import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {decodeTile,tilesAround,type TileData} from './map-tiles';
import {createSegmentIndex,distanceToRoad} from './road-matcher';
import {createSchoolIndex,type OfficialSchools,type SchoolIndex} from './school-zones';
import type {RoadFix,RoadSegment} from './road-types';

// Las cuadrículas viven en public/map-tiles/ (el teléfono las descarga) y next.config las
// incluye en la función del servidor para validar las alertas con los mismos datos.
const tiles=new Map<string,RoadSegment[]>();
function loadTile(key:string){
  let segments=tiles.get(key);
  if(!segments){
    const file=join(process.cwd(),'public','map-tiles',key+'.json');
    segments=existsSync(file)?decodeTile(JSON.parse(readFileSync(file,'utf8')) as TileData):[];
    tiles.set(key,segments);
  }
  return segments;
}
// Colegios oficiales (archivo aparte, CC BY-SA 4.0): se cargan una vez y se cruzan con el tramo.
let schools:SchoolIndex|null=null;
export function officialSchools(){
  if(!schools){
    const file=join(process.cwd(),'public','map-tiles','colegios-oficiales.json');
    schools=createSchoolIndex(existsSync(file)?JSON.parse(readFileSync(file,'utf8')) as OfficialSchools:null);
  }
  return schools;
}
// Tramo informado por el teléfono, solo si está junto a la posición GPS.
export function segmentNear(id:string,fix:RoadFix){
  const index=createSegmentIndex();
  for(const key of tilesAround(fix.lat,fix.lng,120))index.add(loadTile(key));
  const segment=index.get(id);
  if(!segment)return undefined;
  return distanceToRoad(fix,segment.geometry)<=Math.max(30,Math.min(60,fix.accuracy+20))?segment:undefined;
}
