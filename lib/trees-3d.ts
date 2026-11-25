import type {Feature,FeatureCollection,MultiPolygon,Polygon,Position} from 'geojson';

// Árboles 3D decorativos para la vista de navegación: tronco y copa en dos niveles.
// - En áreas verdes del mapa base (parques, bosques, jardines, pasto, cementerios), sobre una cuadrícula fija
//   con desplazamiento pseudoaleatorio estable: no cambian de lugar al mover o girar el mapa.
// - En las aceras de las calles, a ambos lados, a partir de la geometría de cada vía.
// Nunca se ponen dentro de un edificio ni sobre otra calle. No son árboles reales uno a uno: representan la
// vegetación de la zona.
export type GreenArea={geometry:Polygon|MultiPolygon;spacing:number;fill:number};
export type StreetLine={id:string;halfWidth:number;coordinates:number[][]};
export type TreeProps={base:number;height:number;shade:number};
export type TreeLayers={trunks:FeatureCollection<Polygon,TreeProps>;crowns:FeatureCollection<Polygon,TreeProps>;tops:FeatureCollection<Polygon,TreeProps>;count:number};
type Bounds={west:number;south:number;east:number;north:number};
type Box={x0:number;y0:number;x1:number;y1:number};

const M=111195,CELL=25,STREET_STEP=13;
// Número estable en [0,1) a partir de dos enteros: el mismo árbol aparece siempre igual.
function noise(i:number,j:number,salt:number){
  let h=Math.imul(i,374761393)^Math.imul(j,668265263)^Math.imul(salt,1442695041);
  h=Math.imul(h^(h>>>13),1274126177);
  return ((h^(h>>>16))>>>0)/4294967296;
}
const textHash=(text:string)=>{let h=2166136261;for(let k=0;k<text.length;k++)h=Math.imul(h^text.charCodeAt(k),16777619);return h|0};
function insideRing(x:number,y:number,ring:Position[]){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside}
  return inside;
}
// Primer anillo: contorno; los demás: huecos.
const insidePolygon=(x:number,y:number,rings:Position[][])=>insideRing(x,y,rings[0])&&!rings.slice(1).some(r=>insideRing(x,y,r));
const polygonsOf=(g:Polygon|MultiPolygon)=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
function bbox(ring:Position[]):Box{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const [x,y] of ring){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}return {x0,y0,x1,y1}}

