import type {SupabaseClient} from '@supabase/supabase-js';
import {detectRoad} from './road-catalog';
import type {RoadFix,RoadMatch} from './road-types';
export async function resolveRoad(client:SupabaseClient,fix:RoadFix,previous?:RoadFix):Promise<RoadMatch>{
  const elapsed=previous?Date.parse(fix.recorded_at)-Date.parse(previous.recorded_at):0;
  if(previous&&fix.accuracy<=25&&previous.accuracy<=25&&elapsed>0&&elapsed<=15000){
    const {data,error}=await client.rpc('match_survey_zone',{p_lat:fix.lat,p_lng:fix.lng,p_previous_lat:previous.lat,p_previous_lng:previous.lng});
    if(error&&!['PGRST202','42883'].includes(error.code))throw Object.assign(new Error(error.message),{code:error.code});
    const zone=data?.[0];
    if(zone)return {status:'known',reason:'Zona registrada y confirmada por el administrador.',roadId:`confirmed:${zone.id}`,surveyZoneId:zone.id,roadName:zone.name,zone:zone.zone,label:({urbana:'Zona urbana',nacional:'Vía nacional',curvas:'Curvas',escolar:'Escolar / residencial'} as Record<string,string>)[zone.zone],limit:zone.limit_speed,source:'Zona confirmada'};
  }
  return detectRoad(fix,previous);
}
