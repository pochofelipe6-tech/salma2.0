'use client';
import type {RoadMatch,RoadFix} from '../lib/road-types';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ShieldCheck,MapPin,Navigation,Play,Square,LogOut,Car,Clock3,Route,Gauge,Volume2,Check,LoaderCircle,X,LocateFixed,AlertTriangle,CalendarDays} from 'lucide-react';
import RouteMap from './route-map';
import {routeApi,routeZones,routeDistance,type DriverData,type DriverTrip,type RoutePoint} from '../lib/route-types';
import styles from './driver-screen.module.css';

export default function DriverScreen({data,onRefresh,onLogout}:{data:DriverData;onRefresh:()=>Promise<void>;onLogout:()=>Promise<void>}){
  const [vehicleForm,setVehicleForm]=useState(false),[plate,setPlate]=useState(''),[model,setModel]=useState('');
  const completionDialog=useRef<HTMLDialogElement>(null);
  const [completion,setCompletion]=useState<{distance:string;duration:string;count:number;plate:string}|null>(null);
  useEffect(()=>{if(completion){completionDialog.current?.showModal();const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous}}},[completion]);
  const initial=data.trips.find(t=>t.user_id===data.user.id&&!t.ended)||null;
  const [trip,setTrip]=useState<DriverTrip|null>(initial),[tracking,setTracking]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saveError,setSaveError]=useState(''),[position,setPosition]=useState<RoutePoint|null>(null),[points,setPoints]=useState<RoutePoint[]>([]),[speed,setSpeed]=useState<number|null>(null),[gps,setGps]=useState('GPS desconectado'),[stale,setStale]=useState(true),[now,setNow]=useState(Date.now()),[finished,setFinished]=useState(false);
  const watch=useRef<number|null>(null),tripRef=useRef<DriverTrip|null>(initial),queue=useRef<RoutePoint[]>([]),flushing=useRef(false),lastSaved=useRef(0),lastSeen=useRef(0),lastTimestamp=useRef(0),sendingEvent=useRef(false),audio=useRef<AudioContext|null>(null),mounted=useRef(true),starting=useRef(false);
  tripRef.current=trip;
  const [road,setRoad]=useState<RoadMatch>({status:'unknown',reason:'Inicia la ruta para detectar el tramo.',limit:null});
  const previousFix=useRef<RoadFix|null>(null),lookupVersion=useRef(0),lastSound=useRef(0),alertedRoad=useRef('');
  const activeZone={id:road.zone||'',name:road.label||'Zona por identificar',icon:'⚠️',limit:road.limit};
  const limit=activeZone.limit;
  const detectedZone=tracking&&!stale&&road.status==='known'&&road.limit!==null?road.zone:undefined;
  const excess=tracking&&!stale&&limit!==null&&speed!==null&&speed>limit;
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
    const timer=setInterval(()=>{setNow(Date.now());if(tracking&&Date.now()-lastSeen.current>15000){lookupVersion.current++;previousFix.current=null;setRoad({status:'unknown',reason:'Sin GPS reciente.',limit:null});setStale(true);setSpeed(null);setGps('Sin señal GPS reciente')}},1000);
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
  function beep(){
    try{const ctx=audio.current;if(!ctx||ctx.state!=='running')return;
      for(let i=0;i<3;i++){
        const oscillator=ctx.createOscillator(),gain=ctx.createGain(),start=ctx.currentTime+i*.24;
        oscillator.connect(gain);gain.connect(ctx.destination);oscillator.type='sine';oscillator.frequency.setValueAtTime(i===1?1040:780,start);
        gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.16,start+.02);gain.gain.exponentialRampToValueAtTime(.001,start+.18);
        oscillator.start(start);oscillator.stop(start+.2);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect()};
      }
    }catch{}
  }
  useEffect(()=>{
    if(!excess)return;
    const sound=()=>{if(Date.now()-lastSound.current>=5000){beep();lastSound.current=Date.now()}};sound();const timer=setInterval(sound,1000);return()=>clearInterval(timer);
  },[excess]);
  function receive(p:GeolocationPosition){
    if(!mounted.current||!tripRef.current)return;
    if(!Number.isFinite(p.coords.latitude)||Math.abs(p.coords.latitude)>90||!Number.isFinite(p.coords.longitude)||Math.abs(p.coords.longitude)>180||!Number.isFinite(p.coords.accuracy)||p.coords.accuracy<0){lookupVersion.current++;previousFix.current=null;setRoad({status:'unknown',reason:'GPS inválido.',limit:null});setStale(true);setSpeed(null);setGps('Ubicación no disponible · buscando GPS');return}
    if(Date.now()-p.timestamp>15000)return;
    lastSeen.current=Date.now();setStale(false);setGps('GPS conectado');
    const point={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,recorded_at:new Date(p.timestamp).toISOString()};
    setPosition(point);
    if(p.coords.accuracy>60){lookupVersion.current++;previousFix.current=null;setRoad({status:'unknown',reason:'GPS impreciso.',limit:null});setSpeed(null);setGps(`Ubicación aproximada · margen de ${Math.round(p.coords.accuracy)} m`);return}
    if(p.timestamp>lastTimestamp.current&&(p.timestamp-lastSaved.current>=5000||!lastSaved.current)){
      lastTimestamp.current=p.timestamp;lastSaved.current=p.timestamp;queue.current.push(point);setPoints(previous=>[...previous,point]);
    }
    const velocity=p.coords.speed,km=velocity!==null&&Number.isFinite(velocity)&&velocity>=0?velocity*3.6:null;
    setSpeed(km);
    if(km===null)setGps('GPS conectado · velocidad no disponible');
    const current=tripRef.current,previous=previousFix.current;previousFix.current=point;
    const version=++lookupVersion.current;
    setRoad({status:'unknown',reason:'Identificando vía y límite...',limit:null});
    void routeApi('road',{fix:point,previous}).then(async result=>{
      if(!mounted.current||version!==lookupVersion.current||tripRef.current?.id!==current.id)return;
      const match=result.match as RoadMatch;setRoad(match);
      if(match.status!=='known'||match.limit===null||km===null)return;
      if(km>match.limit){
        const key=match.roadId+':'+match.limit;
        if(alertedRoad.current!==key&&!sendingEvent.current){
          sendingEvent.current=true;
          try{await routeApi('event',{trip:current.id,fix:point,previous,speed:km});alertedRoad.current=key}
          catch{if(mounted.current)setError('La alerta está activa, pero no se guardó. Revisa la conexión y ejecuta las migraciones 006 y 007 de Supabase.')}
          finally{sendingEvent.current=false}
        }
      }else if(km<=match.limit-3)alertedRoad.current='';
    }).catch(()=>{if(mounted.current&&version===lookupVersion.current)setRoad({status:'unknown',reason:'No se pudo consultar el límite. Revisa la conexión.',limit:null})});
  }

  async function locate(){
    if(!window.isSecureContext)throw new Error('La ubicación necesita HTTPS o localhost. Abre la app desde una dirección segura.');
    if(!navigator.geolocation)throw new Error('Este navegador no tiene acceso a la ubicación.');
    try{return await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:0,timeout:15000}))}
    catch{throw new Error('No se pudo obtener tu ubicación. Permite el GPS en el navegador y vuelve a intentarlo.')}
  }
  async function connectGPS(first:GeolocationPosition,current:DriverTrip){
    previousFix.current=null;lookupVersion.current++;alertedRoad.current='';tripRef.current=current;setTrip(current);setTracking(true);setFinished(false);lastSeen.current=Date.now();lastSaved.current=0;
    try{audio.current??=new AudioContext();await audio.current.resume()}catch{}
    try{if('Notification' in window&&Notification.permission==='default')void Notification.requestPermission()}catch{}
    receive(first);
    watch.current=navigator.geolocation.watchPosition(receive,()=>{lookupVersion.current++;previousFix.current=null;setRoad({status:'unknown',reason:'GPS desconectado.',limit:null});setStale(true);setSpeed(null);setGps('Se perdió la ubicación · revisa el GPS')},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    void flush();
  }
  async function begin(){
    if(starting.current)return;starting.current=true;setBusy(true);setError('');
    try{
      try{audio.current??=new AudioContext();await audio.current.resume()}catch{}
      const first=await locate();
      const started=await routeApi('start',{plate,model});
      const current:DriverTrip={id:started.id,user_id:data.user.id,plate:started.plate,model:started.model,driver:data.user.name,zone:'urbana',sector:'Recorrido GPS',started:started.started||new Date().toISOString(),ended:null};
      queue.current=[];setPoints([]);setPosition(null);setSpeed(null);
      setVehicleForm(false);await connectGPS(first,current);await onRefresh();
    }catch(e){setError((e as Error).message)}finally{setBusy(false);starting.current=false}
  }
  async function resume(){
    if(!trip||starting.current)return;starting.current=true;setBusy(true);setError('');
    try{await connectGPS(await locate(),trip)}catch(e){setError((e as Error).message)}finally{setBusy(false);starting.current=false}
  }
  async function finish(){
    if(!trip||busy)return;setBusy(true);setError('');
    if(watch.current!==null)navigator.geolocation.clearWatch(watch.current);watch.current=null;lookupVersion.current++;previousFix.current=null;setRoad({status:'unknown',reason:'Ruta finalizada.',limit:null});setTracking(false);setSpeed(null);setStale(true);
    try{
      if(flushing.current)throw new Error('Se está guardando el recorrido. Espera un momento y vuelve a finalizar.');
      if(!await flush())throw new Error('Hay posiciones pendientes de guardar. Revisa la conexión y vuelve a finalizar.');
      if(sendingEvent.current)throw new Error('Se está guardando una alerta. Espera un momento y vuelve a finalizar.');
      await routeApi('end',{trip:trip.id});setCompletion({distance:distance.toFixed(2),duration:[Math.floor((Date.now()-Date.parse(trip.started))/3600000),Math.floor((Date.now()-Date.parse(trip.started))/60000)%60,Math.floor((Date.now()-Date.parse(trip.started))/1000)%60].map(n=>String(Math.max(0,n)).padStart(2,'0')).join(':'),count:new Set(points.map(p=>p.recorded_at)).size,plate:trip.plate});setTrip(null);tripRef.current=null;setGps('Ruta finalizada');setFinished(true);await onRefresh();
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }

  return <div className={styles.screen}>
    {excess&&<aside className={styles.speedAlertOverlay} role="alert" aria-labelledby="speed-alert-title" aria-describedby="speed-alert-description">
      <div className={styles.speedAlertCard}>
        <div className={styles.speedAlertSymbol}><AlertTriangle size={58} strokeWidth={2.5}/></div>
        <span className={styles.speedAlertEyebrow}>ALERTA DE SEGURIDAD VIAL</span>
        <h2 id="speed-alert-title">¡Exceso de velocidad!</h2>
        <div className={styles.speedAlertZone}>{activeZone.icon} {activeZone.name} <b>· {limit} km/h</b></div>
        <div className={styles.detectedRoadName}>{road.roadName}</div><p id="speed-alert-description">Reduce la velocidad de forma gradual.<br/>Tu seguridad es lo primero.</p>
        <div className={styles.speedAlertMetrics}><div><span>VELOCIDAD ACTUAL</span><strong>{Math.round(speed!)}<small>km/h</small></strong></div><div><span>LÍMITE PREVENTIVO SST</span><strong>{limit}<small>km/h</small></strong></div></div>
        <div className={styles.speedAlertFooter}><Volume2 size={18}/>Alerta sonora activa</div>
        <small className={styles.speedAlertNote}>Se cierra automáticamente al volver al límite.</small>
      </div>
    </aside>}
    <dialog ref={completionDialog} className={styles.completionDialog} aria-labelledby="completion-title" aria-describedby="completion-description" onClose={()=>setCompletion(null)}>
      {completion&&<div className={styles.completionContent}>
        <div className={styles.completionSparkles} aria-hidden="true"/>
        <div className={styles.completionCheck}><Check size={48} strokeWidth={4}/></div>
        <span className={styles.completionEyebrow}>LLEGASTE SEGURO</span>
        <h2 id="completion-title">¡Ruta finalizada!</h2>
        <p id="completion-description">Tu viaje y las posiciones están guardados.</p>
        <div className={styles.completionMetrics}>
          <div><MapPin size={20}/><strong>{completion.distance} <small>km</small></strong><span>Distancia</span></div>
          <div><Clock3 size={20}/><strong>{completion.duration}</strong><span>Tiempo</span></div>
          <div><Route size={20}/><strong>{completion.count}</strong><span>Posiciones</span></div>
        </div>
        <button autoFocus className={styles.completionAccept} onClick={()=>completionDialog.current?.close()}><Check size={21}/>Aceptar</button>
        <span className={styles.completionFooter}><ShieldCheck size={14}/>{completion.plate} · Cada kilómetro seguro cuenta</span>
      </div>}
    </dialog>
    <header className={styles.header}><a href="/" className={styles.brand}><ShieldCheck/><span>Seguimiento<br/>de Ruta</span><b>SST</b></a><div className={styles.headerRight}><span className={styles.driverBadge}><Car size={16}/> Conductor</span><span className={styles.userName}>{data.user.name}</span><div className={styles.avatar}>{data.user.name.slice(0,1).toUpperCase()}</div><button className={styles.logout} disabled={tracking||busy} aria-label="Cerrar sesión" title={tracking?'Finaliza tu ruta antes de salir':'Cerrar sesión'} onClick={()=>void onLogout().catch(()=>setError('No se pudo cerrar la sesión.'))}><LogOut size={18}/></button></div></header>
    <main className={styles.content}>
      <div className={styles.welcome}><div><span className={styles.eyebrow}>TU SEGURIDAD ES EL CAMINO</span><h1>Hola, {data.user.name.split(' ')[0]}<span> 👋</span></h1><p>{tracking?'Vamos contigo. Conduce con calma y mantén la app abierta.':'Un nuevo recorrido, la misma prioridad: llegar seguro.'}</p></div><span className={styles.date}><CalendarDays size={19}/>{new Date(now).toLocaleDateString('es-CO',{day:'numeric',month:'long',year:'numeric'})}</span></div>
      {error&&<div className={styles.error} role="alert"><AlertTriangle size={18}/>{error}<button onClick={()=>setError('')} aria-label="Cerrar aviso"><X size={16}/></button></div>}
      {saveError&&<div className={styles.warning} role="status">{saveError}</div>}
      {finished&&<div className={styles.success} role="status"><Check size={18}/>Ruta finalizada. Tu viaje y las posiciones están guardados.</div>}
      <div className={styles.journeyGrid}>
        <section className={styles.mapCard} aria-labelledby="route-map-title"><div className={styles.mapHead}><div><span className={styles.miniIcon}><Route size={18}/></span><h2 id="route-map-title">Tu ruta en tiempo real</h2></div><span className={styles.mapLegend}><i/> Recorrido GPS</span></div><RouteMap points={points} position={position} tracking={tracking} stale={stale} zoneId={detectedZone} zoneLabel={detectedZone?`${road.label} · ${road.limit} km/h`:undefined}/><div className={styles.mapFooter}><MapPin size={14}/><span>{position?`${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · precisión ±${Math.round(position.accuracy)} m`:'Tu ubicación aparecerá al iniciar la ruta.'}</span><span className={styles.privateNote}><ShieldCheck size={13}/> Tu recorrido, protegido</span></div></section>
        <section className={styles.tripCard}>
          <div className={styles.tripIntro}><span className={styles.tripIcon}><Navigation size={24}/></span><span className={styles.tripBadge}>{tracking?'EN RUTA':trip?'RUTA PENDIENTE':'LISTO PARA SALIR'}</span></div>
          <h2>{tracking?'Buen camino.':trip?'Continúa tu recorrido.':'Tu próxima ruta empieza aquí.'}</h2><p>{tracking?'Tu ubicación se actualiza con el GPS. Nosotros te avisamos si excedes el límite.':trip?'Puedes reanudar el GPS o finalizar el viaje que dejaste abierto.':'Activa tu ubicación y deja que te acompañemos en cada kilómetro.'}</p>
          <div className={styles.speedMonitor+' '+(excess?styles.excess:'')}><span>VELOCIDAD ACTUAL</span><strong>{speed===null||stale?'—':Math.round(speed)}<small>km/h</small></strong><div>{excess?<><AlertTriangle size={15}/> Reduce la velocidad</>:<><ShieldCheck size={15}/>{tracking?(stale||speed===null?'Alertas en espera: falta velocidad fiable':limit===null?'Alertas en espera: límite no disponible':'Alertas de velocidad activas'):'La prevención va contigo'}</>}</div></div>
          {trip&&<div className={styles.tripDetails}><span><Car size={15}/><b>{trip.plate}{trip.model&&` · ${trip.model}`}</b></span><span><MapPin size={15}/>{trip.sector}</span></div>}
          <div className={styles.routeMetrics}><div><Route size={15}/><strong>{distance.toFixed(2)} <small>km</small></strong><span>Recorrido GPS</span></div><div><Clock3 size={15}/><strong>{trip?duration:'00:00:00'}</strong><span>Tiempo de ruta</span></div></div>
          {!trip&&vehicleForm&&<form id="start-route-form" className={styles.vehicleForm} onSubmit={event=>{event.preventDefault();void begin()}}><label>Placa<input autoFocus required minLength={5} maxLength={10} pattern="[A-Za-z0-9-]{5,10}" placeholder="ABC123" value={plate} disabled={busy} onChange={event=>{const value=event.target.value.toUpperCase().replace(/\s/g,'');setPlate(value);const saved=data.vehicles.find(v=>v.plate===value);if(saved)setModel(saved.model)}}/></label><label>Marca y modelo<input required maxLength={100} placeholder="Renault Duster 2024" value={model} disabled={busy} onChange={event=>setModel(event.target.value)}/></label><p>Estos datos aparecerán en el panel del administrador.</p></form>}
          {!trip?<button className={styles.startButton} type={vehicleForm?'submit':'button'} form={vehicleForm?'start-route-form':undefined} onClick={event=>{if(!vehicleForm){event.preventDefault();setVehicleForm(true)}}} disabled={busy}>{busy?<LoaderCircle className={styles.spin} size={18}/>:<Play size={18} fill="currentColor"/>}{busy?'Conectando GPS...':'Iniciar ruta'}<Navigation size={17}/></button>:<>{!tracking&&<button className={styles.startButton} onClick={()=>void resume()} disabled={busy}>{busy?<LoaderCircle className={styles.spin} size={17}/>:<LocateFixed size={17}/>}Reanudar GPS</button>}<button className={styles.finishButton} disabled={busy} onClick={()=>void finish()}>{busy?<LoaderCircle className={styles.spin} size={16}/>:<Square size={15}/>}Finalizar ruta</button></>}
          <div className={styles.automaticLimit} role="status"><span><LocateFixed size={15}/>Límites preventivos SST · Detección automática</span><strong>{road.limit===null?'Límite no disponible':road.limit+' km/h · '+road.label}</strong><p>{road.roadName||road.reason}</p>{road.postedLimit&&<p>Límite registrado en el mapa: {road.postedLimit} km/h. Respeta la señalización.</p>}<small>Clasificación basada en OpenStreetMap. Si falta información, no se asigna zona.</small></div><button className={styles.soundTest} onClick={async()=>{try{audio.current??=new AudioContext();await audio.current.resume();beep()}catch{setError('El navegador no pudo reproducir el sonido. Revisa el volumen y los permisos.')}}}><Volume2 size={14}/>Probar sonido de alerta</button><div className={styles.gpsStatus}><span className={tracking&&!stale?styles.liveDot:styles.offDot}/>{gps}</div>
        </section>
      </div>
      <section className={styles.limits} aria-labelledby="limits-title"><div className={styles.sectionTitle}><h2 id="limits-title"><ShieldCheck size={25}/>Límites que protegen</h2><span>Protocolo preventivo SST</span></div><div className={styles.limitGrid}>{routeZones.map(z=><div key={z.id} data-zone={z.id} data-active={detectedZone===z.id} aria-current={detectedZone===z.id?'true':undefined} className={styles.limitCard+(detectedZone===z.id?' '+styles.detectedLimit:'')}><span className={styles.zoneIcon}>{z.icon}</span><div><h3>{z.name}</h3><b>{z.limit}<small> km/h</small></b></div><span className={styles.zoneTag}>{detectedZone===z.id?<><LocateFixed size={13}/>Zona actual</>:'Referencia preventiva'}</span></div>)}</div><p className={styles.limitNote}><Volume2 size={14}/>Alerta sonora al superar el límite registrado del tramo. Las alertas usan estos límites preventivos SST según la categoría identificada. No sustituyen la señalización de la vía.</p></section>
      <footer className={styles.footer}><ShieldCheck size={14}/>Cada kilómetro seguro cuenta.<span>GPS con la app abierta · Límite detectado del tramo · Detección según cobertura del mapa</span></footer>
    </main>

  </div>;
}
