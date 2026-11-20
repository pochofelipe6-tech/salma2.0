import {zones} from './zones.ts';
import type {ConfirmedZone,RoadFix,RoadMatch,RoadSegment} from './road-types';

export const zoneNames:Record<string,string>={urbana:'Zona urbana',nacional:'Vía nacional',curvas:'Curvas',escolar:'Escolar / residencial'};
export const MAX_ACCURACY=35;
const M=111195,CELL=.002,GENERIC=new Set(['Calle sin nombre','Vía sin nombre','Vía de servicio']);
const unknown=(reason:string):RoadMatch=>({status:'unknown',reason,limit:null});

export function validFix(value:unknown):value is RoadFix{
  if(!value||typeof value!=='object')return false;
  const p=value as RoadFix;
  return typeof p.lat==='number'&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&typeof p.lng==='number'&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180&&typeof p.accuracy==='number'&&Number.isFinite(p.accuracy)&&p.accuracy>=0&&typeof p.recorded_at==='string'&&Number.isFinite(Date.parse(p.recorded_at));
}
const metres=(a:{lat:number;lng:number},b:{lat:number;lng:number})=>Math.hypot((b.lng-a.lng)*M*Math.cos(a.lat*Math.PI/180),(b.lat-a.lat)*M);
// Distancia del punto a la polilínea y rumbo (radianes, este=0) de la pieza más cercana.
export function nearestOnRoad(p:{lat:number;lng:number},geometry:number[][]){
  const cos=Math.cos(p.lat*Math.PI/180);let distance=Infinity,bearing=0;
  for(let i=1;i<geometry.length;i++){
    const a=geometry[i-1],b=geometry[i],ax=(a[0]-p.lng)*M*cos,ay=(a[1]-p.lat)*M,bx=(b[0]-p.lng)*M*cos,by=(b[1]-p.lat)*M;
    const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1))),d=Math.hypot(ax+t*dx,ay+t*dy);
    if(d<distance){distance=d;bearing=Math.atan2(dy,dx)}
  }
  return {distance,bearing};
}
export const distanceToRoad=(p:{lat:number;lng:number},geometry:number[][])=>nearestOnRoad(p,geometry).distance;

// Índice por celdas de ~220 m con los tramos cargados (sin duplicados entre cuadrículas).
export function createSegmentIndex(){
  const cells=new Map<string,RoadSegment[]>(),ids=new Map<string,RoadSegment>();
  return {
    add(segments:RoadSegment[]){
      for(const s of segments){
        if(ids.has(s.id)||s.geometry.length<2)continue;ids.set(s.id,s);
        let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y] of s.geometry){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}
        for(let x=Math.floor(x0/CELL);x<=Math.floor(x1/CELL);x++)for(let y=Math.floor(y0/CELL);y<=Math.floor(y1/CELL);y++){const k=x+':'+y;const list=cells.get(k);if(list)list.push(s);else cells.set(k,[s])}
      }
    },
    near(lat:number,lng:number){
      const seen=new Set<RoadSegment>(),x=Math.floor(lng/CELL),y=Math.floor(lat/CELL);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const s of cells.get(`${x+dx}:${y+dy}`)||[])seen.add(s);
      return [...seen];
    },
    get:(id:string)=>ids.get(id),
    get size(){return ids.size},
  };
}
export type SegmentIndex=ReturnType<typeof createSegmentIndex>;

const baseId=(s:RoadSegment)=>s.id.split('-')[0];
const sameRoad=(a:RoadSegment,b:RoadSegment)=>baseId(a)===baseId(b)||(a.name===b.name&&!GENERIC.has(a.name));
export function segmentMatch(s:RoadSegment,reason='Límite preventivo SST por categoría del tramo.'):RoadMatch{
  return {status:'known',reason,roadId:s.id,roadName:s.name,place:s.place,zone:s.zone,label:s.label,limit:zones[s.zone],postedLimit:s.posted||undefined,source:'OpenStreetMap'};
}

