import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,stat,rename,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const url='https://download.geofabrik.de/south-america/colombia-latest.osm.pbf';
const target='data/maps/colombia-latest.osm.pbf',partial=target+'.part';
await mkdir('data/maps',{recursive:true});
if(!await stat(target).catch(()=>null)){
  const offset=(await stat(partial).catch(()=>null))?.size||0;
  const response=await fetch(url,{headers:offset?{Range:`bytes=${offset}-`}:{},signal:AbortSignal.timeout(900000)});
  if(!response.ok)throw new Error(`Descarga HTTP ${response.status}`);
  const append=offset>0&&response.status===206;
  if(append&&!response.headers.get('content-range')?.startsWith(`bytes ${offset}-`))throw new Error('El servidor no confirmó el punto de reanudación.');
  console.log(append?`Reanudando desde ${offset} bytes...`:'Descargando Colombia...');
  await pipeline(Readable.fromWeb(response.body),createWriteStream(partial,{flags:append?'a':'w'}));
  await rename(partial,target);
}
const checksum=await fetch(url+'.md5',{signal:AbortSignal.timeout(30000)});
if(!checksum.ok)throw new Error(`Checksum HTTP ${checksum.status}`);
const expected=(await checksum.text()).trim().split(/\s+/)[0].toLowerCase();
const hash=createHash('md5');for await(const chunk of createReadStream(target))hash.update(chunk);
const actual=hash.digest('hex');
if(expected!==actual)throw new Error('El MD5 no coincide: no usar este archivo.');
const metadata={source:url,downloadedAt:new Date().toISOString(),bytes:(await stat(target)).size,md5:actual,checksumVerified:true,license:'ODbL-1.0',attribution:'© OpenStreetMap contributors'};
await writeFile('data/maps/colombia-source.json',JSON.stringify(metadata,null,2));
console.log(JSON.stringify(metadata,null,2));
