'use client';
import {useEffect,useState,FormEvent} from 'react';
import AuthScreen from '../components/auth-screen';
import DriverScreen from '../components/driver-screen';
import AdminScreen,{type AdminData} from '../components/admin-screen';
import {ShieldCheck} from 'lucide-react';
async function api(action:string,body?:unknown){const r=await fetch('/api/'+action,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error),{status:r.status});return data}
export default function Home(){
 const [data,setData]=useState<AdminData|null>(null),[loading,setLoading]=useState(true),[register,setRegister]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const refresh=async()=>{try{setData(await api('state'))}catch(e){if(e&&typeof e==='object'&&'status' in e&&e.status===401)setData(null);else setError((e as Error).message)}finally{setLoading(false)}};
 useEffect(()=>{if(new URLSearchParams(window.location.search).has('auth_error'))setError('No se pudo confirmar la cuenta. Revisa el enlace o intenta iniciar sesión.');void refresh();},[]);
 useEffect(()=>{if(!data)return;const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer)},[!!data]);
 async function auth(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');setNotice('');try{const result=await api(register?'register':'login',Object.fromEntries(new FormData(e.currentTarget)));if(result.confirmationRequired){setNotice(result.message);setRegister(false)}else await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const logout=async()=>{await api('logout',{});setData(null)};
 if(loading)return <div className="loading"><ShieldCheck size={40}/> Preparando tu ruta…</div>;
 if(!data)return <AuthScreen register={register} busy={busy} error={error} notice={notice} onSubmit={auth} onToggle={()=>{setRegister(!register);setError('');setNotice('')}}/>;
 if(data.user.role!=='admin')return <DriverScreen data={data} onRefresh={refresh} onLogout={logout}/>;
 return <AdminScreen data={data} error={error} onError={setError} onRefresh={refresh} onLogout={logout}/>;
}
