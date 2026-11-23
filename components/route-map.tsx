'use client';
import {useEffect,useRef,useState} from 'react';
import {LocateFixed,MapPin,Maximize2,Minimize2,Box,Moon,Sun} from 'lucide-react';
import type * as Leaflet from 'leaflet';
import type {RoutePoint} from '../lib/route-types';
import BuildingsMap,{ZONE_COLORS,type BuildingView,type BuildingControls,type MapTheme} from './buildings-map';
import styles from './driver-screen.module.css';

export type MapNav={speed:number|null;limit:number|null;roadName?:string;place?:string;zone?:string;roadId?:string};
const LEGEND=[['nacional','Nacional 70'],['urbana','Urbana 50'],['curvas','Curva 35'],['escolar','Colegio 30']];
const nightNow=()=>{const h=new Date().getHours();return h>=18||h<6};
// El 3D necesita WebGL; algunos teléfonos o navegadores lo tienen desactivado.
function supportsWebGL(){
  try{const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2')||canvas.getContext('webgl');gl?.getExtension('WEBGL_lose_context')?.loseContext();return !!gl}catch{return false}
}
const NO_WEBGL='Este dispositivo no tiene activada la aceleración gráfica (WebGL) que necesita el mapa 3D. Puedes seguir con el mapa 2D.';
const FAILED_3D='No se pudo cargar la vista 3D. Revisa tu conexión y toca 3D para intentarlo de nuevo.';

export default function RouteMap({points,position,tracking,stale,zoneLabel,zoneId,nav,markerLabel='Tu ubicación'}:{points:RoutePoint[];position:RoutePoint|null;tracking:boolean;stale:boolean;zoneLabel?:string;zoneId?:string;nav?:MapNav;markerLabel?:string}){
  const [theme,setTheme]=useState<MapTheme>(()=>nightNow()?'noche':'dia');
  const container=useRef<HTMLDivElement>(null),map=useRef<Leaflet.Map|null>(null),line=useRef<Leaflet.Polyline|null>(null),marker=useRef<Leaflet.Marker|null>(null),accuracy=useRef<Leaflet.Circle|null>(null),centered=useRef(false),frame=useRef<HTMLDivElement>(null);
  const latest=useRef({points,position});latest.current={points,position};
  const [ready,setReady]=useState(0),[follow,setFollow]=useState(true),[tilesError,setTilesError]=useState(false),[baseMap,setBaseMap]=useState<'loading'|'vector'|'standard'>('loading'),[expanded,setExpanded]=useState(false);
  const [buildingView,setBuildingView]=useState<BuildingView|null>(null),[buildingsError,setBuildingsError]=useState('');
  const buildingControls=useRef<BuildingControls|null>(null);
  function toggleBuildings(){
    if(buildingView){const view=buildingControls.current?.view();if(view)map.current?.setView([view.lat,view.lng],view.zoom,{animate:false});setBuildingView(null);return}
    if(!supportsWebGL()){setBuildingsError(NO_WEBGL);return}
    // No depende del mapa 2D: si aún no cargó, parte de la última posición o de Barranquilla.
    const center=map.current?.getCenter(),p=latest.current.position||latest.current.points.at(-1);
    setBuildingsError('');
    setBuildingView(center?{lat:center.lat,lng:center.lng,zoom:map.current?.getZoom()||17}:p?{lat:p.lat,lng:p.lng,zoom:16}:{lat:10.98,lng:-74.82,zoom:12});
  }
  function centerOnPosition(resetZoom=false){
    if(buildingControls.current){buildingControls.current.recenter();return}
    const m=map.current,p=latest.current.position||latest.current.points.at(-1);
    if(!m||!p)return;
    m.invalidateSize();
    if((resetZoom||!centered.current)&&p.accuracy>60&&accuracy.current)m.fitBounds(accuracy.current.getBounds(),{padding:[45,45],maxZoom:16,animate:false});
    else if(resetZoom||!centered.current)m.setView([p.lat,p.lng],16,{animate:false});
    else m.panTo([p.lat,p.lng],{animate:false});
    centered.current=true;
  }
  useEffect(()=>{
    let disposed=false,observer:ResizeObserver|undefined,timeout:ReturnType<typeof setTimeout>|undefined;
    void import('leaflet').then(L=>{
      if(disposed||!container.current)return;
      const current=latest.current.position||latest.current.points.at(-1);
      const m=L.map(container.current,{zoomControl:false,scrollWheelZoom:true,minZoom:3,maxZoom:21}).setView(current?[current.lat,current.lng]:[10.98,-74.82],current?16:12);
      map.current=m;
      let raster:Leaflet.TileLayer|undefined,vector:Leaflet.MaplibreGL|undefined;
      const fallback=()=>{
        if(disposed||raster)return;
        if(vector&&m.hasLayer(vector))m.removeLayer(vector);
        raster=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxNativeZoom:19,maxZoom:21,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'}).addTo(m);
        raster.on('tileerror',()=>{if(!disposed)setTilesError(true)});raster.on('load',()=>{if(!disposed)setTilesError(false)});
        setBaseMap('standard');
      };
      void Promise.all([import('@maplibre/maplibre-gl-leaflet'),import('maplibre-gl')]).then(([adapter,gl])=>{
        if(disposed)return;
        gl.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs',import.meta.url).toString());
        vector=adapter.maplibreGL({style:'https://tiles.openfreemap.org/styles/liberty',attributionControl:false}).addTo(m);
        const rendered=vector.getMaplibreMap();
        // Solo pasa al mapa estándar si no carga el estilo; una cuadrícula o imagen que falle no cuenta.
        let styleLoaded=false;rendered.once('style.load',()=>{styleLoaded=true});
        timeout=setTimeout(()=>{if(!disposed&&!styleLoaded)fallback()},12000);
        rendered.once('load',()=>{if(disposed||raster)return;clearTimeout(timeout);setTilesError(false);setBaseMap('vector');container.current?.setAttribute('data-basemap','vector');m.attributionControl?.addAttribution('<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>')});
        rendered.on('error',()=>{if(!disposed&&!styleLoaded)fallback()});
      }).catch(fallback);
      L.control.zoom({position:'bottomright',zoomInTitle:'Acercar mapa',zoomOutTitle:'Alejar mapa'}).addTo(m);
      L.control.scale({position:'bottomleft',imperial:false,maxWidth:100}).addTo(m);
      line.current=L.polyline([],{color:'#1167e9',weight:5,opacity:.9,lineCap:'round'}).addTo(m);
      marker.current=L.marker(current?[current.lat,current.lng]:[0,0],{title:markerLabel,alt:markerLabel,zIndexOffset:1000,icon:L.divIcon({className:styles.positionMarker,html:(()=>{const element=document.createElement('div');element.innerHTML='<span></span>';const label=document.createElement('b');label.textContent=markerLabel;element.append(label);return element})(),iconSize:[28,28],iconAnchor:[14,14]})});
      accuracy.current=L.circle(current?[current.lat,current.lng]:[0,0],{radius:current?.accuracy||10,color:'#2f84f4',weight:1,fillOpacity:.08});
      m.on('dragstart',()=>setFollow(false));
      m.on('moveend',()=>{if(container.current){const c=m.getCenter();container.current.dataset.centerLat=String(c.lat);container.current.dataset.centerLng=String(c.lng);container.current.dataset.zoom=String(m.getZoom())}});
      observer=new ResizeObserver(()=>m.invalidateSize());observer.observe(container.current);
      centered.current=false;setReady(value=>value+1);
    }).catch(()=>{if(!disposed)setTilesError(true)});
    return()=>{disposed=true;clearTimeout(timeout);observer?.disconnect();map.current?.remove();map.current=null};
  },[]);
  useEffect(()=>{
    const m=map.current;if(!m||!ready)return;
    line.current?.setLatLngs(points.map(p=>[p.lat,p.lng] as [number,number]));
    const p=position||points.at(-1);
    if(p){
      marker.current?.setLatLng([p.lat,p.lng]).setOpacity(stale?.65:1).addTo(m);
      accuracy.current?.setLatLng([p.lat,p.lng]).setRadius(p.accuracy).addTo(m);
      if(follow||!centered.current)centerOnPosition();
    }
  },[points,position,ready,follow,stale]);
  useEffect(()=>{const changed=()=>setExpanded(document.fullscreenElement===frame.current);document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed)},[]);
  return <div ref={frame} className={styles.mapFrame}>
    <div ref={container} className={styles.mapCanvas} role="img" aria-hidden={!!buildingView} inert={!!buildingView} style={buildingView?{visibility:'hidden'}:undefined} aria-label="Mapa del recorrido GPS" data-points={points.length}/>
    {buildingView&&<BuildingsMap initialView={buildingView} points={points} position={position} stale={stale} follow={follow} theme={theme} roadId={nav?.roadId} onDrag={()=>setFollow(false)} markerLabel={markerLabel} onReady={controls=>{buildingControls.current=controls}} onError={()=>{setBuildingView(null);setBuildingsError(FAILED_3D)}}/>}
    {buildingView&&<>
      <button className={styles.themeToggle} aria-label={theme==='noche'?'Cambiar a mapa de día':'Cambiar a mapa de noche'} title={theme==='noche'?'Mapa de día':'Mapa de noche'} onClick={()=>{const view=buildingControls.current?.view();if(view)setBuildingView(view);setTheme(theme==='noche'?'dia':'noche')}}>{theme==='noche'?<Sun size={17}/>:<Moon size={17}/>}</button>
      <ul className={styles.legend3d} aria-label="Colores de las zonas">{LEGEND.map(([zone,label])=><li key={zone}><i style={{background:ZONE_COLORS[zone]}}/>{label}</li>)}</ul>
      {nav&&tracking&&<div className={styles.hud3d} data-zone={nav.zone} data-excess={nav.speed!==null&&nav.limit!==null&&nav.speed>nav.limit} aria-label="Velocidad y vía actual">
        <div className={styles.hudSpeed}><strong>{nav.speed===null?'—':Math.round(nav.speed)}</strong><small>km/h</small></div>
        <div className={styles.hudLimit} aria-label={nav.limit===null?'Límite no disponible':`Límite ${nav.limit} km/h`}>{nav.limit??'—'}</div>
        <div className={styles.hudRoad}><b>{nav.roadName||'Identificando la vía...'}</b>{nav.place&&<span>{nav.place}</span>}</div>
      </div>}
    </>}
    <div className={styles.mapStatus}><span className={tracking&&!stale?styles.liveDot:styles.offDot}/>{tracking?(!position?'Buscando tu ubicación':stale?'Última ubicación conocida':position.accuracy>60?'Ubicación aproximada':'Ubicación en vivo'):points.length?'Recorrido registrado':'Esperando tu ubicación'}</div>
    {zoneLabel&&!buildingView&&<div className={styles.mapZoneBadge} data-zone={zoneId}><LocateFixed size={15}/><span>Zona actual<b>{zoneLabel}</b></span></div>}
    <button className={styles.recenter} aria-label="Centrar en mi ubicación" disabled={!position&&!points.length} onClick={()=>{setFollow(true);centerOnPosition(true)}}><LocateFixed size={19}/></button>
    <button className={styles.mapExpand} aria-label={expanded?'Salir de pantalla completa':'Ampliar mapa'} title={expanded?'Salir de pantalla completa':'Ampliar mapa'} onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});else void frame.current?.requestFullscreen?.().catch(()=>{})}}>{expanded?<Minimize2 size={18}/>:<Maximize2 size={18}/>}</button>
    <button className={styles.buildingsToggle} aria-label={buildingView?'Ver mapa en 2D':'Ver mapa en 3D'} aria-pressed={!!buildingView} title={buildingView?'Volver a 2D':'Ver mapa en 3D'} onClick={toggleBuildings}><Box size={17}/>{buildingView?'2D':'3D'}</button>
    {buildingsError&&<div className={styles.mapWarning} role="status">{buildingsError}</div>}
    {!buildingView&&<span className={styles.mapProvider}>{baseMap==='vector'?'Mapa de calles':baseMap==='loading'?'Cargando mapa...':'Mapa estándar'}</span>}
    {!follow&&position&&<button className={styles.followAgain} onClick={()=>{setFollow(true);centerOnPosition()}}>Volver a mi ubicación</button>}
    {!position&&!points.length&&<div className={styles.mapIntro}><MapPin size={16}/><span>Inicia la ruta para activar tu ubicación.</span></div>}
    {tilesError&&<div className={styles.mapWarning} role="status">No se pudo cargar el mapa base. Revisa tu conexión; el GPS puede seguir registrando el recorrido.</div>}
  </div>;
}
