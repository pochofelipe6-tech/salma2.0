'use client';
import {useEffect,useRef,useState} from 'react';
import type {Map as GLMap,Marker,GeoJSONSource} from 'maplibre-gl';
import type {FeatureCollection,Feature,LineString,Polygon} from 'geojson';
import type {RoutePoint} from '../lib/route-types';
import styles from './driver-screen.module.css';

export type BuildingView={lat:number;lng:number;zoom:number};
export type BuildingControls={recenter:()=>void;view:()=>BuildingView};
export default function BuildingsMap({initialView,points,position,stale,follow,onDrag,onReady,onError,markerLabel='Tu ubicación'}:{initialView:BuildingView;points:RoutePoint[];position:RoutePoint|null;stale:boolean;follow:boolean;onDrag:()=>void;onReady:(controls:BuildingControls|null)=>void;onError:()=>void;markerLabel?:string}){
  const container=useRef<HTMLDivElement>(null),map=useRef<GLMap|null>(null),marker=useRef<Marker|null>(null);
  const latest=useRef({points,position,stale,follow,onReady,onError,onDrag});latest.current={points,position,stale,follow,onReady,onError,onDrag};
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    let disposed=false,observer:ResizeObserver|undefined,timeout:ReturnType<typeof setTimeout>|undefined;
    void import('maplibre-gl').then(gl=>{
      if(disposed||!container.current)return;
      gl.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs',import.meta.url).toString());
      const m=new gl.Map({container:container.current,style:'https://tiles.openfreemap.org/styles/liberty',center:[initialView.lng,initialView.lat],zoom:Math.max(16.8,initialView.zoom),pitch:55,bearing:-12,minZoom:3,maxZoom:21,attributionControl:{compact:true}});
      map.current=m;
      m.addControl(new gl.NavigationControl({visualizePitch:true}),'bottom-right');
      m.addControl(new gl.ScaleControl({unit:'metric'}),'bottom-left');
      m.on('dragstart',()=>latest.current.onDrag());
      const fail=()=>{if(!disposed)latest.current.onError()};
      timeout=setTimeout(()=>{if(!disposed&&!m.isStyleLoaded())fail()},15000);
      m.on('error',()=>{if(!m.isStyleLoaded())fail()});
      m.once('load',()=>{
        if(disposed)return;
        clearTimeout(timeout);
        m.addSource('journey',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        m.addLayer({id:'journey-outline',type:'line',source:'journey',paint:{'line-color':'#ffffff','line-width':8},layout:{'line-cap':'round','line-join':'round'}});
        m.addLayer({id:'journey-line',type:'line',source:'journey',paint:{'line-color':'#1462ed','line-width':5},layout:{'line-cap':'round','line-join':'round'}});
        m.addSource('gps-accuracy',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        m.addLayer({id:'gps-accuracy',type:'fill',source:'gps-accuracy',paint:{'fill-color':'#418fff','fill-opacity':.12}});
        const element=document.createElement('div');element.className=styles.positionMarker;element.innerHTML='<span></span>';const label=document.createElement('b');label.textContent=markerLabel;element.append(label);
        marker.current=new gl.Marker({element,anchor:'center'});
        container.current?.setAttribute('data-buildings',m.getLayer('building-3d')?'ready':'unavailable');
        latest.current.onReady({recenter:()=>{const p=latest.current.position||latest.current.points.at(-1);if(p)m.jumpTo({center:[p.lng,p.lat]})},view:()=>({lat:m.getCenter().lat,lng:m.getCenter().lng,zoom:m.getZoom()})});
        setReady(true);
      });
      observer=new ResizeObserver(()=>m.resize());observer.observe(container.current);
    }).catch(()=>{if(!disposed)latest.current.onError()});
    return()=>{disposed=true;clearTimeout(timeout);observer?.disconnect();latest.current.onReady(null);marker.current?.remove();marker.current=null;map.current?.remove();map.current=null};
  },[initialView]);
  useEffect(()=>{
    const m=map.current;if(!m||!ready)return;
    const route:FeatureCollection<LineString>={type:'FeatureCollection',features:points.length>1?[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:points.map(p=>[p.lng,p.lat])}}]:[]};
    (m.getSource('journey') as GeoJSONSource)?.setData(route);
    const p=position||points.at(-1);if(!p)return;
    marker.current?.setLngLat([p.lng,p.lat]).addTo(m);const element=marker.current?.getElement();if(element)element.style.opacity=stale?'.65':'1';
    const ring=Array.from({length:65},(_,i)=>{const a=i*Math.PI/32;return [p.lng+Math.cos(a)*p.accuracy/(111195*Math.cos(p.lat*Math.PI/180)),p.lat+Math.sin(a)*p.accuracy/111195]});
    const accuracy:Feature<Polygon>={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}};
    (m.getSource('gps-accuracy') as GeoJSONSource)?.setData(accuracy);
    if(follow)m.jumpTo({center:[p.lng,p.lat]});
  },[points,position,stale,follow,ready]);
  return <div ref={container} className={styles.buildingsCanvas} role="img" aria-label="Mapa de edificaciones en 3D" data-points={points.length}/>;
}
