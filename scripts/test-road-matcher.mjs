import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRoadTracker,createSegmentIndex,validFix} from '../lib/road-matcher.ts';
import {decodeTile,tileKey,tilesAround} from '../lib/map-tiles.ts';

const T0=1700000000000;
const fix=(lat,lng,second=0,accuracy=5)=>({lat,lng,accuracy,recorded_at:new Date(T0+second*1000).toISOString()});
const seg=(id,name,zone,geometry,extra={})=>({id,name,zone,label:name,place:'Prueba',kind:'secondary',posted:0,oneway:0,geometry,...extra});
const tracker=segments=>{const index=createSegmentIndex();index.add(segments);return createRoadTracker(index)};

// ---------- Casos sintéticos ----------
// Límite por zona SST.
for(const [zone,limit] of Object.entries({urbana:50,nacional:70,curvas:35,escolar:30})){
  const t=tracker([seg(`${zone}-0`,'Vía',zone,[[-75,10.8],[-74.99,10.8]])]);
  assert.equal(t.match(fix(10.8,-74.995)).limit,limit);
}
// GPS impreciso y fuera de vía.
assert.equal(tracker([seg('1-0','Vía','urbana',[[-75,10.8],[-74.99,10.8]])]).match(fix(10.8,-74.995,0,40)).status,'unknown');
assert.equal(tracker([seg('1-0','Vía','urbana',[[-75,10.8],[-74.99,10.8]])]).match(fix(10.801,-74.995)).status,'unknown');
assert.equal(validFix({lat:1}),false);
// Cruce: al pasar por la intersección se mantiene la vía por la que se circula (rumbo este).
{
  const t=tracker([seg('10-0','Avenida','nacional',[[-75,10.8],[-74.99,10.8]]),seg('20-0','Calle transversal','urbana',[[-74.995,10.79],[-74.995,10.81]],{kind:'residential'})]);
  let s=0;for(const lng of [-74.9956,-74.9953,-74.9950,-74.9947,-74.9944])assert.equal(t.match(fix(10.8,lng,s++),60).roadName,'Avenida');
}
// Calzadas paralelas de un solo sentido a 14 m: se elige la del sentido de marcha.
{
  const north=seg('30-0','Calzada norte','nacional',[[-74.99,10.80013],[-75,10.80013]],{oneway:1});// sentido oeste
  const south=seg('31-0','Calzada sur','nacional',[[-75,10.8],[-74.99,10.8]],{oneway:1});// sentido este
  const t=tracker([north,south]);
  t.match(fix(10.80008,-74.9960,0,8),70);
  assert.equal(t.match(fix(10.80008,-74.9958,1,8),70).roadName,'Calzada sur');
}
// Vía paralela residencial a alta velocidad: prioriza la vía principal.
{
  const t=tracker([seg('40-0','Autopista','nacional',[[-75,10.8],[-74.99,10.8]],{kind:'trunk'}),seg('41-0','Calle de servicio','urbana',[[-75,10.80016],[-74.99,10.80016]],{kind:'residential'})]);
  t.match(fix(10.80009,-74.9960),80);
  assert.equal(t.match(fix(10.80009,-74.9958,1),80).roadName,'Autopista');
}
// Giro a otra calle: se reconoce en dos lecturas como máximo.
{
  const t=tracker([seg('50-0','Calle A','urbana',[[-75,10.8],[-74.995,10.8]]),seg('51-0','Calle B','escolar',[[-74.995,10.8],[-74.995,10.81]])]);
  t.match(fix(10.8,-74.9955,0),20);t.match(fix(10.8,-74.9951,1),20);t.match(fix(10.80012,-74.995,2),20);
  const turned=t.match(fix(10.80024,-74.995,3),20);
  assert.equal(turned.roadName,'Calle B');assert.equal(turned.limit,30);
}
// Salto de GPS hacia una calle paralela a 12 m sin cambio de rumbo: se mantiene la vía (dos lecturas para cambiar).
{
  const t=tracker([seg('52-0','Calle A','urbana',[[-75,10.8],[-74.99,10.8]]),seg('53-0','Calle B','escolar',[[-75,10.80011],[-74.99,10.80011]])]);
  t.match(fix(10.8,-74.9960,0),30);t.match(fix(10.8,-74.9958,1),30);
  assert.equal(t.match(fix(10.80009,-74.9956,2),30).roadName,'Calle A');
  assert.equal(t.match(fix(10.80001,-74.9954,3),30).roadName,'Calle A');
}
console.log('PASS sintético: límites, imprecisión, cruces, calzadas, vía principal y cambio de vía.');

