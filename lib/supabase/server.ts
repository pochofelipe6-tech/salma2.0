import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';

export async function createClient() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key) throw new Error('Faltan las variables de Supabase en .env.local.');
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
