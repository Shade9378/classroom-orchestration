import {requestJson} from '../state/http'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './DeviceIdentification.css'

type Job={id:string;label:string;remoteDeviceId:string;dueAt:number;state:'scheduled'|'running'|'success'|'error'|'cancelled';message:string}
export function DeviceIdentification({sessionId}:{sessionId:string}){
  const [jobs,setJobs]=useState<Job[]>([]),[now,setNow]=useState(Date.now()),[target,setTarget]=useState<Element>(document.body),[error,setError]=useState('')
  useEffect(()=>{
    let stopped=false,busy=false
    setJobs([]);setError('')
    const load=async()=>{
      if(busy)return;busy=true
      try{const data=await requestJson<{jobs:Job[]}>(`/api/sessions/${sessionId}/netsblox-devices/identifications`);if(!stopped)setJobs(data.jobs)}catch{}finally{busy=false}
    }
    void load();const poll=setInterval(()=>void load(),1000),clock=setInterval(()=>setNow(Date.now()),250)
    return()=>{stopped=true;clearInterval(poll);clearInterval(clock)}
  },[sessionId])
  useEffect(()=>{
    const update=()=>setTarget([...document.querySelectorAll('dialog[open]')].at(-1)??document.fullscreenElement??document.body)
    const observer=new MutationObserver(update);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});document.addEventListener('fullscreenchange',update);update()
    return()=>{observer.disconnect();document.removeEventListener('fullscreenchange',update)}
  },[])
  const cancel=async(id:string)=>{
    try{await requestJson(`/api/sessions/${sessionId}/netsblox-devices/identifications/${id}/cancel`,'POST');setError('');setJobs(previous=>previous.filter(j=>j.id!==id))}catch(e){setError(e instanceof Error?e.message:'Could not cancel identification.')}
  }
  if(!jobs.length)return null
  return createPortal(<aside className="device-identification-feedback" aria-label="Device identification" aria-live="polite">
    {jobs.map(job=><section key={job.id} className={'identification-job '+job.state}>
      <strong>{job.label}</strong>
      <span>{job.state==='scheduled'?`Identify in ${Math.max(0,Math.ceil((job.dueAt-now)/1000))}s`:job.message}</span>
      <small>Device ID: {job.remoteDeviceId}</small>
      {job.state==='scheduled'&&<progress aria-label={'Identification countdown for '+job.label} max={10} value={Math.max(0,(job.dueAt-now)/1000)}/>}
      {job.state!=='running'&&<button type="button" onClick={()=>void cancel(job.id)}>{job.state==='scheduled'?'Cancel identification':'Dismiss'}</button>}
    </section>)}
    {error&&<p role="alert">{error}</p>}
  </aside>,target)
}
