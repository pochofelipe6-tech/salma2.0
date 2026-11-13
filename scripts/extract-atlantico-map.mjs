import {createReadStream} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Instalar la herramienta aislada: npm install --prefix data/map-tools osm-pbf-parser
const require=createRequire(import.meta.url);
const parseOSM=require('../data/map-tools/node_modules/osm-pbf-parser');
const boundary=JSON.parse(await readFile('data/maps/atlantico-boundary.json','utf8'))[0];
if(boundary?.geojson?.type!=='Polygon')throw new Error('Falta el polígono departamental de Atlántico.');
const rings=boundary.geojson.coordinates;
const [south,north,west,east]=boundary.boundingbox.map(Number);
function insideRing(lon,lat,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>lat)!==(yj>lat)&&lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)inside=!inside;
  }
  return inside;
}
function inside(lon,lat){return insideRing(lon,lat,rings[0])&&!rings.slice(1).some(r=>insideRing(lon,lat,r))}
const nodes=new Map(),roads=[],schools=[];
const drivable=new Set(['motorway','trunk','primary','secondary','tertiary','unclassified','residential','living_street','service','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link']);
console.log('Extrayendo Atlántico del PBF local con su límite administrativo...');
await pipeline(createReadStream('data/maps/colombia-latest.osm.pbf'),parseOSM(),new Writable({objectMode:true,write(items,encoding,next){
  try{
    for(const item of items){
      const tags=item.tags||{};
      if(item.type==='node'){
        if(item.lat<south-.01||item.lat>north+.01||item.lon<west-.01||item.lon>east+.01)continue;
        nodes.set(item.id,[item.lon,item.lat]);
        if(tags.amenity==='school'&&inside(item.lon,item.lat))schools.push({id:item.id,type:'node',tags,coordinates:[item.lon,item.lat]});
      }else if(item.type==='way'&&(drivable.has(tags.highway)||tags.amenity==='school')){
        const coordinates=item.refs.map(id=>nodes.get(id));
        if(coordinates.some(p=>!p)||!coordinates.some(p=>inside(...p)))continue;
        if(drivable.has(tags.highway))roads.push({id:item.id,tags,coordinates});
        if(tags.amenity==='school')schools.push({id:item.id,type:'way',tags,coordinates});
      }
    }
    next();
  }catch(error){next(error)}
}}));
const numeric=value=>typeof value==='string'&&/^\d+(?:\.\d+)?(?:\s*(?:km\/h|kph))?$/.test(value.trim());
const report={region:'Atlántico, Colombia',downloadedAt:new Date().toISOString(),source:'https://download.geofabrik.de/south-america/colombia.html',boundarySource:'https://nominatim.openstreetmap.org',boundaryOsmId:boundary.osm_id,license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',roadWays:roads.length,schoolObjects:schools.length,roadsWithMaxspeedTag:roads.filter(r=>r.tags.maxspeed).length,roadsWithNumericMaxspeed:roads.filter(r=>numeric(r.tags.maxspeed)).length,roadsWithConditionalLimit:roads.filter(r=>Object.keys(r.tags).some(k=>k.startsWith('maxspeed:')&&k.includes('conditional'))).length,roadsWithSchoolZoneTag:roads.filter(r=>r.tags.school_zone==='yes'||r.tags.hazard==='school_zone').length,notes:['Conteos de objetos OSM, no kilómetros ni colegios necesariamente únicos.','Incluye vías que intersectan el departamento; no recorta sus geometrías al borde.','Los polígonos escolares no equivalen a una zona de velocidad alrededor del colegio.','Faltan posibles colegios representados por relaciones OSM.','La clasificación de vía no demuestra un límite legal; no se inventan límites para datos ausentes.','Este extracto no activa la detección automática de la aplicación.']};
await writeFile('data/maps/atlantico-roads.json',JSON.stringify({metadata:report,roads,schools}));
await writeFile('data/maps/atlantico-coverage.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
