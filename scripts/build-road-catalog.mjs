import {mkdir,readFile,writeFile} from 'node:fs/promises';
const raw=JSON.parse(await readFile('data/maps/atlantico-roads.json','utf8'));
const roads=raw.roads.map(r=>{
  const t=r.tags;
  const conditional=Object.keys(t).some(k=>k.startsWith('maxspeed:')&&(/conditional|forward|backward|lanes|variable/.test(k)));
  const value=/^\d+(?:\s*(?:km\/h|kph))?$/.test(t.maxspeed||'')?parseInt(t.maxspeed,10):null;
  const limit=!conditional&&value&&value<=200?value:null;
  const zone=t.school_zone==='yes'||t.hazard==='school_zone'||['residential','living_street'].includes(t.highway)?'escolar':['25','90','90A'].includes(t.ref)&&['motorway','trunk','primary','secondary'].includes(t.highway)?'nacional':'urbana';
  const label=t.school_zone==='yes'||t.hazard==='school_zone'?'Zona escolar':['residential','living_street'].includes(t.highway)?'Vía residencial':zone==='nacional'?'Vía nacional':'Zona urbana';
  return {id:String(r.id),name:t.name||t.ref||'Vía sin nombre',kind:t.highway,zone,label,limit,geometry:r.coordinates.map(p=>p.map(n=>+n.toFixed(7)))};
});
await mkdir('assets/maps',{recursive:true});
await writeFile('assets/maps/atlantico-roads.json',JSON.stringify({source:'OpenStreetMap',date:raw.metadata.downloadedAt,license:'ODbL-1.0',roads}));
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const rows=roads.filter(r=>r.limit).map(r=>`(${quote(r.id)},${quote(r.name)},${quote(r.zone)},${r.limit},${quote(JSON.stringify(r.geometry))}::jsonb)`);
const sql=`-- Catálogo OSM Atlántico. Generado por scripts/build-road-catalog.mjs.\nbegin;\n`+
`insert into public.road_limits(id,name,zone,limit_speed,geometry) values\n${rows.join(',\n')}\non conflict(id) do update set name=excluded.name,zone=excluded.zone,limit_speed=excluded.limit_speed,geometry=excluded.geometry;\nnotify pgrst,'reload schema';\ncommit;\n`;
await writeFile('supabase/migrations/007_atlantico_road_catalog.sql',sql);
const policySql=`-- Actualiza el catalogo existente a limites preventivos SST. Ejecutar tras 006 y 007.
begin;
alter table public.road_limits add column if not exists posted_limit integer;
update public.road_limits set posted_limit=coalesce(posted_limit,limit_speed);
update public.road_limits r set posted_limit=v.posted,zone=v.zone,limit_speed=case v.zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 end
from (values ${roads.filter(r=>r.limit).map(r=>`(${quote(r.id)},${quote(r.zone)},${r.limit})`).join(',\n')}) as v(id,zone,posted) where r.id=v.id;
notify pgrst,'reload schema';
commit;
`;
await writeFile('supabase/migrations/008_sst_zone_limits.sql',policySql);
const schema=await readFile('supabase/migrations/006_automatic_limits.sql','utf8');
await writeFile('supabase/enable-automatic-limits.sql','-- Ejecutar completo en Supabase > SQL Editor. No elimina viajes ni eventos.\n'+schema+'\n'+sql+'\n'+policySql);
console.log(`${roads.length} vías incluidas; ${rows.length} límites fijos utilizables. Datos versionados para Vercel.`);
