import {zones} from './zones.ts';
import type {MapRoad,RoadFix,RoadMatch} from './road-types';
const unknown=(reason:string):RoadMatch=>({status:'unknown',reason,limit:null});
export function validFix(value:unknown):value is RoadFix{
  if(!value||typeof value!=='object')return false;
  const p=value as RoadFix;
  return typeof p.lat==='number'&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&typeof p.lng==='number'&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180&&typeof p.accuracy==='number'&&Number.isFinite(p.accuracy)&&p.accuracy>=0&&typeof p.recorded_at==='string'&&Number.isFinite(Date.parse(p.recorded_at));
}
export function distanceToRoad(p:RoadFix,geometry:number[][]){
  const scale=111195,cos=Math.cos(p.lat*Math.PI/180);let best=Infinity;
  for(let i=1;i<geometry.length;i++){
    const a=geometry[i-1],b=geometry[i],ax=(a[0]-p.lng)*scale*cos,ay=(a[1]-p.lat)*scale,bx=(b[0]-p.lng)*scale*cos,by=(b[1]-p.lat)*scale;
    const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
    best=Math.min(best,Math.hypot(ax+t*dx,ay+t*dy));
  }
  return best;
}
// Índice por celdas; incluye también vías SIN límite para no elegir otra más lejana.
export function createRoadMatcher(roads:MapRoad[],options:{survey?:boolean}={}){
  const size=.002,index=new Map<string,MapRoad[]>();
  for(const road of roads){
    const xs=road.geometry.map(p=>p[0]),ys=road.geometry.map(p=>p[1]);
    for(let x=Math.floor(Math.min(...xs)/size);x<=Math.floor(Math.max(...xs)/size);x++)for(let y=Math.floor(Math.min(...ys)/size);y<=Math.floor(Math.max(...ys)/size);y++){
      const key=`${x}:${y}`,bucket=index.get(key)||[];bucket.push(road);index.set(key,bucket);
    }
  }
  return (fix:RoadFix,previous?:RoadFix):RoadMatch=>{
    if(!validFix(fix)||fix.accuracy>25)return unknown('GPS impreciso: se necesita un margen de 25 m o menos.');
    const seen=new Set<MapRoad>(),x=Math.floor(fix.lng/size),y=Math.floor(fix.lat/size);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const road of index.get(`${x+dx}:${y+dy}`)||[])seen.add(road);
    const candidates=[...seen].map(road=>({road,distance:distanceToRoad(fix,road.geometry)})).filter(r=>r.distance<=Math.min(25,fix.accuracy+8)).sort((a,b)=>a.distance-b.distance);
    if(!candidates.length)return unknown('Sin vía identificada en la cobertura de Atlántico.');
    const best=candidates[0];
    // Evitar inventar el carril/vía en cruces, vías paralelas y pasos a diferente nivel.
    const rival=candidates.find(c=>c.road.id!==best.road.id&&c.distance-best.distance<Math.max(8,fix.accuracy));
    if(rival)return unknown('Ubicación ambigua entre varias vías. Esperando una posición más clara.');
    if(!best.road.limit&&!options.survey)return {...unknown('La vía no tiene un límite fijo utilizable en el mapa.'),roadName:best.road.name};
    if(!previous||previous.accuracy>25||Date.parse(fix.recorded_at)-Date.parse(previous.recorded_at)>15000||Date.parse(fix.recorded_at)<=Date.parse(previous.recorded_at))return unknown('Confirmando el tramo con varias posiciones GPS.');
    if(distanceToRoad(previous,best.road.geometry)>Math.min(30,previous.accuracy+10))return unknown('Cambio de tramo: confirmando el nuevo límite.');
    return {status:'known',reason:'Límite preventivo SST por categoría del tramo.',roadId:best.road.id,roadName:best.road.name,zone:best.road.zone,label:({urbana:'Zona urbana',nacional:'Vía nacional',curvas:'Curvas',escolar:'Escolar / residencial'} as Record<string,string>)[best.road.zone],limit:zones[best.road.zone],postedLimit:best.road.limit??undefined,source:'OpenStreetMap'};
  };
}
