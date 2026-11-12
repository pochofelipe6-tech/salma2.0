'use client';
import {useEffect,useRef,useState} from 'react';
import {LocateFixed,MapPin} from 'lucide-react';
import type * as Leaflet from 'leaflet';
import type {RoutePoint} from '../lib/route-types';
import styles from './driver-screen.module.css';

export default function RouteMap({points,position,tracking,stale}:{points:RoutePoint[];position:RoutePoint|null;tracking:boolean;stale:boolean}){
  const container=useRef<HTMLDivElement>(null),map=useRef<Leaflet.Map|null>(null),line=useRef<Leaflet.Polyline|null>(null),marker=useRef<Leaflet.CircleMarker|null>(null),accuracy=useRef<Leaflet.Circle|null>(null);
  const latest=useRef({points,position});latest.current={points,position};
  const [ready,setReady]=useState(false),[follow,setFollow]=useState(true),[tilesError,setTilesError]=useState(false);
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
      marker.current=L.circleMarker(current?[current.lat,current.lng]:[0,0],{radius:8,color:'#fff',weight:3,fillColor:'#1167e9',fillOpacity:1});
      accuracy.current=L.circle(current?[current.lat,current.lng]:[0,0],{radius:current?.accuracy||10,color:'#2f84f4',weight:1,fillOpacity:.08});
      m.on('dragstart',()=>setFollow(false));
      observer=new ResizeObserver(()=>m.invalidateSize());observer.observe(container.current);
      setReady(true);
    }).catch(()=>{if(!disposed)setTilesError(true)});
    return()=>{disposed=true;observer?.disconnect();map.current?.remove();map.current=null};
  },[]);
  useEffect(()=>{
    const m=map.current;if(!m||!ready)return;
    line.current?.setLatLngs(points.map(p=>[p.lat,p.lng] as [number,number]));
    const p=position||points.at(-1);
    if(p){
      marker.current?.setLatLng([p.lat,p.lng]).setStyle({fillColor:stale?'#8b9bb0':'#1167e9'}).addTo(m);
      accuracy.current?.setLatLng([p.lat,p.lng]).setRadius(p.accuracy).addTo(m);
      if(follow){if(p.accuracy>60&&accuracy.current)m.fitBounds(accuracy.current.getBounds(),{padding:[35,35],maxZoom:16,animate:false});else m.setView([p.lat,p.lng],16,{animate:false})}
    }
  },[points,position,ready,follow,stale]);
  return <div className={styles.mapFrame}>
    <div ref={container} className={styles.mapCanvas} role="img" aria-label="Mapa del recorrido GPS" data-points={points.length}/>
    <div className={styles.mapStatus}><span className={tracking&&!stale?styles.liveDot:styles.offDot}/>{tracking?(!position?'Buscando tu ubicación':stale?'Última ubicación conocida':position.accuracy>60?'Ubicación aproximada':'Ubicación en vivo'):points.length?'Recorrido registrado':'Esperando tu ubicación'}</div>
    <button className={styles.recenter} aria-label="Centrar en mi ubicación" disabled={!position&&!points.length} onClick={()=>setFollow(true)}><LocateFixed size={19}/></button>
    {!position&&!points.length&&<div className={styles.mapPlaceholder}><span><MapPin size={26}/></span><b>Tu próximo camino empieza aquí</b><p>Inicia tu ruta y permite el GPS para ver<br/>tu ubicación y el recorrido en el mapa.</p></div>}
    {tilesError&&<div className={styles.mapWarning} role="status">No se pudo cargar el mapa base. Revisa tu conexión; el GPS puede seguir registrando el recorrido.</div>}
  </div>;
}
