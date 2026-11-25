import {createReadStream,existsSync} from 'node:fs';
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';

// Completa los edificios del Atlántico que no están en OpenStreetMap con las huellas de Microsoft
// (Global ML Building Footprints, ODbL, https://github.com/microsoft/GlobalMLBuildingFootprints).
// 1) Lee del PBF local los edificios de OSM; 2) agrega cada huella de Microsoft dentro del Atlántico que no se
// cruce con un edificio de OSM; 3) escribe public/building-tiles/<x>_<y>.json (cuadrícula de 0,02° como el mapa).
// Fila: [altura en decímetros o 0, x0, y0, dx1, dy1, ...] en 1e-5 grados (el anillo sin repetir el primer punto).
// Requiere data/maps/ms-buildings/<quadkey>.csv.gz (ver docs/automatic-speed-limits.md, «Lugares y edificios») y el PBF de Colombia.
const require=createRequire(import.meta.url);
const parseOSM=require('../data/map-tools/node_modules/osm-pbf-parser');
const PBF='data/maps/colombia-latest.osm.pbf',MS_DIR='data/maps/ms-buildings',OUT='public/building-tiles',TILE=.02;
const boundary=JSON.parse(await readFile('data/maps/atlantico-boundary.json','utf8'))[0];
const rings=boundary.geojson.coordinates;
const [south,north,west,east]=boundary.boundingbox.map(Number);
const inRing=(x,y,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const [xi,yi]=r[i],[xj,yj]=r[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c}return c};
const inside=(x,y)=>inRing(x,y,rings[0])&&!rings.slice(1).some(r=>inRing(x,y,r));
const inBox=(x,y)=>y>=south&&y<=north&&x>=west&&x<=east;
const centroid=ring=>{let x=0,y=0;const n=ring.length-(ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1]?1:0);for(let i=0;i<n;i++){x+=ring[i][0];y+=ring[i][1]}return [x/n,y/n]};

// ---------- 1) Edificios de OSM, indexados por celdas de ~55 m ----------
const CELL=.0005,osm=new Map();
const cellsOf=ring=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y] of ring){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}const keys=[];for(let x=Math.floor(x0/CELL);x<=Math.floor(x1/CELL);x++)for(let y=Math.floor(y0/CELL);y<=Math.floor(y1/CELL);y++)keys.push(x+':'+y);return keys};
const nodes=new Map();let osmCount=0;
await pipeline(createReadStream(PBF),parseOSM(),new Writable({objectMode:true,write(items,e,next){
  try{
    for(const item of items){
      if(item.type==='node'){if(inBox(item.lon,item.lat))nodes.set(item.id,[item.lon,item.lat]);continue}
      if(item.type!=='way'||!item.tags?.building||item.tags.building==='no'||item.refs[0]!==item.refs.at(-1))continue;
      const ring=item.refs.map(id=>nodes.get(id));
      if(ring.length<4||ring.some(p=>!p))continue;
      const c=centroid(ring);if(!inside(c[0],c[1]))continue;
      osmCount++;
      for(const k of cellsOf(ring)){const list=osm.get(k);if(list)list.push(ring);else osm.set(k,[ring])}
    }
    next();
  }catch(err){next(err)}
}}));
nodes.clear();
console.log(`Edificios OSM en el Atlántico: ${osmCount}`);
// Se cruza si el centro de uno queda dentro del otro.
function overlapsOSM(ring){
  const c=centroid(ring);
  for(const k of cellsOf(ring))for(const o of osm.get(k)||[]){if(inRing(c[0],c[1],o))return true;const oc=centroid(o);if(inRing(oc[0],oc[1],ring))return true}
  return false;
}

// ---------- 2) Huellas de Microsoft ----------
const tiles=new Map();let read=0,added=0,duplicated=0;
const files=(await readdir(MS_DIR)).filter(f=>f.endsWith('.csv.gz'));
if(!files.length)throw new Error(`Faltan las huellas de Microsoft en ${MS_DIR}.`);
for(const file of files){
  const lines=createInterface({input:createReadStream(`${MS_DIR}/${file}`).pipe(createGunzip()),crlfDelay:Infinity});
  for await(const line of lines){
    if(!line.trim())continue;
    read++;
    const feature=JSON.parse(line),ring=feature.geometry?.type==='Polygon'?feature.geometry.coordinates[0]:null;
    if(!ring||ring.length<4)continue;
    const c=centroid(ring);
    if(!inBox(c[0],c[1])||!inside(c[0],c[1]))continue;
    if(overlapsOSM(ring)){duplicated++;continue}
    const pts=ring.slice(0,-1).map(([x,y])=>[Math.round(x*1e5),Math.round(y*1e5)]);
    const row=[Math.max(0,Math.round((feature.properties?.height||0)*10)),pts[0][0],pts[0][1]];
    for(let i=1;i<pts.length;i++)row.push(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
    const key=Math.floor(c[0]/TILE)+'_'+Math.floor(c[1]/TILE);
    const list=tiles.get(key);if(list)list.push(row);else tiles.set(key,[row]);
    added++;
  }
  console.log(`${file}: ${read} huellas leídas, ${added} agregadas, ${duplicated} ya estaban en OSM`);
}

// ---------- 3) Cuadrículas ----------
if(existsSync(OUT))await rm(OUT,{recursive:true,force:true});
await mkdir(OUT,{recursive:true});
let bytes=0,largest=0;
for(const [key,rows] of tiles){const body=JSON.stringify({v:1,b:rows});bytes+=body.length;largest=Math.max(largest,body.length);await writeFile(`${OUT}/${key}.json`,body)}
const date=new Date().toISOString().slice(0,10);
await writeFile(`${OUT}/index.json`,JSON.stringify({v:1,date,size:TILE,tiles:[...tiles.keys()].sort()}));
await writeFile(`${OUT}/LICENSE.md`,`# Edificios complementarios del Atlántico\n\nHuellas de edificios de Microsoft Global ML Building Footprints (https://github.com/microsoft/GlobalMLBuildingFootprints), distribuidas bajo Open Data Commons Open Database License (ODbL) 1.0. Solo se incluyen las que no se cruzan con un edificio de OpenStreetMap (© OpenStreetMap contributors, ODbL).\n\nGenerado con \`scripts/build-building-tiles.mjs\` el ${date}. Las huellas se detectaron automáticamente en imágenes satelitales y pueden tener errores.\n`);
console.log(JSON.stringify({edificiosOSM:osmCount,huellasMicrosoftLeidas:read,agregadas:added,yaEnOSM:duplicated,cuadriculas:tiles.size,megabytes:+(bytes/1e6).toFixed(1),mayorKB:Math.round(largest/1e3)},null,2));
