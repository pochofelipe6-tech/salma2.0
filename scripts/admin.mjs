import {createClient} from '@supabase/supabase-js';
import {loadEnvFile} from 'node:process';
try{loadEnvFile('.env.local')}catch(e){if(e.code!=='ENOENT')throw e}
const email=process.argv[2]?.trim().toLowerCase();
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SECRET_KEY;
if(!email||!url||!key){
  console.error('Uso: npm run admin -- correo@empresa.com. Configura SUPABASE_SECRET_KEY en .env.local o usa supabase/assign-admin.sql en SQL Editor.');
  process.exit(1);
}
const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
let user;
for(let page=1;!user;page++){
  const {data,error}=await supabase.auth.admin.listUsers({page,perPage:1000});
  if(error){console.error('No se pudo consultar Supabase Auth. Revisa la clave secreta.');process.exit(1)}
  user=data.users.find(u=>u.email?.toLowerCase()===email);
  if(data.users.length<1000)break;
}
if(!user){console.error('Registra primero esta cuenta en la app.');process.exit(1)}
const {error}=await supabase.from('profiles').update({role:'admin'}).eq('id',user.id).select('id').single();
if(error){console.error('No se pudo asignar el rol. Revisa la migración SQL y la clave secreta.');process.exit(1)}
console.log('Administrador asignado: '+email);
