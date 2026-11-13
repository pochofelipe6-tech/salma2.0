export type RoadFix={lat:number;lng:number;accuracy:number;recorded_at:string};
export type RoadMatch={status:'known'|'unknown';reason:string;roadId?:string;roadName?:string;zone?:string;label?:string;limit:number|null;postedLimit?:number;source?:string;mapDate?:string};
export type MapRoad={id:string;name:string;kind:string;zone:string;label:string;limit:number|null;geometry:number[][]};
