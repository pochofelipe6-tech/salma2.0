import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const base=process.env.TEST_URL||'http://localhost:3000';
const suffix=Date.now();let cookie='';
async function request(action,body,session=cookie){const r=await fetch(base+'/api/'+action,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:session},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
const emails=[`test-${suffix}@example.com`,`other-${suffix}@example.com`];
try{
 assert.equal((await request('state')).status,401);
 const a=await request('register',{name:'Test conductor',email:emails[0],password:'testing-password-123',role:'admin'});assert.equal(a.status,200);cookie=a.cookie;
 assert.equal((await request('state')).data.user.role,'driver');
 assert.equal((await request('vehicle',{plate:'T'+String(suffix).slice(-7),model:'Test'})).status,200);
 const vehicle=(await request('state')).data.vehicles[0].id;
 const trip=(await request('start',{vehicle})).data.id;
 assert.equal((await request('start',{vehicle})).status,400);
 const event={trip,zone:'urbana',sector:'Sector test',speed:60,lat:4.6,lng:-74.1};
 assert.equal((await request('event',{...event,speed:40})).status,400);
 assert.equal((await request('event',event)).status,200);
 assert.equal((await request('state')).data.events.length,1);
 const b=await request('register',{name:'Other',email:emails[1],password:'testing-password-123'});assert.equal(b.status,200);
 assert.equal((await request('state',undefined,b.cookie)).data.events.length,0);
 assert.equal((await request('event',event,b.cookie)).status,400);
 assert.equal((await request('end',{trip})).status,200);
 assert.equal((await request('event',event)).status,400);
 const db=new DatabaseSync('data/salma.db');db.prepare("UPDATE users SET role='admin' WHERE email=?").run(emails[1]);db.close();
 assert.equal((await request('state',undefined,b.cookie)).data.events.length>=1,true);
 assert.equal((await request('logout',{})).status,200);
 assert.equal((await request('state')).status,401);
 console.log('PASS: registro, roles, vehículos, viajes, eventos, aislamiento, administrador y cierre de sesión.');
}finally{
 const db=new DatabaseSync('data/salma.db');
 for(const email of emails){const user=db.prepare('SELECT id FROM users WHERE email=?').get(email);if(!user)continue;db.prepare('DELETE FROM events WHERE trip_id IN (SELECT id FROM trips WHERE user_id=?)').run(user.id);for(const table of ['trips','vehicles','sessions'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(user.id);db.prepare('DELETE FROM users WHERE id=?').run(user.id)}db.close();
}
