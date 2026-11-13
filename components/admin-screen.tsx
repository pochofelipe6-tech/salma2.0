'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Bell,CalendarDays,Car,ChevronRight,Download,LayoutGrid,LogOut,MapPin,Plus,Route,Search,ShieldCheck,Trash2,Check,AlertTriangle} from 'lucide-react';
import {routeApi,routeZones} from '../lib/route-types';
import ZoneReview from './zone-review';
import styles from './admin-screen.module.css';

type Vehicle={id:number;user_id:string;plate:string;model:string;driver:string};
type Trip={id:number;user_id:string;plate:string;model?:string;driver:string;zone:string;sector:string;started:string;ended:string|null};
type RouteEvent={road_id?:string;id:number;plate:string;driver:string;zone:string;sector:string;speed:number;limit_speed:number;created:string;lat:number;lng:number};
export type AdminData={user:{id:string;name:string;email:string;role:string};vehicles:Vehicle[];trips:Trip[];events:RouteEvent[]};
type Tab='Resumen'|'Viajes'|'Vehículos'|'Alertas'|'Zonas';

const tabs=[{id:'Resumen',icon:LayoutGrid},{id:'Viajes',icon:Route},{id:'Vehículos',icon:Car},{id:'Alertas',icon:Bell},{id:'Zonas',icon:MapPin}] as const;
const titles:Record<Tab,string>={Resumen:'Panel de seguridad vial',Viajes:'Viajes de la flota',Vehículos:'Vehículos',Alertas:'Alertas',Zonas:'Zonas de los recorridos'};
const zoneName=(id:string)=>routeZones.find(z=>z.id===id)?.name||id;
const dateTime=(value:string)=>new Date(value).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'});

