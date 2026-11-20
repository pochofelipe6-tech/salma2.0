import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';

// Convierte el extracto OSM de Atlántico en tramos con límite preventivo SST y lugar
// ("vas por"). Reglas: vía nacional 70, vía urbana (ciudad o pueblo) 50, colegio 30, curva 35.
// La salida son cuadrículas de 0.02° en public/map-tiles/, que el teléfono descarga según
// su posición y que el servidor usa para validar las alertas.
const raw=JSON.parse(await readFile('data/maps/atlantico-roads.json','utf8'));
const TILE=0.02,STEP=5,M=111195;
const SPEED={urbana:50,nacional:70,curvas:35,escolar:30};
const ZONES=['urbana','nacional','curvas','escolar'];
const metres=(a,b)=>Math.hypot((a[0]-b[0])*M*Math.cos(a[1]*Math.PI/180),(a[1]-b[1])*M);

// ---------- Índices espaciales de polígonos ----------
function bounds(points){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y] of points){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}return [x0,y0,x1,y1]}
function insideRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside}return inside}
function polygonIndex(polygons,cell=.01){
  const grid=new Map();
  for(const p of polygons){p.bbox=bounds(p.rings.flat());for(let x=Math.floor(p.bbox[0]/cell);x<=Math.floor(p.bbox[2]/cell);x++)for(let y=Math.floor(p.bbox[1]/cell);y<=Math.floor(p.bbox[3]/cell);y++){const k=x+':'+y;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(p)}}
  return ([x,y])=>(grid.get(Math.floor(x/cell)+':'+Math.floor(y/cell))||[]).filter(p=>x>=p.bbox[0]&&x<=p.bbox[2]&&y>=p.bbox[1]&&y<=p.bbox[3]&&p.rings.some(r=>insideRing(x,y,r))&&!(p.holes||[]).some(r=>insideRing(x,y,r)));
}
const named=a=>a.tags.name&&a.tags.name.trim();
const municipalities=polygonIndex(raw.areas.filter(a=>a.tags.boundary==='administrative'&&a.tags.admin_level==='6'&&named(a)));
const barrioAreas=raw.areas.filter(a=>named(a)&&((a.tags.boundary==='administrative'&&['9','10'].includes(a.tags.admin_level))||['neighbourhood','suburb','quarter'].includes(a.tags.place)));
for(const a of barrioAreas)a.size=(b=>(b[2]-b[0])*(b[3]-b[1]))(bounds(a.rings.flat()));
const barrios=polygonIndex(barrioAreas);
const townAreas=polygonIndex(raw.areas.filter(a=>named(a)&&['city','town','village'].includes(a.tags.place)));
// Casco urbano: perímetro urbano, barrios, centros poblados y usos residenciales/comerciales.
const urbanAreas=polygonIndex(raw.areas.filter(a=>(a.tags.boundary==='administrative'&&['7','9','10'].includes(a.tags.admin_level))||['city','town','village','suburb','neighbourhood','quarter'].includes(a.tags.place)||['residential','commercial','retail','industrial'].includes(a.tags.landuse)));

