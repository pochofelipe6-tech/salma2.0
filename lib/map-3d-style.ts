import type {ExpressionSpecification,Map as GLMap} from 'maplibre-gl';
import type {Geometry} from 'geojson';
import type {GreenArea} from './trees-3d';

// Estilo de la vista 3D sobre el mapa base de OpenFreeMap: vías con asfalto, bordillo y línea de
// carril, franjas de color de la zona SST en los bordes de la calzada y edificios con color por altura.

// Grupos de vía con el ancho de calzada del estilo base (px por zoom, interpolación exponencial 1.2).
const ROAD_WIDTHS={
  major:[[7,1],[20,18]],
  mid:[[8,.5],[20,13]],
  minor:[[13.5,0],[14,2.5],[20,18]],
  service:[[15.5,0],[16,2],[20,7.5]],
  link:[[13,1.5],[14,2.5],[20,11.5]],
} satisfies Record<string,number[][]>;
export type RoadGroup=keyof typeof ROAD_WIDTHS;
const GROUPS=Object.keys(ROAD_WIDTHS) as RoadGroup[];
const STOPS=[13,14,15,16,17,18,19,20];

/** Tipo de vía OSM (highway=*) → grupo de ancho del estilo base. */
export function roadGroup(kind:string):RoadGroup{
  if(kind.endsWith('_link'))return 'link';
  if(['motorway','trunk','primary'].includes(kind))return 'major';
  if(['secondary','tertiary'].includes(kind))return 'mid';
  if(kind==='service')return 'service';
  return 'minor';
}
function widthAt(group:RoadGroup,zoom:number){
  const stops=ROAD_WIDTHS[group];
  if(zoom<=stops[0][0])return stops[0][1];
  for(let k=1;k<stops.length;k++){
    const [z0,v0]=stops[k-1],[z1,v1]=stops[k];
    if(zoom<=z1)return v0+(v1-v0)*(Math.pow(1.2,zoom-z0)-1)/(Math.pow(1.2,z1-z0)-1);
  }
  return stops.at(-1)![1];
}
// Ancho de las franjas de zona: finas de lejos, como pintura de borde de cerca.
const stripeAt=(zoom:number)=>Math.min(3.2,Math.max(1,1+(zoom-15)*.45));
const round=(v:number)=>Math.round(v*100)/100;
function byZoom(value:(group:RoadGroup,zoom:number)=>number):ExpressionSpecification{
  const stops=STOPS.flatMap(zoom=>[zoom,['match',['get','group'],...GROUPS.slice(0,-1).flatMap(g=>[g,round(value(g,zoom))]),round(value(GROUPS.at(-1)!,zoom))]]);
  return ['interpolate',['linear'],['zoom'],...stops] as ExpressionSpecification;
}
/** Ancho completo de la calzada (para teñir la vía actual). */
export const roadWidth=byZoom(widthAt);
export const stripeWidth=['interpolate',['linear'],['zoom'],...STOPS.flatMap(z=>[z,round(stripeAt(z))])] as ExpressionSpecification;
/** Desplazamiento de cada franja hacia el borde izquierdo (-1) o derecho (1) de la calzada. */
export const stripeOffset=(side:1|-1)=>byZoom((group,zoom)=>side*Math.max(0,widthAt(group,zoom)/2-stripeAt(zoom)/2-.4));

// houses: colores de fachada para edificios bajos (hasta 12 m); towers: rampa de color por altura desde 12 m.
export type Palette3D={asphalt:string;curb:string;marking:string;markingOpacity:number;path:number;green:number;houses:readonly string[];towers:readonly (string|number)[]};

/** Asfalto y bordillo en las vías del mapa base, caminos discretos y zonas verdes más visibles. */
export function styleBaseMap(m:GLMap,palette:Palette3D){
  for(const layer of m.getStyle().layers){
    try{
      if(layer.type==='fill'&&'source-layer' in layer&&['landcover','park'].includes(layer['source-layer']??''))m.setPaintProperty(layer.id,'fill-opacity',palette.green);
      if(layer.type!=='line'||!('source-layer' in layer)||layer['source-layer']!=='transportation'||/rail|pier|ferry/.test(layer.id))continue;
      if(/path|pedestrian/.test(layer.id)){m.setPaintProperty(layer.id,'line-opacity',palette.path);continue}
      m.setPaintProperty(layer.id,'line-color',/casing/.test(layer.id)?palette.curb:palette.asphalt);
    }catch{}
  }
}

// Línea discontinua de carril en las vías principales (como la pintura central de la calzada).
export const laneMarkingFilter:ExpressionSpecification=['all',['match',['get','class'],['motorway','trunk','primary','secondary','tertiary'],true,false],['!=',['get','brunnel'],'tunnel'],['!=',['get','ramp'],1]];
export const laneMarkingWidth:ExpressionSpecification=['interpolate',['exponential',1.5],['zoom'],15,.5,17,1,20,2.6];

