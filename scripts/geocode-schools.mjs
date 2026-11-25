import {readFile,writeFile} from 'node:fs/promises';

// Ubica los colegios oficiales del Atlántico a partir de su dirección (nomenclatura colombiana) usando las
// calles del extracto OSM: «CL 15 15 82» = Calle 15 a 82 m de la Carrera 15, hacia la Carrera 16.
// Fuentes (datos.gov.co, CC BY-SA 4.0):
// - MEN_SEDES_EDUCATIVAS_PREESCOLAR_BÁSICA_Y_MEDIA (x5ay-984n), Ministerio de Educación Nacional: todas las sedes.
//   Sus coordenadas vienen redondeadas a 2 decimales (≈1 km): solo sirven para descartar ubicaciones absurdas.
// - Listado de instituciones oficiales y no oficiales del Atlántico (7tec-5fhs), Gobernación del Atlántico.
// - MEN_INSTITUCIONES EDUCACIÓN SUPERIOR (n5yy-8nav): universidades y corporaciones, solo para el mapa (sin zona escolar).
// Salida: data/maps/atlantico-schools-official.json. Requiere npm run maps:extract.
const SOURCES=[
  {id:'x5ay-984n',name:'MEN · Sedes educativas preescolar, básica y media',where:"upper(departamento) like '%ATL%NTICO%'",
    map:r=>({name:r.nombre_sede||r.nombre_establecimiento,municipality:r.municipio,address:r.direccion,approx:[+r.coordenada_x_sede,+r.coordenada_y_sede],sector:r.cte_id_sector,code:r.codigo_dane_sede})},
  {id:'7tec-5fhs',name:'Gobernación del Atlántico · Instituciones educativas oficiales y no oficiales',where:"estado like '%ACTIVO%'",
    map:r=>({name:r.nombre,municipality:r.municipio,address:r.direcci_n,approx:null,sector:r.sector,code:r.c_digo})},
];
const M=111195;
const strip=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'');
const norm=s=>strip(s).toLowerCase().replace(/\s+/g,' ').trim();

// ---------- Descarga ----------
const rows=[];
for(const source of SOURCES){
  const url=`https://www.datos.gov.co/resource/${source.id}.json?$limit=50000&$where=${encodeURIComponent(source.where)}`;
  const response=await fetch(url);
  if(!response.ok)throw new Error(`${source.id}: HTTP ${response.status}`);
  for(const r of await response.json())rows.push({...source.map(r),source:source.id});
  console.log(`${source.name}: ${rows.filter(r=>r.source===source.id).length} registros`);
}

// ---------- Calles numeradas por municipio ----------
const raw=JSON.parse(await readFile('data/maps/atlantico-roads.json','utf8'));
const munis=raw.areas.filter(a=>a.tags.boundary==='administrative'&&a.tags.admin_level==='6'&&a.tags.name);
const inRing=(x,y,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const [xi,yi]=r[i],[xj,yj]=r[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c}return c};
const muniOf=([x,y])=>{for(const m of munis)if(m.rings.some(r=>inRing(x,y,r)))return norm(m.tags.name);return ''};
const KIND={calle:'calle',carrera:'carrera',diagonal:'calle',transversal:'carrera'};
// Clave de calle: tipo (calle/carrera; diagonal y transversal cuentan como su par) + número + letras.
const streetKey=(kind,number,letters='')=>`${kind}|${Number(number)}${letters.toUpperCase()}`;
const streets=new Map();
for(const road of raw.roads){
  const g=strip(road.tags.name||'').match(/^(?:avenida\s+)?(calle|carrera|diagonal|transversal)\s+(\d{1,3})\s*([a-z]{0,2})\b/i);
  if(!g)continue;
  const muni=muniOf(road.coordinates[road.coordinates.length>>1]),kind=KIND[g[1].toLowerCase()];
  // «Carrera 3 Sur» es otra calle que la «Carrera 3»: su clave lleva SUR.
  const sur=/\bsur\b/i.test(strip(road.tags.name||''))?'SUR':'';
  for(const key of new Set([streetKey(kind,g[2],g[3]+sur),streetKey(kind,g[2],sur)])){
    const k=muni+'|'+key;if(!streets.has(k))streets.set(k,[]);streets.get(k).push(road.coordinates);
  }
}

