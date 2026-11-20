import {createReadStream} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Instalar la herramienta aislada: npm install --prefix data/map-tools osm-pbf-parser
// Dos pasadas sobre el PBF local: la primera reúne las relaciones (municipios, localidades,
// barrios, perímetros urbanos, usos de suelo y colegios) y la segunda las vías y geometrías.
const require=createRequire(import.meta.url);
const parseOSM=require('../data/map-tools/node_modules/osm-pbf-parser');
const PBF='data/maps/colombia-latest.osm.pbf';
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
const inBox=(lon,lat)=>lat>=south-.03&&lat<=north+.03&&lon>=west-.03&&lon<=east+.03;
const drivable=new Set(['motorway','trunk','primary','secondary','tertiary','unclassified','residential','living_street','service','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link']);
const placeKinds=new Set(['city','town','village','hamlet','suburb','quarter','neighbourhood','locality']);
const urbanLanduse=new Set(['residential','commercial','retail','industrial']);
const isSchool=tags=>tags.amenity==='school'||tags.amenity==='kindergarten';
const areaOfInterest=tags=>(tags.boundary==='administrative'&&['6','7','8','9','10'].includes(tags.admin_level))||placeKinds.has(tags.place)||urbanLanduse.has(tags.landuse)||isSchool(tags);
const keep=(tags,names)=>Object.fromEntries(names.filter(k=>tags[k]!==undefined).map(k=>[k,tags[k]]));
const read=async handle=>pipeline(createReadStream(PBF),parseOSM(),new Writable({objectMode:true,write(items,encoding,next){try{for(const item of items)handle(item);next()}catch(error){next(error)}}}));

console.log('Pasada 1/2: relaciones de municipios, barrios, perímetros urbanos y colegios...');
const relations=[],memberWays=new Set();
await read(item=>{
  if(item.type!=='relation'||!item.tags||!areaOfInterest(item.tags))return;
  const members=item.members.filter(m=>m.type==='way').map(m=>({id:m.id,role:m.role||'outer'}));
  if(!members.length)return;
  relations.push({id:item.id,tags:item.tags,members});
  for(const m of members)memberWays.add(m.id);
});

console.log(`Pasada 2/2: vías y geometrías (${relations.length} relaciones candidatas)...`);
const nodes=new Map(),roads=[],schools=[],places=[],areas=[],wayGeometry=new Map();
await read(item=>{
  const tags=item.tags||{};
  if(item.type==='node'){
    if(!inBox(item.lon,item.lat))return;
    nodes.set(item.id,[item.lon,item.lat]);
    if(isSchool(tags)&&inside(item.lon,item.lat))schools.push({id:item.id,type:'node',tags:keep(tags,['name','amenity']),coordinates:[item.lon,item.lat]});
    if(placeKinds.has(tags.place)&&tags.name)places.push({id:'node:'+item.id,place:tags.place,name:tags.name,coordinates:[item.lon,item.lat]});
  }else if(item.type==='way'){
    const road=drivable.has(tags.highway),area=areaOfInterest(tags),member=memberWays.has(item.id);
    if(!road&&!area&&!member)return;
    const coordinates=item.refs.map(id=>nodes.get(id));
    if(coordinates.some(p=>!p))return;
    if(member)wayGeometry.set(item.id,coordinates);
    if(road&&coordinates.some(p=>inside(...p)))roads.push({id:item.id,tags,coordinates});
    if(!area||item.refs[0]!==item.refs.at(-1))return;
    if(isSchool(tags)){if(coordinates.some(p=>inside(...p)))schools.push({id:item.id,type:'way',tags:keep(tags,['name','amenity']),coordinates})}
    else areas.push({id:'way:'+item.id,tags:keep(tags,['name','boundary','admin_level','place','landuse']),rings:[coordinates]});
  }
});

// Une los tramos de cada relación en anillos cerrados (exteriores e interiores).
function assemble(ways){
  const pending=ways.map(w=>w.slice()),result=[];
  while(pending.length){
    let ring=pending.shift();
    while(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1]){
      const end=ring.at(-1),index=pending.findIndex(w=>(w[0][0]===end[0]&&w[0][1]===end[1])||(w.at(-1)[0]===end[0]&&w.at(-1)[1]===end[1]));
      if(index<0)return null;
      const next=pending.splice(index,1)[0];
      ring=ring.concat((next[0][0]===end[0]&&next[0][1]===end[1]?next:next.reverse()).slice(1));
    }
    result.push(ring);
  }
  return result;
}
let incomplete=0;
for(const relation of relations){
  const outer=relation.members.filter(m=>m.role!=='inner').map(m=>wayGeometry.get(m.id)),inner=relation.members.filter(m=>m.role==='inner').map(m=>wayGeometry.get(m.id));
  if(outer.some(w=>!w)||inner.some(w=>!w)||!outer.length){incomplete++;continue}
  const outerRings=assemble(outer),innerRings=inner.length?assemble(inner):[];
  if(!outerRings||!innerRings){incomplete++;continue}
  const tags=keep(relation.tags,['name','boundary','admin_level','place','landuse','amenity']);
  if(isSchool(relation.tags)){const all=outerRings.flat();if(all.some(p=>inside(...p)))schools.push({id:relation.id,type:'relation',tags,coordinates:outerRings[0]});continue}
  areas.push({id:'relation:'+relation.id,tags,rings:outerRings,holes:innerRings});
}
const atlanticoAreas=areas.filter(a=>a.rings.flat().some(p=>inside(...p)));
const numeric=value=>typeof value==='string'&&/^\d+(?:\.\d+)?(?:\s*(?:km\/h|kph))?$/.test(value.trim());
const count=(list,key)=>list.reduce((total,item)=>({...total,[key(item)]:(total[key(item)]||0)+1}),{});
const report={region:'Atlántico, Colombia',downloadedAt:new Date().toISOString(),source:'https://download.geofabrik.de/south-america/colombia.html',boundarySource:'https://nominatim.openstreetmap.org',boundaryOsmId:boundary.osm_id,license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',roadWays:roads.length,schoolObjects:schools.length,places:count(places,p=>p.place),areas:count(atlanticoAreas,a=>a.tags.boundary?'admin_level_'+a.tags.admin_level:a.tags.place?'place_'+a.tags.place:'landuse_'+a.tags.landuse),incompleteRelations:incomplete,roadsWithMaxspeedTag:roads.filter(r=>r.tags.maxspeed).length,roadsWithNumericMaxspeed:roads.filter(r=>numeric(r.tags.maxspeed)).length,roadsWithSchoolZoneTag:roads.filter(r=>r.tags.school_zone==='yes'||r.tags.hazard==='school_zone').length,notes:['Conteos de objetos OSM, no kilómetros ni colegios necesariamente únicos.','Incluye vías que intersectan el departamento; no recorta sus geometrías al borde.','Los barrios provienen de puntos y polígonos OSM; su cobertura puede estar incompleta.','La clasificación SST se calcula en scripts/build-road-catalog.mjs.']};
await writeFile('data/maps/atlantico-roads.json',JSON.stringify({metadata:report,roads,schools,places,areas:atlanticoAreas}));
await writeFile('data/maps/atlantico-coverage.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