// Sigue la vía del vehículo: distancia, rumbo de marcha, sentido de las vías de una sola
// dirección y continuidad con la vía anterior. Un cambio a otra vía cercana se confirma con
// dos posiciones seguidas para no saltar a calles transversales o calzadas paralelas.
export function createRoadTracker(index:SegmentIndex){
  let previous:RoadFix|null=null,current:RoadSegment|null=null,pending:{id:string;count:number}|null=null;
  function reset(){previous=null;current=null;pending=null}
  function match(fix:RoadFix,speedKmh:number|null=null,confirmed:ConfirmedZone[]=[]):RoadMatch{
    if(!validFix(fix))return unknown('GPS inválido.');
    if(fix.accuracy>MAX_ACCURACY){current=null;pending=null;return unknown(`GPS impreciso: se necesita un margen de ${MAX_ACCURACY} m o menos.`)}
    const elapsed=previous?Date.parse(fix.recorded_at)-Date.parse(previous.recorded_at):Infinity;
    const prev=previous&&elapsed>0&&elapsed<=20000?previous:null;
    const heading=prev&&metres(prev,fix)>=4?Math.atan2(fix.lat-prev.lat,(fix.lng-prev.lng)*Math.cos(fix.lat*Math.PI/180)):null;
    if(!previous||elapsed>0)previous=fix;
    const radius=Math.max(20,Math.min(45,fix.accuracy+12));
    const candidates=index.near(fix.lat,fix.lng).map(segment=>({segment,...nearestOnRoad(fix,segment.geometry)})).filter(c=>c.distance<=radius);
    // Zonas confirmadas por el administrador: tienen prioridad y se usa la más restrictiva.
    const zone=confirmed.filter(z=>distanceToRoad(fix,z.geometry)<=z.radius&&(!prev||distanceToRoad(prev,z.geometry)<=z.radius+15)).sort((a,b)=>zones[a.zone]-zones[b.zone])[0];
    if(zone){
      const near=candidates.sort((a,b)=>a.distance-b.distance)[0]?.segment;
      return {status:'known',reason:'Zona registrada y confirmada por el administrador.',roadId:`confirmed:${zone.id}`,surveyZoneId:zone.id,roadName:zone.name,place:near?.place,zone:zone.zone,label:zoneNames[zone.zone],limit:zones[zone.zone],source:'Zona confirmada'};
    }
    if(!candidates.length){current=null;pending=null;return unknown('Sin vía identificada cerca de tu posición.')}
    const scored=candidates.map(c=>{
      let score=c.distance;
      if(heading!==null){
        let diff=Math.abs(Math.atan2(Math.sin(heading-c.bearing),Math.cos(heading-c.bearing)));
        if(c.segment.oneway===-1)diff=Math.PI-diff;
        if(c.segment.oneway&&diff>100*Math.PI/180)score+=30;// sentido contrario: probablemente la otra calzada
        else{const folded=c.segment.oneway?Math.min(diff,Math.PI/2):Math.min(diff,Math.PI-diff);score+=Math.max(0,folded*180/Math.PI-20)*.35}
      }
      if(speedKmh!==null&&speedKmh>45)score+=['residential','living_street','service'].includes(c.segment.kind)?10:c.segment.kind==='unclassified'?4:0;
      if(current&&sameRoad(c.segment,current))score-=6;
      return {...c,score};
    }).sort((a,b)=>a.score-b.score);
    let chosen=scored[0];
    if(current&&!sameRoad(chosen.segment,current)){
      // Solo se retiene la vía actual si sigue siendo plausible (no va en contravía ni quedó girada).
      const stay=scored.find(c=>sameRoad(c.segment,current!)&&c.score<=chosen.score+12);
      if(stay){
        const id=baseId(chosen.segment);
        pending=pending?.id===id?{id,count:pending.count+1}:{id,count:1};
        if(pending.count<2)chosen=stay;
      }
    }
    // Se limpia la confirmación pendiente al cambiar de vía o si la mejor opción vuelve a ser la actual.
    if(!current||!sameRoad(chosen.segment,current)||sameRoad(scored[0].segment,current))pending=null;
    current=chosen.segment;
    return segmentMatch(chosen.segment);
  }
  return {match,reset};
}