// ---------- Geometría en metros locales ----------
const kx=lat=>M*Math.cos(lat*Math.PI/180);
function closestOnSegment(p,a,b){
  const k=kx(p[1]),ax=(a[0]-p[0])*k,ay=(a[1]-p[1])*M,dx=(b[0]-a[0])*k,dy=(b[1]-a[1])*M,l2=dx*dx+dy*dy;
  const t=l2?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/l2)):0;
  return {point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],distance:Math.hypot(ax+t*dx,ay+t*dy)};
}
function nearestOn(lines,p){let best=null;for(const line of lines)for(let i=1;i<line.length;i++){const c=closestOnSegment(p,line[i-1],line[i]);if(!best||c.distance<best.distance)best=c}return best}
const metres=(a,b)=>Math.hypot((a[0]-b[0])*kx(a[1]),(a[1]-b[1])*M);
// Cruce de dos calles: punto de A más cercano a B (se aceptan hasta 30 m: esquinas en T o con desfase).
function crossing(a,b,near){
  const found=[];
  for(const line of a)for(const p of line){const c=nearestOn(b,p);if(c&&c.distance<30)found.push({point:p,distance:c.distance})}
  if(!found.length)return null;
  // Si dos calles se cruzan en varios puntos, el más cercano a la coordenada aproximada del MEN.
  found.sort((x,y)=>near?metres(x.point,near)-metres(y.point,near):x.distance-y.distance);
  return found[0].point;
}
// Sin la letra se prueba la calle base, conservando SUR («Carrera 5B Sur» → «Carrera 5 Sur»).
const lookup=(muni,kind,number,letters='')=>{const sur=letters.endsWith('SUR')?'SUR':'';return streets.get(`${muni}|${streetKey(kind,number,letters)}`)||(letters!==sur?streets.get(`${muni}|${streetKey(kind,number,sur)}`):null)};

