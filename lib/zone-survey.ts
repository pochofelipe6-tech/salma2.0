import {distanceToRoad} from './road-matcher.ts';
import type {MapRoad,RoadFix} from './road-types';
import type {SurveyCandidate} from './survey-types';
export type SchoolPoint={id:string;name:string;coordinates:number[]};
function metres(a:number[],b:number[]){return Math.hypot((a[0]-b[0])*111195*Math.cos(a[1]*Math.PI/180),(a[1]-b[1])*111195)}
// Un tramo corto alrededor de la observación evita convertir un colegio en un círculo sobre otras vías.
export function observedSection(road:MapRoad,fix:RoadFix){
  let best=Infinity,section:number[][]=[];
  for(let i=1;i<road.geometry.length;i++){
    const a=road.geometry[i-1],b=road.geometry[i],d=distanceToRoad(fix,[a,b]);if(d>=best)continue;
    best=d;const cos=Math.cos(fix.lat*Math.PI/180),dx=(b[0]-a[0])*cos,dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((fix.lng-a[0])*cos*dx+(fix.lat-a[1])*dy)/(dx*dx+dy*dy||1)));
    const half=45/Math.max(1,metres(a,b));section=[Math.max(0,t-half),Math.min(1,t+half)].map(k=>[a[0]+k*(b[0]-a[0]),a[1]+k*(b[1]-a[1])]);
  }
  return section;
}
export function surveyCandidates(road:MapRoad,fix:RoadFix,schools:SchoolPoint[]):SurveyCandidate[]{
  const geometry=observedSection(road,fix);if(geometry.length<2||metres(geometry[0],geometry[1])<2)return [];
  const cell=`${Math.floor(fix.lat*1000)}:${Math.floor(fix.lng*1000)}`;
  const base={geometry,lat:fix.lat,lng:fix.lng,source:'OpenStreetMap + recorrido GPS'};
  const candidates:SurveyCandidate[]=[{...base,candidate_key:`road:${road.id}:${cell}`,name:road.name,zone:road.zone,reason:'Categoría propuesta a partir del tipo de vía del mapa; requiere verificar el tramo.',confidence:'media'}];
  for(const school of schools){
    if(metres([fix.lng,fix.lat],school.coordinates)>80)continue;
    candidates.push({...base,candidate_key:`school:${school.id}:${road.id}`,name:`Posible zona escolar · ${school.name}`,zone:'escolar',reason:'Colegio a menos de 80 m. La cercanía no confirma que esta vía sea zona escolar.',confidence:'baja'});
  }
  for(let i=1;i<road.geometry.length-1;i++){
    const [a,b,c]=road.geometry.slice(i-1,i+2);if(metres(b,[fix.lng,fix.lat])>45||metres(a,b)<8||metres(b,c)<8)continue;
    const cos=Math.cos(b[1]*Math.PI/180),u=[(b[0]-a[0])*cos,b[1]-a[1]],v=[(c[0]-b[0])*cos,c[1]-b[1]];
    const angle=Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)||1))))*180/Math.PI;
    if(angle<35||angle>120)continue;
    candidates.push({...base,candidate_key:`curve:${road.id}:${i}`,name:`Posible curva · ${road.name}`,zone:'curvas',reason:'Cambio de dirección en la geometría de la vía. Podría ser un giro o una esquina; verificar antes de confirmar.',confidence:'baja'});break;
  }
  return candidates.slice(0,8);
}
