import {detectRoad} from '../../../lib/road-catalog';
import {validFix} from '../../../lib/road-matcher';
import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '../../../lib/supabase/server';
import {zones} from '../../../lib/zones';
import {isAllowedOrigin} from '../../../lib/request-origin';
import type {SupabaseClient} from '@supabase/supabase-js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
type Profile={id:string;name:string;role:'driver'|'admin'};
type Vehicle={id:number;user_id:string;plate:string;model:string};
type Trip={id:number;user_id:string;vehicle_id:number;started:string;ended:string|null};
type Event={id:number;trip_id:number;user_id:string;zone:string;sector:string;speed:number;limit_speed:number;lat:number;lng:number;created:string};
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const fail=(error:string,status=400)=>json({error},status);
const positiveId=(value:unknown)=>Number.isSafeInteger(Number(value))&&Number(value)>0;
function databaseError(error:{code?:string;message:string}):never{throw Object.assign(new Error(error.message),{code:error.code})}

// Pagina para conservar los conteos y CSV completos con el límite de PostgREST.
async function readAll<T>(client:SupabaseClient,table:'profiles'|'vehicles'|'trips'|'events'):Promise<T[]>{
  const rows:T[]=[];
  for(let offset=0;;offset+=1000){
    const result=await client.from(table).select('*').order('id').range(offset,offset+999);
    if(result.error)databaseError(result.error);
    rows.push(...result.data as T[]);
    if(result.data.length<1000)return rows;
  }
}

