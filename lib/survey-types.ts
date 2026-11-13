export type SurveyCandidate={candidate_key:string;name:string;zone:string;reason:string;confidence:'media'|'baja';source:string;geometry:number[][];lat:number;lng:number};
export type SurveyZone=SurveyCandidate&{id:number;trip_id:number|null;status:'pending'|'confirmed'|'rejected';radius:number;created:string};
