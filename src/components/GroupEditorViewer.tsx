import {requestJson} from '../state/http'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { starterProject } from '../student/starter'

type Snapshot = {groupId:string;workspaceKey:string;starterXml:string;editor:{revision:string;xml:string;version:number;actions:{version:number;action:Record<string,unknown>}[]}|null}

export function GroupEditorViewer({sessionId,groupId,groupName}:{sessionId:string;groupId:string;groupName:string}) {
  const container=useRef<HTMLDivElement>(null)
  const frame=useRef<HTMLIFrameElement>(null)
  const refresh=useRef<()=>void>(()=>{})
  const [status,setStatus]=useState('Loading NetsBlox...')
  const [ready,setReady]=useState(false)
  const [live,setLive]=useState(false)
  const [expanded,setExpanded]=useState(false)
  const [workspace,setWorkspace]=useState('')
  useEffect(()=>{
    const changed=()=>setExpanded(document.fullscreenElement===container.current)
    document.addEventListener('fullscreenchange',changed)
    return()=>document.removeEventListener('fullscreenchange',changed)
  },[])
  useEffect(()=>{
    let stopped=false,bridgeReady=false,busy=false,loadedKey='',version=-1,revision=''
    const pending=new Map<string,{resolve:()=>void;reject:(error:Error)=>void;timer:number}>()
    const post=(data:unknown)=>frame.current?.contentWindow?.postMessage(data,'*')
    const command=(type:string,extra:Record<string,unknown>)=>new Promise<void>((resolve,reject)=>{
      const id=crypto.randomUUID()
      const timer=window.setTimeout(()=>{pending.delete(id);reject(new Error('The editor did not respond. Reconnect to retry.'))},30000)
      pending.set(id,{resolve,reject,timer});post({type,id,...extra})
    })
    const sync=async()=>{
      if(stopped||!bridgeReady||busy)return
      busy=true
      try {
        const query=new URLSearchParams({after:String(version),...(revision?{revision}:{})})
        const next=await requestJson<Snapshot>(`/api/sessions/${sessionId}/groups/${groupId}/editor?${query}`,'GET',undefined,{timeoutMs:5000})
        if(stopped)return
        const key=`${next.workspaceKey}:${next.editor?.revision??next.starterXml}`
        if(key!==loadedKey){
          setReady(false)
          await command('classroom-load',{xml:next.editor?.xml??next.starterXml,helpers:starterProject,version:-1,actor:'teacher-viewer',shared:true,readOnly:true})
          if(stopped)return
          loadedKey=key;version=-1;revision=next.editor?.revision??''
        }
        if(next.editor?.actions.length){
          await command('classroom-actions',{actions:next.editor.actions})
          version=next.editor.version
        }
        if(!stopped){setWorkspace(`${groupId}:${next.workspaceKey}`);setReady(true);setLive(!!next.editor);setStatus(next.editor?'Live - Read only':'Read only - Waiting for students to open this project')}
      }catch(error){if(!stopped){setReady(false);setLive(false);loadedKey='';revision='';version=-1;setStatus(error instanceof Error?error.message:'Unable to load project.')}}
      finally{busy=false}
    }
    refresh.current=()=>{
      if(!bridgeReady){if(frame.current)frame.current.src='/student-editor.html'}
      else {loadedKey='';revision='';version=-1;void sync()}
    }
    const receive=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow||event.origin!=='null'||!event.data||typeof event.data!=='object')return
      const data=event.data
      if(data.type==='classroom-editor-ready'){bridgeReady=true;void sync()}
      else if(data.type==='classroom-reply'){
        const waiting=pending.get(data.id)
        if(waiting){window.clearTimeout(waiting.timer);pending.delete(data.id);if(data.error)waiting.reject(new Error(data.error));else waiting.resolve()}
      }else if(data.type==='classroom-editor-error'){setReady(false);setLive(false);setStatus(data.message??'NetsBlox could not load.')}
      else if(data.type==='classroom-edit')post({type:'classroom-reject',message:'This is a read-only classroom view.'})
    }
    window.addEventListener('message',receive)
    const poll=window.setInterval(()=>void sync(),1000)
    return()=>{stopped=true;window.clearInterval(poll);window.removeEventListener('message',receive);for(const waiting of pending.values()){window.clearTimeout(waiting.timer);waiting.reject(new Error('Viewer closed.'))}pending.clear()}
  },[sessionId,groupId])
  const toggleExpanded=async()=>{
    try {
      if(document.fullscreenElement===container.current)await document.exitFullscreen()
      else await container.current?.requestFullscreen()
    }catch{setStatus('Your browser could not expand the editor.')}
  }
  return <div className="group-editor-viewer" ref={container}>
    <div className="group-editor-toolbar">
      <span role="status"><span className={`viewer-live-dot ${ready&&live?'live':'offline'}`} role="img" aria-label={ready&&live?'Live connection':'No live connection'}/>{status}</span>
      <button type="button" className="secondary-btn small" onClick={()=>refresh.current()}>Reconnect</button>
      <button type="button" className="secondary-btn small" onClick={()=>void toggleExpanded()}><Icon name={expanded?'x':'external'} size={14}/>{expanded?'Close expanded view':'Expand editor'}</button>
    </div>
    <div className="group-editor-canvas"><iframe ref={frame} title={`${groupName} NetsBlox live editor`} data-ready={ready} data-workspace={workspace} src="/student-editor.html" sandbox="allow-scripts allow-downloads allow-modals allow-pointer-lock" allow="clipboard-write" /></div>
  </div>
}
