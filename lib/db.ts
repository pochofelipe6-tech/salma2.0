import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
mkdirSync('data',{recursive:true});
export const db = new DatabaseSync('data/salma.db');
db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT DEFAULT 'driver');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);
CREATE TABLE IF NOT EXISTS vehicles(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),plate TEXT UNIQUE NOT NULL,model TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trips(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),vehicle_id INTEGER REFERENCES vehicles(id),started TEXT DEFAULT CURRENT_TIMESTAMP,ended TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS active_trip ON trips(user_id) WHERE ended IS NULL;
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,trip_id INTEGER REFERENCES trips(id),zone TEXT,sector TEXT,speed REAL,limit_speed INTEGER,lat REAL,lng REAL,created TEXT DEFAULT CURRENT_TIMESTAMP);`);
export function hash(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex')}
export function verify(password:string,stored:string){const [salt,key]=stored.split(':');return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(key,'hex'))}
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export const zones:Record<string,number>={urbana:50,nacional:70,curvas:35,escolar:30};
