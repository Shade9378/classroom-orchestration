import {requestJson,HttpError as StudentError} from '../state/http'
import { useEffect, useRef, useState } from 'react'
import type { GroupMessage, StudentConnection, StudentState } from './types'
const key = 'classroom.student.v1'
async function api<T>(path:string,token?:string,body?:unknown):Promise<T>{
  return requestJson<T>(path,body===undefined?'GET':'POST',body,{headers:token?{Authorization:`Bearer ${token}`}:{},keepalive:path==='/api/participants/heartbeat'})
}
export function useStudent() {
  const [connection, setConnection] = useState<StudentConnection | null>(() => {
    try { const c = JSON.parse(sessionStorage.getItem(key) ?? 'null'); return typeof c?.token === 'string' && typeof c.sessionId === 'string' ? c : null } catch { return null }
  })
  const [state, setState] = useState<StudentState | null>(null)
  const [error, setError] = useState('')
  const [connectionError,setConnectionError]=useState('')
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<GroupMessage[]>([])
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    if (!connection) { setState(null); setMessages([]); return }
    sessionStorage.setItem(key, JSON.stringify(connection))
    let stopped = false, refreshBusy = false, refreshQueued = false, heartbeatBusy = false, heartbeatQueued = false
    let socket: WebSocket | undefined, reconnect: number | undefined, heartbeatTimer: number | undefined
    let cadence = 0
    const terminal = (message: string) => { sessionStorage.removeItem(key); setError(message); setConnection(null) }
    const failed = (e: unknown) => {
      if (stopped) return
      if (e instanceof StudentError && e.status === 401) terminal(e.message)
      else setConnectionError(e instanceof Error ? e.message : 'Connection failed.')
    }
    const refresh = async () => {
      if (stopped) return
      if (refreshBusy) { refreshQueued = true; return }
      refreshBusy = true
      try {
        const next = await api<StudentState>('/api/student/state', connection.token)
        if (stopped) return
        setMessages(next.messages ?? [])
        stateRef.current = next; setState(next)
        if (cadence !== next.heartbeatIntervalMs) {
          cadence = next.heartbeatIntervalMs
          window.clearInterval(heartbeatTimer)
          heartbeatTimer = window.setInterval(() => void heartbeat(), cadence)
        }
        setConnectionError(next.session.status==='closed'?'Your teacher closed this session.':'')
      } catch (e) { failed(e) } finally {
        refreshBusy = false
        if (refreshQueued && !stopped) { refreshQueued = false; void refresh() }
      }
    }
    const heartbeat = async () => {
      if(stopped)return
      if(heartbeatBusy){heartbeatQueued=true;return}
      heartbeatBusy = true
      try { await api('/api/participants/heartbeat', undefined, { token: connection.token, visibility:document.hidden?'hidden':'visible' }) }
      catch (e) { failed(e) } finally { heartbeatBusy = false;if(heartbeatQueued && !stopped){heartbeatQueued=false;void heartbeat()} }
    }
    const connect = () => {
      if (stopped) return
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`)
      socket.onopen = () => {socket?.send(JSON.stringify({ studentToken: connection.token }));void heartbeat()}
      socket.onmessage = event => {
        if (stopped) return
        const data = JSON.parse(event.data)
        if (data.type === 'session-deleted' && data.sessionId === connection.sessionId) { terminal('Your teacher deleted this session.'); return }
        if (data.type === 'student-removed') { terminal('Your teacher removed you from the session.'); return }
        if (data.type === 'student-replaced') { terminal('This student name reconnected from another page.'); return }
        if (data.type === 'group-message') {
          if (data.groupId === stateRef.current?.group?.id) setMessages(prev => prev.some(message => message.id === data.id) ? prev : [...prev, data].slice(-100))
          return
        }
        setConnected(true); void refresh()
      }
      socket.onclose = () => { if (!stopped) { setConnected(false); reconnect = window.setTimeout(connect, 2000) } }
      socket.onerror = () => socket?.close()
    }
    const visibilityChanged=()=>{void heartbeat();if(!document.hidden)void refresh()}
    const online=()=>{visibilityChanged();if(!socket||socket.readyState>=WebSocket.CLOSING){window.clearTimeout(reconnect);connect()}}
    const offline=()=>setConnected(false)
    window.addEventListener('online',online);window.addEventListener('offline',offline)
    document.addEventListener('visibilitychange',visibilityChanged)
    window.addEventListener('pageshow',visibilityChanged)
    void heartbeat(); void refresh(); connect()
    const poll = window.setInterval(() => void refresh(), 5000)
    return () => { stopped = true;window.removeEventListener('online',online);window.removeEventListener('offline',offline);document.removeEventListener('visibilitychange',visibilityChanged);window.removeEventListener('pageshow',visibilityChanged); socket?.close(); window.clearInterval(poll); window.clearInterval(heartbeatTimer); window.clearTimeout(reconnect); setConnected(false) }
  }, [connection])
  const join = async (joinCode: string, name: string) => {
    setBusy(true); setError('');setConnectionError('')
    try {
      const result = await api<{ token: string; sessionId: string; name: string }>('/api/participants/join', undefined, { joinCode: joinCode.trim(), name: name.trim() })
      setConnection({ token: result.token, sessionId: result.sessionId, joinCode: joinCode.trim().toUpperCase(), name: result.name })
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not join class.') }
    finally { setBusy(false) }
  }
  const leave = async () => {
    if (!connection) return
    setBusy(true)
    try { await api('/api/student/leave', connection.token, {}); sessionStorage.removeItem(key); setConnection(null); setError('') }
    catch (e) { if (e instanceof StudentError && e.status === 401) { sessionStorage.removeItem(key); setConnection(null) } else setError(e instanceof Error ? e.message : 'Could not leave.') }
    finally { setBusy(false) }
  }
  const sendMessage = async (text: string) => {
    if (!connection) return
    try { await api('/api/student/messages', connection.token, { text }); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Message failed.'); throw e }
  }
  const finishActivity = async (progressId: string) => {
    if (!connection) return
    setBusy(true); setError('')
    try { await api('/api/student/activities/finish', connection.token, { progressId }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not finish the exercise.') }
    finally { setBusy(false) }
  }
  const requestHelp = async (text: string) => {
    if (!connection) return
    try { await api('/api/student/help', connection.token, { text }); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not request help.'); throw e }
  }
  return { requestHelp, connection, state, error:error||connectionError, busy, connected, messages, join, leave, sendMessage, finishActivity }
}
