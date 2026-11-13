import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRoadMatcher} from './road-matcher';
import type {MapRoad,RoadFix,RoadMatch} from './road-types';
import {surveyCandidates,type SchoolPoint} from './zone-survey';
let matcher:ReturnType<typeof createRoadMatcher>|undefined,mapDate='';
let surveyMatcher:ReturnType<typeof createRoadMatcher>|undefined,roadIndex:Map<string,MapRoad>|undefined,schools:SchoolPoint[]|undefined;
export function collectZoneCandidates(fix:RoadFix,previous?:RoadFix){
  if(!surveyMatcher){
    const data=JSON.parse(readFileSync(join(process.cwd(),'assets/maps/atlantico-roads.json'),'utf8')) as {roads:MapRoad[]};
    roadIndex=new Map(data.roads.map(r=>[r.id,r]));surveyMatcher=createRoadMatcher(data.roads,{survey:true});
    schools=JSON.parse(readFileSync(join(process.cwd(),'assets/maps/atlantico-schools.json'),'utf8')) as SchoolPoint[];
  }
  const match=surveyMatcher(fix,previous),road=match.roadId?roadIndex?.get(match.roadId):undefined;
  return road?surveyCandidates(road,fix,schools||[]):[];
}
export function detectRoad(fix:RoadFix,previous?:RoadFix):RoadMatch{
  if(!matcher){const data=JSON.parse(readFileSync(join(process.cwd(),'assets/maps/atlantico-roads.json'),'utf8')) as {date:string;roads:MapRoad[]};mapDate=data.date;matcher=createRoadMatcher(data.roads)}
  return {...matcher(fix,previous),mapDate};
}