// ---------- Densidad de calles locales (pueblos sin polígonos en OSM) ----------
const DENSITY_CELL=.0015,density=new Map();
for(const r of raw.roads){
  if(!['residential','living_street','unclassified'].includes(r.tags.highway))continue;
  for(let i=1;i<r.coordinates.length;i++){
    const a=r.coordinates[i-1],b=r.coordinates[i],length=metres(a,b),n=Math.max(1,Math.ceil(length/20));
    for(let k=0;k<n;k++){const x=a[0]+(b[0]-a[0])*(k+.5)/n,y=a[1]+(b[1]-a[1])*(k+.5)/n,key=Math.floor(x/DENSITY_CELL)+':'+Math.floor(y/DENSITY_CELL);density.set(key,(density.get(key)||0)+length/n)}
  }
}
function streetDensity([x,y],reach){const cx=Math.floor(x/DENSITY_CELL),cy=Math.floor(y/DENSITY_CELL);let total=0;for(let dx=-reach;dx<=reach;dx++)for(let dy=-reach;dy<=reach;dy++)total+=density.get((cx+dx)+':'+(cy+dy))||0;return total}
// Metros de calles locales en ~500 m × 500 m y en ~750 m × 750 m alrededor del punto.
// En autopistas solo cuenta la ventana corta: así no toman como urbanas las urbanizaciones que bordean.
const isUrban=(p,expressway)=>urbanAreas(p).length>0||streetDensity(p,1)>=2600||(!expressway&&streetDensity(p,2)>=4500);
// Evita saltos urbano/rural en tramos cortos: rellena huecos rurales <150 m y descarta islas urbanas <80 m.
function smoothUrban(flags,lengths){
  const runs=[];for(let i=0;i<flags.length;){let j=i,length=0;while(j<flags.length&&flags[j]===flags[i]){length+=lengths[j];j++}runs.push({value:flags[i],start:i,end:j,length});i=j}
  for(let r=1;r<runs.length-1;r++){const run=runs[r];if((!run.value&&run.length<150)||(run.value&&run.length<80))for(let k=run.start;k<run.end;k++)flags[k]=!run.value}
  return flags;
}

// ---------- Lugares con nombre ----------
const placeGrid=new Map(),PLACE_CELL=.01;
for(const p of raw.places){const k=Math.floor(p.coordinates[0]/PLACE_CELL)+':'+Math.floor(p.coordinates[1]/PLACE_CELL);if(!placeGrid.has(k))placeGrid.set(k,[]);placeGrid.get(k).push(p)}
function nearestPlace(point,kinds,max){
  const cx=Math.floor(point[0]/PLACE_CELL),cy=Math.floor(point[1]/PLACE_CELL),reach=Math.ceil(max/(PLACE_CELL*M));let best=null,bestDistance=max;
  for(let dx=-reach;dx<=reach;dx++)for(let dy=-reach;dy<=reach;dy++)for(const p of placeGrid.get((cx+dx)+':'+(cy+dy))||[]){if(!kinds.includes(p.place))continue;const d=metres(point,p.coordinates);if(d<bestDistance){best=p;bestDistance=d}}
  return best;
}
const clean=s=>s.replace(/\s+/g,' ').trim();
function placeName(point,urban){
  const municipality=municipalities(point)[0]?.tags.name;
  const barrio=barrios(point).sort((a,b)=>a.size-b.size)[0]?.tags.name||(urban?nearestPlace(point,['neighbourhood','suburb','quarter'],450)?.name:undefined);
  const town=townAreas(point)[0]?.tags.name||nearestPlace(point,['city','town','village','hamlet','locality'],urban?1200:1800)?.name;
  const parts=[];
  if(barrio)parts.push(clean(barrio));
  else if(town&&town.toLowerCase()!==municipality?.toLowerCase())parts.push((urban?'':'cerca de ')+clean(town));
  if(municipality)parts.push(clean(municipality));
  return parts.join(', ')||'Atlántico';
}