function downloadCsv(events:RouteEvent[]){
  const rows=[['Placa','Conductor','Zona','Sector','Velocidad','Limite','Fecha UTC','Latitud','Longitud'],...events.map(e=>[e.plate,e.driver,e.road_id?'Límite del tramo':e.zone,e.sector,e.speed,e.limit_speed,e.created,e.lat,e.lng])];
  const csv='﻿'+rows.map(r=>r.map(v=>'"'+String(v).replace(/^[=+@-]/,"'").replaceAll('"','""')+'"').join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  const link=document.createElement('a');link.href=url;link.download='seguimiento-de-ruta-alertas.csv';link.click();URL.revokeObjectURL(url);
}

export default function AdminScreen({data,error,onError,onRefresh,onLogout}:{data:AdminData;error:string;onError:(message:string)=>void;onRefresh:()=>Promise<void>;onLogout:()=>Promise<void>}){
  const [tab,setTab]=useState<Tab>('Resumen'),[filter,setFilter]=useState(''),[vehicleForm,setVehicleForm]=useState(false),[busy,setBusy]=useState(false);
  const deleteDialog=useRef<HTMLDialogElement>(null);
  const [deletion,setDeletion]=useState<{kind:'trip'|'vehicle';id:number;plate:string;detail:string}|null>(null);
  const [deleteStage,setDeleteStage]=useState<'confirm'|'deleting'|'success'|'error'>('confirm'),[deleteError,setDeleteError]=useState('');
  useEffect(()=>{if(deletion){deleteDialog.current?.showModal();const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous}}},[deletion]);
  const [destination,setDestination]=useState<string|null>(null);
  useEffect(()=>{if(destination){const target=document.getElementById(destination);target?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});target?.focus({preventScroll:true});setDestination(null)}},[destination,tab]);
  function openStat(index:number){
    const destinations=['vehicles-title','trips-title','alerts-title','zones-title'];
    setTab((['Vehículos','Viajes','Alertas','Resumen'] as const)[index]);setFilter('');setDestination(destinations[index]);
  }
  const initial=data.user.name.trim().slice(0,1).toUpperCase()||'A';
  const today=new Date().toDateString();
  const query=filter.trim().toLowerCase();
  const events=data.events.filter(e=>`${e.plate} ${e.driver} ${e.sector} ${e.zone} ${e.road_id?'Límite del tramo':zoneName(e.zone)}`.toLowerCase().includes(query));
  const shown=tab==='Resumen'?events.slice(0,5):events;
  const stats=[
    {label:'Vehículos registrados',value:data.vehicles.length,note:'En tu centro de seguridad',icon:Car,tone:styles.green},
    {label:'Viajes realizados',value:data.trips.length,note:`${data.trips.filter(t=>!t.ended).length} en curso`,icon:Route,tone:styles.blue},
    {label:'Alertas registradas',value:data.events.length,note:`${data.events.filter(e=>new Date(e.created).toDateString()===today).length} durante el día de hoy`,icon:Bell,tone:styles.orange},
    {label:'Zonas preventivas',value:String(routeZones.length).padStart(2,'0'),note:'Límites para cuidar la vida',icon:ShieldCheck,tone:styles.purple},
  ];

  function deleteTrip(trip:Trip){
    if(busy)return;setDeleteStage('confirm');setDeleteError('');setDeletion({kind:'trip',id:trip.id,plate:trip.plate,detail:dateTime(trip.started)+' · '+trip.driver});
  }
  function deleteVehicle(vehicle:Vehicle){
    if(busy)return;setDeleteStage('confirm');setDeleteError('');setDeletion({kind:'vehicle',id:vehicle.id,plate:vehicle.plate,detail:vehicle.model+' · '+vehicle.driver});
  }
  async function confirmDeletion(){
    if(!deletion||busy)return;
    setBusy(true);setDeleteStage('deleting');onError('');
    const animation= new Promise(resolve=>setTimeout(resolve,1100));
    try{
      await routeApi(deletion.kind==='trip'?'delete-trip':'delete-vehicle',deletion.kind==='trip'?{trip:deletion.id}:{vehicle:deletion.id});
      await animation;setDeleteStage('success');await onRefresh();
    }catch(err){setDeleteError((err as Error).message);setDeleteStage('error')}
    finally{setBusy(false)}
  }

  async function saveVehicle(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const body=Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);onError('');
    try{await routeApi('vehicle',body);setVehicleForm(false);await onRefresh()}
    catch(err){onError((err as Error).message)}
    finally{setBusy(false)}
  }

  const alertsPanel=<section className={styles.panel} aria-labelledby="alerts-title">
    <div className={styles.panelHead}>
      <div><h2 id="alerts-title" tabIndex={-1}>{tab==='Resumen'?'Últimas alertas':'Registro de alertas'}</h2><p>Cada evento es una oportunidad para prevenir.</p></div>
      <button className={styles.outlineButton} onClick={()=>downloadCsv(data.events)}><Download size={19}/>Exportar CSV</button>
    </div>
    {tab==='Alertas'&&<label className={styles.search}><Search size={18} aria-hidden/><input aria-label="Buscar alertas" placeholder="Buscar por placa, conductor, zona o sector…" value={filter} onChange={e=>setFilter(e.target.value)}/></label>}
    <div className={styles.tableWrap}><table className={styles.alertsTable}>
      <colgroup><col style={{width:'22%'}}/><col style={{width:'18%'}}/><col style={{width:'13%'}}/><col style={{width:'11%'}}/><col style={{width:'18%'}}/><col/></colgroup>
      <thead><tr><th>Vehículo / conductor</th><th>Zona y sector</th><th>Velocidad</th><th>Límite</th><th>Fecha y hora</th><th>Ubicación</th></tr></thead>
      <tbody>{shown.map(e=><tr key={e.id}>
        <td><b className={styles.plate}>{e.plate}</b><small>{e.driver}</small></td>
        <td>{zoneName(e.zone)}<small>{e.sector}</small></td>
        <td><span className={styles.speedBadge}>{Math.round(e.speed)} km/h</span></td>
        <td>{e.limit_speed} km/h</td>
        <td>{dateTime(e.created)}</td>
        <td><a className={styles.mapLink} target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=17/${e.lat}/${e.lng}`}><MapPin size={16}/>Ver mapa</a></td>
      </tr>)}</tbody>
    </table></div>
    {!shown.length&&<div className={styles.empty}>
      <span className={styles.emptyIcon}><ShieldCheck size={32}/></span>
      <h3>{query?'No encontramos coincidencias':'Sin alertas recientes'}</h3>
      <p>{query?'Prueba otra placa, zona o conductor.':'Cuando se registre una alerta, aparecerá aquí con todos los detalles.'}</p>
    </div>}
    {data.events.length>0&&<div className={styles.zoneSummary}>{routeZones.map(z=><span key={z.id}>{z.name}: <b>{data.events.filter(e=>e.zone===z.id).length}</b></span>)}</div>}
  </section>;

  return <div className={styles.shell}>
    <dialog ref={deleteDialog} className={styles.deleteDialog} data-stage={deleteStage} aria-labelledby="delete-title" aria-describedby="delete-description" onCancel={event=>{if(busy)event.preventDefault()}} onClose={()=>setDeletion(null)}>
      {deletion&&<div className={styles.deleteContent}>
        <div className={styles.deleteHalo} key={deleteStage}>{deleteStage==='success'?<Check size={44} strokeWidth={3}/>:deleteStage==='error'?<AlertTriangle size={40}/>:<span className={styles.trashAnimation} aria-hidden="true"><span className={styles.trashPaper}/><span className={styles.trashLid}/><span className={styles.trashCan}><i/><i/><i/></span></span>}</div>
        <span className={styles.deleteEyebrow}>{deleteStage==='deleting'?'ELIMINANDO...':deleteStage==='confirm'?'CONFIRMAR ELIMINACIÓN':deleteStage==='success'?'OPERACIÓN COMPLETADA':'REVISA LOS DATOS'}</span>
        <h2 id="delete-title">{deleteStage==='deleting'?'Eliminando registro...':deleteStage==='confirm'?(deletion.kind==='trip'?'¿Eliminar esta ruta?':'¿Eliminar este vehículo?'):deleteStage==='success'?(deletion.kind==='trip'?'¡Ruta eliminada!':'¡Vehículo eliminado!'):'No se pudo eliminar'}</h2>
        <div className={styles.deleteSummary}><strong>{deletion.plate}</strong><span>{deletion.detail}</span></div>
        <p id="delete-description">{deleteStage==='deleting'?'Estamos procesando la eliminación.':deleteStage==='error'?deleteError:deleteStage==='success'?'El registro se eliminó correctamente.':deletion.kind==='trip'?'También se eliminarán sus posiciones GPS y alertas. Esta acción no se puede deshacer.':'Esta acción no se puede deshacer. Los vehículos con viajes registrados se conservan para proteger el historial.'}</p>
        <div className={styles.deleteActions}>{deleteStage==='confirm'||deleteStage==='deleting'?<><button autoFocus disabled={busy} className={styles.cancelDeletion} onClick={()=>deleteDialog.current?.close()}>Cancelar</button><button disabled={busy} className={styles.confirmDeletion} onClick={()=>void confirmDeletion()}><Trash2 size={17}/>{busy?'Eliminando...':'Sí, eliminar'}</button></>:<button autoFocus disabled={busy} className={styles.confirmDeletion} onClick={()=>deleteDialog.current?.close()}><Check size={18}/>Aceptar</button>}</div>
      </div>}
    </dialog>
    <aside className={styles.sidebar}>
      <a href="/" className={styles.brand}><ShieldCheck/><span>Seguimiento<br/>de Ruta</span><b>SST</b></a>
      <p className={styles.workspace}>CENTRO DE SEGURIDAD VIAL</p>
      <nav className={styles.nav} aria-label="Secciones del panel">{tabs.map(({id,icon:Icon})=>
        <button key={id} className={styles.navItem+(tab===id?' '+styles.active:'')} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}>
          <Icon/>{id}{id==='Alertas'&&<span className={styles.navBadge}>{data.events.length}</span>}
        </button>)}
      </nav>
      <div className={styles.safety}><ShieldCheck/><b>La prevención nos mueve.</b><p>Un viaje seguro empieza con pequeñas decisiones.</p></div>
      <div className={styles.profile}>
        <span className={styles.avatar} aria-hidden>{initial}</span>
        <div><b>Administrador</b></div>
        <button aria-label="Cerrar sesión" title="Cerrar sesión" onClick={()=>void onLogout().catch(()=>onError('No se pudo cerrar la sesión.'))}><LogOut size={20}/></button>
      </div>
    </aside>
    <div className={styles.main}>
      <header className={styles.topbar}>
        <nav className={styles.crumbs} aria-label="Ubicación">Mi espacio <ChevronRight size={16}/> <b>{tab}</b></nav>
        <span className={styles.status}><i/>Sistema activo</span>
        <span className={styles.topAvatar} aria-hidden>{initial}</span>
      </header>
      <main key={tab} className={styles.content}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <span className={styles.eyebrow}>CONTROL Y PREVENCIÓN</span>
            <h1>{titles[tab]}</h1>
            <p>Una visión completa de tu flota y las alertas en cada recorrido.</p>
          </div>
          <div className={styles.heroArt}><span className={styles.date}><CalendarDays size={22}/>{new Date().toLocaleDateString('es-CO',{day:'numeric',month:'long',year:'numeric'})}</span></div>
        </section>
        {error&&<div className={styles.error} role="alert">{error}<button onClick={()=>onError('')}>Cerrar</button></div>}

        {tab==='Resumen'&&<>
          <div className={styles.stats}>{stats.map(({label,value,note,icon:Icon,tone},index)=><button type="button" onClick={()=>openStat(index)} key={label} className={styles.stat+' '+tone}>
            <span className={styles.tile}><Icon/></span><span className={styles.statLabel}>{label}</span><strong>{value}</strong><small>{note}</small>
          </button>)}</div>
          <div className={styles.sectionHead}><h2 id="zones-title" tabIndex={-1}>Límites que protegen</h2><span>Protocolo preventivo SST</span></div>
          <div className={styles.zones}>{routeZones.map(z=><div key={z.id} className={styles.zone}>
            <img src={`/images/admin/zona-${z.id}.png`} alt="" width={150} height={140}/>
            <div><h3>{z.name}</h3><b>{z.limit}<small>km/h</small></b><span>Límite preventivo</span></div>
          </div>)}</div>
          {alertsPanel}
        </>}

        {tab==='Alertas'&&alertsPanel}
        {tab==='Zonas'&&<ZoneReview/>}

        {tab==='Viajes'&&<section className={styles.panel} aria-labelledby="trips-title">
          <div className={styles.panelHead}><div><h2 id="trips-title" tabIndex={-1}>Historial de viajes</h2><p>Todos los recorridos de la flota, en curso y finalizados.</p></div></div>
          <div className={styles.tableWrap}><table>
            <thead><tr><th>Vehículo</th><th>Conductor</th><th>Inicio</th><th>Finalización</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>{data.trips.map(t=><tr key={t.id}>
              <td><b className={styles.plate}>{t.plate}</b><small>{t.model}</small></td><td>{t.driver}</td><td>{dateTime(t.started)}</td><td>{t.ended?dateTime(t.ended):'—'}</td>
              <td><span className={t.ended?styles.doneBadge:styles.liveBadge}>{t.ended?'Finalizado':'En curso'}</span></td><td><button className={styles.deleteButton} disabled={busy} aria-label={`Eliminar ruta ${t.id}`} onClick={()=>void deleteTrip(t)}><Trash2 size={16}/>Eliminar ruta</button></td>
            </tr>)}</tbody>
          </table></div>
          {!data.trips.length&&<div className={styles.empty}><span className={styles.emptyIcon}><Route size={30}/></span><h3>Aún no hay recorridos</h3><p>Los viajes de la flota aparecerán aquí.</p></div>}
        </section>}

        {tab==='Vehículos'&&<section className={styles.panel} aria-labelledby="vehicles-title">
          <div className={styles.panelHead}>
            <div><h2 id="vehicles-title" tabIndex={-1}>Vehículos registrados</h2><p>Placas y modelos disponibles para los recorridos.</p></div>
            <button className={styles.primaryButton} onClick={()=>setVehicleForm(!vehicleForm)}><Plus size={18}/>Agregar vehículo</button>
          </div>
          {vehicleForm&&<form onSubmit={saveVehicle} className={styles.vehicleForm}>
            <label>Placa<input name="plate" required placeholder="ABC123" minLength={5} maxLength={10}/></label>
            <label>Marca y modelo<input name="model" required placeholder="Renault Duster 2024" maxLength={100}/></label>
            <button className={styles.primaryButton} disabled={busy}>Guardar vehículo</button>
          </form>}
          <div className={styles.vehicleGrid}>{data.vehicles.map(v=><div className={styles.vehicle} key={v.id}><span className={styles.tile}><Car/></span><h3>{v.plate}</h3><p>{v.model}</p><small>{v.driver}</small><button className={styles.deleteButton} disabled={busy} aria-label={`Eliminar vehículo ${v.plate}`} onClick={()=>void deleteVehicle(v)}><Trash2 size={16}/>Eliminar vehículo</button></div>)}</div>
          {!data.vehicles.length&&<div className={styles.empty}><span className={styles.emptyIcon}><Car size={30}/></span><h3>Tu primer vehículo, tu próximo viaje</h3><p>Agrega la placa y el modelo para empezar.</p><button className={styles.textButton} onClick={()=>setVehicleForm(true)}>Registrar vehículo <Plus size={15}/></button></div>}
        </section>}

        <footer className={styles.footer}><span><ShieldCheck size={15}/> Seguimiento de Ruta · Seguridad en cada kilómetro</span><span>GPS en primer plano · Datos actualizados cada 15 s</span></footer>
      </main>
    </div>
  </div>;
}