// Altura: la del mapa; las casas sin dato (5 m por defecto) varían entre uno y tres pisos según su id.
const rawHeight:ExpressionSpecification=['coalesce',['get','render_height'],5];
export const buildingHeight:ExpressionSpecification=['case',['<=',rawHeight,5],['+',3.4,['*',1.6,['%',['to-number',['id'],0],4]]],rawHeight];
// Casas en colores de fachada variados (como las del Caribe) y torres con color por altura.
// Por defecto usa la altura y el id del mapa base; los edificios separados traen 'height' y 'tone' propios.
export const buildingColor=(palette:Palette3D,height:ExpressionSpecification=buildingHeight,tone:ExpressionSpecification=['%',['to-number',['id'],0],palette.houses.length])=>['case',['<=',height,12],
  ['match',tone,...palette.houses.slice(0,-1).flatMap((c,i)=>[i,c]),palette.houses.at(-1)!],
  ['interpolate',['linear'],height,...palette.towers]] as unknown as ExpressionSpecification;

// Áreas verdes donde se siembran árboles: bosque denso, parques y jardines abiertos, pasto y cementerios dispersos.
export const greenAreaFilter:ExpressionSpecification=['any',['==',['get','class'],'wood'],['in',['get','subclass'],['literal',['park','garden','village_green','recreation_ground','forest','wood','scrub','grass']]]];
const GREEN:Record<string,{spacing:number;fill:number}>={wood:{spacing:8,fill:.85},scrub:{spacing:10,fill:.5},park:{spacing:11,fill:.55},grass:{spacing:18,fill:.3},cemetery:{spacing:14,fill:.45}};
export function greenArea(properties:Record<string,unknown>|null,geometry:Geometry):GreenArea|null{
  if(geometry.type!=='Polygon'&&geometry.type!=='MultiPolygon')return null;
  const cls=String(properties?.class),sub=String(properties?.subclass);
  const kind=cls==='wood'||sub==='forest'||sub==='wood'?'wood':sub==='scrub'?'scrub':cls==='cemetery'?'cemetery':sub==='grass'?'grass':'park';
  return {geometry,...GREEN[kind]};
}
// Semiancho aproximado de cada tipo de vía en metros (calzada), para poner los árboles en la acera.
export const ROAD_HALF_WIDTH_M:Record<RoadGroup,number>={major:7,mid:5.5,minor:4,service:3,link:4};

/** Mapa 2D: edificios con relleno en todo zoom, color por altura, sombra y contorno; zonas verdes más visibles. */
export function styleStreetMap2D(m:GLMap){
  const layers=m.getStyle().layers;
  for(const layer of layers)try{
    if(layer.type==='fill'&&'source-layer' in layer&&['landcover','park'].includes(layer['source-layer']??''))m.setPaintProperty(layer.id,'fill-opacity',.7);
  }catch{}
  if(!m.getLayer('building'))return;
  try{
    // Vista desde arriba: la capa 3D del estilo solo mostraría techos pálidos.
    if(m.getLayer('building-3d'))m.setLayoutProperty('building-3d','visibility','none');
    m.setLayerZoomRange('building',13,24);
    m.setPaintProperty('building','fill-color',['interpolate',['linear'],['coalesce',['get','render_height'],5],0,'#ebdfcc',12,'#dfd2bf',30,'#c8d3e6',80,'#a6b9dd']);
    m.setPaintProperty('building','fill-outline-color','#b4a083');
    const after=layers[layers.findIndex(l=>l.id==='building')+1]?.id;
    m.addLayer({id:'edificios-sombra',type:'fill',source:'openmaptiles','source-layer':'building',minzoom:15,paint:{'fill-color':'rgba(91,74,49,0.32)','fill-translate':[1.6,1.6],'fill-translate-anchor':'viewport'}},'building');
    m.addLayer({id:'edificios-borde',type:'line',source:'openmaptiles','source-layer':'building',minzoom:15.5,paint:{'line-color':'#a48f6c','line-width':['interpolate',['linear'],['zoom'],15.5,.3,18,1.1]}},after);
  }catch{}
}

// Edificios complementarios en el 2D (fuente GeoJSON con 'height'): mismo estilo que los de OSM, debajo de las vías.
const extraFill=['interpolate',['linear'],['max',['coalesce',['get','height'],0],5],0,'#ebdfcc',12,'#dfd2bf',30,'#c8d3e6',80,'#a6b9dd'] as ExpressionSpecification;
export function addExtraBuildings2D(m:GLMap,source:string){
  const before=m.getLayer('edificios-sombra')?'edificios-sombra':m.getStyle().layers.find(l=>'source-layer' in l&&l['source-layer']==='transportation')?.id;
  m.addLayer({id:'edificios-extra-sombra',type:'fill',source,minzoom:15,paint:{'fill-color':'rgba(91,74,49,0.32)','fill-translate':[1.6,1.6],'fill-translate-anchor':'viewport'}},before);
  m.addLayer({id:'edificios-extra',type:'fill',source,minzoom:14,paint:{'fill-color':extraFill,'fill-outline-color':'#b4a083'}},before);
  m.addLayer({id:'edificios-extra-borde',type:'line',source,minzoom:15.5,paint:{'line-color':'#a48f6c','line-width':['interpolate',['linear'],['zoom'],15.5,.3,18,1.1]}},before);
}
