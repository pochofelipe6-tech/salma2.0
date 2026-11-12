import {NextRequest,NextResponse} from 'next/server';
import {db,hash,verify,tokenHash,zones} from '../../../lib/db';
import {randomBytes} from 'node:crypto';
export const runtime='nodejs';
type User={id:number;name:string;email:string;role:string;password:string};
const fail=(message:string,status=400)=>NextResponse.json({error:message},{status});
export async function GET(req:NextRequest){return handle(req)}
export async function POST(req:NextRequest){return handle(req)}
async function handle(req:NextRequest){
try{
 const action=req.nextUrl.pathname.split('/').pop();
 if(req.method==='POST' && req.headers.get('origin') && req.headers.get('origin')!==req.nextUrl.origin)return fail('Origen no permitido',403);
 const b=req.method==='POST'?await req.json():{};
 if(['login','register'].includes(action||'')){
 if(req.method!=='POST')return fail('Método no permitido',405);
 const email=String(b.email||'').trim().toLowerCase(); const password=String(b.password||'');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10||password.length>128)return fail('Ingresa un correo válido y una contraseña de 10 a 128 caracteres.');
 if(action==='register'){
 if(!String(b.name||'').trim())return fail('Ingresa tu nombre.');
 if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return fail('Este correo ya está registrado.');
 db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(String(b.name).trim().slice(0,100),email,hash(password));
 }
 const u=db.prepare('SELECT * FROM users WHERE email=?').get(email) as User|undefined;
 if(!u||!verify(password,u.password))return fail('Credenciales incorrectas.',401);
 const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),u.id,Date.now()+86400000*7);
 const r=NextResponse.json({ok:true});r.cookies.set('salma_session',token,{httpOnly:true,sameSite:'lax',secure:req.nextUrl.protocol==='https:',path:'/',maxAge:604800});return r;
 }
 const token=req.cookies.get('salma_session')?.value;
 const u=token?db.prepare('SELECT users.* FROM users JOIN sessions ON sessions.user_id=users.id WHERE token=? AND expires>?').get(tokenHash(token),Date.now()) as User|undefined:undefined;
 if(!u)return fail('Inicia sesión para continuar.',401);
 if(action==='state'&&req.method==='GET'){
 const admin=u.role==='admin';
 const vehicles=db.prepare(`SELECT vehicles.*,users.name driver FROM vehicles JOIN users ON users.id=vehicles.user_id ${admin?'':'WHERE user_id=?'}`).all(...(admin?[]:[u.id]));
 const trips=db.prepare(`SELECT trips.*,vehicles.plate,users.name driver FROM trips JOIN vehicles ON vehicles.id=trips.vehicle_id JOIN users ON users.id=trips.user_id ${admin?'':'WHERE trips.user_id=?'} ORDER BY trips.id DESC`).all(...(admin?[]:[u.id]));
 const events=db.prepare(`SELECT events.*,vehicles.plate,users.name driver FROM events JOIN trips ON trips.id=events.trip_id JOIN vehicles ON vehicles.id=trips.vehicle_id JOIN users ON users.id=trips.user_id ${admin?'':'WHERE trips.user_id=?'} ORDER BY events.id DESC`).all(...(admin?[]:[u.id]));
 return NextResponse.json({user:{id:u.id,name:u.name,email:u.email,role:u.role},vehicles,trips,events});
 }
 if(req.method!=='POST')return fail('Método no permitido',405);
 if(action==='logout'){db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(token!));const r=NextResponse.json({ok:true});r.cookies.delete('salma_session');return r}
 if(action==='vehicle'){
 const plate=String(b.plate||'').toUpperCase().replace(/\s/g,'');if(!/^[A-Z0-9-]{5,10}$/.test(plate)||!String(b.model||'').trim())return fail('Revisa la placa y el modelo.');
 if(db.prepare('SELECT id FROM vehicles WHERE plate=?').get(plate))return fail('La placa ya está registrada.');
 db.prepare('INSERT INTO vehicles(user_id,plate,model) VALUES(?,?,?)').run(u.id,plate,String(b.model).slice(0,100));
 }else if(action==='start'){
 if(!db.prepare('SELECT id FROM vehicles WHERE id=? AND user_id=?').get(Number(b.vehicle),u.id))return fail('Vehículo no disponible.');
 if(db.prepare('SELECT id FROM trips WHERE user_id=? AND ended IS NULL').get(u.id))return fail('Ya tienes un viaje activo.');
 const result=db.prepare('INSERT INTO trips(user_id,vehicle_id) VALUES(?,?)').run(u.id,Number(b.vehicle));return NextResponse.json({id:Number(result.lastInsertRowid)});
 }else if(action==='end'){db.prepare('UPDATE trips SET ended=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND ended IS NULL').run(Number(b.trip),u.id);
 }else if(action==='event'){
 if(!db.prepare('SELECT id FROM trips WHERE id=? AND user_id=? AND ended IS NULL').get(Number(b.trip),u.id))return fail('No hay viaje activo.');
 const limit=zones[b.zone];if(!limit||!Number.isFinite(b.speed)||b.speed<=limit||b.speed>300||!Number.isFinite(b.lat)||Math.abs(b.lat)>90||!Number.isFinite(b.lng)||Math.abs(b.lng)>180||!String(b.sector||'').trim())return fail('Evento inválido.');
 db.prepare('INSERT INTO events(trip_id,zone,sector,speed,limit_speed,lat,lng) VALUES(?,?,?,?,?,?,?)').run(Number(b.trip),b.zone,String(b.sector).slice(0,150),b.speed,limit,b.lat,b.lng);
 }else return fail('Ruta desconocida',404);
 return NextResponse.json({ok:true});
}catch(e){console.error(e);return fail('No se pudo completar la operación. Inténtalo de nuevo.',500)}
}
