import {requestJson} from '../state/http'
import { useEffect, useRef, useState } from 'react'
import { starterProject } from './starter'
import type { GroupMessage, StudentState } from './types'
type Edit = {version:number;action:Record<string,unknown>}
type EditorState = {groupId:string;workspaceKey:string;starterXml:string;actor:string;editable:boolean;editor:{revision:string;xml:string;version:number;actions:Edit[]}|null}
export function NetsBloxEditor({token,state,lastMessage,onSend}:{token:string;state:StudentState|null;lastMessage?:GroupMessage;onSend:(text:string)=>Promise<void>}) {
  const frame=useRef<HTMLIFrameElement>(null)
  const [ready,setReady]=useState(false)
  const [loadedWorkspace,setLoadedWorkspace]=useState('')
  const [status,setStatus]=useState('Loading NetsBlox...')
  const latest=useRef({state,lastMessage,onSend})
  latest.current={state,lastMessage,onSend}
  const connect=useRef<()=>void>(()=>{})
  const retry=useRef<()=>void>(()=>{})
  const stopDevices=()=>frame.current?.contentWindow?.postMessage({type:'classroom-device-stop'},'*')
  useEffect(()=>{
    let stopped=false,bridgeReady=false,connecting=false,syncing=false,editing=false
    let currentGroup:string|null|undefined,currentWorkspace='',revision='',version=-1
    let queuedEdit:Record<string,unknown>|undefined
    const leases=new Map<string,{deviceId:string;runId:string;leaseId:string}>(),runs=new Set<string>(),finishedRuns=new Set<string>()
    const pending=new Map<string,{resolve:(data:Record<string,unknown>)=>void;reject:(e:Error)=>void;timer:number}>()
    // opaque sandbox keep student scripts away from teacher cookies and storage
    const post=(data:unknown)=>frame.current?.contentWindow?.postMessage(data,'*')
    const request=(type:string,extra:Record<string,unknown>={})=>new Promise<Record<string,unknown>>((resolve,reject)=>{
      const id=crypto.randomUUID(),timer=window.setTimeout(()=>{pending.delete(id);reject(new Error('The editor did not respond. Reconnect editor to retry.'))},30000)
      pending.set(id,{resolve,reject,timer});post({type,id,...extra,...(type==='classroom-load'?{helpers:starterProject}:{})})
    })
    const api=<T,>(path:string,body?:unknown)=>requestJson<T>(path,body===undefined?'GET':'POST',body,{headers:{Authorization:`Bearer ${token}`},keepalive:path.endsWith('/devices/finish'),timeoutMs:30000})
    const group=()=>latest.current.state?.group?.id??null
    const workspace=()=>latest.current.state?.activity?.id??''
    const config=()=>{
      const s=latest.current.state;if(!s)return
      const m=latest.current.lastMessage
      post({type:'set-variable',key:'classroom',value:{deviceServiceCatalog:JSON.stringify(s.managedDeviceServices??[]),devices:JSON.stringify(s.devices??[]),deviceIds:(s.devices??[]).map(d=>d.deviceId).join(', '),deviceServices:(s.devices??[]).map(d=>d.service).join(', '),name:s.participant.name,groupName:s.session.status==='closed'?'Session closed':s.group?.name??'Waiting for group',activity:s.activity?.name??'Waiting for activity',teammates:s.group?.members.map(m=>m.name).join(', ')??'',message:m&&m.groupId===s.group?.id?`${m.senderName}: ${m.text}`:''}})
    }
    const sync=async()=>{
      if(stopped||connecting||syncing||editing||!currentGroup||currentGroup!==group()||currentWorkspace!==workspace())return
      syncing=true
      try {
        const next=await api<EditorState>(`/api/student/editor?after=${version}&revision=${revision}`)
        if(stopped||next.groupId!==currentGroup||currentGroup!==group()||currentWorkspace!==workspace())return
        if(next.workspaceKey!==currentWorkspace || (next.editor?.revision??'')!==revision || (!next.editor&&next.editable)){currentGroup=undefined;return}
        if(next.editor?.actions.length){await request('classroom-actions',{actions:next.editor.actions});version=next.editor.version}
        post({type:'classroom-enable',enabled:next.editable});config()
        setStatus('');setReady(true)
      } catch(e){if(!stopped){setReady(false);post({type:'classroom-enable',enabled:false});setStatus(e instanceof Error?e.message:'Shared editor disconnected.')}}
      finally{syncing=false;if(queuedEdit){const edit=queuedEdit;queuedEdit=undefined;sendEdit(edit)}}
    }
    connect.current=()=>{
      if(!bridgeReady||stopped||connecting||syncing||editing)return
      connecting=true;setReady(false);setStatus('Connecting NetsBlox...')
      const target=group(),targetWorkspace=workspace()
      void(async()=>{
        try {
          if(target){
            let next=await api<EditorState>('/api/student/editor')
            if(!next.editor&&next.editable){
              await request('classroom-load',{xml:next.starterXml,version:-1,actor:next.actor,shared:false,initializing:true})
              const exported=await request('classroom-export')
              await api('/api/student/editor',{xml:exported.xml,groupId:next.groupId,workspaceKey:next.workspaceKey})
              next=await api<EditorState>('/api/student/editor')
            }
            if(next.groupId!==target||next.workspaceKey!==targetWorkspace)throw new Error('Your group changed. Reconnecting...')
            await request('classroom-load',{xml:next.editor?.xml??next.starterXml,version:-1,actor:next.actor,shared:!!next.editor})
            await request('classroom-actions',{actions:next.editor?.actions??[]})
            version=next.editor?.version??-1;revision=next.editor?.revision??''
            post({type:'classroom-enable',enabled:next.editable})
          }else{
            await request('classroom-load',{xml:starterProject,version:-1,actor:latest.current.state?.participant.id??'',shared:false});version=-1
          }
          currentGroup=target;currentWorkspace=targetWorkspace
          await request('remove-listener',{eventType:'classroom-send',listenerId:'classroom-group-send'})
          await request('add-listener',{eventType:'classroom-send',listenerId:'classroom-group-send'})
          config();if(!stopped){setLoadedWorkspace(`${target??''}:${targetWorkspace}`);setReady(true);setStatus('')}
        }catch(e){if(!stopped)setStatus(e instanceof Error?e.message:'Editor connection failed.')}
        finally{connecting=false;if(!stopped&&(target!==group()||targetWorkspace!==workspace()))connect.current()}
      })()
    }
    retry.current=()=>{
      if(!bridgeReady){if(frame.current)frame.current.src='/student-editor.html'}else connect.current()
    }
    const sendEdit=(data:Record<string,unknown>)=>{
        if(stopped)return
        if(!currentGroup||currentGroup!==group()||currentWorkspace!==workspace()||editing||connecting||syncing){post({type:'classroom-reject',message:'The editor is syncing. Try your change again.'});return}
        editing=true
        void api<Edit>('/api/student/editor/actions',{groupId:currentGroup,workspaceKey:currentWorkspace,revision,version:data.version,action:data.action}).then(async record=>{
          if(stopped)return
          await request('classroom-actions',{actions:[record]});version=record.version
        }).catch(e=>{if(!stopped)post({type:'classroom-reject',message:e.message})}).finally(()=>{editing=false;void sync()})
    }
    const finishRun=(runId:string)=>{
      finishedRuns.add(runId);runs.delete(runId)
      for(const [key,lease] of leases)if(lease.runId===runId)leases.delete(key)
      void api('/api/student/devices/finish',{runId}).catch(e=>{if(!stopped)setStatus(e.message)})
    }
    const receive=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow||event.origin!=='null'||!event.data||typeof event.data!=='object')return
      const data=event.data
      if(data.type==='classroom-device-command'){
        if(typeof data.runId!=='string'||typeof data.deviceId!=='string'||typeof data.id!=='string')return
        if(finishedRuns.has(data.runId)){post({type:'classroom-device-result',id:data.id,error:'This program has already stopped.'});return}
        runs.add(data.runId)
        void api<{result:unknown;leaseId:string}>(`/api/student/devices/${encodeURIComponent(data.deviceId)}/command`,{runId:data.runId,method:data.method,args:data.args,transport:data.transport}).then(result=>{
          if(!finishedRuns.has(data.runId))leases.set(`${data.runId}:${data.deviceId}`,{deviceId:data.deviceId,runId:data.runId,leaseId:result.leaseId})
          post({type:'classroom-device-result',id:data.id,result:result.result})
        }).catch(e=>post({type:'classroom-device-result',id:data.id,error:e.message}))
      }else if(data.type==='classroom-device-finish'&&typeof data.runId==='string'){
        finishRun(data.runId)
      }else if(data.type==='classroom-device-renew'&&typeof data.runId==='string'){
        for(const lease of leases.values())if(lease.runId===data.runId&&!finishedRuns.has(lease.runId))void api(`/api/student/devices/${lease.deviceId}/renew`,{runId:lease.runId,leaseId:lease.leaseId}).catch(e=>{post({type:'classroom-device-stop',message:e.message});finishRun(lease.runId)})
      }else if(data.type==='reply'||data.type==='classroom-reply'){
        const req=pending.get(data.id)
        if(req){window.clearTimeout(req.timer);pending.delete(data.id);if(data.error)req.reject(new Error(data.error));else req.resolve(data)}
      }else if(data.type==='classroom-editor-ready'){bridgeReady=true;connect.current()}
      else if(data.type==='classroom-editor-error'){setStatus(data.message??'Editor could not load.')}
      else if(data.type==='event'&&data.eventType==='classroom-send'&&typeof data.detail==='string')void latest.current.onSend(data.detail).catch(()=>{})
      else if(data.type==='classroom-edit'){
        if(syncing){queuedEdit=data;return}
        sendEdit(data)
      }
    }
    const leaving=()=>{for(const runId of [...runs])finishRun(runId)}
    window.addEventListener('pagehide',leaving)
    window.addEventListener('message',receive)
    const poll=window.setInterval(()=>{
      if(currentGroup!==group()||currentWorkspace!==workspace())connect.current();else void sync()
      config()
    },600)
    return()=>{stopped=true;for(const runId of [...runs])finishRun(runId);window.clearInterval(poll);window.removeEventListener('message',receive);window.removeEventListener('pagehide',leaving);for(const req of pending.values()){window.clearTimeout(req.timer);req.reject(new Error('Editor closed.'))}pending.clear()}
  },[token])
  useEffect(()=>{connect.current()},[state?.group?.id,state?.activity?.id])
  useEffect(() => {
    stopDevices()
  }, [state?.activity?.progressId, state?.activity?.awaitingReview])
  const awaitingReview = !!state?.activity?.awaitingReview
  return <section>
    {status && status!=='Loading NetsBlox...' && status!=='Connecting NetsBlox...' && <p role="alert">{status}</p>}
    <button type="button" onClick={()=>retry.current()}>Reconnect editor</button>
    <button type="button" onClick={stopDevices}>Stop scripts and release devices</button>
    <div inert={awaitingReview} className={awaitingReview ? "student-editor-under-review" : undefined}><iframe ref={frame} data-ready={ready} data-workspace={loadedWorkspace} title="Student NetsBlox editor" src="/student-editor.html" sandbox="allow-scripts allow-downloads allow-modals allow-pointer-lock" allow="clipboard-write" /></div>
  </section>
}
