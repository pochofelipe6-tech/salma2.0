import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRoadMatcher} from '../lib/road-matcher.ts';
const road=(id,lat,limit)=>({id,name:id,kind:'residential',zone:'escolar',label:'Vía residencial',limit,geometry:[[-75,lat],[-74.99,lat]]});
const fix=(lat,lng=-74.995,seconds=6,accuracy=5)=>({lat,lng,accuracy,recorded_at:new Date(1700000000000+seconds*1000).toISOString()});
const previous=fix(10.8,-74.996,0),current=fix(10.8);
for(const [zone,limit] of Object.entries({urbana:50,nacional:70,curvas:35,escolar:30})){const result=createRoadMatcher([{...road('1',10.8,40),zone}])(current,previous);assert.equal(result.limit,limit);assert.equal(result.postedLimit,40)}
assert.equal(createRoadMatcher([road('1',10.8,50)])(current).status,'unknown');
assert.equal(createRoadMatcher([road('1',10.8,50)])({...current,accuracy:30},previous).status,'unknown');
assert.equal(createRoadMatcher([road('1',10.8,50)])(fix(4.65),previous).status,'unknown');
assert.equal(createRoadMatcher([road('1',10.8,null),road('2',10.80018,50)])(current,previous).limit,null);
assert.equal(createRoadMatcher([road('1',10.8,50),road('2',10.80002,30)])(current,previous).status,'unknown');
assert.equal(createRoadMatcher([road('1',10.8,50)])(fix(10.8,-74.995,30),previous).status,'unknown');
assert.equal(createRoadMatcher([road('1',10.8,50)])(current,fix(10.82,-74.995,0)).status,'unknown');
const catalog=JSON.parse(await readFile('assets/maps/atlantico-roads.json','utf8'));
const match=createRoadMatcher(catalog.roads);
let realMatch;
for(const r of catalog.roads.filter(r=>r.limit)){
  for(let i=1;i<r.geometry.length;i++){
    const [a,b]=[r.geometry[i-1],r.geometry[i]],lat=(a[1]+b[1])/2,lng=(a[0]+b[0])/2;
    const result=match(fix(lat,lng),fix(lat,lng,0));
    if(result.status==='known'){realMatch=result;break}
  }
  if(realMatch)break;
}
assert.ok(realMatch,'El catálogo real debe producir al menos una identificación inequívoca.');
assert.equal(realMatch.source,'OpenStreetMap');
console.log('PASS: límites variables, GPS impreciso, fuera de cobertura, cruces, vía sin límite, cambio de tramo y catálogo real.',realMatch);
