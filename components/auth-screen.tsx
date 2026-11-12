'use client';

import {useRef,useState,type FormEvent} from 'react';
import {ShieldCheck,Gauge,Route,UserRound,Mail,LockKeyhole,Eye,EyeOff,ArrowRight,AlertCircle,Check, X} from 'lucide-react';
import styles from './auth-screen.module.css';

type Props={register:boolean;busy:boolean;error:string;notice:string;onSubmit:(event:FormEvent<HTMLFormElement>)=>void;onToggle:()=>void};
type Topic='Seguridad'|'Rutas'|'Ayuda';
const topics:Record<Topic,{title:string;description:string;items:string[]}>={
  Seguridad:{title:'Límites que protegen la vida',description:'Los límites preventivos SST te ayudan a cuidar cada recorrido.',items:['Zona urbana: 50 km/h.','Vía nacional: 70 km/h.','Curvas: 35 km/h.','Zona escolar o residencial: 30 km/h.','Durante un exceso, la app muestra una alerta y emite un sonido. Mantén la aplicación abierta y permite el acceso al GPS.']},
  Rutas:{title:'Tu próximo viaje, paso a paso',description:'Prepara tu recorrido antes de poner el vehículo en movimiento.',items:['Registra la placa y el modelo en Vehículos.','Selecciona tu vehículo, el tipo de zona y el sector.','Activa el GPS y permite el acceso a tu ubicación.','Mantén la app abierta durante el viaje y finalízalo al llegar.','Las alertas guardan el sector, la hora y las coordenadas del evento. La zona se selecciona manualmente.']},
  Ayuda:{title:'Estamos para orientarte',description:'Lo que necesitas para empezar a usar Seguimiento de Ruta.',items:['¿Cuenta nueva? Regístrate, revisa tu correo y confirma tu cuenta antes de ingresar.','¿No aparece el correo? Revisa la carpeta de spam y espera unos minutos.','¿Sin señal GPS? Revisa los permisos de ubicación del navegador y mantén la app abierta.','¿Necesitas acceso de administrador? Solicítalo al responsable del sistema. No se asigna desde el registro público.']},
};