// ---------- Colegios ----------
const SCHOOL_CELL=.003,schoolGrid=new Map();
const schools=raw.schools.map(s=>{const polygon=s.type!=='node'&&s.coordinates.length>3?s.coordinates:null,points=polygon||[s.coordinates];return {name:clean(s.tags?.name||'Colegio'),polygon,point:s.type==='node'?s.coordinates:null,bbox:bounds(points),center:[points.reduce((v,p)=>v+p[0],0)/points.length,points.reduce((v,p)=>v+p[1],0)/points.length],id:s.type+':'+s.id}});
for(const s of schools)for(let x=Math.floor((s.bbox[0]-.001)/SCHOOL_CELL);x<=Math.floor((s.bbox[2]+.001)/SCHOOL_CELL);x++)for(let y=Math.floor((s.bbox[1]-.001)/SCHOOL_CELL);y<=Math.floor((s.bbox[3]+.001)/SCHOOL_CELL);y++){const k=x+':'+y;if(!schoolGrid.has(k))schoolGrid.set(k,[]);schoolGrid.get(k).push(s)}
function pointSegment(p,a,b){const cos=Math.cos(p[1]*Math.PI/180),ax=(a[0]-p[0])*M*cos,ay=(a[1]-p[1])*M,bx=(b[0]-p[0])*M*cos,by=(b[1]-p[1])*M,dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));return Math.hypot(ax+t*dx,ay+t*dy)}
// Zona escolar: hasta 50 m del predio del colegio o 80 m del punto que lo representa.
function nearSchool(p){
  for(const s of schoolGrid.get(Math.floor(p[0]/SCHOOL_CELL)+':'+Math.floor(p[1]/SCHOOL_CELL))||[]){
    if(s.point){if(metres(p,s.point)<=80)return s;continue}
    if(insideRing(p[0],p[1],s.polygon))return s;
    for(let i=1;i<s.polygon.length;i++)if(pointSegment(p,s.polygon[i-1],s.polygon[i])<=50)return s;
  }
  return null;
}

// ---------- Clasificación por vía ----------
const NATIONAL_REF=/^(25|90)/i;
const NATIONAL_NAME=/cordialidad|oriental|prosperidad|circunvalar|v[ií]a al mar|troncal|autopista|variante|carretera|caracol[ií]|barranquilla\s*-\s*cartagena/i;
const ORIENTAL_TOWNS=new Set(['Malambo','Sabanagrande','Santo Tomás','Palmar de Varela','Ponedera']);
const SKIP_SERVICE=new Set(['parking_aisle','driveway','drive-through','emergency_access']);
function roadInfo(t){
  const hw=t.highway,ref=(t.ref||'').trim(),name=clean(t.name||t.official_name||'');
  const national=['motorway','trunk','motorway_link','trunk_link'].includes(hw)||NATIONAL_REF.test(ref)||(['primary','secondary','tertiary','primary_link','secondary_link'].includes(hw)&&NATIONAL_NAME.test(name));
  const display=name||(ref?'Ruta '+ref:hw==='residential'?'Calle sin nombre':hw==='service'?'Vía de servicio':'Vía sin nombre');
  const posted=/^\d+(?:\s*(?:km\/h|kph))?$/.test(t.maxspeed||'')?parseInt(t.maxspeed,10):0;
  const oneway=t.oneway==='yes'||t.oneway==='1'||t.junction==='roundabout'||(['motorway'].includes(hw)&&t.oneway!=='no')?1:t.oneway==='-1'?-1:0;
  const curveRadius=['residential','living_street','service'].includes(hw)?0:national?110:90;
  return {hw,national,expressway:['motorway','trunk','motorway_link','trunk_link'].includes(hw),display,posted:posted>0&&posted<=130?posted:0,oneway,curveRadius,bridge:t.bridge==='yes'||t.tunnel==='yes'};
}