export function generateTrees({areas,streets,buildings,view,center,max=4000}:{areas:GreenArea[];streets:StreetLine[];buildings:(Polygon|MultiPolygon)[];view:Bounds;center:number[];max?:number}):TreeLayers{
  const trunks:Feature<Polygon,TreeProps>[]=[],crowns:Feature<Polygon,TreeProps>[]=[],tops:Feature<Polygon,TreeProps>[]=[];
  // Escala fija por grado entero de latitud: la cuadrícula no se mueve con el centro del mapa.
  const kx=M*Math.cos(Math.round((view.south+view.north)/2)*Math.PI/180);
  const cellOf=(lng:number,lat:number)=>[Math.floor(lng*kx/CELL),Math.floor(lat*M/CELL)];
  const add=<T,>(grid:Map<string,T[]>,b:Box,item:T)=>{
    const [cx0,cy0]=cellOf(b.x0,b.y0),[cx1,cy1]=cellOf(b.x1,b.y1);
    for(let x=cx0;x<=cx1;x++)for(let y=cy0;y<=cy1;y++){const k=x+':'+y;const list=grid.get(k);if(list)list.push(item);else grid.set(k,[item])}
  };
  const near=<T,>(grid:Map<string,T[]>,lng:number,lat:number)=>{const [x,y]=cellOf(lng,lat);return grid.get(x+':'+y)||[]};
  const inView=(b:Box)=>b.x1>=view.west&&b.x0<=view.east&&b.y1>=view.south&&b.y0<=view.north;

  // Edificios y calles cercanas, indexados para descartar árboles encima de ellos.
  const buildingGrid=new Map<string,{box:Box;rings:Position[][]}[]>();
  for(const g of buildings)for(const rings of polygonsOf(g)){if(!rings[0]?.length)continue;const box=bbox(rings[0]);if(inView(box))add(buildingGrid,box,{box,rings})}
  type Segment={a:number[];b:number[];half:number};
  const roadGrid=new Map<string,Segment[]>();
  for(const s of streets)for(let k=1;k<s.coordinates.length;k++){
    const a=s.coordinates[k-1],b=s.coordinates[k],pad=(s.halfWidth+2)/M;
    const box={x0:Math.min(a[0],b[0])-pad,y0:Math.min(a[1],b[1])-pad,x1:Math.max(a[0],b[0])+pad,y1:Math.max(a[1],b[1])+pad};
    if(inView(box))add(roadGrid,box,{a,b,half:s.halfWidth});
  }
  const treeGrid=new Map<string,number[][]>();
  const distance=(p:number[],a:number[],b:number[])=>{
    const ax=(a[0]-p[0])*kx,ay=(a[1]-p[1])*M,dx=(b[0]-a[0])*kx,dy=(b[1]-a[1])*M,l2=dx*dx+dy*dy;
    const t=l2?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/l2)):0;return Math.hypot(ax+t*dx,ay+t*dy);
  };
  function free(lng:number,lat:number){
    if(lng<view.west||lng>view.east||lat<view.south||lat>view.north)return false;
    for(const b of near(buildingGrid,lng,lat))if(lng>=b.box.x0&&lng<=b.box.x1&&lat>=b.box.y0&&lat<=b.box.y1&&insidePolygon(lng,lat,b.rings))return false;
    for(const s of near(roadGrid,lng,lat))if(distance([lng,lat],s.a,s.b)<s.half+.8)return false;
    for(const t of near(treeGrid,lng,lat))if(Math.hypot((t[0]-lng)*kx,(t[1]-lat)*M)<3.2)return false;
    return true;
  }
  function plant(lng:number,lat:number,size:number,shade:number,big:boolean){
    const radius=big?2.6+3.2*size:2+1.8*size,trunk=big?1.8+1.4*size:1.8+.8*size,top=trunk+(big?4+5*size:3+3.5*size);
    const ring=(r:number,sides:number):Position[]=>{const out:Position[]=[];for(let k=0;k<=sides;k++){const a=(k%sides)/sides*Math.PI*2;out.push([lng+Math.cos(a)*r/kx,lat+Math.sin(a)*r/M])}return out};
    trunks.push({type:'Feature',properties:{base:0,height:trunk+.4,shade},geometry:{type:'Polygon',coordinates:[ring(.3+.2*size,6)]}});
    crowns.push({type:'Feature',properties:{base:trunk,height:top-1,shade},geometry:{type:'Polygon',coordinates:[ring(radius,9)]}});
    tops.push({type:'Feature',properties:{base:top-1.6,height:top+1.3,shade},geometry:{type:'Polygon',coordinates:[ring(radius*.62,8)]}});
    add(treeGrid,{x0:lng,y0:lat,x1:lng,y1:lat},[lng,lat]);
  }

  // 1) Áreas verdes, de la más cercana a la más lejana.
  const planted=new Set<string>();
  const areaAway=(a:GreenArea)=>{const b=bbox(polygonsOf(a.geometry)[0]?.[0]||[]);return Math.hypot(Math.max(b.x0-center[0],0,center[0]-b.x1)*kx,Math.max(b.y0-center[1],0,center[1]-b.y1)*M)};
  for(const area of areas.map(a=>({a,d:areaAway(a)})).sort((x,y)=>x.d-y.d).map(x=>x.a)){
    const dx=area.spacing/kx,dy=area.spacing/M;
    for(const rings of polygonsOf(area.geometry)){
      if(!rings[0]?.length)continue;
      const b=bbox(rings[0]);
      const west=Math.max(b.x0,view.west),east=Math.min(b.x1,view.east),south=Math.max(b.y0,view.south),north=Math.min(b.y1,view.north);
      if(west>=east||south>=north)continue;
      for(let i=Math.floor(west/dx);i<=Math.floor(east/dx);i++)for(let j=Math.floor(south/dy);j<=Math.floor(north/dy);j++){
        if(trunks.length>=max)return finish();
        const key=area.spacing+':'+i+':'+j;
        if(planted.has(key)||noise(i,j,3)>area.fill)continue;
        const lng=(i+.15+.7*noise(i,j,1))*dx,lat=(j+.15+.7*noise(i,j,2))*dy;
        if(!insidePolygon(lng,lat,rings)||!free(lng,lat))continue;
        planted.add(key);plant(lng,lat,noise(i,j,4),Math.floor(noise(i,j,5)*4),true);
      }
    }
  }
  // 2) Aceras: cada STREET_STEP metros a lo largo de la vía, a cada lado y con huecos al azar; primero las calles más cercanas.
  const away=(s:StreetLine)=>Math.min(...s.coordinates.map(p=>Math.hypot((p[0]-center[0])*kx,(p[1]-center[1])*M)));
  for(const s of streets.filter(s=>inView(bbox(s.coordinates))).map(s=>({s,d:away(s)})).sort((a,b)=>a.d-b.d).map(x=>x.s)){
    const seed=textHash(s.id);let walked=0,slot=0;
    for(let k=1;k<s.coordinates.length;k++){
      const a=s.coordinates[k-1],b=s.coordinates[k],ex=(b[0]-a[0])*kx,ey=(b[1]-a[1])*M,len=Math.hypot(ex,ey);
      if(!len)continue;
      const nx=-ey/len,ny=ex/len;
      for(let d=(STREET_STEP-walked%STREET_STEP)%STREET_STEP;d<len;d+=STREET_STEP,slot++){
        if(trunks.length>=max)return finish();
        for(const side of [-1,1]){
          if(noise(seed,slot,side+7)>.5)continue;
          const off=side*(s.halfWidth+1.6),lng=a[0]+(ex*d/len+nx*off)/kx,lat=a[1]+(ey*d/len+ny*off)/M;
          if(free(lng,lat))plant(lng,lat,noise(seed,slot,side+11),Math.floor(noise(seed,slot,side+13)*4),false);
        }
      }
      walked+=len;
    }
  }
  return finish();
  function finish():TreeLayers{
    return {trunks:{type:'FeatureCollection',features:trunks},crowns:{type:'FeatureCollection',features:crowns},tops:{type:'FeatureCollection',features:tops},count:trunks.length};
  }
}
