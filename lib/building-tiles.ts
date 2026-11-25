import {tileKey,tilesAround} from './map-tiles';

// Edificios complementarios (Microsoft Global ML Building Footprints, ODbL) que OpenStreetMap no tiene, en
// public/building-tiles/<x>_<y>.json (scripts/build-building-tiles.mjs). Se descargan solo alrededor del centro.
export type ExtraBuilding={height:number;ring:number[][];x0:number;y0:number;x1:number;y1:number};
type BuildingTile={v:number;b:number[][]};
type Bounds={west:number;south:number;east:number;north:number};

export function decodeBuildingTile(data:BuildingTile):ExtraBuilding[]{
  if(!data||data.v!==1||!Array.isArray(data.b))return [];
  const out:ExtraBuilding[]=[];
  for(const row of data.b){
    if(!Array.isArray(row)||row.length<9)continue;
    let x=row[1],y=row[2];const ring=[[x/1e5,y/1e5]];
    for(let i=3;i+1<row.length;i+=2){x+=row[i];y+=row[i+1];ring.push([x/1e5,y/1e5])}
    ring.push(ring[0]);
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const [px,py] of ring){if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py}
    out.push({height:row[0]/10,ring,x0,y0,x1,y1});
  }
  return out;
}

export function createBuildingTileLoader(onLoad:()=>void,base='/building-tiles/'){
  const tiles=new Map<string,ExtraBuilding[]>(),pending=new Set<string>(),failed=new Map<string,number>();
  let catalog:Set<string>|null=null,catalogRequest:Promise<void>|null=null;
  async function ensure(lat:number,lng:number,metres:number){
    catalogRequest??=fetch(base+'index.json').then(r=>r.ok?r.json():Promise.reject(new Error(String(r.status)))).then((d:{tiles:string[]})=>{catalog=new Set(d.tiles)}).catch(()=>{catalogRequest=null});
    await catalogRequest;
    if(!catalog)return;
    const wanted=[tileKey(lng,lat),...tilesAround(lat,lng,metres)].filter((k,i,all)=>all.indexOf(k)===i&&catalog!.has(k)&&!tiles.has(k)&&!pending.has(k)&&Date.now()-(failed.get(k)||0)>15000);
    if(!wanted.length)return;
    await Promise.all(wanted.map(async k=>{
      pending.add(k);
      try{const r=await fetch(`${base}${k}.json`);if(!r.ok)throw new Error(String(r.status));tiles.set(k,decodeBuildingTile(await r.json()));failed.delete(k)}
      catch{failed.set(k,Date.now())}
      finally{pending.delete(k)}
    }));
    onLoad();
  }
  /** Edificios ya descargados que tocan el recuadro. */
  function within(view:Bounds){
    const out:ExtraBuilding[]=[];
    for(const list of tiles.values())for(const b of list)if(b.x1>=view.west&&b.x0<=view.east&&b.y1>=view.south&&b.y0<=view.north)out.push(b);
    return out;
  }
  return {ensure,within};
}
