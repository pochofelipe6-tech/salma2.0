'use client';
import {useEffect,useRef,useState} from 'react';
import type {Map as GLMap,Marker,GeoJSONSource,StyleSpecification,ExpressionSpecification} from 'maplibre-gl';
import type {FeatureCollection,Feature,LineString,Polygon} from 'geojson';
import type {RoutePoint} from '../lib/route-types';
import {buildingColor,buildingHeight,greenArea,greenAreaFilter,laneMarkingFilter,laneMarkingWidth,ROAD_HALF_WIDTH_M,roadWidth,stripeOffset,stripeWidth,styleBaseMap,type RoadGroup} from '../lib/map-3d-style';
import {generateTrees,type GreenArea,type StreetLine} from '../lib/trees-3d';
import {extraBuildings,splitBuildings} from '../lib/buildings-3d';
import {createBuildingTileLoader} from '../lib/building-tiles';
import {createMapOverlay} from '../lib/map-overlay';
import {addPlacesLayer,OFFICIAL_SCHOOLS_ATTRIBUTION} from '../lib/map-places';
import styles from './driver-screen.module.css';

export type BuildingView={lat:number;lng:number;zoom:number};
export type BuildingControls={recenter:()=>void;view:()=>BuildingView};
export type MapTheme='dia'|'noche';
export const ZONE_COLORS:Record<string,string>={nacional:'#12d98a',urbana:'#3d8bff',curvas:'#ffa62b',escolar:'#c46bff'};
// Día: casas en tonos cálidos y torres de vidrio azul, asfalto gris y sol fijo para sombrear fachadas.
// Noche: estilo oscuro con edificios neón y vías iluminadas.
const THEMES={
  dia:{style:'https://tiles.openfreemap.org/styles/liberty',
    houses:['#f7f2e8','#f3dcc4','#dde8f3','#f5ecc8','#dcefe1','#f4dfd7','#ece6f5'],towers:[12,'#dbe6f5',30,'#b3c8ec',60,'#8fb0e6',120,'#6b93dc',200,'#4d74cf'],
    asphalt:'#a2aab6',curb:'#fdfbf7',marking:'#ffffff',markingOpacity:.95,path:.45,green:.75,
    trees:{crown:['#3b8a3e','#4a9a3a','#2f7a3a','#5aa547'],top:['#58a54d','#6bb44a','#479447','#78bf57'],trunk:'#7b5a3a'},
    trail:'#0752ff',glow:.12,hill:['#4b5d78','#ffffff'],
    sky:{'sky-color':'#3d8bff','horizon-color':'#d6ebff','fog-color':'#eef5ff','sky-horizon-blend':.55,'horizon-fog-blend':.45,'fog-ground-blend':.55,'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,12,.6,16,.2]},
    light:{anchor:'map',color:'#ffffff',intensity:.5,position:[1.3,200,32]}},
  noche:{style:'https://tiles.openfreemap.org/styles/dark',
    houses:['#18213d','#1b2645','#162039','#1e2a4d','#1a2442','#202b50','#1c2348'],towers:[12,'#1b2f5c',20,'#2850a6',45,'#4b5cf2',90,'#8b4dff',160,'#ff4fd8'],
    asphalt:'#1a2136',curb:'#2c3758',marking:'#c7d2fe',markingOpacity:.55,path:.35,green:.6,
    trees:{crown:['#0f3b2f','#124436','#0c3329','#164b3a'],top:['#1a5a45','#1d6a4f','#16503e','#237a5a'],trunk:'#2a2230'},
    trail:'#00e5ff',glow:.55,hill:['#000000','#33467a'],
    sky:{'sky-color':'#050816','horizon-color':'#40206f','fog-color':'#0b1026','sky-horizon-blend':.7,'horizon-fog-blend':.5,'fog-ground-blend':.4,'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,12,.5,16,.1]},
    light:{anchor:'map',color:'#a8c2ff',intensity:.5,position:[1.2,180,60]}},
} as const;
// Edificios separados y árboles se dibujan desde este zoom, cerca del conductor.
const NEAR_ZOOM=14.5,NEAR_SOURCES=['edificios-cerca','arboles-tronco','arboles-copa','arboles-copa-alta'];
const shadeColor=(colors:readonly string[])=>['match',['get','shade'],0,colors[0],1,colors[1],2,colors[2],colors[3]] as never;
const DEM='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
// Respaldo si OpenFreeMap no responde: mapa estándar de OpenStreetMap (sin edificios) con relieve y vías por zona.
const fallbackStyle=(theme:MapTheme):StyleSpecification=>({version:8,
  sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'}},
  layers:[{id:'fondo',type:'background',paint:{'background-color':theme==='noche'?'#0b1026':'#eeeae3'}},{id:'osm',type:'raster',source:'osm',paint:theme==='noche'?{'raster-brightness-max':.4,'raster-saturation':-.5}:{}}]});
const metres=(a:RoutePoint,b:RoutePoint)=>Math.hypot((b.lng-a.lng)*111195*Math.cos(a.lat*Math.PI/180),(b.lat-a.lat)*111195);
const bearing=(a:RoutePoint,b:RoutePoint)=>(Math.atan2((b.lng-a.lng)*Math.cos(a.lat*Math.PI/180),b.lat-a.lat)*180/Math.PI+360)%360;
const reducedMotion=()=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;


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
        // Con el mapa vectorial: vías con asfalto y bordillo, zonas verdes más visibles y edificios propios.
        const vectorBase=!!m.getSource('openmaptiles');
        if(vectorBase)styleBaseMap(m,t);
        for(const id of ['building','building-3d'])if(m.getLayer(id))m.setLayoutProperty(id,'visibility','none');
        const line={'line-cap':'round','line-join':'round'} as const;
        // Vías por zona SST. De cerca, el color va como dos franjas en los bordes de la calzada (con la línea
        // de carril en el centro); de lejos, o con el mapa de respaldo, como una línea centrada.
        const zoneColor=['match',['get','zone'],'nacional',ZONE_COLORS.nacional,'curvas',ZONE_COLORS.curvas,'escolar',ZONE_COLORS.escolar,ZONE_COLORS.urbana] as never;
        m.addSource('zonas',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        // La vía actual se tiñe completa con el color de su zona.
        m.addLayer({id:'via-actual',type:'line',source:'zonas',filter:['==',['get','id'],''],paint:{'line-color':zoneColor,'line-width':vectorBase?['max',6,roadWidth]:['interpolate',['linear'],['zoom'],12,6,17,16],'line-opacity':vectorBase?.4:.9},layout:line},firstSymbol);
        if(vectorBase)m.addLayer({id:'marcas-carril',type:'line',source:'openmaptiles','source-layer':'transportation',minzoom:15,filter:laneMarkingFilter,paint:{'line-color':t.marking,'line-width':laneMarkingWidth,'line-dasharray':[3,3],'line-opacity':t.markingOpacity}},firstSymbol);
        m.addLayer({id:'zonas-brillo',type:'line',source:'zonas',minzoom:12,paint:{'line-color':zoneColor,'line-width':['interpolate',['linear'],['zoom'],12,4,17,14],'line-blur':['interpolate',['linear'],['zoom'],12,3,17,9],'line-opacity':t.glow},layout:line},firstSymbol);
        m.addLayer({id:'zonas-linea',type:'line',source:'zonas',minzoom:12,...(vectorBase?{maxzoom:15}:{}),paint:{'line-color':zoneColor,'line-width':['interpolate',['linear'],['zoom'],12,1,17,3.5],'line-opacity':.95},layout:line},firstSymbol);
        if(vectorBase)for(const side of [-1,1] as const)m.addLayer({id:side<0?'zonas-borde-izq':'zonas-borde-der',type:'line',source:'zonas',minzoom:15,paint:{'line-color':zoneColor,'line-width':stripeWidth,'line-offset':stripeOffset(side),'line-opacity':.95},layout:line},firstSymbol);
        let zoneRoads:Feature<LineString>[]=[],onZoneRoads=()=>{};
        // Vías con zona, lugares (colegios, iglesias...) y colegios oficiales alrededor del centro (lib/map-overlay).
        m.addSource('lugares',{type:'geojson',data:{type:'FeatureCollection',features:[]},attribution:OFFICIAL_SCHOOLS_ATTRIBUTION});
        const overlay=createMapOverlay(data=>{if(disposed)return;zoneRoads=data.roads.features;(m.getSource('zonas') as GeoJSONSource|undefined)?.setData(data.roads);(m.getSource('lugares') as GeoJSONSource|undefined)?.setData(data.places);onZoneRoads()});
        const refresh=()=>{const c=m.getCenter();void overlay(c.lat,c.lng)};
        m.on('moveend',refresh);refresh();
        if(vectorBase){
          // Edificios lejanos: los del mapa base. Los que se separan cerca del conductor quedan con altura 0
          // (estado 'cerca'), sin recargar teselas.
          const hidden:ExpressionSpecification=['boolean',['feature-state','cerca'],false];
          m.addLayer({id:'edificios-3d',type:'fill-extrusion',source:'openmaptiles','source-layer':'building',minzoom:13,paint:{
            'fill-extrusion-color':buildingColor(t),
            'fill-extrusion-height':['case',hidden,0,['interpolate',['linear'],['zoom'],13,0,15,buildingHeight]],
            'fill-extrusion-base':['case',hidden,0,['interpolate',['linear'],['zoom'],13,0,15,['coalesce',['get','render_min_height'],0]]],
            'fill-extrusion-opacity':1,'fill-extrusion-vertical-gradient':true}},firstSymbol);
          // Edificios cercanos: casas individuales con su altura (o de uno a tres pisos) y su tono de fachada.
          const empty:FeatureCollection={type:'FeatureCollection',features:[]};
          for(const id of NEAR_SOURCES)m.addSource(id,{type:'geojson',data:empty});
          const extrusion=(id:string,color:unknown)=>m.addLayer({id,type:'fill-extrusion',source:id,minzoom:NEAR_ZOOM,paint:{'fill-extrusion-color':color as never,'fill-extrusion-base':['get','base'],'fill-extrusion-height':['get','height'],'fill-extrusion-opacity':1,'fill-extrusion-vertical-gradient':true}},firstSymbol);
          extrusion('edificios-cerca',buildingColor(t,['get','height'],['get','tone']));
          // Árboles: tronco y copa en dos niveles, en áreas verdes y aceras (lib/trees-3d).
          extrusion('arboles-tronco',t.trees.trunk);extrusion('arboles-copa',shadeColor(t.trees.crown));extrusion('arboles-copa-alta',shadeColor(t.trees.top));
          // Se recalcula al alejarse 250 m del último cálculo o al llegar mapa nuevo, no en cada movimiento de la cámara.
          // En teléfonos lentos el radio se reduce solo (mínimo 400 m) si el cálculo pasa de medio segundo.
          let timer:ReturnType<typeof setTimeout>|undefined,plantTimer:ReturnType<typeof setTimeout>|undefined,last:{lng:number;lat:number}|null=null,nearIds:(string|number)[]=[],radius=750;
          const extraLoader=createBuildingTileLoader(()=>schedule(true));
          const markNear=(ids:(string|number)[])=>{
            const next=new Set(ids);
            for(const id of nearIds)if(!next.has(id))m.setFeatureState({source:'openmaptiles',sourceLayer:'building',id},{cerca:false});
            for(const id of ids)m.setFeatureState({source:'openmaptiles',sourceLayer:'building',id},{cerca:true});
            nearIds=ids;
          };
          const clear=()=>{clearTimeout(plantTimer);last=null;markNear([]);for(const id of NEAR_SOURCES)(m.getSource(id) as GeoJSONSource|undefined)?.setData(empty);container.current?.removeAttribute('data-trees')};
          const rebuild=(force:boolean)=>{
            if(disposed||map.current!==m)return;
            const c=m.getCenter();
            if(m.getZoom()<NEAR_ZOOM){if(last)clear();return}
            if(!force&&last&&Math.hypot((c.lng-last.lng)*111195*Math.cos(c.lat*Math.PI/180),(c.lat-last.lat)*111195)<250)return;
            last={lng:c.lng,lat:c.lat};
            const started=performance.now();
            // Solo cerca del centro: con la cámara inclinada el horizonte abarcaría kilómetros.
            const dy=radius/111195,dx=dy/Math.cos(c.lat*Math.PI/180),view={west:c.lng-dx,east:c.lng+dx,south:c.lat-dy,north:c.lat+dy};
            const near=splitBuildings(m.querySourceFeatures('openmaptiles',{sourceLayer:'building'}),view,t.houses.length);
            // Edificios que OSM no tiene (huellas de Microsoft): se descargan alrededor y se suman.
            void extraLoader.ensure(c.lat,c.lng,radius);
            const extra=extraBuildings(extraLoader.within(view),t.houses.length);
            near.collection.features.push(...extra);near.polygons.push(...extra.map(f=>f.geometry));
            (m.getSource('edificios-cerca') as GeoJSONSource|undefined)?.setData(near.collection);
            markNear(near.ids);
            const split=performance.now()-started;
            // Los árboles, en el siguiente turno: dos tareas cortas en vez de una larga.
            clearTimeout(plantTimer);plantTimer=setTimeout(()=>{
              if(disposed||map.current!==m)return;
              const planting=performance.now();
              const areas=[...m.querySourceFeatures('openmaptiles',{sourceLayer:'landcover',filter:greenAreaFilter}),...m.querySourceFeatures('openmaptiles',{sourceLayer:'landuse',filter:['==',['get','class'],'cemetery']})]
                .map(f=>greenArea(f.properties,f.geometry)).filter((a):a is GreenArea=>!!a);
              // Aceras de las calles del catálogo (sin vías de servicio ni enlaces).
              const streets:StreetLine[]=zoneRoads.filter(f=>!f.properties?.official&&!['service','link'].includes(String(f.properties?.group))).map(f=>({id:String(f.properties?.id),halfWidth:ROAD_HALF_WIDTH_M[(f.properties?.group as RoadGroup)||'minor'],coordinates:f.geometry.coordinates}));
              const trees=generateTrees({areas,streets,buildings:near.polygons,view,center:[c.lng,c.lat]});
              (m.getSource('arboles-tronco') as GeoJSONSource|undefined)?.setData(trees.trunks);
              (m.getSource('arboles-copa') as GeoJSONSource|undefined)?.setData(trees.crowns);
              (m.getSource('arboles-copa-alta') as GeoJSONSource|undefined)?.setData(trees.tops);
              const box=container.current;
              const elapsed=split+performance.now()-planting;
              if(elapsed>500)radius=Math.max(400,Math.round(radius*.75));
              box?.setAttribute('data-trees',String(trees.count));box?.setAttribute('data-near-buildings',String(near.collection.features.length));box?.setAttribute('data-near-ms',String(Math.round(elapsed)));
            },0);
          };
          const schedule=(force:boolean)=>{clearTimeout(timer);timer=setTimeout(()=>rebuild(force),400)};
          m.on('moveend',()=>schedule(false));
          m.on('zoomend',()=>{if(m.getZoom()<NEAR_ZOOM&&last)clear()});
          // Una tesela nueva del mapa base trae más edificios y áreas verdes: se recalcula cuando termina de cargar
          // todo o, si alguna tesela sigue pendiente, cuando el mapa queda en reposo.
          let freshTiles=false;
          m.on('sourcedata',e=>{if(e.sourceId!=='openmaptiles'||!e.tile)return;freshTiles=true;if(e.isSourceLoaded)schedule(true)});
          m.on('idle',()=>{if(freshTiles){freshTiles=false;schedule(true)}});
          // Las calles del catálogo llegan aparte: al cargarse, se siembran sus aceras.
          onZoneRoads=()=>schedule(true);
          m.once('remove',()=>{clearTimeout(timer);clearTimeout(plantTimer)});
          schedule(true);
        }
        // Estela del recorrido: degradado hacia la posición actual y halo.
        m.addSource('journey',{type:'geojson',lineMetrics:true,data:{type:'FeatureCollection',features:[]}});
        m.addLayer({id:'journey-glow',type:'line',source:'journey',paint:{'line-color':t.trail,'line-width':18,'line-blur':12,'line-opacity':.45},layout:{'line-cap':'round','line-join':'round'}});
        m.addLayer({id:'journey-line',type:'line',source:'journey',paint:{'line-width':6,'line-gradient':['interpolate',['linear'],['line-progress'],0,'rgba(0,229,255,0.15)',.6,t.trail,1,'#ffffff']},layout:{'line-cap':'round','line-join':'round'}});
        m.addSource('gps-accuracy',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        m.addLayer({id:'gps-accuracy',type:'fill',source:'gps-accuracy',paint:{'fill-color':t.trail,'fill-opacity':.12}});
        // Íconos de colegios, iglesias, centros comerciales, salud... encima de todo (lib/map-places).
        addPlacesLayer(m,'lugares',theme==='noche');
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
