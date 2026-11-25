import type {RoadSegment,Zone} from './road-types';

// Cuadrículas de 0.02° (~2,2 km) en public/map-tiles/<x>_<y>.json.
export const TILE_SIZE=0.02;
const ZONES:Zone[]=['urbana','nacional','curvas','escolar'];
type Row=[string,number,number,number,number,number,number,number,number[]];
// p: lugares del mapa (colegios, iglesias...): [tipo, nombre, x·1e5, y·1e5]. Opcional: cuadrículas anteriores no lo traen.
export type TileData={v:number;date:string;s:string[];r:Row[];p?:[number,number,number,number][]};
export type TileIndex={v:number;date:string;size:number;tiles:string[]};

export const tileKey=(lng:number,lat:number)=>`${Math.floor(lng/TILE_SIZE)}_${Math.floor(lat/TILE_SIZE)}`;
// Claves de las cuadrículas que tocan un cuadrado de ±metres alrededor del punto.
export function tilesAround(lat:number,lng:number,metres:number){
  const dLat=metres/111195,dLng=metres/(111195*Math.cos(lat*Math.PI/180)),keys:string[]=[];
  for(let x=Math.floor((lng-dLng)/TILE_SIZE);x<=Math.floor((lng+dLng)/TILE_SIZE);x++)for(let y=Math.floor((lat-dLat)/TILE_SIZE);y<=Math.floor((lat+dLat)/TILE_SIZE);y++)keys.push(`${x}_${y}`);
  return keys;
}
export function decodeTile(data:TileData):RoadSegment[]{
  if(!data||data.v!==2||!Array.isArray(data.r)||!Array.isArray(data.s))throw new Error('Formato de mapa no compatible.');
  return data.r.map(([id,name,zone,label,place,kind,posted,oneway,flat])=>{
    const geometry:number[][]=[];let x=0,y=0;
    for(let i=0;i+1<flat.length;i+=2){x+=flat[i];y+=flat[i+1];geometry.push([x/1e5,y/1e5])}
    return {id,name:data.s[name],zone:ZONES[zone],label:data.s[label],place:data.s[place],kind:data.s[kind],posted,oneway,geometry};
  });
}

// Tipos de lugar en el mismo orden que scripts/build-road-catalog.mjs.
export const PLACE_KINDS=['colegio','universidad','iglesia','centro_comercial','salud','policia','bomberos','alcaldia','mercado','terminal','deporte'] as const;
export type PlaceKind=typeof PLACE_KINDS[number];
export type Place={kind:PlaceKind;name:string;lng:number;lat:number};
export function decodePlaces(data:TileData):Place[]{
  if(!data||!Array.isArray(data.p)||!Array.isArray(data.s))return [];
  return data.p.filter(p=>Array.isArray(p)&&PLACE_KINDS[p[0]]).map(([kind,name,x,y])=>({kind:PLACE_KINDS[kind],name:data.s[name]||'',lng:x/1e5,lat:y/1e5}));
}
