import type {ExpressionSpecification,Map as GLMap} from 'maplibre-gl';
import type {PlaceKind} from './map-tiles';

// Íconos de la infraestructura del Atlántico en los mapas 2D y 3D: un círculo de color con borde blanco y un
// emoji por tipo. Los colegios usan el morado de la zona escolar.
export const PLACE_STYLE:Record<PlaceKind,{label:string;color:string;icon:string}>={
  colegio:{label:'Colegio',color:'#a855f7',icon:'🏫'},
  universidad:{label:'Universidad',color:'#6d28d9',icon:'🎓'},
  iglesia:{label:'Iglesia',color:'#b45309',icon:'⛪'},
  centro_comercial:{label:'Centro comercial',color:'#db2777',icon:'🛍️'},
  salud:{label:'Salud',color:'#dc2626',icon:'🏥'},
  policia:{label:'Policía',color:'#1d4ed8',icon:'👮'},
  bomberos:{label:'Bomberos',color:'#ea580c',icon:'🚒'},
  alcaldia:{label:'Alcaldía',color:'#0f766e',icon:'🏛️'},
  mercado:{label:'Mercado',color:'#16a34a',icon:'🛒'},
  terminal:{label:'Terminal',color:'#0891b2',icon:'🚌'},
  deporte:{label:'Deporte',color:'#65a30d',icon:'🏟️'},
};
// Atribución de los colegios oficiales (CC BY-SA 4.0), que se muestran en los mapas.
export const OFFICIAL_SCHOOLS_ATTRIBUTION='Colegios oficiales: <a href="https://www.datos.gov.co/d/x5ay-984n" target="_blank" rel="noreferrer">MinEducación</a> y <a href="https://www.datos.gov.co/d/7tec-5fhs" target="_blank" rel="noreferrer">Gobernación del Atlántico</a> (CC BY-SA 4.0)';
// Prioridad cuando no caben todos: primero colegios (seguridad vial) y salud.
const ORDER:PlaceKind[]=['colegio','salud','policia','bomberos','iglesia','centro_comercial','alcaldia','universidad','terminal','mercado','deporte'];

function addPlaceIcons(m:GLMap){
  for(const [kind,style] of Object.entries(PLACE_STYLE)){
    const id='lugar-'+kind;
    if(m.hasImage(id))continue;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
    const ctx=canvas.getContext('2d');if(!ctx)continue;
    ctx.beginPath();ctx.arc(32,32,27,0,Math.PI*2);ctx.fillStyle=style.color;ctx.fill();
    ctx.lineWidth=5;ctx.strokeStyle='#ffffff';ctx.stroke();
    ctx.font='30px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(style.icon,32,35);
    m.addImage(id,ctx.getImageData(0,0,64,64),{pixelRatio:2});
  }
}
// Fuente de las etiquetas: la que ya usa el estilo base (sus glifos están disponibles).
function textFont(m:GLMap){
  for(const layer of m.getStyle().layers){
    const font=layer.type==='symbol'?(layer.layout as Record<string,unknown>|undefined)?.['text-font']:null;
    if(Array.isArray(font)&&font.every(f=>typeof f==='string'))return font as string[];
  }
  return null;
}

// El estilo base ya trae íconos para estos tipos: se ocultan para no duplicarlos.
const BASE_CLASSES=['school','college','place_of_worship','hospital','police','fire_station','town_hall'];
function hideBasePlaces(m:GLMap){
  for(const layer of m.getStyle().layers){
    if(layer.type!=='symbol'||!('source-layer' in layer)||layer['source-layer']!=='poi')continue;
    try{m.setFilter(layer.id,['all',...(layer.filter?[layer.filter as ExpressionSpecification]:[]),['!',['in',['get','class'],['literal',BASE_CLASSES]]]] as ExpressionSpecification)}catch{}
  }
}

/** Capa de lugares sobre la fuente GeoJSON `source`, con nombres cuando el estilo tiene fuentes tipográficas. */
export function addPlacesLayer(m:GLMap,source:string,night:boolean){
  addPlaceIcons(m);
  hideBasePlaces(m);
  const font=textFont(m);
  m.addLayer({id:'lugares',type:'symbol',source,minzoom:13.5,
    layout:{
      'icon-image':['concat','lugar-',['get','kind']],
      'icon-size':['interpolate',['linear'],['zoom'],13.5,.6,16,.85,18,1],
      'symbol-sort-key':['match',['get','kind'],...ORDER.flatMap((k,i)=>[k,i]),ORDER.length] as unknown as ExpressionSpecification,
      ...(font?{
        'text-field':['step',['zoom'],'',15.5,['get','name']] as ExpressionSpecification,
        'text-font':font,'text-size':11,'text-offset':[0,1.4],'text-anchor':'top','text-max-width':9,'text-optional':true,
      }:{}),
    },
    paint:font?{'text-color':night?'#e3e9ff':'#1f2a44','text-halo-color':night?'#0b1026':'#ffffff','text-halo-width':1.5}:{}});
}
