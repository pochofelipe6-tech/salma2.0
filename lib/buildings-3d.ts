import type {Feature,FeatureCollection,MultiPolygon,Polygon,Position} from 'geojson';

// El mapa base agrupa muchas casas en un solo elemento (MultiPolygon) con la misma altura, así que de cerca
// se ven como bloques iguales. Cerca del conductor se separan en edificios individuales: cada uno conserva su
// altura conocida o, si el mapa no la tiene (5 m por defecto), recibe entre uno y tres pisos, y un tono de
// fachada estable calculado con su posición.
export type BuildingProps={height:number;base:number;tone:number};
export type SourceBuilding={id?:string|number;properties:Record<string,unknown>|null;geometry:{type:string;coordinates?:unknown}};
type Bounds={west:number;south:number;east:number;north:number};

const noise=(x:number,y:number,salt:number)=>{
  let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(salt,1442695041);
  h=Math.imul(h^(h>>>13),1274126177);
  return ((h^(h>>>16))>>>0)/4294967296;
};

export function splitBuildings(features:SourceBuilding[],view:Bounds,tones:number):{collection:FeatureCollection<Polygon,BuildingProps>;ids:(string|number)[];polygons:Polygon[]}{
  const out:Feature<Polygon,BuildingProps>[]=[],ids=new Set<string|number>(),seen=new Set<string>();
  // Primero se eligen los elementos que tocan la zona cercana; luego se separan todas sus casas.
  const chosen=features.filter(f=>(f.geometry.type==='Polygon'||f.geometry.type==='MultiPolygon')&&f.id!==undefined&&polygonsOf(f.geometry as Polygon|MultiPolygon).some(p=>touches(p[0],view)));
  for(const f of chosen)ids.add(f.id!);
  for(const f of features){
    if(f.id===undefined||!ids.has(f.id))continue;
    const known=Number(f.properties?.render_height),base=Number(f.properties?.render_min_height)||0;
    for(const rings of polygonsOf(f.geometry as Polygon|MultiPolygon)){
      if(!rings[0]?.length)continue;
      // Clave por posición (≈1 m): descarta la misma casa repetida en dos teselas vecinas.
      let sx=0,sy=0;for(const [x,y] of rings[0]){sx+=x;sy+=y}
      const cx=Math.round(sx/rings[0].length*1e5),cy=Math.round(sy/rings[0].length*1e5),key=cx+':'+cy+':'+rings[0].length;
      if(seen.has(key))continue;seen.add(key);
      const height=Number.isFinite(known)&&known>5?known:3.2+1.6*Math.floor(noise(cx>>2,cy>>2,1)*4);
      out.push({type:'Feature',properties:{height,base:Math.min(base,height-1),tone:Math.floor(noise(cx>>2,cy>>2,2)*tones)},geometry:{type:'Polygon',coordinates:rings}});
    }
  }
  return {collection:{type:'FeatureCollection',features:out},ids:[...ids],polygons:out.map(f=>f.geometry)};
}
function polygonsOf(g:Polygon|MultiPolygon):Position[][][]{return g.type==='Polygon'?[g.coordinates]:g.coordinates}
function touches(ring:Position[],v:Bounds){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const [x,y] of ring){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}
  return x1>=v.west&&x0<=v.east&&y1>=v.south&&y0<=v.north;
}

/** Edificios complementarios (lib/building-tiles) como casas separadas: su altura estimada o de uno a tres pisos. */
export function extraBuildings(list:{height:number;ring:number[][]}[],tones:number):Feature<Polygon,BuildingProps>[]{
  return list.map(b=>{
    let sx=0,sy=0;for(let i=0;i<b.ring.length-1;i++){sx+=b.ring[i][0];sy+=b.ring[i][1]}
    const cx=Math.round(sx/(b.ring.length-1)*1e5),cy=Math.round(sy/(b.ring.length-1)*1e5);
    const height=b.height>2?b.height:3.2+1.6*Math.floor(noise(cx>>2,cy>>2,1)*4);
    return {type:'Feature',properties:{height,base:0,tone:Math.floor(noise(cx>>2,cy>>2,2)*tones)},geometry:{type:'Polygon',coordinates:[b.ring]}};
  });
}
