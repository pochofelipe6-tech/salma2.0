import {zones} from './zones.ts';
import type {RoadMatch,RoadSegment} from './road-types';

// Colegios oficiales del Atlántico (MinEducación y Gobernación del Atlántico, datos.gov.co, CC BY-SA 4.0),
// ubicados por dirección con scripts/geocode-schools.mjs. Van en un archivo aparte de las vías (OpenStreetMap,
// ODbL), public/map-tiles/colegios-oficiales.json, y se cruzan al momento con la vía reconocida: a 80 m o menos
// de un colegio la vía es zona escolar (30 km/h). El teléfono y el servidor aplican la misma regla.
// s: colegios (generan zona escolar); u: universidades y corporaciones (solo íconos del mapa).
export type OfficialSchools={v:1;date:string;license:string;attribution:string;s:[name:string,lng:number,lat:number][];u?:[name:string,lng:number,lat:number][]};
export type SchoolIndex={near:(lat:number,lng:number)=>{name:string;distance:number}|null};
export const SCHOOL_RADIUS_M=80;
const CELL=.002,M=111195;

export function createSchoolIndex(data:OfficialSchools|null|undefined):SchoolIndex{
  const grid=new Map<string,[string,number,number][]>();
  const valid=(s:unknown):s is [string,number,number]=>Array.isArray(s)&&typeof s[0]==='string'&&Number.isFinite(s[1])&&Number.isFinite(s[2]);
  for(const school of data?.v===1&&Array.isArray(data.s)?data.s.filter(valid):[]){
    const key=Math.floor(school[1]/CELL)+':'+Math.floor(school[2]/CELL);
    const list=grid.get(key);if(list)list.push(school);else grid.set(key,[school]);
  }
  return {near(lat,lng){
    let best:{name:string;distance:number}|null=null;
    const cx=Math.floor(lng/CELL),cy=Math.floor(lat/CELL),kx=M*Math.cos(lat*Math.PI/180);
    for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(const [name,slng,slat] of grid.get(x+':'+y)||[]){
      const distance=Math.hypot((slng-lng)*kx,(slat-lat)*M);
      if(distance<=SCHOOL_RADIUS_M&&(!best||distance<best.distance))best={name,distance};
    }
    return best;
  }};
}

// Como en el catálogo de vías: sin zona escolar en autopistas (no hay acceso peatonal al colegio).
const eligible=(kind:string|undefined,zone:string|undefined)=>zone!=='escolar'&&!['motorway','motorway_link'].includes(kind||'');

/** Zona de un tramo en una posición, contando los colegios oficiales cercanos. */
export function zoneAt(segment:Pick<RoadSegment,'zone'|'kind'>,lat:number,lng:number,schools:SchoolIndex){
  return eligible(segment.kind,segment.zone)&&schools.near(lat,lng)?'escolar':segment.zone;
}

/** Ajusta una vía reconocida en el teléfono si pasa junto a un colegio oficial. */
export function withOfficialSchool(match:RoadMatch,lat:number,lng:number,schools:SchoolIndex):RoadMatch{
  if(match.status!=='known'||!eligible(match.kind,match.zone))return match;
  const school=schools.near(lat,lng);
  return school?{...match,zone:'escolar',limit:zones.escolar,label:'Zona escolar · '+school.name,source:'MinEducación / Gobernación del Atlántico'}:match;
}
