import {loadEnvFile} from 'node:process';
try{loadEnvFile('.env.local')}catch(e){if(e.code!=='ENOENT')throw e}
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key){console.error('Falta la configuración de Supabase.');process.exit(1)}
let failed=false;
for(const table of ['profiles','vehicles','trips','events','route_points']){
  const r=await fetch(`${url}/rest/v1/${table}?select=id&limit=0`,{headers:{apikey:key}});
  const body=await r.json();
  if(body.code==='PGRST205'||body.code==='42P01'){console.error(`Falta la tabla ${table}. Ejecuta las migraciones de supabase/migrations en orden.`);failed=true}
  else if(r.ok&&Array.isArray(body)&&body.length===0)console.log(`${table}: endpoint disponible, sin registros públicos en esta consulta.`);
  else if(body.code==='42501')console.log(`${table}: acceso anónimo bloqueado.`);
  else{console.error(`${table}: respuesta inesperada (HTTP ${r.status}).`);failed=true}
}
if(failed)process.exitCode=1;
