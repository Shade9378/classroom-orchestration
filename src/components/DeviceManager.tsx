import {requestJson} from '../state/http'
import { useActionFeedback } from './ActionFeedback'
import {deviceRequirementWarning,groupHardwareAssignment} from '../state/hardware'
import {deviceVitalRows,deviceSensorReadings} from '../devices/vitals'
import { useEffect,useRef,useState } from 'react'
import type { Activity,Device,Group,Playlist } from '../types'
import { Icon } from './Icon'
const request=<T,>(url:string,method='GET',body?:unknown)=>requestJson<T>(url,method,body,{timeoutMs:45000})
type Discovery={services:string[];devices:string[];serviceName:string}
type LocalDevice={id:string;name:string;type:string;mode:string;serviceName:string;remoteDeviceId:string;registered:boolean}
type Method={name:string;args:string[];description:string}
export function DeviceManager({sessionId,devices,groups,activities,playlists,selectedDeviceId,open,onClose,onChange}:{sessionId:string;devices:Device[];groups:Group[];activities:Activity[];playlists:Playlist[];selectedDeviceId?:string;open:boolean;onClose:()=>void;onChange:()=>Promise<void>}) {
  const notify = useActionFeedback()
  const dialog=useRef<HTMLDialogElement>(null)
  const [adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState('')
  const [mode,setMode]=useState<'iotscape'|'roboscape'>('iotscape'),[serviceName,setService]=useState(''),[remoteId,setRemote]=useState(''),[name,setName]=useState(''),[type,setType]=useState('Sensor')
  const [source,setSource]=useState<'local'|'registered'|'phoneiot'>('registered'),[localDevices,setLocalDevices]=useState<LocalDevice[]>([]),[localId,setLocalId]=useState('')
  const [localTesting,setLocalTesting]=useState(false)
  const [phonePassword,setPhonePassword]=useState('')
  const [discovery,setDiscovery]=useState<Discovery>({services:[],devices:[],serviceName:''})
  const path=`/api/sessions/${sessionId}/netsblox-devices`,active=devices.find(d=>d.id===selected)??devices[0]
  useEffect(()=>{if(open){dialog.current?.showModal();setError('');if(selectedDeviceId){setAdding(false);setSelected(selectedDeviceId)}else begin()}else {dialog.current?.close();setPhonePassword('')}},[open,selectedDeviceId])
  const run=async(action:()=>Promise<unknown>,confirmation?:string)=>{setBusy(true);setError('');try{await action();try{await onChange()}catch{setError('Operation completed, but the dashboard could not refresh. Reconnect to see the latest data.')}if(confirmation)notify(confirmation)}catch(e){setError(e instanceof Error?e.message:'Device operation failed.')}finally{setBusy(false)}}
  const discover=async(m:typeof mode,service='')=>{
    const result=await request<Discovery>(`${path}?mode=${m}${service?`&serviceName=${encodeURIComponent(service)}`:''}`)
    setDiscovery(previous=>({...result,services:m==='iotscape'&&service?previous.services:result.services}));setRemote('')
  }
  const alreadyConnected=(m:string,service:string,id:string)=>devices.some(d=>{
    const runtime=d.runtime
    return (d.status==='online'||d.status==='degraded')&&runtime?.mode===m&&runtime.serviceName===service&&(m==='iotscape'?runtime.remoteDeviceId===id:runtime.remoteDeviceId?.toLowerCase()===id.toLowerCase())
  })
  const refreshLocal=async()=>{const result=await request<{devices:LocalDevice[]}>(`${path}/local`);setLocalDevices(result.devices)}
  const beginPhone=(d?:Device)=>{setSource('phoneiot');setAdding(true);setRemote(d?.runtime?.remoteDeviceId??'');setName(d?.name??'Phone');setPhonePassword('');setError('')}
  const begin=()=>{setPhonePassword('');setAdding(true);setSource('registered');setLocalId('');setService('');setRemote('');setName('');setLocalTesting(false);void run(async()=>{const options=await request<{localDeviceTesting:boolean}>(`${path}/connection-options`);setLocalTesting(options.localDeviceTesting);await discover(mode)})}
  return <dialog ref={dialog} className="device-dialog" aria-labelledby="device-dialog-title" onCancel={onClose} onClose={onClose}>
    <header className="device-dialog-header"><h2 id="device-dialog-title">{adding?'Connect device':'Classroom devices'}</h2><button className="icon-btn" aria-label="Close device window" onClick={onClose}><Icon name="x"/></button></header>
    {error&&<div className="api-error" role="alert"><p className="api-error-message">{error}</p></div>}
    <div className="device-dialog-body">
    {!adding&&<div className="device-window-actions"><button className="primary-btn small" disabled={busy} onClick={begin}><Icon name="plus" size={16}/> Connect device</button></div>}
    {adding?<form onSubmit={e=>{e.preventDefault();void run(async()=>{const d=source==='phoneiot'?await request<{id:string}>(`${path}/phoneiot`,'POST',{name,remoteDeviceId:remoteId,password:phonePassword}):source==='local'?await request<{id:string}>(`${path}/local/${localId}/connect`,'POST',{name}):await request<{id:string}>(path,'POST',{mode,serviceName:mode==='roboscape'?'RoboScape':serviceName,remoteDeviceId:remoteId,name,type:mode==='roboscape'?'Robot':type});setSelected(d.id);setAdding(false);setPhonePassword('')},(name||'Device')+' connected to classroom.')}}>
      <div className="device-connect-fields panel-scroll-body">
      <label>Device source<select aria-label="Device source" value={source} disabled={busy} onChange={e=>{const next=e.target.value as typeof source;setSource(next);setName(next==='phoneiot'?'Phone':'');setRemote('');setPhonePassword('');if(next!=='phoneiot')void run(()=>next==='local'?refreshLocal():discover(mode))}}><option value="registered">Registered with RoboScape or IoTScape</option><option value="phoneiot">PhoneIoT (device ID and password)</option>{localTesting&&<option value="local">Local simulators (testing only)</option>}</select></label>
      {source==='phoneiot'?<>
        <p>Open PhoneIoT on the phone, tap Connect, then enter the ID and password shown in its menu.</p>
        <div className="device-form-grid">
          <label>Device ID<input aria-label="PhoneIoT device ID" required maxLength={128} autoComplete="off" value={remoteId} onChange={e=>setRemote(e.target.value)}/></label>
          <label>Password<input aria-label="PhoneIoT password" type="password" required maxLength={128} autoComplete="off" value={phonePassword} onChange={e=>setPhonePassword(e.target.value)}/></label>
          <label>Name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label>
        </div>
        <small>The password is used to authenticate with NetsBlox and is not saved in the classroom database. Re-enter it after the API restarts.</small>
      </>:source==='local'?<div className="device-form-grid">
        <label>Device<select aria-label="Nearby device" value={localId} required disabled={busy} onChange={e=>{setLocalId(e.target.value);setName(localDevices.find(d=>d.id===e.target.value)?.name??'')}}><option value="">Choose a device</option>{localDevices.filter(d=>!alreadyConnected(d.mode,d.serviceName,d.remoteDeviceId)).map(d=><option key={d.id} value={d.id}>{d.name} - {d.type}</option>)}</select></label>
        <label>Name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label>
      </div>:<>

      <div className="device-form-grid">
        <label>Registered service<select aria-label="NetsBlox service" value={mode} disabled={busy} onChange={e=>{const m=e.target.value as typeof mode;setMode(m);setService('');setDiscovery({services:[],devices:[],serviceName:''});void run(()=>discover(m))}}><option value="iotscape">IoTScape (sensors and other devices)</option><option value="roboscape">RoboScape (robots)</option></select></label>
        {mode==='iotscape'&&<label>IoTScape service<select aria-label="IoTScape service" required value={serviceName} disabled={busy} onChange={e=>{setService(e.target.value);void run(()=>discover(mode,e.target.value))}}><option value="">Choose a service</option>{discovery.services.map(s=><option key={s}>{s}</option>)}</select></label>}
        <label>Device ID<select aria-label="Device ID" required value={remoteId} disabled={busy} onChange={e=>{setRemote(e.target.value);if(!name)setName(e.target.value)}}><option value="">Choose a device</option>{discovery.devices.filter(id=>!alreadyConnected(mode,mode==='roboscape'?'RoboScape':serviceName,id)).map(id=><option key={id} value={id}>{id}</option>)}</select></label>
        <label>Name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label>
        {mode==='iotscape'&&<label>Type<select aria-label="Type" value={type} onChange={e=>setType(e.target.value)}><option>Sensor</option><option>Phone</option><option>Other</option></select></label>}
      </div>
      </>}
      </div>
      <div className="device-window-actions"><button className="primary-btn" disabled={busy||(source==='local'?!localId:!remoteId)||(source==='phoneiot'&&!phonePassword)}>{busy?'Connecting...':'Connect'}</button>{source!=='phoneiot'&&<button type="button" className="secondary-btn" disabled={busy} onClick={()=>void run(()=>source==='local'?refreshLocal():discover(mode,serviceName),'Device list refreshed.')}>Refresh discovery</button>}<button type="button" className="secondary-btn" onClick={()=>{setAdding(false);setPhonePassword('')}}>Cancel</button></div>
    </form>:<div className="device-workbench">
      <nav className="device-list" aria-label="Device list">{devices.map(d=><button key={d.id} className={active?.id===d.id?'selected':''} onClick={()=>setSelected(d.id)}><span className={`status-dot ${d.status}`}/><span><strong>{d.name}</strong><small>{d.type} - {d.runtime?.serviceName??'Legacy connection'}</small></span></button>)}</nav>
      {active&&<section className="device-inspector" key={active.id} aria-label={`${active.name} details`}>
        <h3>{active.name}</h3><p>{active.runtime?.serviceName} {active.runtime?.remoteDeviceId&&<>- Device ID: <code>{active.runtime.remoteDeviceId}</code></>}</p>
        <div className="device-metadata"><span className={`status-pill ${active.status==='online'?'running':active.status==='degraded'?'degraded':'idle'}`}>{active.runtime?.state??active.status}</span><span>Latency: {active.latencyMs??'-'} ms</span></div>
        {active.control&&<p role="status">Controlled by {active.control.name} <button type="button" className="secondary-btn small" disabled={busy} onClick={()=>void run(()=>request(`${path}/${active.id}/release-control`,'POST',{}),active.name+' ('+active.type+') control released.')}>Release student control</button></p>}
        <p className="device-capabilities">{active.capabilities?.join(' - ')??active.capability}</p>
        <div className="device-window-actions">
          {active.runtime?.serviceName&&<button type="button" className="secondary-btn small" disabled={busy} onClick={()=>void run(()=>request(`${path}/${active.id}/identify`,'POST'),active.name+' ('+active.type+'): identification starts in 10 seconds.')}>Identify device</button>}
          {active.runtime?.serviceName&&<button className="secondary-btn small" disabled={busy} onClick={()=>{if(active.runtime?.mode==='phoneiot'&&active.status!=='online')beginPhone(active);else void run(()=>request(`${path}/${active.id}/connection`,'POST',{connected:active.runtime?.state==='paused'||active.status!=='online'}),active.name+' ('+active.type+') '+(active.status==='online'?'disconnected.':'reconnection requested.'))}}>{active.status==='online'?'Disconnect':active.runtime?.mode==='phoneiot'?'Reconnect phone':'Reconnect device'}</button>}
          {active.assignedGroupId&&<button className="secondary-btn small" disabled={busy} onClick={()=>void run(()=>request(`/api/sessions/${sessionId}/device-assignments`,'DELETE',{deviceIds:[active.id]}),active.name+' ('+active.type+') unassigned.')}>Unassign device</button>}
          <button className="danger-btn small" disabled={busy} onClick={()=>void run(()=>request(`/api/sessions/${sessionId}/device-connections/${active.id}`,'DELETE'),active.name+' ('+active.type+') removed from classroom.')}><Icon name="trash" size={14}/> Remove</button>
        </div>
        <label>Assigned group<select aria-label="Device assigned group" value={active.assignedGroupId??''} disabled={busy} onChange={e=>{const groupId=e.target.value;if(!groupId){void run(()=>request(`/api/sessions/${sessionId}/device-assignments`,'DELETE',{deviceIds:[active.id]}),active.name+' ('+active.type+') unassigned.');return}const group=groups.find(g=>g.id===groupId),warning=deviceRequirementWarning([active],group?groupHardwareAssignment(group,activities,playlists):undefined);if(warning&&!window.confirm(warning))return;void run(()=>request(`/api/sessions/${sessionId}/device-assignments`,'POST',{groupId,deviceIds:[active.id]}),active.name+' ('+active.type+') assigned to '+(group?.name??'the group')+'.')}}><option value="">Unassigned</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <div className="device-inspector-body panel-scroll-body">
        {active.runtime?.serviceName&&<DeviceRpc id={active.id} path={path} mode={active.runtime.mode} busy={busy} run={run}/>}
        <section aria-label="Battery"><h4>Battery</h4><dl className="device-readings">{deviceVitalRows(active.runtime?.telemetry??{},active.batteryLevel).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
        <h4>Device readings</h4><small>{active.runtime?.sampledAt?`Last sample: ${new Date(active.runtime.sampledAt).toLocaleTimeString()}`:'No sample received yet.'}</small>
        <dl className="device-readings">{deviceSensorReadings(active.runtime?.telemetry??{}).map(([name,r])=><div key={name}><dt>{name}</dt><dd>{r.value} <small>{r.unit}</small></dd></div>)}</dl>
        </div>
      </section>}
    </div>}
    </div>
  </dialog>
}
function DeviceRpc({id,path,mode,busy,run}:{id:string;path:string;mode:string;busy:boolean;run:(f:()=>Promise<unknown>,confirmation?:string)=>Promise<void>}){
  const [methods,setMethods]=useState<Method[]>([]),[method,setMethod]=useState(''),[args,setArgs]=useState<Record<string,string>>({}),[result,setResult]=useState(''),[error,setError]=useState('')
  useEffect(()=>{let cancelled=false;void request<Method[]>(`${path}/${id}/methods`).then(m=>{if(!cancelled){setMethods(m);setMethod(m[0]?.name??'')}}).catch(e=>{if(!cancelled)setError(e.message)});return()=>{cancelled=true}},[id,path])
  const fields=methods.find(m=>m.name===method)?.args.filter(k=>k!=='id'&&k!=='robot'&&k!=='device')??[]
  return <form className="simulator-controls" onSubmit={e=>{e.preventDefault();void run(async()=>{const response=await request<{result:unknown}>(`${path}/${id}/rpc`,'POST',{method,args:Object.fromEntries(fields.map(k=>{const raw=args[k]??'';let value:unknown=raw;try{value=JSON.parse(raw)}catch{}return [k,value]}))});setResult(JSON.stringify(response.result))},method+' command completed.')}}>
    <h4>NetsBlox RPC</h4>{error&&<p role="alert">{error}</p>}
    <label>RPC<select aria-label="RPC" value={method} onChange={e=>{setMethod(e.target.value);setArgs({})}}>{methods.map(m=><option key={m.name}>{m.name}</option>)}</select></label>
    {fields.map(field=><label key={field}>{field}<input required value={args[field]??''} placeholder={mode==='roboscape'?'get range':''} onChange={e=>setArgs({...args,[field]:e.target.value})}/></label>)}
    {mode==='roboscape'&&<small>Commands: get range - get ticks - set speed 20 20 - set speed 0 0</small>}
    <button className="secondary-btn small" disabled={busy||!method}>Call RPC</button>{result&&<output aria-label="RPC result">{result}</output>}
  </form>
}
