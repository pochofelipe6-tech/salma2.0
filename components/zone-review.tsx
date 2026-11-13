'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {MapPin,Check,RefreshCw,X,Map} from 'lucide-react';
import {routeApi,routeZones} from '../lib/route-types';
import type {SurveyZone} from '../lib/survey-types';
import RouteMap from './route-map';
import styles from './admin-screen.module.css';

export default function ZoneReview(){
  const [status,setStatus]=useState('pending'),[items,setItems]=useState<SurveyZone[]>([]),[count,setCount]=useState(0),[loading,setLoading]=useState(false),[busy,setBusy]=useState<number|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[preview,setPreview]=useState<number|null>(null),[offset,setOffset]=useState(0);
  useEffect(()=>{
    let cancelled=false;setLoading(true);setError('');
    void routeApi(`zone-proposals?status=${status}&offset=${offset}`).then(r=>{if(!cancelled){setItems(r.zones||[]);setCount(r.count||0)}}).catch(e=>{if(!cancelled)setError((e as Error).message)}).finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[status,revision,offset]);
  async function review(event:FormEvent<HTMLFormElement>,item:SurveyZone){event.preventDefault();const form=new FormData(event.currentTarget);await save(item,'confirmed',String(form.get('zone')),Number(form.get('radius')))}
  async function save(item:SurveyZone,nextStatus:string,zone=item.zone,radius=item.radius){
    if(busy!==null)return;setBusy(item.id);setError('');
    try{await routeApi('review-zone',{id:item.id,status:nextStatus,zone,radius});setRevision(n=>n+1)}catch(e){setError((e as Error).message)}finally{setBusy(null)}
  }
  return <section className={styles.panel} aria-labelledby="zone-review-title">
    <div className={styles.panelHead}><div><h2 id="zone-review-title">Zonas de los recorridos</h2><p>Revisa las propuestas antes de activar alertas en futuros viajes.</p></div><button className={styles.outlineButton} disabled={loading} onClick={()=>setRevision(n=>n+1)}><RefreshCw size={17}/>Actualizar</button></div>
    <label className={styles.zoneFilter}>Estado<select aria-label="Estado" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);setPreview(null)}}><option value="pending">Pendientes</option><option value="confirmed">Confirmadas</option><option value="rejected">Descartadas</option></select></label>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {loading?<p role="status">Cargando zonas...</p>:<p role="status">{count} zonas {status==='pending'?'pendientes de revisión':status==='confirmed'?'confirmadas':'descartadas'}</p>}
    <div className={styles.proposalList}>{items.map(item=><article key={`${item.id}:${item.status}:${item.zone}:${item.radius}`} className={styles.proposalCard}>
      <div className={styles.proposalHeader}><MapPin size={22}/><div><h3>{item.name}</h3><small>Ruta {item.trip_id||'eliminada'} · {item.source}</small></div><span>{item.status==='confirmed'?'Confirmada':item.status==='rejected'?'Descartada':`Propuesta · confianza ${item.confidence}`}</span></div>
      <p>{item.reason}</p><p className={styles.proposalCoordinates}>Observación: {item.lat.toFixed(5)}, {item.lng.toFixed(5)} · Tramo corto registrado por GPS</p>
      <button type="button" className={styles.outlineButton} onClick={()=>setPreview(preview===item.id?null:item.id)}><Map size={16}/>{preview===item.id?'Ocultar tramo':'Ver tramo en el mapa'}</button>
      {preview===item.id&&<div className={styles.proposalMap}><RouteMap points={item.geometry.map((p,i)=>({lat:p[1],lng:p[0],accuracy:0,recorded_at:new Date(i*1000).toISOString()}))} position={null} tracking={false} stale={false} markerLabel="Tramo propuesto"/></div>}
      <form className={styles.proposalForm} onSubmit={e=>void review(e,item)}>
        <label>Categoría SST<select aria-label="Categoría SST" name="zone" defaultValue={item.zone} disabled={busy!==null}>{routeZones.map(z=><option key={z.id} value={z.id}>{z.name} · {z.limit} km/h</option>)}</select></label>
        <label>Margen alrededor del tramo (m)<input name="radius" type="number" min={5} max={40} required defaultValue={item.radius} disabled={busy!==null}/></label>
        <label className={styles.proposalAcknowledgment}><input type="checkbox" required disabled={busy!==null}/>Verifiqué el tramo, su categoría y el margen. Confirmarlo activará alertas SST en futuros recorridos.</label>
        <div className={styles.proposalActions}><button type="submit" className={styles.primaryButton} disabled={busy!==null}><Check size={17}/>{busy===item.id?'Guardando...':item.status==='confirmed'?'Actualizar zona':'Confirmar zona'}</button>{item.status!=='rejected'&&<button type="button" className={styles.deleteButton} disabled={busy!==null} onClick={()=>void save(item,'rejected')}><X size={16}/>Descartar</button>}</div>
      </form>
    </article>)}</div>
    {!loading&&!error&&!items.length&&<div className={styles.empty}><MapPin size={32}/><h3>No hay zonas en este estado</h3><p>El conductor puede activar «Registrar zonas del recorrido» antes de iniciar o mientras realiza su ruta.</p></div>}
    {count>100&&<div className={styles.proposalActions}><button className={styles.outlineButton} disabled={loading||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-100))}>Anterior</button><span>{offset+1}–{Math.min(offset+100,count)} de {count}</span><button className={styles.outlineButton} disabled={loading||offset+100>=count} onClick={()=>setOffset(n=>n+100)}>Siguiente</button></div>}
  </section>;
}
