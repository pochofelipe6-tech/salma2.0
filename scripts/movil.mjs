// Abre la app de desarrollo en el celular por HTTPS. El navegador solo entrega
// la ubicación en un contexto seguro (HTTPS o localhost), así que este proxy
// atiende HTTPS en el puerto 3443 y reenvía todo, incluido el WebSocket de
// recarga en caliente, al servidor de `npm run dev` (puerto 3000).
//
// Uso: deja `npm run dev` corriendo y ejecuta `npm run movil` en otra terminal.
// Los certificados se crean con OpenSSL (incluido en Git para Windows) en
// certificates/, carpeta excluida de Git. La CA local está restringida a
// direcciones de red privada y localhost.
import {spawnSync} from 'node:child_process';
import {X509Certificate,createPrivateKey,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {networkInterfaces} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const APP_PORT=Number(process.env.APP_PORT||3000);
const PORT=Number(process.env.MOVIL_PORT||3443);
const UPSTREAM='127.0.0.1';
const DIR=fileURLToPath(new URL('../certificates/',import.meta.url));
const CA_KEY=join(DIR,'movil-ca.key'),CA_CRT=join(DIR,'movil-ca.crt'),KEY=join(DIR,'movil.key'),CRT=join(DIR,'movil.crt');
const CA_PATH='/__certificado-movil.crt';
const DAY=864e5;
const HOP_BY_HOP=new Set(['connection','keep-alive','proxy-connection','te','trailer','transfer-encoding','upgrade']);

function lanAddresses(){
  const all=Object.values(networkInterfaces()).flat().filter(Boolean);
  return [...new Set(all.filter(i=>(i.family==='IPv4'||i.family===4)&&!i.internal&&!i.address.startsWith('169.254.')).map(i=>i.address))];
}

function findOpenssl(){
  const candidates=['openssl'];
  for(const base of [process.env.ProgramW6432,process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Programs')])
    if(base)candidates.push(join(base,'Git','mingw64','bin','openssl.exe'),join(base,'Git','usr','bin','openssl.exe'));
  const found=candidates.find(command=>spawnSync(command,['version'],{stdio:'ignore'}).status===0);
  if(!found)throw new Error('No encontré OpenSSL para crear el certificado. Instala Git para Windows (incluye OpenSSL) o agrega openssl al PATH.');
  return found;
}

function openssl(command,args){
  const result=spawnSync(command,args,{encoding:'utf8'});
  if(result.status!==0)throw new Error(`OpenSSL no pudo crear el certificado: ${(result.stderr||result.error?.message||'').trim()}`);
}

function readCertificate(file){try{return new X509Certificate(readFileSync(file))}catch{return null}}
function matchesKey(certificate,file){try{return certificate.checkPrivateKey(createPrivateKey(readFileSync(file)))}catch{return false}}
const validFor=(certificate,days)=>Date.parse(certificate.validTo)-Date.now()>days*DAY;

function withTempFiles(files,task){
  try{for(const [file,content] of Object.entries(files))writeFileSync(file,content);task()}
  finally{for(const file of Object.keys(files))rmSync(file,{force:true})}
}

function createCa(command){
  const config=join(DIR,'movil-ca.cnf');
  withTempFiles({[config]:`[req]
prompt=no
distinguished_name=dn
x509_extensions=ext
[dn]
CN=Seguimiento de Ruta - CA local de desarrollo
O=Desarrollo local
[ext]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
nameConstraints=critical,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0,permitted;IP:127.0.0.0/255.0.0.0,permitted;DNS:localhost
`},()=>openssl(command,['req','-x509','-new','-newkey','rsa:2048','-nodes','-sha256','-days','825','-config',config,'-keyout',CA_KEY,'-out',CA_CRT]));
}

function createLeaf(command,ips){
  const config=join(DIR,'movil.cnf'),extensions=join(DIR,'movil.ext'),request=join(DIR,'movil.csr');
  const names=['DNS:localhost','IP:127.0.0.1',...ips.map(ip=>'IP:'+ip)].join(',');
  withTempFiles({[config]:'[req]\nprompt=no\ndistinguished_name=dn\n[dn]\nCN=Seguimiento de Ruta (desarrollo)\n',[extensions]:`[ext]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
subjectAltName=${names}
`,[request]:''},()=>{
    openssl(command,['req','-new','-newkey','rsa:2048','-nodes','-config',config,'-keyout',KEY,'-out',request]);
    openssl(command,['x509','-req','-in',request,'-CA',CA_CRT,'-CAkey',CA_KEY,'-set_serial','0x'+randomBytes(16).toString('hex'),'-days','397','-sha256','-extfile',extensions,'-extensions','ext','-out',CRT]);
  });
}

// Reutiliza los certificados mientras sigan vigentes y cubran las IP actuales;
// si la red cambia (por ejemplo, al usar el punto de acceso del celular), se
// renueva solo el certificado del servidor y la CA instalada sigue sirviendo.
function ensureCertificates(ips){
  mkdirSync(DIR,{recursive:true});
  let command,ca=readCertificate(CA_CRT),newCa=false;
  const hadCa=!!ca,tool=()=>command??=findOpenssl();
  if(!ca||!matchesKey(ca,CA_KEY)||!validFor(ca,30)){createCa(tool());ca=readCertificate(CA_CRT);newCa=true}
  const leaf=readCertificate(CRT);
  if(newCa||!leaf||!leaf.verify(ca.publicKey)||!matchesKey(leaf,KEY)||!validFor(leaf,7)||!ips.every(ip=>leaf.checkIP(ip)))createLeaf(tool(),ips);
  return newCa&&hadCa;
}

const ips=lanAddresses();
const localHosts=new Set(['localhost','127.0.0.1',...ips]);
const isNextDevPath=url=>{const path=(url||'').split('?')[0];return path.includes('/_next')||path.includes('/__nextjs')};

// Next 16 rechaza en desarrollo las solicitudes internas (/_next, /__nextjs y el
// WebSocket de recarga) cuyo Origin no es localhost; sin esto, la página del
// celular se recarga sola cada ~40 s y corta el GPS. Solo se ajusta el Origin
// cuando la solicitud viene de esta misma dirección del proxy; un sitio externo
// conserva su Origin y Next lo sigue bloqueando. /api/* nunca se modifica porque
// lib/request-origin.ts compara ese Origin con Host y X-Forwarded-Proto.
function isSameOriginDevRequest(req){
  const {host,origin}=req.headers;
  if(!host||!origin||!isNextDevPath(req.url))return false;
  try{return localHosts.has(new URL(`https://${host}`).hostname)&&origin.toLowerCase()===`https://${host}`.toLowerCase()}catch{return false}
}

function upstreamHeaders(req,upgrade=false){
  const headers={};
  for(const [name,value] of Object.entries(req.headers))
    if(!name.startsWith('x-forwarded-')&&(upgrade||!HOP_BY_HOP.has(name)))headers[name]=value;
  headers['x-forwarded-proto']='https';
  headers['x-forwarded-host']=req.headers.host||`localhost:${PORT}`;
  headers['x-forwarded-port']=String(PORT);
  headers['x-forwarded-for']=req.socket.remoteAddress||'';
  if(isSameOriginDevRequest(req))headers.origin=`http://localhost:${APP_PORT}`;
  return headers;
}

// Las redirecciones absolutas hacia la dirección interna de Next (0.0.0.0:3000)
// no se pueden abrir desde el celular; se traducen a la dirección del proxy.
function publicLocation(value,req){
  try{
    const url=new URL(value);
    if(['0.0.0.0','localhost','127.0.0.1'].includes(url.hostname)&&url.port===String(APP_PORT)&&req.headers.host)return `https://${req.headers.host}${url.pathname}${url.search}${url.hash}`;
  }catch{}
  return value;
}

function proxyRequest(req,res){
  if(req.url===CA_PATH){
    res.writeHead(200,{'content-type':'application/x-x509-ca-cert','cache-control':'no-store'});
    return res.end(readFileSync(CA_CRT));
  }
  const upstream=http.request({host:UPSTREAM,port:APP_PORT,method:req.method,path:req.url,headers:upstreamHeaders(req)},answer=>{
    const headers=[];
    for(let i=0;i<answer.rawHeaders.length;i+=2){
      const name=answer.rawHeaders[i],lower=name.toLowerCase();
      if(!HOP_BY_HOP.has(lower))headers.push(name,lower==='location'?publicLocation(answer.rawHeaders[i+1],req):answer.rawHeaders[i+1]);
    }
    res.writeHead(answer.statusCode||502,answer.statusMessage,headers);
    answer.pipe(res);
  });
  upstream.on('error',()=>{
    if(res.headersSent)return res.destroy();
    res.writeHead(502,{'content-type':'text/plain; charset=utf-8'});
    res.end(`No hay respuesta del servidor de desarrollo en el puerto ${APP_PORT}. Ejecuta npm run dev y recarga la página.`);
  });
  res.on('close',()=>{if(!res.writableFinished)upstream.destroy()});
  req.pipe(upstream);
}

function proxyUpgrade(req,socket,head){
  const upstream=net.connect(APP_PORT,UPSTREAM,()=>{
    let request=`${req.method} ${req.url} HTTP/1.1\r\n`;
    for(const [name,value] of Object.entries(upstreamHeaders(req,true)))
      for(const item of [].concat(value))request+=`${name}: ${item}\r\n`;
    upstream.write(request+'\r\n');
    if(head?.length)upstream.write(head);
    upstream.pipe(socket).pipe(upstream);
  });
  const close=()=>{upstream.destroy();socket.destroy()};
  upstream.on('error',close);socket.on('error',close);
  upstream.setNoDelay(true);socket.setNoDelay(true);
}

if(!ips.length){
  console.error('No encontré una red con IPv4. Conecta el computador al Wi-Fi (o al punto de acceso del celular) y vuelve a ejecutar npm run movil.');
  process.exit(1);
}
let replacedCa;
try{replacedCa=ensureCertificates(ips)}catch(error){console.error(error.message);process.exit(1)}

const server=https.createServer({key:readFileSync(KEY),cert:readFileSync(CRT)},proxyRequest);
server.on('upgrade',proxyUpgrade);
server.on('tlsClientError',()=>{});
server.on('clientError',(_error,socket)=>socket.destroy());
server.on('error',error=>{
  console.error(error.code==='EADDRINUSE'?`El puerto ${PORT} ya está en uso. ¿Ya hay otro npm run movil abierto?`:error.message);
  process.exit(1);
});
server.listen(PORT,'0.0.0.0',()=>{
  const urls=ips.map(ip=>`https://${ip}:${PORT}`);
  console.log(`
Seguimiento de Ruta · acceso desde el celular

  Abre en el celular, conectado a la misma red Wi-Fi:
${urls.map(url=>'    '+url).join('\n')}

  El navegador avisará que la conexión no es privada porque el certificado es local:
  toca «Configuración avanzada» → «Continuar» y permite la ubicación al iniciar la ruta.
  Para quitar el aviso (o si usas iPhone), instala el certificado: ${urls[0]}${CA_PATH}${replacedCa?'\n  El certificado raíz se renovó: si lo habías instalado en el celular, instálalo de nuevo.':''}

  Si la página no carga, la red bloquea conexiones entre dispositivos: conecta el
  computador al punto de acceso del celular y vuelve a ejecutar npm run movil.

  Reenviando a http://localhost:${APP_PORT} (npm run dev). Ctrl+C para detener.
`);
  const probe=http.request({host:UPSTREAM,port:APP_PORT,method:'HEAD',path:'/',timeout:5000},answer=>answer.resume());
  probe.on('timeout',()=>probe.destroy(new Error('timeout')));
  probe.on('error',()=>console.warn(`  Aviso: no encuentro npm run dev en el puerto ${APP_PORT}. Inícialo en otra terminal.\n`));
  probe.end();
});
