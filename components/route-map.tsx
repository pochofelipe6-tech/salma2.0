'use client';
import {useEffect,useRef,useState} from 'react';
import {LocateFixed,MapPin} from 'lucide-react';
import type * as Leaflet from 'leaflet';
import type {RoutePoint} from '../lib/route-types';
import styles from './driver-screen.module.css';

export default function RouteMap({points,position,tracking,stale}:{points:RoutePoint[];position:RoutePoint|null;tracking:boolean;stale:boolean}){
  const container=useRef<HTMLDivElement>(null),map=useRef<Leaflet.Map|null>(null),line=useRef<Leaflet.Polyline|null>(null),marker=useRef<Leaflet.Marker|null>(null),accuracy=useRef<Leaflet.Circle|null>(null),centered=useRef(false);
  const latest=useRef({points,position});latest.current={points,position};
  const [ready,setReady]=useState(0),[follow,setFollow]=useState(true),[tilesError,setTilesError]=useState(false);
  function centerOnPosition(){
    const m=map.current,p=latest.current.position||latest.current.points.at(-1);
    if(!m||!p)return;
    m.invalidateSize();
    if(p.accuracy>60&&accuracy.current)m.fitBounds(accuracy.current.getBounds(),{padding:[45,45],maxZoom:16,animate:false});
    else m.setView([p.lat,p.lng],16,{animate:false});
    centered.current=true;
  }
  useEffect(()=>{
    let disposed=false,observer:ResizeObserver|undefined;
    void import('leaflet').then(L=>{
      if(disposed||!container.current)return;
      const current=latest.current.position||latest.current.points.at(-1);
      const m=L.map(container.current,{zoomControl:false,scrollWheelZoom:false}).setView(current?[current.lat,current.lng]:[4.5709,-74.2973],current?16:5);
      map.current=m;
      const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'}).addTo(m);
      tiles.on('tileerror',()=>{if(!disposed)setTilesError(true)});
      tiles.on('load',()=>{if(!disposed)setTilesError(false)});
      L.control.zoom({position:'bottomright'}).addTo(m);
      line.current=L.polyline([],{color:'#1167e9',weight:5,opacity:.9,lineCap:'round'}).addTo(m);
      marker.current=L.marker(current?[current.lat,current.lng]:[0,0],{title:'Tu ubicación',alt:'Tu ubicación',zIndexOffset:1000,icon:L.divIcon({className:styles.positionMarker,html:'<span></span><b>Tu ubicación</b>',iconSize:[28,28],iconAnchor:[14,14]})});
      accuracy.current=L.circle(current?[current.lat,current.lng]:[0,0],{radius:current?.accuracy||10,color:'#2f84f4',weight:1,fillOpacity:.08});
      m.on('dragstart',()=>setFollow(false));
      m.on('moveend',()=>{if(container.current){const c=m.getCenter();container.current.dataset.centerLat=String(c.lat);container.current.dataset.centerLng=String(c.lng)}});
      observer=new ResizeObserver(()=>m.invalidateSize());observer.observe(container.current);
      centered.current=false;setReady(value=>value+1);
    }).catch(()=>{if(!disposed)setTilesError(true)});
    return()=>{disposed=true;observer?.disconnect();map.current?.remove();map.current=null};
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
  return <div className={styles.mapFrame}>
    <div ref={container} className={styles.mapCanvas} role="img" aria-label="Mapa del recorrido GPS" data-points={points.length}/>
    <div className={styles.mapStatus}><span className={tracking&&!stale?styles.liveDot:styles.offDot}/>{tracking?(!position?'Buscando tu ubicación':stale?'Última ubicación conocida':position.accuracy>60?'Ubicación aproximada':'Ubicación en vivo'):points.length?'Recorrido registrado':'Esperando tu ubicación'}</div>
    <button className={styles.recenter} aria-label="Centrar en mi ubicación" disabled={!position&&!points.length} onClick={()=>{setFollow(true);centerOnPosition()}}><LocateFixed size={19}/></button>
    {!follow&&position&&<button className={styles.followAgain} onClick={()=>{setFollow(true);centerOnPosition()}}>Volver a mi ubicación</button>}
    {!position&&!points.length&&<div className={styles.mapPlaceholder}><span><MapPin size={26}/></span><b>Tu próximo camino empieza aquí</b><p>Inicia tu ruta y permite el GPS para ver<br/>tu ubicación y el recorrido en el mapa.</p></div>}
    {tilesError&&<div className={styles.mapWarning} role="status">No se pudo cargar el mapa base. Revisa tu conexión; el GPS puede seguir registrando el recorrido.</div>}
  </div>;
}
