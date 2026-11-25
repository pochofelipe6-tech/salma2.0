import {createReadStream} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Puntos de interés del Atlántico desde el PBF local (OpenStreetMap, ODbL): colegios con todas sus formas de
// etiquetado, universidades, iglesias, centros comerciales, salud, policía, bomberos, alcaldías, mercados,
// terminales y escenarios deportivos. Una pasada; los predios (vías cerradas) guardan su contorno.
// Salida: data/maps/atlantico-pois.json. Requiere data/maps/atlantico-boundary.json y el PBF de Colombia.
const require=createRequire(import.meta.url);
const parseOSM=require('../data/map-tools/node_modules/osm-pbf-parser');
const PBF='data/maps/colombia-latest.osm.pbf';
const boundary=JSON.parse(await readFile('data/maps/atlantico-boundary.json','utf8'))[0];
const rings=boundary.geojson.coordinates;
const [south,north,west,east]=boundary.boundingbox.map(Number);
const inRing=(x,y,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const [xi,yi]=r[i],[xj,yj]=r[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c}return c};
const inside=(x,y)=>inRing(x,y,rings[0])&&!rings.slice(1).some(r=>inRing(x,y,r));
const inBox=(x,y)=>y>=south&&y<=north&&x>=west&&x<=east;

// Nombres que indican colegio cuando falta la etiqueta, y los que no son colegios de niños.
const SCHOOL_NAME=/\b(colegio|instituci[oó]n educativa|escuela|liceo|jard[ií]n infantil|centro educativo|concentraci[oó]n escolar|normal superior|preescolar)\b/i;
const NOT_A_SCHOOL=/\b(naval|polic[ií]a|militar|cadetes|suboficiales|universi|sena|tecnol[oó]gic|corporaci[oó]n|conducci[oó]n|antigu[oa]|f[uú]tbol|deportiva|idiomas|m[uú]sica|baile|danza)\b/i;
// Educación superior por nombre (aunque falte la etiqueta): universidades, corporaciones, fundaciones e instituciones
// universitarias, politécnicos, tecnológicos y el SENA.
const HIGHER_ED=/\b(universidad|universitari[ao]|corporaci[oó]n (universitaria|tecnol[oó]gica|educativa)|fundaci[oó]n universitaria|instituci[oó]n universitaria|polit[eé]cnico|tecnol[oó]gico|escuela superior|sena|itsa|unad|uniminuto|unicorsalud)\b/i;
const CAMPUS_PART=/^(bloque|edificio|comedor|ba[nñ]os|parqueadero|cafeter|auditorio|laboratorio|aula|torre|coliseo|biblioteca|porter[ií]a|teatro|polideportivo|gimnasio|piscina|cancha|estadio|museo|bellas artes)\b/i;
export function classify(t){
  const name=t.name||'';
  if(t.disused||t['disused:amenity']||t.abandoned)return null;
  const higher=HIGHER_ED.test(name);
  const school=['school','kindergarten','childcare'].includes(t.amenity)||['school','kindergarten'].includes(t.building)||t.landuse==='education'
    ||(t.amenity==='college'&&!higher)
    ||(name&&SCHOOL_NAME.test(name)&&!higher&&!t.highway&&!t.amenity&&!t.shop);
  if(school)return higher?'universidad':NOT_A_SCHOOL.test(name)?null:'colegio';
  // Edificios internos de un campus («Bloque I2», «Comedor - Baños»): no son una institución aparte.
  const campusPart=(CAMPUS_PART.test(name)&&t.amenity!=='university')||(['university','college'].includes(t.building)&&!t.amenity&&(!name||!higher));
  if(!campusPart&&(['university','college'].includes(t.amenity)||['university','college'].includes(t.building)||(higher&&!t.highway&&!t.shop)))return 'universidad';
  if(t.amenity==='place_of_worship'||['church','cathedral','chapel'].includes(t.building))return 'iglesia';
  if(t.shop==='mall'||/^(c\.?\s?c\.?\s|centro comercial)/i.test(name))return 'centro_comercial';
  if(['hospital','clinic'].includes(t.amenity)||t.healthcare==='hospital'||t.building==='hospital')return 'salud';
  if(t.amenity==='police')return 'policia';
  if(t.amenity==='fire_station')return 'bomberos';
  if(t.amenity==='townhall')return 'alcaldia';
  if(t.amenity==='marketplace'||t.shop==='supermarket')return 'mercado';
  if(t.amenity==='bus_station')return 'terminal';
  if(t.leisure==='stadium'||t.leisure==='sports_centre')return 'deporte';
  return null;
}
const read=async handle=>pipeline(createReadStream(PBF),parseOSM(),new Writable({objectMode:true,write(items,e,next){try{for(const it of items)handle(it);next()}catch(err){next(err)}}}));
const nodes=new Map(),pois=[];
await read(item=>{
  const t=item.tags||{};
  if(item.type==='node'){
    if(!inBox(item.lon,item.lat))return;
    nodes.set(item.id,[item.lon,item.lat]);
    const kind=classify(t);
    if(kind&&inside(item.lon,item.lat))pois.push({id:'node/'+item.id,kind,name:(t.name||'').trim(),coordinates:[item.lon,item.lat],tags:{amenity:t.amenity,building:t.building}});
  }else if(item.type==='way'){
    const kind=classify(t);if(!kind)return;
    const pts=item.refs.map(id=>nodes.get(id)).filter(Boolean);if(pts.length<2)return;
    const lng=pts.reduce((s,p)=>s+p[0],0)/pts.length,lat=pts.reduce((s,p)=>s+p[1],0)/pts.length;
    if(!inside(lng,lat))return;
    pois.push({id:'way/'+item.id,kind,name:(t.name||'').trim(),coordinates:[lng,lat],ring:item.refs[0]===item.refs.at(-1)&&pts.length>3?pts:null,tags:{amenity:t.amenity,building:t.building}});
  }
});
const count=pois.reduce((o,p)=>({...o,[p.kind]:(o[p.kind]||0)+1}),{});
const metadata={date:new Date().toISOString().slice(0,10),source:'OpenStreetMap (Geofabrik, Colombia)',license:'ODbL-1.0',total:pois.length,porTipo:count};
await writeFile('data/maps/atlantico-pois.json',JSON.stringify({metadata,pois}));
console.log(JSON.stringify(metadata,null,2));
