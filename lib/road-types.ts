export type Zone='urbana'|'nacional'|'curvas'|'escolar';
export type RoadFix={lat:number;lng:number;accuracy:number;recorded_at:string};
// Tramo de vía con zona SST y lugar ("vas por"), generado por scripts/build-road-catalog.mjs.
export type RoadSegment={id:string;name:string;zone:Zone;label:string;place:string;kind:string;posted:number;oneway:number;geometry:number[][]};
export type RoadMatch={status:'known'|'unknown';reason:string;roadId?:string;roadName?:string;place?:string;zone?:Zone;label?:string;limit:number|null;postedLimit?:number;source?:string};
