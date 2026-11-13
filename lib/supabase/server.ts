import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';

export async function createClient() {
  const url=(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key=(process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if(!url||!key) throw Object.assign(new Error('Falta configurar Supabase en el servidor. En Vercel configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para Production y vuelve a desplegar.'),{code:'SUPABASE_CONFIG'});
  try{const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))throw new Error()}
  catch{throw Object.assign(new Error('La URL de Supabase configurada en el servidor no es válida.'),{code:'SUPABASE_CONFIG'})}
  const store=await cookies();
  // Solo las rutas de servidor utilizan esta sesión; el navegador no lee tokens.
  return createServerClient(url,key,{
    cookieOptions:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/'},
    cookies:{
      getAll:()=>store.getAll(),
      setAll:items=>{for(const {name,value,options} of items)store.set(name,value,options)},
    },
  });
}
