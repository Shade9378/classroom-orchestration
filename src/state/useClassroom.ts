import {requestJson as request,HttpError as RequestError} from './http'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useActionFeedback } from '../components/ActionFeedback'
import type { Activity, Playlist, Student, Group, Device } from '../types'
export type Session = { id: string; name: string; joinCode: string; status: 'open'|'closed'; createdAt: string }
type Snapshot = { dismissedWarningKeys?: string[]; activities: Activity[]; playlists: Playlist[]; students: Student[]; groups: Group[]; devices: Device[]; session: Session | null; events: { id: string; groupId?: string | null; type: string; message: string; createdAt: string }[] }
const empty: Snapshot = { activities: [], playlists: [], students: [], groups: [], devices: [], session: null, events: [] }
export function useClassroom() {
  const notify = useActionFeedback()
  useEffect(()=>{
    for(const key of Object.keys(localStorage))if(key.startsWith('cp1.')||key==='classroom.teacher-sessions.v1'||key==='classroom.active-session')localStorage.removeItem(key)
  },[])
  const [auth,setAuth]=useState<{authenticated:boolean;name?:string|null}|null>(null)
  const [sessions,setSessions]=useState<Session[]>([])
  const [activeId,setActive]=useState(()=>new URLSearchParams(location.search).get('session')??'')
  const setActiveId=(id:string)=>{
    const url=new URL(location.href)
    if(id)url.searchParams.set('session',id);else url.searchParams.delete('session')
    history.replaceState(null,'',url);setActive(id)
  }
  const [state,setState]=useState<Snapshot>(empty)
  const [error,setError]=useState('')
  const [connectionError,setConnectionError]=useState('')
  const savedNeedsRefresh=useRef(false)
  const authVersion=useRef(0)
  const [loaded,setLoaded]=useState(false)
  const [pending,setPending]=useState(0)
  const [connected,setConnected]=useState(false)
  const version=useRef(0)
  const retryAuth=useCallback(async()=>{
    const sequence=++authVersion.current
    setPending(n=>n+1);setConnectionError('')
    try{const next=await request<{authenticated:boolean;name?:string|null}>('/api/teacher/status');if(sequence===authVersion.current)setAuth(next)}
    catch(e){if(sequence===authVersion.current)setConnectionError(e instanceof Error?e.message:'Could not check teacher access.')}
    finally{setPending(n=>n-1)}
  },[])
  useEffect(()=>{void retryAuth();return()=>{++authVersion.current}},[retryAuth])
  useEffect(()=>{
    if(auth?.authenticated)return
    const online=()=>{void retryAuth()}
    window.addEventListener('online',online)
    return()=>window.removeEventListener('online',online)
  },[auth?.authenticated,retryAuth])
  const signIn=async(name:string,password:string,createAccount=false)=>{
    setPending(n=>n+1);setError('')
    try{++authVersion.current;const result=await request<{authenticated:boolean;name:string}>(`/api/teacher/${createAccount?'register':'login'}`,'POST',{name,password});setAuth(result);setConnectionError('');notify(createAccount?'Account created. Signed in as '+result.name+'.':'Signed in as '+result.name+'.')}
    catch(e){setError(e instanceof Error?e.message:'Sign-in failed.')}
    finally{setPending(n=>n-1)}
  }
  const signOut=async()=>{
    setPending(n=>n+1)
    try{++authVersion.current;await request('/api/teacher/logout','POST',{});setAuth({authenticated:false,name:null});setSessions([]);setState(empty);setError('');setConnectionError('');notify('Signed out.')}
    catch(e){setError(e instanceof Error?e.message:'Sign-out failed.')}
    finally{setPending(n=>n-1)}
  }
  const refresh=useCallback(async()=>{
    const sequence=++version.current
    const list=await request<Session[]>('/api/sessions')
    const selected=activeId&&list.some(s=>s.id===activeId)?activeId:''
    const snapshot=await request<Snapshot>(`/api/state${selected?`?sessionId=${selected}`:''}`)
    if(sequence===version.current){
      setSessions(list);setState(snapshot);setLoaded(true);savedNeedsRefresh.current=false;setConnectionError('')
      if(activeId&&!selected){const url=new URL(location.href);url.searchParams.delete('session');history.replaceState(null,'',url);setActive('')}
    }
  },[activeId])
  useEffect(()=>{
    if(!auth?.authenticated)return
    let stopped=false,socket:WebSocket|undefined,retry:number|undefined
    ++version.current;setLoaded(false);setState(empty)
    const update=()=>{void refresh().catch(e=>{if(!stopped){setConnectionError((savedNeedsRefresh.current?'Your change was saved, but the dashboard could not refresh. ':'')+e.message);setLoaded(true);if(e instanceof RequestError&&e.status===401)setAuth({authenticated:false,name:null})}})}
    const connect=()=>{
      if(stopped)return
      socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/live`)
      socket.onopen=()=>socket?.send(JSON.stringify({teacher:true}))
      socket.onmessage=()=>{if(!stopped){setConnected(true);update()}}
      socket.onclose=()=>{if(!stopped){setConnected(false);retry=window.setTimeout(connect,3000)}}
      socket.onerror=()=>socket?.close()
    }
    const online=()=>{update();if(!socket||socket.readyState>=WebSocket.CLOSING){window.clearTimeout(retry);connect()}}
    const offline=()=>setConnected(false)
    window.addEventListener('online',online);window.addEventListener('offline',offline)
    update();connect()
    const poll=window.setInterval(update,10000)
    return()=>{stopped=true;++version.current;window.removeEventListener('online',online);window.removeEventListener('offline',offline);window.clearInterval(poll);window.clearTimeout(retry);socket?.close();setConnected(false)}
  },[auth?.authenticated,refresh])
  const mutate=async<T,>(path:string,method:string,body?:unknown,confirmation?:string|((result:T)=>string),commit?:()=>void):Promise<T>=>{
    setPending(n=>n+1);setError('')
    try{
      const result=await request<T>(path,method,body)
      commit?.()
      try{await refresh()}catch(e){savedNeedsRefresh.current=true;setConnectionError('Your change was saved, but the dashboard could not refresh. '+(e instanceof Error?e.message:'Try reconnecting.'))}
      if(confirmation)notify(typeof confirmation==='string'?confirmation:confirmation(result))
      return result
    }
    catch(e){setError(e instanceof Error?e.message:'Request failed.');throw e}
    finally{setPending(n=>n-1)}
  }
  const sessionPath=()=>{if(!activeId)throw new Error('Create or select a session first.');return `/api/sessions/${activeId}`}
  const createSession=async(name:string)=>{
    setPending(n=>n+1);setError('')
    try{const next=await request<{session:Session}>('/api/sessions','POST',{name});setSessions(prev=>[next.session,...prev]);setActiveId(next.session.id);notify('Session '+next.session.name+' created.')}
    catch(e){setError(e instanceof Error?e.message:'Could not create session.');throw e}
    finally{setPending(n=>n-1)}
  }
  const deleteSession=async()=>{
    if(!activeId)return
    setPending(n=>n+1);setError('')
    try{await request(sessionPath(),'DELETE');++version.current;setSessions(prev=>prev.filter(s=>s.id!==activeId));setActiveId('');setError('');notify('Session deleted.')}
    catch(e){setError(e instanceof Error?e.message:'Could not delete session.');throw e}
    finally{setPending(n=>n-1)}
  }
  return {refresh,retryAuth,auth,signIn,signOut,deleteSession,state,sessions,activeId,setActiveId,createSession,loaded,pending,connected,error:error||connectionError,dismissError:()=>{setError('');setConnectionError('')},
    setSessionStatus: (status: 'open'|'closed') => mutate<void>(sessionPath(), 'PATCH', { status }, status==='open'?'Session reopened.':'Session closed.'),
    saveActivity: (a: Activity) => mutate<void>(`/api/activities/${a.id}`, 'PUT', a,undefined,()=>setState(previous=>({...previous,activities:previous.activities.some(item=>item.id===a.id)?previous.activities.map(item=>item.id===a.id?a:item):[...previous.activities,a]}))),
    savePlaylist: (p: Playlist) => mutate<void>(`/api/playlists/${p.id}`, 'PUT', p,undefined,()=>setState(previous=>({...previous,playlists:previous.playlists.some(item=>item.id===p.id)?previous.playlists.map(item=>item.id===p.id?p:item):[...previous.playlists,p]}))),
    deleteActivity: (id: string) => mutate<void>(`/api/activities/${id}`, 'DELETE'),
    deletePlaylist: (id: string) => mutate<void>(`/api/playlists/${id}`, 'DELETE'),
    actions: {
      reviewDeviceReplacement: (plan: import('../types').DeviceReplacement, decision: 'approve' | 'reject') => mutate<{identificationError?:string}>(sessionPath() + '/device-assignments/replacement', 'POST', { ...plan, decision }, result=>decision==='approve'?(result.identificationError?'Device replacement approved. '+result.identificationError:'Device replacement approved. Identification starts in 10 seconds.'):'Replacement rejected. The device remains disconnected.').then(()=>{}),
      sendGroupMessage: (groupId: string, text: string) => mutate<void>(sessionPath() + '/groups/' + groupId + '/messages', 'POST', { text }, 'Message sent to '+(state.groups.find(group=>group.id===groupId)?.name??'the group')+'.'),
      resolveHelp: (groupId: string, id: string) => mutate<void>(sessionPath() + '/groups/' + groupId + '/help/' + id + '/resolve', 'POST', {}, 'Help request marked resolved.'),
      reviewActivity: (groupId: string, progressId: string, decision: 'complete' | 'return', message?: string) =>
        mutate<void>(sessionPath() + '/groups/' + groupId + '/activity-review', 'POST', { progressId, decision, message }, 'Exercise '+(decision==='complete'?'marked complete':'returned for changes')+' for '+(state.groups.find(group=>group.id===groupId)?.name??'the group')+'.'),
      resetEditor:(groupId:string)=>mutate<void>(`${sessionPath()}/groups/${groupId}/editor/reset`,'POST',{},'Editor reset to starter.'),
      removeStudent: (id:string)=>mutate<void>(`${sessionPath()}/participants/${id}`,'DELETE',undefined,(state.students.find(student=>student.id===id)?.name??'Student')+' removed from session.'),
      createGroup: (name: string) => mutate<{ id: string; name: string }>(`${sessionPath()}/groups`, 'POST', { name }, name+' created.'),
      deleteGroups: (groupIds:string[]) => mutate<void>(`${sessionPath()}/groups`,'DELETE',{groupIds},groupIds.length+' group'+(groupIds.length===1?'':'s')+' removed.'),
      deleteGroup: (id: string) => mutate<void>(`${sessionPath()}/groups/${id}`, 'DELETE',undefined,(state.groups.find(group=>group.id===id)?.name??'Group')+' removed.'),
      autoGroupStudents: (participantIds:string[]) => mutate<void>(`${sessionPath()}/memberships/auto`, 'POST', {participantIds},participantIds.length+' student'+(participantIds.length===1?'':'s')+' grouped evenly.'),
      unassignStudents: (participantIds:string[]) => mutate<void>(`${sessionPath()}/memberships`, 'DELETE', {participantIds},participantIds.length+' student'+(participantIds.length===1?'':'s')+' unassigned.'),
      moveStudents: (groupId: string, participantIds: string[]) => mutate<void>(`${sessionPath()}/memberships`, 'POST', { groupId, participantIds },participantIds.length+' student'+(participantIds.length===1?'':'s')+' moved to '+(state.groups.find(group=>group.id===groupId)?.name??'the group')+'.'),
      assignWork: (groupIds: string[], kind: 'activity'|'playlist', id: string) => mutate<void>(`${sessionPath()}/assignments`, 'POST', { groupIds, kind, id },(kind==='playlist'?'Playlist':'Activity')+' assigned to '+groupIds.length+' group'+(groupIds.length===1?'':'s')+'.'),
      removeWork: (groupId: string, kind: 'activity'|'playlist', id: string) => mutate<void>(`${sessionPath()}/groups/${groupId}/assignments`, 'DELETE', { kind, id },(kind==='playlist'?'Playlist':'Activity')+' unassigned from '+(state.groups.find(group=>group.id===groupId)?.name??'the group')+'.'),
      dismissWarning: (fingerprint: string) => mutate<void>(sessionPath() + '/warning-dismissals', 'POST', { fingerprint }),
      autoAssignDevices:(deviceIds:string[])=>mutate<import('../types').AutoDeviceAssignmentResult>(`${sessionPath()}/device-assignments/auto`,'POST',{deviceIds},result=>result.assignedCount?result.assignedCount+' device'+(result.assignedCount===1?'':'s')+' assigned.':'No matching assignments were available for the selected devices.'),
      unassignDevices:(deviceIds:string[])=>mutate<void>(`${sessionPath()}/device-assignments`,'DELETE',{deviceIds},deviceIds.length+' device'+(deviceIds.length===1?'':'s')+' unassigned.'),
      assignDevices: (groupId: string, deviceIds: string[]) => mutate<void>(`${sessionPath()}/device-assignments`, 'POST', { groupId, deviceIds },deviceIds.length+' device'+(deviceIds.length===1?'':'s')+' assigned to '+(state.groups.find(group=>group.id===groupId)?.name??'the group')+'.'),
    },
  }
}
