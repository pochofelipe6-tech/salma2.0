export type RoutePoint={lat:number;lng:number;accuracy:number;recorded_at:string};
export type DriverVehicle={id:number;user_id:string;plate:string;model:string;driver:string};
export type DriverTrip={id:number;user_id:string;vehicle_id?:number;collect_zones?:boolean;plate:string;model?:string;driver:string;zone:string;sector:string;started:string;ended:string|null};
export type DriverData={user:{id:string;name:string;email:string;role:string};vehicles:DriverVehicle[];trips:DriverTrip[]};
export const routeZones=[
  {id:'urbana',name:'Zona urbana',icon:'🏙️',limit:50},
  {id:'nacional',name:'Vía nacional',icon:'🛣️',limit:70},
  {id:'curvas',name:'Curvas',icon:'🌀',limit:35},
  {id:'escolar',name:'Escolar / residencial',icon:'🏫',limit:30},
];
export async function routeApi(action:string,body?:unknown){
  const response=await fetch('/api/'+action,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'No se pudo completar la operación.');
  return result;
}
export function routeDistance(points:RoutePoint[]):number{
  let total=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],r=Math.PI/180;
    const h=Math.sin((b.lat-a.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lng-a.lng)*r/2)**2;
    total+=6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  return total;
}