// Remuestrea la vía cada 5 m conservando los vértices originales.
function densify(coords){
  const out=[{p:coords[0],v:true,s:0}];let s=0;
  for(let i=1;i<coords.length;i++){
    const a=coords[i-1],b=coords[i],d=metres(a,b),n=Math.max(1,Math.ceil(d/STEP));
    for(let k=1;k<=n;k++){s+=d/n;out.push({p:k===n?b:[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n],v:k===n,s})}
  }
  return out;
}
// Curvas: radio del cambio de rumbo en una ventana de 30 m; se marca el arco y 25 m de aproximación.
function curveMask(samples,radius){
  const mask=new Array(samples.length).fill(false);if(!radius||samples.length<5)return mask;
  const heading=i=>{const a=samples[i].p,b=samples[i+1].p;return Math.atan2((b[1]-a[1]),(b[0]-a[0])*Math.cos(a[1]*Math.PI/180))};
  const W=3,raw=new Array(samples.length).fill(false);
  for(let i=W;i<samples.length-W-1;i++){
    let delta=heading(i+W)-heading(i-W);delta=Math.atan2(Math.sin(delta),Math.cos(delta));
    const length=samples[i+W].s-samples[i-W].s;if(length<10||Math.abs(delta)<.05)continue;
    if(length/Math.abs(delta)<radius)raw[i]=true;
  }
  // Solo arcos con giro total relevante (evita ondulaciones del dibujo).
  for(let i=0;i<raw.length;){
    if(!raw[i]){i++;continue}
    let j=i;while(j<raw.length&&raw[j])j++;
    let delta=heading(Math.min(j+W,samples.length-2))-heading(Math.max(i-W,0));delta=Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta)));
    if(delta>=30*Math.PI/180){const start=samples[i].s-25,end=samples[j-1].s+15;for(let k=0;k<samples.length;k++)if(samples[k].s>=start&&samples[k].s<=end)mask[k]=true}
    i=j;
  }
  return mask;
}

const segments=[];let skipped=0;
const stats={length:{urbana:0,nacional:0,curvas:0,escolar:0}};
for(const road of raw.roads){
  const t=road.tags;
  if(SKIP_SERVICE.has(t.service)||['private','no'].includes(t.access)||t.area==='yes'){skipped++;continue}
  const info=roadInfo(t),samples=densify(road.coordinates),curves=curveMask(samples,info.curveRadius);
  let placeCache=null;
  const pieces=[],mids=[],lengths=[];
  for(let i=1;i<samples.length;i++){mids.push([(samples[i-1].p[0]+samples[i].p[0])/2,(samples[i-1].p[1]+samples[i].p[1])/2]);lengths.push(samples[i].s-samples[i-1].s)}
  const urbanFlags=smoothUrban(mids.map(p=>isUrban(p,info.expressway)),lengths);
  // La ruta 25 entre Malambo y Ponedera se conoce como «la Oriental» aunque OSM use otros nombres.
  const municipality=municipalities(mids[Math.floor(mids.length/2)]||road.coordinates[0])[0]?.tags.name||'';
  if(/^25/.test(t.ref||'')&&info.expressway&&ORIENTAL_TOWNS.has(municipality)&&!/oriental|prosperidad|circunvalar/i.test(info.display))info.display=info.display.startsWith('Ruta ')?'Vía Oriental':`Vía Oriental (${info.display})`;
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i],mid=mids[i-1],urban=urbanFlags[i-1];
    // En autopistas fuera del casco urbano no hay acceso peatonal al colegio.
    const school=info.bridge||(!urban&&info.expressway)?null:nearSchool(mid);
    let zone,label;
    if(school){zone='escolar';label='Zona escolar · '+school.name}
    else if(curves[i]||curves[i-1]){zone='curvas';label=info.national?'Curva en vía nacional':'Curva'}
    else if(info.hw==='living_street'){zone='escolar';label='Zona residencial'}
    else if(urban){zone='urbana';label=info.national?'Vía nacional · tramo urbano':'Zona urbana'}
    else if(info.national||['primary','secondary','tertiary','primary_link','secondary_link','tertiary_link'].includes(info.hw)){zone='nacional';label=info.national?'Vía nacional':'Carretera intermunicipal'}
    else {zone='urbana';label='Vía rural'}
    // El lugar se recalcula cada ~50 m para no repetir búsquedas en cada pieza de 5 m.
    if(!placeCache||b.s-placeCache.s>=50||placeCache.urban!==urban)placeCache={s:b.s,urban,name:placeName(mid,urban)};
    pieces.push({a,b,zone,label,place:placeCache.name});
    stats.length[zone]+=b.s-a.s;
  }
  // Une piezas consecutivas con la misma zona, etiqueta y lugar en un tramo.
  let run=0;
  for(let i=0;i<pieces.length;){
    let j=i;const key=pieces[i].zone+'|'+pieces[i].label+'|'+pieces[i].place;
    while(j+1<pieces.length&&pieces[j+1].zone+'|'+pieces[j+1].label+'|'+pieces[j+1].place===key)j++;
    const geometry=[pieces[i].a.p];for(let k=i;k<=j;k++)if(pieces[k].b.v||k===j)geometry.push(pieces[k].b.p);
    segments.push({id:road.id+'-'+run++,name:info.display,zone:pieces[i].zone,label:pieces[i].label,place:pieces[i].place,kind:info.hw,posted:info.posted,oneway:info.oneway,geometry});
    i=j+1;
  }
}