export async function GET(req:NextRequest){return handle(req)}
export async function POST(req:NextRequest){return handle(req)}
async function handle(req:NextRequest){
try{
  const action=req.nextUrl.pathname.split('/').pop();
  if(req.method==='POST'&&!isAllowedOrigin(req))return fail('Origen no permitido.',403);
  let b:Record<string,unknown>={};
  if(req.method==='POST'){
    try{const value=await req.json();if(!value||typeof value!=='object'||Array.isArray(value))return fail('Datos inválidos.');b=value}catch{return fail('La solicitud debe contener JSON válido.')}
  }
  const supabase=await createClient();
  if(action==='login'||action==='register'){
    if(req.method!=='POST')return fail('Método no permitido.',405);
    const email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<6||password.length>128)return fail('Ingresa un correo válido y una contraseña de 6 a 128 caracteres.');
    if(action==='register'){
      const name=String(b.name||'').trim().slice(0,100);
      if(!name)return fail('Ingresa tu nombre.');
      const {data,error}=await supabase.auth.signUp({email,password,options:{data:{name},emailRedirectTo:new URL('/auth/callback',req.url).toString()}});
      if(error){if(error.code==='over_email_send_rate_limit'||error.status===429)return fail('Supabase limitó el envío de correos. Espera unos minutos e inténtalo de nuevo.',429);return fail('No se pudo crear la cuenta. Revisa el correo y la contraseña o intenta iniciar sesión.');}
      if(!data.session)return json({ok:true,confirmationRequired:true,message:'Revisa tu correo y confirma tu cuenta. Después vuelve aquí e inicia sesión.'});
    }else{
      const {error}=await supabase.auth.signInWithPassword({email,password});
      if(error)return fail(error.code==='email_not_confirmed'?'Confirma tu correo antes de ingresar.':'Correo o contraseña incorrectos.',401);
    }
    return json({ok:true});
  }
  const {data:auth,error:authError}=await supabase.auth.getUser();
  if(authError||!auth.user)return fail('Inicia sesión para continuar.',401);
  const user=auth.user;
  if(action==='logout'&&req.method==='POST'){
    const {error}=await supabase.auth.signOut({scope:'local'});
    if(error)return fail('No se pudo cerrar la sesión.',503);
    return json({ok:true});
  }
  if(action==='state'&&req.method==='GET'){
    const [profiles,vehicles,trips,events]=await Promise.all([
      readAll<Profile>(supabase,'profiles'),readAll<Vehicle>(supabase,'vehicles'),
      readAll<Trip>(supabase,'trips'),readAll<Event>(supabase,'events'),
    ]);
    const profile=profiles.find(p=>p.id===user.id);
    if(!profile)return fail('Falta tu perfil. Ejecuta la migración SQL de Supabase.',503);
    const names=new Map(profiles.map(p=>[p.id,p.name]));
    const models=new Map(vehicles.map(v=>[v.id,v.model]));
    const plates=new Map(vehicles.map(v=>[v.id,v.plate]));
    const tripVehicles=new Map(trips.map(t=>[t.id,t.vehicle_id]));
    return json({user:{id:user.id,name:profile.name,email:user.email,role:profile.role},
      vehicles:vehicles.map(v=>({...v,driver:names.get(v.user_id)||'Conductor'})),
      trips:trips.reverse().map(t=>({...t,driver:names.get(t.user_id)||'Conductor',plate:plates.get(t.vehicle_id)||'—',model:models.get(t.vehicle_id)||''})),
      events:events.reverse().map(e=>({...e,driver:names.get(e.user_id)||'Conductor',plate:plates.get(tripVehicles.get(e.trip_id)!)||'—'})),
    });
  }
  if(action==='positions'&&req.method==='GET'){
    const trip=req.nextUrl.searchParams.get('trip');
    if(!positiveId(trip))return fail('Viaje inválido.');
    const {data:current,error:tripError}=await supabase.from('trips').select('id').eq('id',Number(trip)).maybeSingle();
    if(tripError)databaseError(tripError);
    if(!current)return fail('El viaje no está disponible.',404);
    const points:unknown[]=[];
    for(let offset=0;;offset+=1000){
      const result=await supabase.from('route_points').select('lat,lng,accuracy,recorded_at').eq('trip_id',current.id).order('recorded_at').range(offset,offset+999);
      if(result.error){if(result.error.code==='PGRST205')return fail('Falta guardar la migración 002_route_points.sql en Supabase.',503);databaseError(result.error)}
      points.push(...result.data!);if(result.data!.length<1000)break;
    }
    return json({points});
  }
  if(req.method!=='POST')return fail('Método no permitido.',405);
  if(action==='delete-trip'){
    if(!positiveId(b.trip))return fail('Ruta no válida.');
    const {data:profile,error:profileError}=await supabase.from('profiles').select('role').eq('id',user.id).single();
    if(profileError)databaseError(profileError);
    if(profile?.role!=='admin')return fail('Solo el administrador puede eliminar rutas.',403);
    const {data:deleted,error}=await supabase.from('trips').delete().eq('id',Number(b.trip)).select('id');
    if(error){
      if(error.code==='42501')return fail('Faltan permisos de Supabase. Ejecuta supabase/enable-admin-delete.sql en el SQL Editor para habilitar la eliminación de viajes y vehículos.',503);
      databaseError(error);
    }
    if(!deleted?.length)return fail('La ruta ya no está disponible.',404);
    return json({ok:true});
  }
  if(action==='delete-vehicle'){
    if(!positiveId(b.vehicle))return fail('Vehiculo no valido.');
    const {data:profile,error:profileError}=await supabase.from('profiles').select('role').eq('id',user.id).single();
    if(profileError)databaseError(profileError);
    if(profile?.role!=='admin')return fail('Solo el administrador puede eliminar vehiculos.',403);
    const {data:trips,error:tripError}=await supabase.from('trips').select('id').eq('vehicle_id',Number(b.vehicle)).limit(1);
    if(tripError)databaseError(tripError);
    if(trips?.length)return fail('Este vehiculo tiene viajes registrados. Se conserva para proteger el historial.',409);
    const {data:deleted,error}=await supabase.from('vehicles').delete().eq('id',Number(b.vehicle)).select('id');
    if(error){
      if(error.code==='42501')return fail('Faltan permisos de Supabase. Ejecuta supabase/enable-admin-delete.sql en el SQL Editor para habilitar la eliminación de viajes y vehículos.',503);
      if(error.code==='23503')return fail('Este vehiculo tiene viajes registrados. Se conserva para proteger el historial.',409);
      databaseError(error);
    }
    if(!deleted?.length)return fail('El vehiculo ya no esta disponible.',404);
    return json({ok:true});
  }
  if(action==='vehicle'){
    const plate=String(b.plate||'').toUpperCase().replace(/\s/g,''),model=String(b.model||'').trim().slice(0,100);
    if(!/^[A-Z0-9-]{5,10}$/.test(plate)||!model)return fail('Revisa la placa y el modelo.');
    const {data,error}=await supabase.from('vehicles').insert({user_id:user.id,plate,model}).select('id').single();
    if(error){if(error.code==='23505')return fail('La placa ya está registrada.');databaseError(error)}
    return json({ok:true,id:data!.id});
  }else if(action==='start'){
    const zone=String(b.zone||'urbana'),sector=String(b.sector||'Recorrido GPS').trim().slice(0,150);
    if(!Object.hasOwn(zones,zone)||!sector)return fail('Selecciona una zona válida e indica el sector.');
    const plate=String(b.plate||'').toUpperCase().replace(/\s/g,''),model=String(b.model||'').trim();
    if(!/^[A-Z0-9-]{5,10}$/.test(plate)||!model||model.length>100)return fail('Ingresa una placa válida y la marca y modelo del vehículo.');
    const {data:existing,error:lookupError}=await supabase.from('vehicles').select('id,model').eq('plate',plate).eq('user_id',user.id).maybeSingle();
    if(lookupError)databaseError(lookupError);
    let vehicleId=existing?.id;
    if(existing&&existing.model.toLowerCase()!==model.toLowerCase())return fail('Esta placa ya está registrada con el modelo '+existing.model+'. Revisa los datos.');
    if(!existing){
      const {data:vehicle,error:vehicleError}=await supabase.from('vehicles').insert({user_id:user.id,plate,model}).select('id').single();
      if(vehicleError){if(vehicleError.code==='23505')return fail('La placa ya está registrada. Revisa los datos e inténtalo de nuevo.');databaseError(vehicleError)}
      vehicleId=vehicle!.id;
    }
    const {data,error}=await supabase.from('trips').insert({user_id:user.id,vehicle_id:vehicleId,zone,sector}).select('id,started').single();
    if(error?.code==='23502')return fail('Falta activar el inicio directo: ejecuta 003_quick_start.sql en Supabase.',503);
    if(error){if(error.code==='23505')return fail('Ya tienes un viaje activo.');databaseError(error)}
    return json({id:data!.id,started:data!.started,plate,model:existing?.model||model});
  }else if(action==='road'){
    if(!validFix(b.fix)||Date.now()-Date.parse(b.fix.recorded_at)>15000||Date.parse(b.fix.recorded_at)>Date.now()+5000)return fail('Posición GPS reciente requerida.');
    const previous=validFix(b.previous)?b.previous:undefined;
    return json({match:detectRoad(b.fix,previous)});
  }else if(action==='positions'){
    if(!positiveId(b.trip)||!Array.isArray(b.points)||!b.points.length||b.points.length>100)return fail('Lote de posiciones inválido.');
    const rows=[];
    for(const value of b.points){
      if(!value||typeof value!=='object'||Array.isArray(value))return fail('Posición inválida.');
      const p=value as Record<string,unknown>;
      if(typeof p.lat!=='number'||!Number.isFinite(p.lat)||Math.abs(p.lat)>90||typeof p.lng!=='number'||!Number.isFinite(p.lng)||Math.abs(p.lng)>180||typeof p.accuracy!=='number'||!Number.isFinite(p.accuracy)||p.accuracy<0||p.accuracy>60||typeof p.recorded_at!=='string'||!Number.isFinite(Date.parse(p.recorded_at))||Date.parse(p.recorded_at)>Date.now()+60000)return fail('Posición GPS inválida.');
      rows.push({trip_id:Number(b.trip),user_id:user.id,lat:p.lat,lng:p.lng,accuracy:p.accuracy,recorded_at:new Date(p.recorded_at).toISOString()});
    }
    const {error}=await supabase.from('route_points').upsert(rows,{onConflict:'trip_id,recorded_at',ignoreDuplicates:true});
    if(error){
      if(error.code==='PGRST205')return fail('Ejecuta supabase/migrations/002_route_points.sql para guardar el recorrido.',503);
      if(['42501','23503','23514','P0001'].includes(error.code))return fail('El viaje no está activo o no te pertenece.');
      databaseError(error);
    }
  }else if(action==='end'){
    if(!positiveId(b.trip))return fail('Viaje inválido.');
    const {data,error}=await supabase.from('trips').update({ended:new Date().toISOString()}).eq('id',Number(b.trip)).eq('user_id',user.id).is('ended',null).select('id');
    if(error)databaseError(error);
    if(!data?.length)return fail('No hay un viaje activo con ese identificador.');
  }else if(action==='event'){
    if(!positiveId(b.trip)||typeof b.speed!=='number'||!Number.isFinite(b.speed)||b.speed>300||!validFix(b.fix)||!validFix(b.previous)||Date.now()-Date.parse(b.fix.recorded_at)>15000||Date.parse(b.fix.recorded_at)>Date.now()+5000)return fail('Evento GPS inválido.');
    const match=detectRoad(b.fix,b.previous);
    if(match.status!=='known'||match.limit===null||b.speed<=match.limit)return fail('No hay un exceso confirmado en un tramo identificado.');
    const {error}=await supabase.from('events').insert({trip_id:Number(b.trip),user_id:user.id,road_id:match.roadId,zone:match.zone,sector:match.roadName,speed:b.speed,lat:b.fix.lat,lng:b.fix.lng});
    if(error){
      if(['PGRST204','PGRST205','42703','42P01'].includes(error.code))return fail('Ejecuta las migraciones 006 y 007 en Supabase para guardar alertas automáticas.',503);
      if(['42501','23503','23514','P0001'].includes(error.code))return fail('No se puede registrar el evento: revisa que el viaje siga activo y que esté cargado el catálogo 007.');
      databaseError(error);
    }
  }else return fail('Ruta desconocida.',404);
  return json({ok:true});
}catch(e){
  const code=e&&typeof e==='object'&&'code' in e?String(e.code):'';
  console.error('Supabase:',code||'connection_error');
  if(code==='SUPABASE_CONFIG')return fail((e as Error).message,503);
  if(['PGRST205','42P01','PGRST204'].includes(code))return fail('Faltan las tablas de Supabase. Ejecuta supabase/migrations/001_initial.sql en el SQL Editor de tu proyecto.',503);
  return fail('No se pudo acceder a Supabase. Revisa la conexión y la configuración del proyecto.',503);
}
}
