import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRoadMatcher} from './road-matcher';
import type {MapRoad,RoadFix,RoadMatch} from './road-types';
let matcher:ReturnType<typeof createRoadMatcher>|undefined,mapDate='';
export function detectRoad(fix:RoadFix,previous?:RoadFix):RoadMatch{
  if(!matcher){const data=JSON.parse(readFileSync(join(process.cwd(),'assets/maps/atlantico-roads.json'),'utf8')) as {date:string;roads:MapRoad[]};mapDate=data.date;matcher=createRoadMatcher(data.roads)}
  return {...matcher(fix,previous),mapDate};
}
