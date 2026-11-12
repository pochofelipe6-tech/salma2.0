'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ShieldCheck,MapPin,Navigation,Play,Square,LogOut,Car,Clock3,Route,Gauge,Volume2,Check,LoaderCircle,X,LocateFixed,AlertTriangle,CalendarDays} from 'lucide-react';
import RouteMap from './route-map';
import {routeApi,routeZones,routeDistance,type DriverData,type DriverTrip,type RoutePoint} from '../lib/route-types';
import styles from './driver-screen.module.css';

export default function DriverScreen({data,onRefresh,onLogout}:{data:DriverData;onRefresh:()=>Promise<void>;onLogout:()=>Promise<void>}){
  const initial=data.trips.find(t=>t.user_id===data.user.id&&!t.ended)||null;
  const [trip,setTrip]=useState<DriverTrip|null>(initial),[tracking,setTracking]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saveError,setSaveError]=useState(''),[position,setPosition]=useState<RoutePoint|null>(null),[points,setPoints]=useState<RoutePoint[]>([]),[speed,setSpeed]=useState<number|null>(null),[gps,setGps]=useState('GPS desconectado'),[stale,setStale]=useState(true),[now,setNow]=useState(Date.now()),[finished,setFinished]=useState(false);
  const watch=useRef<number|null>(null),tripRef=useRef<DriverTrip|null>(initial),queue=useRef<RoutePoint[]>([]),flushing=useRef(false),lastSaved=useRef(0),lastSeen=useRef(0),lastTimestamp=useRef(0),over=useRef(false),sendingEvent=useRef(false),lastBeep=useRef(0),audio=useRef<AudioContext|null>(null),mounted=useRef(true),starting=useRef(false);
  tripRef.current=trip;
  const limit=routeZones.find(z=>z.id===(trip?.zone||'urbana'))?.limit||50;
  const excess=tracking&&!stale&&speed!==null&&speed>limit;
  const distance=useMemo(()=>routeDistance(points),[points]);
  const elapsed=trip?Math.max(0,Math.floor((now-new Date(trip.started).getTime())/1000)):0;
  const duration=[Math.floor(elapsed/3600),Math.floor(elapsed/60)%60,elapsed%60].map(n=>String(n).padStart(2,'0')).join(':');

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(watch.current!==null)navigator.geolocation.clearWatch(watch.current);void audio.current?.close()}},[]);
  useEffect(()=>{
    if(!initial?.id||tracking||busy||finished)return;
    let cancelled=false;
    void routeApi(`positions?trip=${initial.id}`).then(result=>{if(!cancelled){const stored=result.points as RoutePoint[];setPoints(previous=>{const merged=new Map([...stored,...previous].map(p=>[p.recorded_at,p]));return [...merged.values()].sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at))});setPosition(previous=>previous||stored.at(-1)||null)}}).catch(()=>{if(!cancelled)setSaveError('No se pudo recuperar el recorrido guardado. Puedes reanudar el GPS.')});
    return()=>{cancelled=true};
  },[initial?.id,tracking,busy,finished]);
  useEffect(()=>{
    const timer=setInterval(()=>{setNow(Date.now());if(tracking&&Date.now()-lastSeen.current>15000){setStale(true);setSpeed(null);setGps('Sin señal GPS reciente')}},1000);
    return()=>clearInterval(timer);
  },[tracking]);
  useEffect(()=>{if(!tracking)return;const handler=(e:BeforeUnloadEvent)=>{e.preventDefault()};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler)},[tracking]);

  async function flush(){
    if(flushing.current)return false;
    const current=tripRef.current;if(!current||!queue.current.length)return true;
    flushing.current=true;
    try{
      while(queue.current.length){
        const batch=queue.current.slice(0,100);
        await routeApi('positions',{trip:current.id,points:batch});
        queue.current.splice(0,batch.length);
      }
      if(mounted.current)setSaveError('');return true;
    }catch{if(mounted.current)setSaveError('El recorrido se ve en vivo, pero hay posiciones pendientes de guardar. Revisa tu conexión o la migración 002 de Supabase.');return false}
    finally{flushing.current=false}
  }
  useEffect(()=>{if(!tracking)return;const timer=setInterval(()=>{void flush()},7000);return()=>clearInterval(timer)},[tracking]);
  function beep(){try{const ctx=audio.current;if(!ctx)return;const oscillator=ctx.createOscillator(),gain=ctx.createGain();oscillator.connect(gain);gain.connect(ctx.destination);oscillator.frequency.value=880;gain.gain.value=.12;oscillator.start();oscillator.stop(ctx.currentTime+.35)}catch{}}
  function receive(p:GeolocationPosition){
    if(!mounted.current||!tripRef.current)return;
    if(!Number.isFinite(p.coords.latitude)||!Number.isFinite(p.coords.longitude)||!Number.isFinite(p.coords.accuracy)||p.coords.accuracy>60){setStale(true);setSpeed(null);setGps('Señal imprecisa · buscando GPS');return}
    if(Date.now()-p.timestamp>15000)return;
    lastSeen.current=Date.now();setStale(false);setGps('GPS conectado');
    const point={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,recorded_at:new Date(p.timestamp).toISOString()};
    setPosition(point);
    if(p.timestamp>lastTimestamp.current&&(p.timestamp-lastSaved.current>=5000||!lastSaved.current)){
      lastTimestamp.current=p.timestamp;lastSaved.current=p.timestamp;queue.current.push(point);setPoints(previous=>[...previous,point]);
    }
    const velocity=p.coords.speed,km=velocity!==null&&Number.isFinite(velocity)&&velocity>=0?velocity*3.6:null;
    setSpeed(km);
    const current=tripRef.current,currentLimit=routeZones.find(z=>z.id===current.zone)!.limit;
    if(km===null){setGps('GPS conectado · velocidad no disponible');return}
    if(km>currentLimit){
      if(Date.now()-lastBeep.current>5000){beep();lastBeep.current=Date.now()}
      if(!over.current&&!sendingEvent.current){
        sendingEvent.current=true;
        try{if('Notification' in window&&Notification.permission==='granted')new Notification('Reduce la velocidad',{body:`${Math.round(km)} km/h · límite ${currentLimit} km/h`})}catch{}
        void routeApi('event',{trip:current.id,zone:current.zone,sector:current.sector,speed:km,lat:point.lat,lng:point.lng}).then(()=>{over.current=true}).catch(()=>setError('No se guardó la alerta de velocidad. Revisa la conexión.')).finally(()=>{sendingEvent.current=false});
      }
    }else if(km<=currentLimit-3)over.current=false;
  }
  async function locate(){
    if(!window.isSecureContext)throw new Error('La ubicación necesita HTTPS o localhost. Abre la app desde una dirección segura.');
    if(!navigator.geolocation)throw new Error('Este navegador no tiene acceso a la ubicación.');
    try{return await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:0,timeout:15000}))}
    catch{throw new Error('No se pudo obtener tu ubicación. Permite el GPS en el navegador y vuelve a intentarlo.')}
  }
  async function connectGPS(first:GeolocationPosition,current:DriverTrip){
    tripRef.current=current;setTrip(current);setTracking(true);setFinished(false);lastSeen.current=Date.now();over.current=false;lastSaved.current=0;
    try{audio.current??=new AudioContext();await audio.current.resume()}catch{}
    try{if('Notification' in window&&Notification.permission==='default')void Notification.requestPermission()}catch{}
    receive(first);
    watch.current=navigator.geolocation.watchPosition(receive,()=>{setStale(true);setSpeed(null);setGps('Se perdió la ubicación · revisa el GPS')},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    void flush();
  }
  async function begin(){
    if(starting.current)return;starting.current=true;setBusy(true);setError('');
    try{
      const first=await locate();
      const started=await routeApi('start',{});
      const current:DriverTrip={id:started.id,user_id:data.user.id,plate:'Sin vehículo asignado',driver:data.user.name,zone:'urbana',sector:'Recorrido GPS',started:started.started||new Date().toISOString(),ended:null};
      queue.current=[];setPoints([]);setPosition(null);setSpeed(null);
      await connectGPS(first,current);await onRefresh();
    }catch(e){setError((e as Error).message)}finally{setBusy(false);starting.current=false}
  }
  async function resume(){
    if(!trip||starting.current)return;starting.current=true;setBusy(true);setError('');
    try{await connectGPS(await locate(),trip)}catch(e){setError((e as Error).message)}finally{setBusy(false);starting.current=false}
  }
  async function finish(){
    if(!trip||busy)return;setBusy(true);setError('');
    if(watch.current!==null)navigator.geolocation.clearWatch(watch.current);watch.current=null;setTracking(false);setSpeed(null);setStale(true);
    try{
      if(flushing.current)throw new Error('Se está guardando el recorrido. Espera un momento y vuelve a finalizar.');
      if(!await flush())throw new Error('Hay posiciones pendientes de guardar. Revisa la conexión y vuelve a finalizar.');
      if(sendingEvent.current)throw new Error('Se está guardando una alerta. Espera un momento y vuelve a finalizar.');
      await routeApi('end',{trip:trip.id});setTrip(null);tripRef.current=null;setGps('Ruta finalizada');setFinished(true);await onRefresh();
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }

  return <div className={styles.screen}>
    <header className={styles.header}><a href="/" className={styles.brand}><ShieldCheck/><span>Seguimiento<br/>de Ruta</span><b>SST</b></a><div className={styles.headerRight}><span className={styles.driverBadge}><Car size={16}/> Conductor</span><span className={styles.userName}>{data.user.name}</span><div className={styles.avatar}>{data.user.name.slice(0,1).toUpperCase()}</div><button className={styles.logout} disabled={tracking||busy} aria-label="Cerrar sesión" title={tracking?'Finaliza tu ruta antes de salir':'Cerrar sesión'} onClick={()=>void onLogout().catch(()=>setError('No se pudo cerrar la sesión.'))}><LogOut size={18}/></button></div></header>
    <main className={styles.content}>
      <div className={styles.welcome}><div><span className={styles.eyebrow}>TU SEGURIDAD ES EL CAMINO</span><h1>Hola, {data.user.name.split(' ')[0]}<span> 👋</span></h1><p>{tracking?'Vamos contigo. Conduce con calma y mantén la app abierta.':'Un nuevo recorrido, la misma prioridad: llegar seguro.'}</p></div><span className={styles.date}><CalendarDays size={19}/>{new Date(now).toLocaleDateString('es-CO',{day:'numeric',month:'long',year:'numeric'})}</span></div>
      {error&&<div className={styles.error} role="alert"><AlertTriangle size={18}/>{error}<button onClick={()=>setError('')} aria-label="Cerrar aviso"><X size={16}/></button></div>}
      {saveError&&<div className={styles.warning} role="status">{saveError}</div>}
      {finished&&<div className={styles.success} role="status"><Check size={18}/>Ruta finalizada. Tu viaje y las posiciones guardadas están en Supabase.</div>}
      <div className={styles.journeyGrid}>
        <section className={styles.mapCard} aria-labelledby="route-map-title"><div className={styles.mapHead}><div><span className={styles.miniIcon}><Route size={18}/></span><h2 id="route-map-title">Tu ruta en tiempo real</h2></div><span className={styles.mapLegend}><i/> Recorrido GPS</span></div><RouteMap points={points} position={position} tracking={tracking} stale={stale}/><div className={styles.mapFooter}><MapPin size={14}/><span>{position?`${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · precisión ±${Math.round(position.accuracy)} m`:'Tu ubicación aparecerá al iniciar la ruta.'}</span><span className={styles.privateNote}><ShieldCheck size={13}/> Tu recorrido, protegido</span></div></section>
        <section className={styles.tripCard}>
          <div className={styles.tripIntro}><span className={styles.tripIcon}><Navigation size={24}/></span><span className={styles.tripBadge}>{tracking?'EN RUTA':trip?'RUTA PENDIENTE':'LISTO PARA SALIR'}</span></div>
          <h2>{tracking?'Buen camino.':trip?'Continúa tu recorrido.':'Tu próxima ruta empieza aquí.'}</h2><p>{tracking?'Tu ubicación se actualiza con el GPS. Nosotros te avisamos si excedes el límite.':trip?'Puedes reanudar el GPS o finalizar el viaje que dejaste abierto.':'Activa tu ubicación y deja que te acompañemos en cada kilómetro.'}</p>
          <div className={styles.speedMonitor+' '+(excess?styles.excess:'')}><span>VELOCIDAD ACTUAL</span><strong>{speed===null||stale?'—':Math.round(speed)}<small>km/h</small></strong><div>{excess?<><AlertTriangle size={15}/> Reduce la velocidad</>:<><ShieldCheck size={15}/>{tracking?'Mantén una velocidad segura':'La prevención va contigo'}</>}</div></div>
          {trip&&<div className={styles.tripDetails}><span><Car size={15}/><b>{trip.plate}</b></span><span><MapPin size={15}/>{trip.sector}</span></div>}
          <div className={styles.routeMetrics}><div><Route size={15}/><strong>{distance.toFixed(2)} <small>km</small></strong><span>Recorrido GPS</span></div><div><Clock3 size={15}/><strong>{trip?duration:'00:00:00'}</strong><span>Tiempo de ruta</span></div></div>
          {!trip?<button className={styles.startButton} onClick={()=>void begin()} disabled={busy}>{busy?<LoaderCircle className={styles.spin} size={18}/>:<Play size={18} fill="currentColor"/>}{busy?'Conectando GPS?':'Iniciar ruta'}<Navigation size={17}/></button>:<>{!tracking&&<button className={styles.startButton} onClick={()=>void resume()} disabled={busy}>{busy?<LoaderCircle className={styles.spin} size={17}/>:<LocateFixed size={17}/>}Reanudar GPS</button>}<button className={styles.finishButton} disabled={busy} onClick={()=>void finish()}>{busy?<LoaderCircle className={styles.spin} size={16}/>:<Square size={15}/>}Finalizar ruta</button></>}
          <div className={styles.gpsStatus}><span className={tracking&&!stale?styles.liveDot:styles.offDot}/>{gps}</div>
        </section>
      </div>
      <section className={styles.limits} aria-labelledby="limits-title"><div className={styles.sectionTitle}><h2 id="limits-title"><ShieldCheck size={25}/>Límites que protegen</h2><span>Protocolo preventivo SST</span></div><div className={styles.limitGrid}>{routeZones.map(z=><div key={z.id} data-zone={z.id} className={styles.limitCard+' '+(trip?.zone===z.id?styles.currentLimit:'')}><span className={styles.zoneIcon}>{z.icon}</span><div><h3>{z.name}</h3><b>{z.limit}<small> km/h</small></b></div>{trip?.zone===z.id?<span className={styles.zoneTag}>Tu zona actual</span>:<span className={styles.zoneTag}>Límite preventivo</span>}</div>)}</div><p className={styles.limitNote}><Volume2 size={14}/>Alerta sonora al superar el límite de la zona seleccionada. Inicio directo: límite urbano de 50 km/h por defecto.</p></section>
      <footer className={styles.footer}><ShieldCheck size={14}/>Cada kilómetro seguro cuenta.<span>GPS con la app abierta · Límite inicial: 50 km/h · Sin detección automática de zonas</span></footer>
    </main>

  </div>;
}
