'use client';
import {useEffect,useRef,useState} from 'react';
import type {Map as GLMap,Marker,GeoJSONSource,StyleSpecification} from 'maplibre-gl';
import type {FeatureCollection,Feature,LineString,Polygon} from 'geojson';
import {decodeTile,tilesAround,type TileData,type TileIndex} from '../lib/map-tiles';
import type {RoutePoint} from '../lib/route-types';
import styles from './driver-screen.module.css';

export type BuildingView={lat:number;lng:number;zoom:number};
export type BuildingControls={recenter:()=>void;view:()=>BuildingView};
export type MapTheme='dia'|'noche';
export const ZONE_COLORS:Record<string,string>={nacional:'#12d98a',urbana:'#3d8bff',curvas:'#ffa62b',escolar:'#c46bff'};
// Día: estilo claro con edificios azules; noche: estilo oscuro con edificios neón.
const THEMES={
  dia:{style:'https://tiles.openfreemap.org/styles/liberty',buildings:[0,'#e9eef7',8,'#d2ddf0',20,'#a8c0ea',45,'#7b9be0',90,'#4f6ccf',160,'#3a3db0'],trail:'#0752ff',glow:.28,hill:['#4b5d78','#ffffff'],
    sky:{'sky-color':'#3d8bff','horizon-color':'#d6ebff','fog-color':'#eef5ff','sky-horizon-blend':.55,'horizon-fog-blend':.45,'fog-ground-blend':.55,'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,12,.6,16,.2]},
    light:{anchor:'viewport',color:'#ffffff',intensity:.32,position:[1.4,210,40]}},
  noche:{style:'https://tiles.openfreemap.org/styles/dark',buildings:[0,'#141d36',8,'#1b2f5c',20,'#2850a6',45,'#4b5cf2',90,'#8b4dff',160,'#ff4fd8'],trail:'#00e5ff',glow:.55,hill:['#000000','#33467a'],
    sky:{'sky-color':'#050816','horizon-color':'#40206f','fog-color':'#0b1026','sky-horizon-blend':.7,'horizon-fog-blend':.5,'fog-ground-blend':.4,'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,12,.5,16,.1]},
    light:{anchor:'viewport',color:'#a8c2ff',intensity:.5,position:[1.2,180,60]}},
} as const;
const DEM='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
// Respaldo si OpenFreeMap no responde: mapa estándar de OpenStreetMap (sin edificios) con relieve y vías por zona.
const fallbackStyle=(theme:MapTheme):StyleSpecification=>({version:8,
  sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'}},
  layers:[{id:'fondo',type:'background',paint:{'background-color':theme==='noche'?'#0b1026':'#eeeae3'}},{id:'osm',type:'raster',source:'osm',paint:theme==='noche'?{'raster-brightness-max':.4,'raster-saturation':-.5}:{}}]});
const metres=(a:RoutePoint,b:RoutePoint)=>Math.hypot((b.lng-a.lng)*111195*Math.cos(a.lat*Math.PI/180),(b.lat-a.lat)*111195);
const bearing=(a:RoutePoint,b:RoutePoint)=>(Math.atan2((b.lng-a.lng)*Math.cos(a.lat*Math.PI/180),b.lat-a.lat)*180/Math.PI+360)%360;
const reducedMotion=()=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Vías clasificadas (public/map-tiles) alrededor del centro, coloreadas por zona SST.
function createZoneOverlay(onData:(data:FeatureCollection<LineString>)=>void){
  const features=new Map<string,Feature<LineString>>(),loaded=new Set<string>();let catalog:Promise<Set<string>>|null=null;
  return async(lat:number,lng:number)=>{
    catalog??=fetch('/map-tiles/index.json').then(r=>r.ok?r.json():{tiles:[]}).then((d:TileIndex)=>new Set(d.tiles)).catch(()=>{catalog=null;return new Set<string>()});
    const keys=await catalog,wanted=tilesAround(lat,lng,2200).filter(k=>keys.has(k)&&!loaded.has(k));
    if(!wanted.length)return;
    for(const k of wanted)loaded.add(k);
    await Promise.all(wanted.map(async k=>{
      try{const r=await fetch(`/map-tiles/${k}.json`);if(!r.ok)throw new Error();for(const s of decodeTile(await r.json() as TileData))if(!features.has(s.id))features.set(s.id,{type:'Feature',properties:{id:s.id,zone:s.zone},geometry:{type:'LineString',coordinates:s.geometry}})}
      catch{loaded.delete(k)}
    }));
    onData({type:'FeatureCollection',features:[...features.values()]});
  };
}

export default function BuildingsMap({initialView,points,position,stale,follow,theme,roadId,onDrag,onReady,onError,markerLabel='Tu ubicación'}:{initialView:BuildingView;points:RoutePoint[];position:RoutePoint|null;stale:boolean;follow:boolean;theme:MapTheme;roadId?:string;onDrag:()=>void;onReady:(controls:BuildingControls|null)=>void;onError:()=>void;markerLabel?:string}){
  const container=useRef<HTMLDivElement>(null),map=useRef<GLMap|null>(null),marker=useRef<Marker|null>(null),heading=useRef<number|null>(null),intro=useRef(true);
  const latest=useRef({points,position,stale,follow,onReady,onError,onDrag});latest.current={points,position,stale,follow,onReady,onError,onDrag};
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    let disposed=false,observer:ResizeObserver|undefined,timeout:ReturnType<typeof setTimeout>|undefined;
    setReady(false);intro.current=true;
    void import('maplibre-gl').then(gl=>{
      if(disposed||!container.current)return;
      gl.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs',import.meta.url).toString());
      const t=THEMES[theme];
      const build=(fallback:boolean)=>{
      if(disposed||!container.current)return;
      const m=new gl.Map({container:container.current,style:fallback?fallbackStyle(theme):t.style,center:[initialView.lng,initialView.lat],zoom:Math.min(initialView.zoom,13.5),pitch:0,bearing:0,maxPitch:78,minZoom:3,maxZoom:20.5,attributionControl:{compact:true},canvasContextAttributes:{antialias:true}});
      map.current=m;
      container.current.dataset.basemap=fallback?'standard':'vector';
      // Sin botones de zoom/brújula: en 3D se usan gestos y «Centrar» endereza la cámara.
      m.on('dragstart',()=>latest.current.onDrag());
      // Si el estilo de OpenFreeMap falla o tarda, se rehace el mapa con el respaldo; si también falla, se avisa.
      // Una imagen o cuadrícula que falle después de cargar el estilo no cierra el mapa.
      let failed=false,styleLoaded=false;
      const fail=()=>{
        if(disposed||failed)return;failed=true;clearTimeout(timeout);
        if(fallback){latest.current.onError();return}
        setTimeout(()=>{if(disposed||map.current!==m)return;m.remove();map.current=null;build(true)},0);
      };
      m.once('style.load',()=>{styleLoaded=true});
      timeout=setTimeout(()=>{if(!styleLoaded)fail()},fallback?15000:12000);
      m.on('error',()=>{if(!styleLoaded)fail()});
      m.once('load',()=>{
        if(disposed||failed)return;
        clearTimeout(timeout);
        // Las capas propias van encima de las calles y debajo de las etiquetas; el relieve, debajo de las calles.
        const layers=m.getStyle().layers,isRoad=(l:(typeof layers)[number])=>'source-layer' in l&&l['source-layer']==='transportation';
        const lastRoad=layers.reduce((last,l,i)=>isRoad(l)?i:last,-1);
        const firstSymbol=layers.find((l,i)=>i>lastRoad&&l.type==='symbol')?.id,firstRoad=layers.find(isRoad)?.id;
        // Relieve del terreno, sombras de colinas, cielo y luz.
        m.addSource('relieve',{type:'raster-dem',tiles:[DEM],encoding:'terrarium',tileSize:256,maxzoom:14,attribution:'Relieve: Mapzen / AWS Terrain Tiles'});
        m.addSource('relieve-sombra',{type:'raster-dem',tiles:[DEM],encoding:'terrarium',tileSize:256,maxzoom:14});
        m.addLayer({id:'colinas',type:'hillshade',source:'relieve-sombra',paint:{'hillshade-exaggeration':.4,'hillshade-shadow-color':t.hill[0],'hillshade-highlight-color':t.hill[1]}},firstRoad);
        m.setTerrain({source:'relieve',exaggeration:1.5});
        m.setSky(t.sky as unknown as Parameters<GLMap['setSky']>[0]);
        m.setLight(t.light as unknown as Parameters<GLMap['setLight']>[0]);
        // Edificios propios: altura real del mapa y color según la altura.
        for(const id of ['building','building-3d'])if(m.getLayer(id))m.setLayoutProperty(id,'visibility','none');
        if(m.getSource('openmaptiles'))m.addLayer({id:'edificios-3d',type:'fill-extrusion',source:'openmaptiles','source-layer':'building',minzoom:13,paint:{
          'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],7],...t.buildings] as never,
          'fill-extrusion-height':['interpolate',['linear'],['zoom'],13,0,15,['coalesce',['get','render_height'],7]],
          'fill-extrusion-base':['interpolate',['linear'],['zoom'],13,0,15,['coalesce',['get','render_min_height'],0]],
          'fill-extrusion-opacity':.92,'fill-extrusion-vertical-gradient':true}},firstSymbol);
        // Vías por zona SST con brillo, y la vía actual resaltada.
        const zoneColor=['match',['get','zone'],'nacional',ZONE_COLORS.nacional,'curvas',ZONE_COLORS.curvas,'escolar',ZONE_COLORS.escolar,ZONE_COLORS.urbana];
        m.addSource('zonas',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        m.addLayer({id:'zonas-brillo',type:'line',source:'zonas',minzoom:12,paint:{'line-color':zoneColor as never,'line-width':['interpolate',['linear'],['zoom'],12,4,17,14],'line-blur':['interpolate',['linear'],['zoom'],12,3,17,9],'line-opacity':t.glow},layout:{'line-cap':'round','line-join':'round'}},firstSymbol);
        m.addLayer({id:'zonas-linea',type:'line',source:'zonas',minzoom:12,paint:{'line-color':zoneColor as never,'line-width':['interpolate',['linear'],['zoom'],12,1,17,3.5],'line-opacity':.95},layout:{'line-cap':'round','line-join':'round'}},firstSymbol);
        m.addLayer({id:'via-actual',type:'line',source:'zonas',filter:['==',['get','id'],''],paint:{'line-color':zoneColor as never,'line-width':['interpolate',['linear'],['zoom'],12,6,17,16],'line-blur':2,'line-opacity':.95},layout:{'line-cap':'round','line-join':'round'}},firstSymbol);
        const overlay=createZoneOverlay(data=>{if(!disposed)(m.getSource('zonas') as GeoJSONSource|undefined)?.setData(data)});
        const refresh=()=>{const c=m.getCenter();void overlay(c.lat,c.lng)};
        m.on('moveend',refresh);refresh();
        // Estela del recorrido: degradado hacia la posición actual y halo.
        m.addSource('journey',{type:'geojson',lineMetrics:true,data:{type:'FeatureCollection',features:[]}});
        m.addLayer({id:'journey-glow',type:'line',source:'journey',paint:{'line-color':t.trail,'line-width':18,'line-blur':12,'line-opacity':.45},layout:{'line-cap':'round','line-join':'round'}});
        m.addLayer({id:'journey-line',type:'line',source:'journey',paint:{'line-width':6,'line-gradient':['interpolate',['linear'],['line-progress'],0,'rgba(0,229,255,0.15)',.6,t.trail,1,'#ffffff']},layout:{'line-cap':'round','line-join':'round'}});
        m.addSource('gps-accuracy',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        m.addLayer({id:'gps-accuracy',type:'fill',source:'gps-accuracy',paint:{'fill-color':t.trail,'fill-opacity':.12}});
        // Vehículo: flecha apoyada en el suelo que gira con el rumbo.
        const element=document.createElement('div');element.className=styles.vehicle3d;element.setAttribute('aria-label',markerLabel);
        element.innerHTML='<span></span><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 L34 35 L20 27 L6 35 Z"/></svg>';
        marker.current=new gl.Marker({element,anchor:'center',rotationAlignment:'map',pitchAlignment:'map'});
        container.current?.setAttribute('data-buildings','ready');
        // La atribución compacta empieza abierta; se pliega para no tapar el panel de navegación.
        container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        if(!latest.current.position&&!latest.current.points.length){intro.current=false;m.flyTo({center:[initialView.lng,initialView.lat],zoom:Math.max(16,initialView.zoom),pitch:60,bearing:-25,duration:reducedMotion()?0:2800,essential:true})}
        latest.current.onReady({recenter:()=>{const p=latest.current.position||latest.current.points.at(-1);if(p)m.easeTo({center:[p.lng,p.lat],zoom:Math.max(m.getZoom(),16.5),pitch:62,bearing:heading.current??m.getBearing(),duration:reducedMotion()?0:900})},view:()=>({lat:m.getCenter().lat,lng:m.getCenter().lng,zoom:m.getZoom()})});
        setReady(true);
      });
      };
      build(false);
      observer=new ResizeObserver(()=>map.current?.resize());observer.observe(container.current);
    }).catch(()=>{if(!disposed)latest.current.onError()});
    return()=>{disposed=true;clearTimeout(timeout);observer?.disconnect();latest.current.onReady(null);marker.current?.remove();marker.current=null;map.current?.remove();map.current=null};
  },[initialView,theme]);
  useEffect(()=>{const m=map.current;if(m&&ready&&m.getLayer('via-actual'))m.setFilter('via-actual',['==',['get','id'],roadId||''])},[roadId,ready]);
  useEffect(()=>{
    const m=map.current;if(!m||!ready)return;
    const route:FeatureCollection<LineString>={type:'FeatureCollection',features:points.length>1?[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:points.map(p=>[p.lng,p.lat])}}]:[]};
    (m.getSource('journey') as GeoJSONSource)?.setData(route);
    const p=position||points.at(-1);if(!p)return;
    // Rumbo a partir de las dos últimas posiciones separadas al menos 3 m.
    const before=[...points].reverse().find(q=>q!==p&&metres(q,p)>=3);
    if(before)heading.current=bearing(before,p);
    marker.current?.setLngLat([p.lng,p.lat]).setRotation(heading.current??0).addTo(m);
    const element=marker.current?.getElement();if(element)element.style.opacity=stale?'.6':'1';
    const ring=Array.from({length:65},(_,i)=>{const a=i*Math.PI/32;return [p.lng+Math.cos(a)*p.accuracy/(111195*Math.cos(p.lat*Math.PI/180)),p.lat+Math.sin(a)*p.accuracy/111195]});
    const accuracy:Feature<Polygon>={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}};
    (m.getSource('gps-accuracy') as GeoJSONSource)?.setData(accuracy);
    // Entrada cinematográfica la primera vez; después, cámara de navegación con el rumbo arriba.
    if(intro.current){intro.current=false;m.flyTo({center:[p.lng,p.lat],zoom:17,pitch:62,bearing:heading.current??-25,duration:reducedMotion()?0:3200,curve:1.5,essential:true});return}
    if(follow&&!m.isMoving())m.easeTo({center:[p.lng,p.lat],bearing:heading.current??m.getBearing(),duration:reducedMotion()?0:900,easing:x=>x});
  },[points,position,stale,follow,ready]);
  return <div ref={container} className={styles.buildingsCanvas} role="img" aria-label="Mapa 3D del recorrido" data-theme={theme} data-points={points.length}/>;
}
