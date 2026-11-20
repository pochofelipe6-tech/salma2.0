import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {decodeTile,tilesAround,type TileData} from './map-tiles';
import {createRoadTracker,createSegmentIndex,distanceToRoad} from './road-matcher';
import type {RoadFix,RoadSegment} from './road-types';
import {surveyCandidates,type SchoolPoint} from './zone-survey';

// Las cuadrículas viven en public/map-tiles/ (el teléfono las descarga) y next.config las
// incluye en la función del servidor para validar las alertas con los mismos datos.
const tiles=new Map<string,RoadSegment[]>();
let schools:SchoolPoint[]|undefined;
function loadTile(key:string){
  let segments=tiles.get(key);
  if(!segments){
    const file=join(process.cwd(),'public','map-tiles',key+'.json');
    segments=existsSync(file)?decodeTile(JSON.parse(readFileSync(file,'utf8')) as TileData):[];
    tiles.set(key,segments);
  }
  return segments;
}
function indexAround(fix:{lat:number;lng:number},metres:number){
  const index=createSegmentIndex();
  for(const key of tilesAround(fix.lat,fix.lng,metres))index.add(loadTile(key));
  return index;
}
// Tramo informado por el teléfono, solo si está junto a la posición GPS.
export function segmentNear(id:string,fix:RoadFix){
  const segment=indexAround(fix,120).get(id);
  if(!segment)return undefined;
  return distanceToRoad(fix,segment.geometry)<=Math.max(30,Math.min(60,fix.accuracy+20))?segment:undefined;
}
export function collectZoneCandidates(fix:RoadFix,previous:RoadFix){
  schools??=JSON.parse(readFileSync(join(process.cwd(),'assets/maps/atlantico-schools.json'),'utf8')) as SchoolPoint[];
  const index=indexAround(fix,120),tracker=createRoadTracker(index);
  tracker.match(previous);
  const match=tracker.match(fix),segment=match.roadId?index.get(match.roadId):undefined;
  return segment?surveyCandidates(segment,fix,schools):[];
}