// ---------- Recorridos simulados sobre el mapa real ----------
const catalog=JSON.parse(readFileSync('public/map-tiles/index.json','utf8')),available=new Set(catalog.tiles),cache=new Map();
const loadTile=key=>{if(!cache.has(key))cache.set(key,available.has(key)?decodeTile(JSON.parse(readFileSync(`public/map-tiles/${key}.json`,'utf8'))):[]);return cache.get(key)};
const all=new Map();for(const key of available)for(const s of loadTile(key))all.set(s.id,s);
let seed=42;const random=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
const M=111195,length=g=>g.slice(1).reduce((t,p,i)=>t+Math.hypot((p[0]-g[i][0])*M*Math.cos(p[1]*Math.PI/180),(p[1]-g[i][1])*M),0);
// Recorre la vía completa (todos sus tramos en orden) a velocidad constante con ruido GPS de ±6 m.
function drive(wayId,kmh){
  const parts=[...all.values()].filter(s=>s.id.split('-')[0]===wayId).sort((a,b)=>Number(a.id.split('-')[1])-Number(b.id.split('-')[1]));
  const index=createSegmentIndex();const t=createRoadTracker(index);
  const step=kmh/3.6;let second=0,ok=0,total=0,carry=0;const wrong={};
  for(const part of parts)for(let i=1;i<part.geometry.length;i++){
    const a=part.geometry[i-1],b=part.geometry[i],d=Math.hypot((b[0]-a[0])*M*Math.cos(a[1]*Math.PI/180),(b[1]-a[1])*M);
    for(let s=carry;s<d;s+=step){
      const k=s/d,lng=a[0]+(b[0]-a[0])*k+(random()-.5)*12/(M*Math.cos(a[1]*Math.PI/180)),lat=a[1]+(b[1]-a[1])*k+(random()-.5)*12/M;
      for(const key of tilesAround(lat,lng,300))index.add(loadTile(key));
      const result=t.match(fix(lat,lng,second++,8),kmh);
      if(second<=2)continue;total++;
      if(result.roadId?.split('-')[0]===wayId||(result.roadName===part.name&&result.zone===part.zone))ok++;else{const w=result.roadName||result.reason;wrong[w]=(wrong[w]||0)+1}
    }
    carry=0;
  }
  return {ok,total,wrong};
}
const ways=new Map();for(const s of all.values()){const id=s.id.split('-')[0];const w=ways.get(id)||{name:s.name,kind:s.kind,zones:new Set(),length:0};w.zones.add(s.zone);w.length+=length(s.geometry);ways.set(id,w)}
const pick=(test,count)=>[...ways.entries()].filter(([,w])=>test(w)).sort(()=>random()-.5).slice(0,count);
const groups={
  'La Cordialidad':pick(w=>/Cordialidad/.test(w.name)&&w.length>150,15),
  'Vía Oriental':pick(w=>/Oriental/.test(w.name)&&w.length>150,15),
  'Circunvalar de la Prosperidad':pick(w=>/Prosperidad/.test(w.name)&&w.length>150,15),
  'Calles urbanas de Barranquilla y Soledad':pick(w=>['residential','secondary','tertiary','primary'].includes(w.kind)&&w.length>80&&w.zones.has('urbana'),60),
};
let failures=0;
for(const [name,list] of Object.entries(groups)){
  let ok=0,total=0;const wrong={};
  for(const [id,w] of list){const r=drive(id,w.kind==='trunk'?80:40);ok+=r.ok;total+=r.total;for(const [k,v] of Object.entries(r.wrong))wrong[k]=(wrong[k]||0)+v}
  const rate=ok/Math.max(1,total);
  console.log(`${name}: ${(rate*100).toFixed(1)} % de ${total} lecturas en la vía correcta`,Object.entries(wrong).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k} (${v})`).join(', '));
  assert.ok(list.length>0,`Sin vías de prueba para ${name}`);
  if(rate<.9)failures++;
}
// Clasificación de las vías nacionales pedidas y de un tramo urbano.
const zonesOf=re=>{const km={};for(const s of all.values())if(re.test(s.name))km[s.zone]=(km[s.zone]||0)+length(s.geometry);return km};
for(const re of [/Autopista de La Cordialidad/,/Circunvalar de la Prosperidad/,/Oriental/]){const km=zonesOf(re);assert.ok(km.nacional>(km.urbana||0),`${re} debe ser mayormente vía nacional`)}
const lookup=(lat,lng)=>{const index=createSegmentIndex();for(const key of tilesAround(lat,lng,200))index.add(loadTile(key));return createRoadTracker(index).match(fix(lat,lng,0,5))};
const carrera46=[...all.values()].find(s=>s.name==='Avenida Carrera 46'&&s.zone==='urbana');
assert.equal(lookup(carrera46.geometry[0][1],carrera46.geometry[0][0]).limit,50);
assert.ok(tileKey(-74.8,10.98)&&available.size>100);
assert.equal(failures,0,'Algún grupo de vías quedó por debajo del 90 % de reconocimiento.');
console.log('PASS: reconocimiento en recorridos simulados y clasificación de vías nacionales y urbanas.');

// ---------- Colegios oficiales (lib/school-zones.ts) ----------
const {createSchoolIndex,withOfficialSchool,zoneAt}=await import('../lib/school-zones.ts');
const schoolIndex=createSchoolIndex({v:1,date:'2026-11-25',license:'CC BY-SA 4.0',attribution:'prueba',s:[['Institución Educativa Prueba',-74.9,10.65]]});
const at=metres=>[10.65,-74.9+metres/(111195*Math.cos(10.65*Math.PI/180))];
const urbanMatch={status:'known',reason:'',roadId:'1-0',roadName:'Calle 10',zone:'urbana',label:'Zona urbana',kind:'residential',limit:50};
const near=withOfficialSchool(urbanMatch,...at(60),schoolIndex);
assert.equal(near.zone,'escolar');assert.equal(near.limit,30);assert.equal(near.label,'Zona escolar · Institución Educativa Prueba');
assert.equal(withOfficialSchool(urbanMatch,...at(120),schoolIndex),urbanMatch,'A 120 m no es zona escolar.');
assert.equal(withOfficialSchool({...urbanMatch,kind:'motorway',zone:'nacional',limit:70},...at(10),schoolIndex).zone,'nacional','En autopista no hay zona escolar.');
assert.equal(zoneAt({zone:'urbana',kind:'residential'},...at(30),schoolIndex),'escolar');
assert.equal(zoneAt({zone:'nacional',kind:'motorway'},...at(30),schoolIndex),'nacional');
assert.equal(createSchoolIndex({v:2,s:'dañado'}).near(10.65,-74.9),null,'Un archivo inválido no genera zonas.');
// Archivo publicado: colegios dentro del Atlántico y con nombre.
const officialFile=JSON.parse(readFileSync('public/map-tiles/colegios-oficiales.json','utf8'));
assert.ok(officialFile.s.length>300&&officialFile.license==='CC BY-SA 4.0');
assert.ok(officialFile.s.every(([name,lng,lat])=>name&&lng>-75.4&&lng<-74.6&&lat>10.2&&lat<11.2));
console.log('PASS: zona escolar por colegios oficiales ('+officialFile.s.length+' sedes en archivo aparte).');