// ---------- Cuadrículas ----------
await rm('public/map-tiles',{recursive:true,force:true});
await mkdir('public/map-tiles',{recursive:true});
const tiles=new Map(),PAD=.0006;
for(const s of segments){
  const b=bounds(s.geometry);
  for(let x=Math.floor((b[0]-PAD)/TILE);x<=Math.floor((b[2]+PAD)/TILE);x++)for(let y=Math.floor((b[1]-PAD)/TILE);y<=Math.floor((b[3]+PAD)/TILE);y++){const k=x+'_'+y;if(!tiles.has(k))tiles.set(k,[]);tiles.get(k).push(s)}
}
const date=raw.metadata.downloadedAt;let bytes=0,largest=0;
for(const [key,list] of tiles){
  const strings=[],index=new Map(),str=v=>{if(!index.has(v)){index.set(v,strings.length);strings.push(v)}return index.get(v)};
  const rows=list.map(s=>{
    const flat=[];let px=0,py=0;
    for(const [x,y] of s.geometry){const ix=Math.round(x*1e5),iy=Math.round(y*1e5);flat.push(ix-px,iy-py);px=ix;py=iy}
    return [s.id,str(s.name),ZONES.indexOf(s.zone),str(s.label),str(s.place),str(s.kind),s.posted,s.oneway,flat];
  });
  const body=JSON.stringify({v:2,date,s:strings,r:rows});bytes+=body.length;largest=Math.max(largest,body.length);
  await writeFile(`public/map-tiles/${key}.json`,body);
}
await writeFile('public/map-tiles/index.json',JSON.stringify({v:2,date,size:TILE,tiles:[...tiles.keys()].sort()}));
await writeFile('public/map-tiles/LICENSE.md',`# Datos geográficos de Atlántico\n\n© OpenStreetMap contributors. Base de datos derivada de OpenStreetMap, distribuida bajo Open Database License (ODbL) 1.0.\n\n- Atribución y licencia: https://www.openstreetmap.org/copyright\n- Extracto original: https://download.geofabrik.de/south-america/colombia.html\n- Preparación reproducible: \`scripts/extract-atlantico-map.mjs\` y \`scripts/build-road-catalog.mjs\`.\n\nLos límites son preventivos SST por categoría (nacional 70, urbana 50, curva 35, colegio 30). No constituyen un inventario oficial de señalización.\n`);
// Colegios para el registro de zonas (propuestas que revisa el administrador).
await writeFile('assets/maps/atlantico-schools.json',JSON.stringify(schools.map(s=>({id:s.id,name:s.name,coordinates:s.center}))));
const km=Object.fromEntries(Object.entries(stats.length).map(([k,v])=>[k+' ('+SPEED[k]+' km/h)',Math.round(v/1000)+' km']));
console.log(JSON.stringify({vias:raw.roads.length,omitidas:skipped,tramos:segments.length,cuadriculas:tiles.size,megabytes:+(bytes/1e6).toFixed(1),mayorKB:Math.round(largest/1e3),longitudPorZona:km},null,2));
