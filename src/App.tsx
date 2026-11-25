import { DeviceIdentification } from './components/DeviceIdentification'
import './styles/laptop-layout.css'
import './styles/panel-scrolling.css'
import { getClassroomAlerts, alertFingerprint, canDismissAlert, type ClassroomAlert } from './state/classroomAlerts'
import { ClassroomNotifications } from './components/ClassroomNotifications'
import {usePageState} from './state/usePageState'
import { DeviceManager } from './components/DeviceManager'
import { useEffect, useState } from 'react'
import { TopNav, type MainView } from './components/TopNav'
import { LiveClassroom } from './pages/LiveClassroom'
import { ActivitiesPlaylists } from './pages/ActivitiesPlaylists'
import { GroupAssignments } from './pages/GroupAssignments'
import { useActivityTests } from './state/useActivityTests'
import { useClassroom } from './state/useClassroom'

export default function App() {
  useEffect(()=>{localStorage.removeItem('classroom.layout.v1')},[])
  const [deviceOpen,setDeviceOpen]=useState(false)
  const [deviceDetailsId,setDeviceDetailsId]=useState<string|undefined>()
  const openDevice=(id?:string)=>{setDeviceDetailsId(id);setDeviceOpen(true)}
  const [view,setView]=usePageState<MainView>('view','activities',['live','activities','groups'])
  const [pendingDismissals, setPendingDismissals] = useState(new Set<string>())
  const [alertTarget,setAlertTarget]=useState<{groupId?:string; chat?:boolean}|null>(null)
  const [unsavedLibrary,setUnsavedLibrary]=useState(false)
  const confirmLeaveLibrary=()=>!unsavedLibrary||window.confirm('You have unsaved changes. Leave without saving?')
  const [teacherName,setTeacherName]=useState('')
  const [createAccount,setCreateAccount]=useState(false)
  const [password, setPassword] = useState('')
  const [name, setName] = useState('Classroom session')
  const classroom = useClassroom()
  const { state, pending, loaded } = classroom
  const activityTests = useActivityTests(state.session?.status === 'open' ? state.session.id : '', state.groups, state.activities)
  const openAlerts = (groupId?: string, chat = false) => {
    if (view !== 'live' && !confirmLeaveLibrary()) return
    setView('live')
    setAlertTarget({ groupId, chat })
  }
  const allClassroomAlerts = getClassroomAlerts({
    activities: state.activities, devices: state.devices, groups: state.groups,
    sessionOpen: state.session?.status === 'open',
    onReplacement: classroom.actions.reviewDeviceReplacement,
    onReview: openAlerts,
    onOpenChat: groupId => openAlerts(groupId, true),
  })
  const dismissalScope = state.session?.id
  const activeWarningKeys = JSON.stringify(allClassroomAlerts.filter(canDismissAlert).map(alertFingerprint))
  const confirmedDismissals = JSON.stringify(state.dismissedWarningKeys ?? [])
  useEffect(() => {
    const active = new Set<string>(JSON.parse(activeWarningKeys))
    const confirmed = new Set<string>(JSON.parse(confirmedDismissals))
    setPendingDismissals(previous => {
      const remaining = [...previous].filter(key => {
        const [sessionId, fingerprint] = JSON.parse(key) as [string | null, string]
        return sessionId === dismissalScope && active.has(fingerprint) && !confirmed.has(fingerprint)
      })
      return remaining.length === previous.size ? previous : new Set(remaining)
    })
  }, [dismissalScope, activeWarningKeys, confirmedDismissals])
  const dismissalKey = (alert: ClassroomAlert) => JSON.stringify([state.session?.id, alertFingerprint(alert)])
  const classroomAlerts = allClassroomAlerts.filter(alert => !canDismissAlert(alert)
    || (!state.dismissedWarningKeys?.includes(alertFingerprint(alert)) && !pendingDismissals.has(dismissalKey(alert))))
  const dismissAlert = async (alert: ClassroomAlert) => {
    if (!canDismissAlert(alert)) return
    const key = dismissalKey(alert)
    setPendingDismissals(previous => new Set([...previous, key]))
    try {
      if (alert.dismiss) await alert.dismiss()
      else await classroom.actions.dismissWarning(alertFingerprint(alert))
    } catch (error) {
      setPendingDismissals(previous => {
        const next = new Set(previous)
        next.delete(key)
        return next
      })
      throw error
    }
  }
  if (!classroom.auth?.authenticated) return <main className="page-shell">
    <section className="teacher-auth">
      <h1>{createAccount ? 'Create teacher account' : 'Teacher log in'}</h1>
      <div className="teacher-auth-options" role="tablist" aria-label="Teacher access">
        <button type="button" role="tab" aria-selected={!createAccount} className={!createAccount?'primary-btn small':'secondary-btn small'} disabled={!!pending} onClick={()=>{setCreateAccount(false);setPassword('');classroom.dismissError()}}>Log in</button>
        <button type="button" role="tab" aria-selected={createAccount} className={createAccount?'primary-btn small':'secondary-btn small'} disabled={!!pending} onClick={()=>{setCreateAccount(true);setPassword('');classroom.dismissError()}}>Create account</button>
      </div>
      {classroom.error && <p role="alert">{classroom.error}</p>}
      {!classroom.auth ? <>{classroom.error ? <button type="button" className="secondary-btn" disabled={!!pending} onClick={()=>void classroom.retryAuth()}>Retry connection</button> : <p>Loading teacher access...</p>}</> : <form onSubmit={e=>{e.preventDefault();void classroom.signIn(teacherName,password,createAccount)}}>
        <label>Name <input name="username" autoComplete="username" maxLength={100} required value={teacherName} onChange={e=>setTeacherName(e.target.value)} /></label>
        <label>Password <input type="password" autoComplete={createAccount?'new-password':'current-password'} minLength={createAccount?8:1} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)} /></label>
        {createAccount && <small>Use at least 8 characters for your password.</small>}
        <button className="primary-btn" disabled={!!pending}>{createAccount?'Create account':'Log in'}</button>
      </form>}
    </section>
  </main>
  return <div className="app classroom-app">
    {loaded && state.session && <DeviceIdentification key={state.session.id} sessionId={state.session.id}/>}
    {loaded && state.session && <ClassroomNotifications onDismissAlert={dismissAlert} key={state.session.id} alerts={classroomAlerts} busy={!!pending} onViewAlerts={() => openAlerts()}/>}
    <TopNav view={view} onChange={next=>{if(next!==view&&confirmLeaveLibrary())setView(next)}} teacherName={classroom.auth.name} pending={!!pending} onSignOut={()=>{if(confirmLeaveLibrary()){setPassword('');void classroom.signOut()}}} />
    <section className="session-bar" aria-label="Classroom session">
      <form onSubmit={e => { e.preventDefault(); if(!confirmLeaveLibrary())return; void classroom.createSession(name).catch(() => {}) }}>
        <input aria-label="Session name" value={name} onChange={e => { setName(e.target.value); classroom.dismissError() }} maxLength={100} required />
        <button className="primary-btn small" disabled={!!pending}>Create session</button>
      </form>
      <select disabled={!!pending} aria-label="Select session" value={classroom.activeId} onChange={e => {if(confirmLeaveLibrary())classroom.setActiveId(e.target.value)}}>
        <option value="">Library only</option>
        {classroom.sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {state.session && <div className="session-controls">
        <span className="session-join">Join code <strong className="join-code" data-testid="join-code">{state.session.joinCode}</strong></span>
        <span className={`status-pill ${state.session.status === 'open' ? 'running' : 'idle'}`}>{state.session.status}</span>
        <div className="session-action-buttons">
        <button className="secondary-btn small" disabled={!!pending} onClick={() => void classroom.setSessionStatus(state.session?.status === 'open' ? 'closed' : 'open').catch(() => {})}>{state.session.status === 'open' ? 'Close session' : 'Reopen session'}</button>
        <button className="danger-btn small" disabled={!!pending} onClick={() => {
          if (confirmLeaveLibrary() && window.confirm(`Delete session "${state.session?.name}"? This permanently removes its students, groups, assignments, device connections, and events. Shared activities and playlists are kept.`)) {
            void classroom.deleteSession().catch(() => {})
          }
        }}>Delete session</button>
        </div>
      </div>}
    </section>
    {state.session && <DeviceManager key={state.session.id} sessionId={state.session.id} devices={state.devices} groups={state.groups} activities={state.activities} playlists={state.playlists} selectedDeviceId={deviceDetailsId} open={deviceOpen} onClose={()=>setDeviceOpen(false)} onChange={classroom.refresh}/>}
    {classroom.error && <div className="api-error" role="alert"><span className="api-error-message">{classroom.error}</span><button className="text-btn" onClick={classroom.dismissError}>Dismiss</button></div>}
    {!loaded ? <p className="page-shell">Loading classroom...</p> : <fieldset className="classroom-content" disabled={!!pending}>
      {view === 'live' && <LiveClassroom onSendMessage={classroom.actions.sendGroupMessage} onResolveHelp={classroom.actions.resolveHelp} onDismissAlert={dismissAlert} classroomAlerts={classroomAlerts} alertTarget={alertTarget} activityTests={activityTests} sessionOpen={state.session?.status === "open"} onReviewActivity={classroom.actions.reviewActivity} onManageDevices={()=>openDevice()} onOpenDevice={openDevice} sessionId={classroom.activeId} key={classroom.activeId} {...state} />}
      {view === 'activities' && <ActivitiesPlaylists busy={!!pending} onDirtyChange={setUnsavedLibrary} activities={state.activities} playlists={state.playlists} onSaveActivity={classroom.saveActivity} onSavePlaylist={classroom.savePlaylist} onDeleteActivity={classroom.deleteActivity} onDeletePlaylist={classroom.deletePlaylist} />}
      {view === 'groups' && (state.session ? <GroupAssignments onManageDevices={()=>openDevice()} onOpenDevice={openDevice} key={classroom.activeId} {...state} actions={classroom.actions} /> : <p className="page-shell">Create or select a classroom session to organize students and assign work.</p>)}
    </fieldset>}
  </div>
}