export default function AuthScreen({register,busy,error,notice,onSubmit,onToggle}:Props){
  const [visible,setVisible]=useState(false),[topic,setTopic]=useState<Topic>('Ayuda');
  const dialog=useRef<HTMLDialogElement>(null);
  function openTopic(value:Topic){setTopic(value);dialog.current?.showModal()}
  const steps=register||!!notice;
  return <main className={styles.screen} id="inicio">
    <section className={styles.hero} aria-labelledby="welcome-title">
      <div className={styles.scenery} aria-hidden="true"/>
      <div className={styles.wave} aria-hidden="true"/>
      <div className={styles.topbar}>
        <a className={styles.logo} href="#inicio" aria-label="Seguimiento de Ruta, inicio"><ShieldCheck strokeWidth={1.8}/><span>Seguimiento<br/>de Ruta</span><b>SST</b></a>
        <nav className={styles.navigation} aria-label="Navegación de bienvenida">
          <a href="#inicio" aria-current="page">Inicio</a>
          {(['Seguridad','Rutas','Ayuda'] as Topic[]).map(item=><button type="button" key={item} onClick={()=>openTopic(item)}>{item}</button>)}
        </nav>
      </div>
      <div className={styles.heroCopy}>
        <div className={styles.eyebrow}>CADA KILÓMETRO CUENTA<span/></div>
        <h1 id="welcome-title">El mejor destino<br/>es llegar <em>seguro.</em></h1>
        <p>Prevén excesos de velocidad, acompaña cada viaje<br className={styles.desktopBreak}/> y construye una cultura de cuidado en la vía.</p>
        <div className={styles.features}>
          <div><span className={styles.featureIcon}><Gauge/></span><h2>Monitoreo de velocidad</h2><p>Alertas durante tu viaje</p></div>
          <div><span className={styles.featureIcon}><Route/></span><h2>Seguimiento de ruta</h2><p>Eventos y sectores<br/>en un solo lugar</p></div>
          <div><span className={styles.featureIcon}><ShieldCheck/></span><h2>Cultura de seguridad</h2><p>Hábitos que salvan vidas</p></div>
        </div>
      </div>
      <div className={styles.heroFoot}><ShieldCheck size={15}/><span>Seguridad en cada kilómetro</span><span className={styles.footLine}/><span>Prevención SST</span></div>
    </section>

    <section className={styles.formSide} aria-labelledby="auth-title">
      <div className={styles.formCard}>
        <div className={styles.pill}><ShieldCheck/>Tu seguridad, conectada</div>
        <h2 id="auth-title">{notice?'Verifica tu correo':register?'Crea tu cuenta de conductor':'Bienvenido de nuevo'}</h2>
        <p className={styles.subtitle}>{notice?'Estás a un paso de comenzar tu primer viaje.':register?'Comienza a usar Seguimiento de Ruta en minutos.':'Ingresa y continúa tu camino con seguridad.'}</p>
        {steps&&<ol className={styles.steps} aria-label="Progreso del registro">
          {['Tus datos','Verificación','Listo'].map((label,index)=><li key={label} className={(notice?index===1:index===0)?styles.activeStep:notice&&index===0?styles.doneStep:''} aria-current={(notice?index===1:index===0)?'step':undefined}><span>{notice&&index===0?<Check size={15}/>:index+1}</span><b>{label}</b></li>)}
        </ol>}
        {notice&&<div className={styles.notice} role="status"><Mail size={20}/><p>{notice}</p></div>}
        <form className={styles.form} onSubmit={onSubmit} aria-busy={busy}>
          {register&&<label className={styles.field}><UserRound className={styles.fieldIcon} size={20}/><span>Nombre completo</span><input name="name" autoComplete="name" required placeholder="Tu nombre y apellido" maxLength={100} disabled={busy}/></label>}
          <label className={styles.field}><Mail className={styles.fieldIcon} size={20}/><span>Correo electrónico</span><input name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required placeholder="nombre@empresa.com" disabled={busy}/></label>
          <label className={styles.field}><LockKeyhole className={styles.fieldIcon} size={20}/><span>Contraseña</span><div className={styles.password}><input name="password" aria-label="Contraseña" type={visible?'text':'password'} autoComplete={register?'new-password':'current-password'} minLength={10} maxLength={128} required placeholder={register?'Crea una contraseña segura':'Ingresa tu contraseña'} aria-describedby={register?'password-hint':undefined} disabled={busy}/><button type="button" aria-label={visible?'Ocultar contraseña':'Mostrar contraseña'} aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={19}/>:<Eye size={19}/>}</button></div>{register&&<small className={styles.passwordHint} id="password-hint">Usa al menos 10 caracteres.</small>}</label>
          {error&&<div className={styles.error} role="alert"><AlertCircle size={20}/><span>{error}</span></div>}
          <button className={styles.submit} disabled={busy} type="submit"><span>{busy?'Un momento…':register?'Crear cuenta':'Iniciar sesión'}</span>{busy?<span className={styles.spinner} aria-hidden="true"/>:<ArrowRight size={22}/>}</button>
        </form>
        <p className={styles.switch}>{register?'¿Ya tienes cuenta?':'¿Aún no tienes cuenta?'} <button type="button" onClick={()=>{setVisible(false);onToggle()}} disabled={busy}>{register?'Inicia sesión':'Regístrate'}</button></p>
        <div className={styles.adminNote}><LockKeyhole size={18}/><p>El administrador se asigna de forma privada por el responsable del sistema.</p></div>
      </div>
    </section>

    <dialog ref={dialog} className={styles.dialog} aria-labelledby="help-title" onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close()}}>
      <button type="button" className={styles.closeDialog} onClick={()=>dialog.current?.close()} aria-label="Cerrar información"><X size={22}/></button>
      <ShieldCheck className={styles.dialogIcon} size={34}/><h2 id="help-title">{topics[topic].title}</h2><p>{topics[topic].description}</p><ul>{topics[topic].items.map(item=><li key={item}>{item}</li>)}</ul><button className={styles.dialogAction} onClick={()=>dialog.current?.close()}>Entendido<Check size={17}/></button>
    </dialog>
  </main>;
}