// ---------- Direcciones ----------
const TYPE={CL:'calle',CLL:'calle',CALLE:'calle',DG:'calle',DIAG:'calle',DIAGONAL:'calle',KR:'carrera',KRA:'carrera',CRA:'carrera',CR:'carrera',CARRERA:'carrera',TV:'carrera',TR:'carrera',TRANSV:'carrera',TRANSVERSAL:'carrera',CRAS:'carrera',CALLES:'calle',CLLS:'calle'};
const other=kind=>kind==='calle'?'carrera':'calle';
const NUM='(\\d{1,3})\\s?((?:[A-H](?![A-Z]))?)\\s?(?:BIS\\s?)?((?:[A-H](?![A-Z]))?)';
// Formas reconocidas: «CL 15 15 82», «CL 16 C 51 A 04», «KR 50 CL 14» o «CALLE 18 CON CARRERA 3» (esquina), «CL 25 ENTRE CRAS 16 Y 17»,
// «KR 15 21 ESQUINA»; se ignoran prefijos como «IND» y separadores «N.», «#», «-», «=».
const TYPES=Object.keys(TYPE).join('|');
// «CR 3SUR # 90-06»: la calle principal es la Carrera 3 Sur (se marca y se quita la palabra SUR).
function parse(address){
  let s=strip(address).toUpperCase().replace(/^IND\.?\s+/,'').replace(/N[°º¿]|\bNO?\.?(?=\s*\d)|#|-|=|,/g,' ').replace(/\s+/g,' ').trim(),sur='';
  s=s.replace(new RegExp(`^((?:${TYPES})\\.?\\s?\\d{1,3}\\s?(?:[A-H](?![A-Z]))?)\\s?SUR\\b`),(all,head)=>{sur='SUR';return head});
  const result=(m,i,metresValue,between=null)=>({kind:TYPE[m[1]],number:m[2],letters:m[3]+m[4]+sur,cross:m[i],crossLetters:m[i+1]+m[i+2],metres:metresValue,between});
  let m=s.match(new RegExp(`^(${TYPES})\\.?\\s?${NUM}\\s(?:ENTRE\\s|CON\\s)?(${TYPES})\\.?\\s?${NUM}(?:\\s?Y\\s?${NUM})?`));
  if(m)return result(m,6,m[9]?null:0,m[9]||null);
  m=s.match(new RegExp(`^(${TYPES})\\.?\\s?${NUM}\\s${NUM}\\s(\\d{1,3})\\b`));
  // Más de 150 m suele ser un error de digitación («8 872» por «8-72»): se usa como máximo 150 m.
  if(m)return result(m,5,Math.min(150,Number(m[8])));
  m=s.match(new RegExp(`^(${TYPES})\\.?\\s?${NUM}\\s${NUM}(?:\\s(?:ESQUINA|ESQ)\\b|$)`));
  if(m)return result(m,5,0);
  return null;
}
// Sin cruce exacto con la transversal (falta en el mapa o no se toca): posición estimada entre las transversales
// vecinas que sí cruzan, p. ej. entre la Carrera 18 y la 20 para la 19. Solo en cuadrículas (cuadras ≤ 250 m).
function interpolate(muni,a,along,approx){
  const target=a.between?(Number(a.cross)+Number(a.between))/2:Number(a.cross)+(a.crossLetters?.3:0),corners=[];
  for(let n=Math.floor(target)-3;n<=Math.ceil(target)+3;n++){
    if(n<1||n===target)continue;
    const lines=lookup(muni,other(a.kind),n,''),p=lines&&crossing(along,lines,approx);
    if(p)corners.push({n,p});
  }
  const below=corners.filter(c=>c.n<target).sort((x,y)=>y.n-x.n)[0],above=corners.filter(c=>c.n>target).sort((x,y)=>x.n-y.n)[0];
  if(!below||!above)return null;
  const span=above.n-below.n,length=metres(below.p,above.p);
  if(length<20||length/span>250)return null;
  const block=length/span,t=(target+Math.min(a.metres||0,block)/block-below.n)/span;
  return nearestOn(along,[below.p[0]+(above.p[0]-below.p[0])*t,below.p[1]+(above.p[1]-below.p[1])*t]).point;
}
function geocode(row){
  const muni=norm(row.municipality),a=parse(row.address||'');
  if(!a)return {reason:'dirección no reconocida'};
  const along=lookup(muni,a.kind,a.number,a.letters);
  if(!along)return {reason:'calle no está en el mapa'};
  const approx=row.approx&&Number.isFinite(row.approx[0])&&row.approx[0]<-74&&row.approx[1]>10?row.approx:null;
  const crossLines=lookup(muni,other(a.kind),a.cross,a.crossLetters);
  const corner=crossLines&&crossing(along,crossLines,approx);
  if(!corner){
    const estimate=interpolate(muni,a,along,approx);
    if(!estimate)return {reason:crossLines?'las calles no se cruzan':'calle transversal no está en el mapa'};
    if(approx&&metres(estimate,approx)>1500)return {reason:'lejos de la coordenada del MEN'};
    return {point:estimate,precision:'interpolada'};
  }
  let point=corner,precision='esquina';
  // Avanzar los metros indicados hacia la siguiente calle transversal (o alejarse de la anterior).
  const metresAlong=a.between?Math.min(60,metres(corner,crossing(along,lookup(muni,other(a.kind),a.between,'')||[],approx)||corner)/2):a.metres;
  if(metresAlong>0){
    const target=a.between?a.between:Number(a.cross)+1,next=lookup(muni,other(a.kind),target,'');
    const ahead=next&&crossing(along,next,approx),behind=!ahead&&lookup(muni,other(a.kind),Number(a.cross)-1,'');
    const back=behind&&crossing(along,behind,approx);
    const towards=ahead||(back&&[2*corner[0]-back[0],2*corner[1]-back[1]]);
    if(towards){
      const d=metres(corner,towards);
      if(d>15){const f=Math.min(metresAlong,d-5)/d;point=nearestOn(along,[corner[0]+(towards[0]-corner[0])*f,corner[1]+(towards[1]-corner[1])*f]).point;precision='dirección'}
    }
  }
  // La coordenada del MEN tiene ≈1 km de redondeo: más de 1,5 km indica una calle homónima en otro sector.
  if(approx&&metres(point,approx)>1500)return {reason:'lejos de la coordenada del MEN'};
  return {point,precision};
}

// ---------- Resultado ----------
const located=[],failed={},unread=[],unlocated=[];
for(const row of rows){
  const g=geocode(row);
  if(!g.point){failed[g.reason]=(failed[g.reason]||0)+1;if(g.reason==='dirección no reconocida')unread.push(row.address);unlocated.push({name:row.name,municipality:row.municipality,address:row.address,reason:g.reason,source:row.source});continue}
  located.push({name:String(row.name||'Colegio').trim(),municipality:row.municipality,address:row.address,source:row.source,code:row.code,precision:g.precision,coordinates:g.point.map(v=>Math.round(v*1e6)/1e6)});
}
// Una sede puede venir en las dos fuentes: se unen las ubicadas a menos de 40 m.
const unique=[];
for(const s of located)if(!unique.some(u=>metres(u.coordinates,s.coordinates)<40))unique.push(s);
const byMuni=unique.reduce((o,s)=>{const k=s.municipality.toUpperCase();o[k]=(o[k]||0)+1;return o},{});
const report={date:new Date().toISOString().slice(0,10),sources:SOURCES.map(s=>({id:s.id,name:s.name,url:`https://www.datos.gov.co/d/${s.id}`,license:'CC BY-SA 4.0'})),
  registros:rows.length,ubicados:located.length,ejemplosNoReconocidos:unread.slice(0,25),unicos:unique.length,porPrecision:unique.reduce((o,s)=>({...o,[s.precision]:(o[s.precision]||0)+1}),{}),sinUbicar:failed,porMunicipio:byMuni};
// Educación superior (MEN_INSTITUCIONES EDUCACIÓN SUPERIOR, n5yy-8nav, CC BY-SA 4.0): solo para el mapa, sin zona escolar.
const HIGHER={id:'n5yy-8nav',name:'MEN · Instituciones de educación superior',where:"upper(departamento_domicilio) like '%ATL%NTICO%'"};
const higherRows=await (await fetch(`https://www.datos.gov.co/resource/${HIGHER.id}.json?$limit=5000&$where=${encodeURIComponent(HIGHER.where)}`)).json();
const universities=[];
for(const r of Array.isArray(higherRows)?higherRows:[]){
  if(!/activa/i.test(r.estado||''))continue;
  const g=geocode({municipality:r.municipio_domicilio,address:r.direcci_n_domicilio,approx:null});
  if(g.point)universities.push({name:String(r.nombre_instituci_n||'').trim(),municipality:r.municipio_domicilio,address:r.direcci_n_domicilio,precision:g.precision,coordinates:g.point.map(v=>Math.round(v*1e6)/1e6)});
}
report.sources.push({id:HIGHER.id,name:HIGHER.name,url:`https://www.datos.gov.co/d/${HIGHER.id}`,license:'CC BY-SA 4.0'});
report.educacionSuperior={registros:Array.isArray(higherRows)?higherRows.length:0,ubicadas:universities.length};
await writeFile('data/maps/atlantico-schools-official.json',JSON.stringify({metadata:report,schools:unique,unlocated,universities}));
console.log(JSON.stringify(report,null,2));
