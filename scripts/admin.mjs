import {DatabaseSync} from 'node:sqlite';
const email=process.argv[2]?.trim().toLowerCase();
if(!email){console.error('Uso: npm run admin -- correo@ejemplo.com');process.exit(1)}
const db=new DatabaseSync('data/salma.db');
const result=db.prepare("UPDATE users SET role='admin' WHERE email=?").run(email);
if(!result.changes){console.error('Registra primero esta cuenta en la app.');process.exit(1)}
console.log('Administrador asignado: '+email);
