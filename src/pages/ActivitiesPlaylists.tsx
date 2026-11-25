import { useActionFeedback } from '../components/ActionFeedback'
import {usePageState} from '../state/usePageState'
import {useDraftHistory} from '../state/useDraftHistory'
import {parseActivityTests, parseTestCases} from '../state/activityTests'
import {combineHardwareRequirements} from '../state/hardware'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Activity, Playlist } from '../types'
import { hardwareOptions } from '../devices/hardwareOptions'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'

type Props = {
  onDirtyChange?: (dirty:boolean)=>void
  busy?:boolean
  activities: Activity[]
  playlists: Playlist[]
  onDeleteActivity: (id: string) => Promise<void>
  onDeletePlaylist: (id: string) => Promise<void>
  onSaveActivity: (activity: Activity) => Promise<void>
  onSavePlaylist: (playlist: Playlist) => Promise<void>
}

const emptyActivity = (): Activity => ({
  id: crypto.randomUUID(),
  name: 'New Activity',
  description: '',
  starterProject: '',
  requirements: [],
  completionMethod: 'teacher',
  estimatedMinutes: 10,
  category: 'General',
})

const emptyPlaylist = (): Playlist => ({
  id: crypto.randomUUID(),
  name: 'New Playlist',
  description: '',
  activityIds: [],
})

function unusedName(base: string, items: { name: string }[]) {
  const names = new Set(items.map(item => item.name.trim().toLowerCase()))
  let candidate = base, suffix = 2
  while (names.has(candidate.trim().toLowerCase())) candidate = `${base} (${suffix++})`
  return candidate
}

function cloneActivity(a: Activity): Activity {
  return { ...a, requirements: a.requirements.map(r => ({ ...r })) }
}

function mergeServerFields<T extends {id:string}>(draft:T,previous:T,next:T,fields:(keyof T)[],working:T):T {
  if(draft.id!==next.id)return draft
  const merged={...draft}
  for(const field of fields)if(JSON.stringify(working[field])===JSON.stringify(previous[field])&&JSON.stringify(draft[field])===JSON.stringify(previous[field]))merged[field]=next[field]
  return merged
}

const activityValue=(a:Activity)=>JSON.stringify([a.name,a.description,a.starterProject,a.starterProjectName??'',a.requirements.map(r=>[r.id,r.capability,r.quantity]),a.completionMethod,a.testConfig??null,a.estimatedMinutes,a.category??'General'])
const playlistValue=(p:Playlist)=>JSON.stringify([p.name,p.description,p.activityIds])

export function ActivitiesPlaylists({ activities, playlists, onSaveActivity, onSavePlaylist, onDeleteActivity, onDeletePlaylist, onDirtyChange, busy=false }: Props) {
  const [mode,setMode]=usePageState<'activities'|'playlists'>('libraryTab','activities',['activities','playlists'])
  const [selectedActivityId,setSelectedActivityId]=usePageState('activity',activities[0]?.id??'',activities.map(a=>a.id))
  const [selectedPlaylistId,setSelectedPlaylistId]=usePageState('playlist',playlists[0]?.id??'',playlists.map(p=>p.id))
  const selectedActivity = activities.find(a => a.id === selectedActivityId)
  const selectedPlaylist = playlists.find(p => p.id === selectedPlaylistId)
  const [activityDraft,setActivityDraft,resetActivityDraft,undoActivity,rebaseActivity]=useDraftHistory<Activity>(()=>cloneActivity(selectedActivity??emptyActivity()),activityValue)
  const [playlistDraft,setPlaylistDraft,resetPlaylistDraft,undoPlaylist,rebasePlaylist]=useDraftHistory<Playlist>(()=>({...selectedPlaylist??emptyPlaylist(),activityIds:[...selectedPlaylist?.activityIds??[]]}),playlistValue)
  const activityBaseline=useRef(selectedActivity)
  const playlistBaseline=useRef(selectedPlaylist)
  useEffect(()=>{
    const previous=activityBaseline.current
    activityBaseline.current=selectedActivity
    if(!selectedActivity)return
    if(activityDraft.id!==selectedActivity.id){resetActivityDraft(cloneActivity(selectedActivity));return}
    if(previous?.id===selectedActivity.id&&activityValue(previous)!==activityValue(selectedActivity))rebaseActivity(value=>mergeServerFields(value,previous,selectedActivity,['name','description','starterProject','starterProjectName','requirements','completionMethod','testConfig','estimatedMinutes','category'],activityDraft))
  },[selectedActivity,activityDraft.id,resetActivityDraft,rebaseActivity])
  useEffect(()=>{
    const previous=playlistBaseline.current
    playlistBaseline.current=selectedPlaylist
    if(!selectedPlaylist)return
    if(playlistDraft.id!==selectedPlaylist.id){resetPlaylistDraft({...selectedPlaylist,activityIds:[...selectedPlaylist.activityIds]});return}
    if(previous?.id===selectedPlaylist.id&&playlistValue(previous)!==playlistValue(selectedPlaylist))rebasePlaylist(value=>mergeServerFields(value,previous,selectedPlaylist,['name','description','activityIds'],playlistDraft))
  },[selectedPlaylist,playlistDraft.id,resetPlaylistDraft,rebasePlaylist])
  const [activitySearch, setActivitySearch] = useState('')
  const [playlistSearch, setPlaylistSearch] = useState('')
  const flash = useActionFeedback()
  const [testError,setTestError]=useState('')
  const [starterError,setStarterError]=useState('')
  const saving=useRef(false)
  const [addHardware, setAddHardware] = useState(false)
  const [addActivityId, setAddActivityId] = useState('')
  const [draggedActivityId, setDraggedActivityId] = useState<string | null>(null)
  const activityDirty=!!selectedActivity&&activityValue(activityDraft)!==activityValue(selectedActivity)
  const playlistDirty=!!selectedPlaylist&&playlistValue(playlistDraft)!==playlistValue(selectedPlaylist)
  const dirty=activityDirty||playlistDirty
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false)},[dirty,onDirtyChange])
  useEffect(()=>{
    if(!dirty)return
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
    window.addEventListener('beforeunload',warn)
    return()=>window.removeEventListener('beforeunload',warn)
  },[dirty])
  const confirmDiscard=()=>{
    const changed=mode==='activities'?activityDirty:playlistDirty
    if(changed&&!window.confirm('You have unsaved changes. Leave without saving?'))return false
    if(changed&&mode==='activities'&&selectedActivity)resetActivityDraft(cloneActivity(selectedActivity))
    if(changed&&mode==='playlists'&&selectedPlaylist)resetPlaylistDraft({...selectedPlaylist,activityIds:[...selectedPlaylist.activityIds]})
    return true
  }
  const switchMode=(next:'activities'|'playlists')=>{
    if(next===mode)return
    if(confirmDiscard())setMode(next)
  }


  const uploadStarter=async(file?:File)=>{
    if(!file)return
    try {
      if(file.size>750000)throw new Error('Choose an XML file smaller than 750 KB.')
      const xml=await file.text(),doc=new DOMParser().parseFromString(xml,'text/xml')
      if(doc.getElementsByTagName('parsererror').length || !doc.getElementsByTagName('project').length || !['room','project','snapdata'].includes(doc.documentElement.tagName))throw new Error('Choose a NetsBlox project exported as XML.')
      setActivityDraft(draft=>({...draft,starterProject:xml,starterProjectName:file.name}));setStarterError('');flash('Starter project loaded. Save Changes to keep it.')
    }catch(e){setStarterError(e instanceof Error?e.message:'Unable to read the file.')}
  }
  const uploadActivityId = useRef(activityDraft.id)
  uploadActivityId.current = activityDraft.id
  const uploadTestCases = async (file?: File) => {
    if (!file) return
    const id = activityDraft.id
    try {
      if (!file.name.toLowerCase().endsWith('.json')) throw new Error('Choose a JSON test-case file.')
      if (file.size > 64000) throw new Error('The test-case file must be smaller than 64 KB.')
      const text = (await file.text()).replace(/^\uFEFF/, '').trim()
      if (text.length > 16000) throw new Error('Test cases must fit within 16000 characters.')
      const cases = parseTestCases(text)
      const pretty = JSON.stringify(cases, null, 2)
      const serialized = pretty.length <= 16000 ? pretty : JSON.stringify(cases)
      if (serialized.length > 16000) throw new Error('Test cases must fit within 16000 characters.')
      if (uploadActivityId.current !== id) return
      setActivityDraft(draft => draft.id === id ? { ...draft, testConfig: { spec: draft.testConfig?.spec ?? '', cases: serialized } } : draft)
      setTestError('')
      flash(cases.length + ' test case' + (cases.length === 1 ? '' : 's') + ' loaded')
    } catch (error) {
      if (uploadActivityId.current === id) setTestError(error instanceof Error ? error.message : 'Could not read the test-case file.')
    }
  }


  const chooseActivity = (id: string) => {
    if(mode==='activities'&&id===selectedActivityId)return
    if(!confirmDiscard())return
    const next = activities.find(a => a.id === id)
    if (!next) return
    setMode('activities')
    setSelectedActivityId(id)
    resetActivityDraft(cloneActivity(next))
  }

  const choosePlaylist = (id: string) => {
    if(mode==='playlists'&&id===selectedPlaylistId)return
    if(!confirmDiscard())return
    const next = playlists.find(p => p.id === id)
    if (!next) return
    setMode('playlists')
    setSelectedPlaylistId(id)
    resetPlaylistDraft({ ...next, activityIds: [...next.activityIds] })
  }

  const createActivity = async () => {
    if(!confirmDiscard())return
    const next = { ...emptyActivity(), name: unusedName('New Activity', activities) }
    await onSaveActivity(next)
    setMode('activities')
    setSelectedActivityId(next.id)
    resetActivityDraft(next)
    flash('New activity created. Add details and save changes.')
  }

  const createPlaylist = async () => {
    if(!confirmDiscard())return
    const next = { ...emptyPlaylist(), name: unusedName('New Playlist', playlists) }
    await onSavePlaylist(next)
    setMode('playlists')
    setSelectedPlaylistId(next.id)
    resetPlaylistDraft(next)
    flash('New playlist created. Add activities and save.')
  }

  const saveActivity = async () => {
    const clean = {
      ...activityDraft,
      name: activityDraft.name.trim() || 'Untitled Activity',
      testConfig: activityDraft.completionMethod === 'project' && activityDraft.testConfig
        ? { ...activityDraft.testConfig, spec: activityDraft.testConfig.spec.trim() }
        : undefined,
      estimatedMinutes: Math.max(1, Number(activityDraft.estimatedMinutes) || 1),
    }
    if(saving.current||busy||!activityDirty)return
    setTestError('')
    if (clean.completionMethod === 'project') {
      try { parseActivityTests(clean.testConfig ?? { spec: '', cases: '' }) }
      catch (error) { setTestError((error as Error).message); return }
    }
    saving.current=true
    try{await onSaveActivity(clean);setActivityDraft(current=>activityValue(current)===activityValue(activityDraft)?clean:current);flash('Activity saved.')}finally{saving.current=false}
  }

  const savePlaylist = async () => {
    const clean = { ...playlistDraft, name: playlistDraft.name.trim() || 'Untitled Playlist', activityIds: playlistDraft.activityIds.filter(id => activities.some(a => a.id === id)) }
    if(saving.current||busy||!playlistDirty)return
    saving.current=true
    try{await onSavePlaylist(clean);setPlaylistDraft(current=>playlistValue(current)===playlistValue(playlistDraft)?{...clean,activityIds:[...clean.activityIds]}:current);flash('Playlist saved.')}finally{saving.current=false}
  }

  const deleteActivity = async () => {
    if (!selectedActivity) return
    if (!window.confirm(`Delete "${selectedActivity.name}"?`)) return
    const remaining = activities.filter(a => a.id !== selectedActivity.id)
    await onDeleteActivity(selectedActivity.id)
    resetPlaylistDraft(prev => ({ ...prev, activityIds: prev.activityIds.filter(id => id !== selectedActivity.id) }))
    const next = remaining[0]
    if (next) {
      setSelectedActivityId(next.id)
      resetActivityDraft(cloneActivity(next))
    } else {
      setSelectedActivityId('')
    }
    flash('Activity deleted.')
  }

  const deletePlaylist = async () => {
    if (!selectedPlaylist) return
    if (!window.confirm(`Delete "${selectedPlaylist.name}"?`)) return
    const remaining = playlists.filter(p => p.id !== selectedPlaylist.id)
    await onDeletePlaylist(selectedPlaylist.id)
    const next = remaining[0]
    if (next) {
      setSelectedPlaylistId(next.id)
      resetPlaylistDraft({ ...next, activityIds: [...next.activityIds] })
    } else {
      setSelectedPlaylistId('')
    }
    flash('Playlist deleted.')
  }

  const duplicateActivity = async () => {
    if(saving.current||busy)return
    const copy:Activity={...cloneActivity(activityDraft),id:crypto.randomUUID(),name:unusedName(`${activityDraft.name.trim().slice(0,80)||'Untitled Activity'} (Copy)`,activities),requirements:activityDraft.requirements.map(requirement=>({...requirement,id:crypto.randomUUID()})),testConfig:activityDraft.completionMethod==='project'&&activityDraft.testConfig?{...activityDraft.testConfig}:undefined}
    if(copy.completionMethod==='project'){
      try{parseActivityTests(copy.testConfig??{spec:'',cases:''})}catch(error){setTestError((error as Error).message);return}
    }
    saving.current=true
    try{await onSaveActivity(copy);setSelectedActivityId(copy.id);resetActivityDraft(copy);setTestError('');setStarterError('');flash('Activity duplicated.')}finally{saving.current=false}
  }

  const duplicatePlaylist = async () => {
    const copy: Playlist = { ...playlistDraft, id: crypto.randomUUID(), name: unusedName(`${playlistDraft.name} (Copy)`, playlists), activityIds: [...playlistDraft.activityIds] }
    await onSavePlaylist(copy)
    setSelectedPlaylistId(copy.id)
    resetPlaylistDraft(copy)
    flash('Playlist duplicated.')
  }

  const filteredActivities = activities.filter(a => `${a.name} ${a.description}`.toLowerCase().includes(activitySearch.toLowerCase()))
  const filteredPlaylists = playlists.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(playlistSearch.toLowerCase()))

  const currentPlaylistForActivity = useMemo(
    () => playlists.find(p => p.activityIds.includes(activityDraft.id)) ?? playlists[0],
    [playlists, activityDraft.id],
  )
  const [targetPlaylistId, setTargetPlaylistId] = useState(currentPlaylistForActivity?.id ?? '')
  const targetPlaylist = playlists.find(p => p.id === targetPlaylistId) ?? currentPlaylistForActivity

  const addCurrentActivityToPlaylist = async () => {
    if (!targetPlaylist || !selectedActivity) return
    await onSavePlaylist({ ...targetPlaylist, activityIds: [...new Set([...targetPlaylist.activityIds, activityDraft.id])] })
    setPlaylistDraft(prev => prev.id === targetPlaylist.id && !prev.activityIds.includes(activityDraft.id)
      ? { ...prev, activityIds: [...prev.activityIds, activityDraft.id] } : prev)
    flash(`Added ${activityDraft.name} to ${targetPlaylist.name}.`)
  }

  const movePlaylistItem = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= playlistDraft.activityIds.length || to >= playlistDraft.activityIds.length) return
    const ids = [...playlistDraft.activityIds]
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved)
    setPlaylistDraft(prev => ({ ...prev, activityIds: ids }))
  }

  const resourceSummary = useMemo(() => combineHardwareRequirements(
    playlistDraft.activityIds.flatMap(id=>{const activity=activities.find(a=>a.id===id);return activity?[activity]:[]}),
  ), [playlistDraft.activityIds, activities])

  useLayoutEffect(()=>{
    const shortcut=(event:KeyboardEvent)=>{
      if(!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey||event.isComposing||document.querySelector('dialog[open]'))return
      const key=event.key.toLowerCase()
      if(key==='s'){
        event.preventDefault()
        if(!busy)void (mode==='activities'?saveActivity():savePlaylist()).catch(()=>{})
      }else if(key==='z'&&event.target instanceof HTMLElement&&event.target.closest('.editor-panel,.playlist-editor')){
        event.preventDefault()
        if(!busy)(mode==='activities'?undoActivity:undoPlaylist)()
      }
    }
    window.addEventListener('keydown',shortcut)
    return()=>window.removeEventListener('keydown',shortcut)
  })

  return (
    <main className="page-shell activities-page">
      <div className="heading-actions">
        <button className="primary-btn" onClick={() => void createActivity().catch(() => {})}><Icon name="plus" /> New Activity</button>
        <button className="secondary-btn" onClick={() => void createPlaylist().catch(() => {})}><Icon name="plus" /> New Playlist</button>
      </div>

      {mode === 'activities' ? (
        <div className="activity-layout">
          <aside className="panel library-panel">
            <div className="segmented wide">
              <button className="selected" onClick={() => switchMode('activities')}>Activities</button>
              <button onClick={() => switchMode('playlists')}>Playlists</button>
            </div>
            <div className="library-title-row"><h2>Activities ({activities.length})</h2></div>
            <div className="search-box"><Icon name="search" size={18}/><input value={activitySearch} onChange={e => setActivitySearch(e.target.value)} placeholder="Search activities..."/></div>
            <div className="library-list">
              {filteredActivities.length ? filteredActivities.map((a, i) => (
                <button key={a.id} className={`library-item ${a.id === selectedActivityId ? 'active' : ''}`} onClick={() => chooseActivity(a.id)}>
                  <span className="item-icon"><Icon name={a.category === 'Phone' ? 'phone' : a.category === 'Sensor' ? 'sensor' : 'robot'} size={28}/></span>
                  <span className="item-copy"><strong>{i + 1}. {a.name}</strong><span>{a.description}</span><span className="chip-row">{a.requirements.slice(0,2).map(r => <span className="chip" key={r.id}>{r.capability.replace(' (RoboScape)','')}</span>)}</span></span>
                  <Icon name="chevron" size={20}/>
                </button>
              )) : <EmptyState compact title={activities.length ? 'No matching activities' : 'No activities yet'} message={activities.length ? 'Try a different search.' : 'Create an activity to get started.'} />}
            </div>
          </aside>

          {selectedActivity ? <>
            <section className="panel editor-panel">
              <div className="editor-title-row"><h2>Edit Activity</h2><div className="button-row activity-editor-actions"><button type="button" className="secondary-btn" onClick={()=>void duplicateActivity().catch(()=>{})}><Icon name="copy" size={15}/> Duplicate</button><button type="button" className="danger-btn" onClick={() => void deleteActivity().catch(() => {})}><Icon name="trash" size={15}/> Delete Activity</button><button className="primary-btn" disabled={!activityDirty} title="Save changes (Ctrl+S)" aria-keyshortcuts="Control+s Meta+s" onClick={() => void saveActivity().catch(() => {})}>Save Changes</button></div></div>
              <div className="activity-editor-fields panel-scroll-body" tabIndex={0} aria-label="Activity settings">
              <label className="field-label">Activity Name <span>*</span></label>
              <input className="text-input" value={activityDraft.name} onChange={e => setActivityDraft({ ...activityDraft, name: e.target.value })}/>

              <label className="field-label">Description / Instructions <span>*</span></label>
              <div className="textarea-wrap"><textarea value={activityDraft.description} maxLength={500} onChange={e => setActivityDraft({ ...activityDraft, description: e.target.value })}/><small>{activityDraft.description.length}/500</small></div>

              <label className="field-label">Starter Project</label>
              <div className="file-row">
                <Icon name="file" size={26}/>
                <div className="file-name"><strong>{activityDraft.starterProjectName || (activityDraft.starterProject.trim().startsWith('<')?'NetsBlox starter.xml':activityDraft.starterProject) || 'No starter project selected'}</strong><span>NetsBlox project file</span></div>
                {activityDraft.starterProject ? <>
                  <label className="secondary-btn small file-picker">Replace<input type="file" accept=".xml" aria-label="Upload starter project" onChange={e => {void uploadStarter(e.target.files?.[0]);e.target.value=''}}/></label>
                  <button className="icon-btn" title="Remove starter project" onClick={() => setActivityDraft({ ...activityDraft, starterProject: '', starterProjectName:'' })}><Icon name="trash"/></button>
                </> :
                  <label className="secondary-btn small file-picker">Choose File<input type="file" accept=".xml" aria-label="Upload starter project" onChange={e => {void uploadStarter(e.target.files?.[0]);e.target.value=''}}/></label>
                }
              </div>

              <p className="helper">To add a starter project, export your NetsBlox project as XML, choose the file, then click Save Changes. Students start with this code when the activity begins.</p>
              {starterError && <p role="alert">{starterError}</p>}
              <div className="activity-settings-grid">
                <div className="hardware-time-settings">
              <label className="field-label hardware-title">Required Hardware <span>*</span></label>
              <p className="helper">Select the devices/capabilities needed for this activity.</p>
              {activityDraft.requirements.length > 0 && (
                <div className="requirements-list">
                  {activityDraft.requirements.map((req, index) => (
                    <div className="requirement-row" key={req.id}>
                      <Icon name={req.capability.includes('Phone') ? 'phone' : req.capability.includes('Sensor') ? 'sensor' : 'robot'} />
                      <select value={req.capability} onChange={e => setActivityDraft({ ...activityDraft, requirements: activityDraft.requirements.map((r,i) => i===index ? {...r, capability:e.target.value}:r) })}>{hardwareOptions.map(h => <option key={h}>{h}</option>)}</select>
                      <select value={req.quantity} onChange={e => setActivityDraft({ ...activityDraft, requirements: activityDraft.requirements.map((r,i) => i===index ? {...r, quantity:Number(e.target.value)}:r) })}>{[1,2,3,4].map(q => <option value={q} key={q}>{q}</option>)}</select>
                      <button className="danger-icon" aria-label="Remove hardware requirement" onClick={() => setActivityDraft({ ...activityDraft, requirements: activityDraft.requirements.filter((_,i) => i!==index) })}><Icon name="trash"/></button>
                    </div>
                  ))}
                </div>
              )}
              {addHardware ? (
                <div className="inline-add-row">
                  <select id="new-hardware-select" defaultValue={hardwareOptions[0]}>{hardwareOptions.map(h => <option key={h}>{h}</option>)}</select>
                  <button className="primary-btn small" onClick={() => {
                    const select = document.getElementById('new-hardware-select') as HTMLSelectElement
                    setActivityDraft({ ...activityDraft, requirements: [...activityDraft.requirements, { id: crypto.randomUUID(), capability: select.value, quantity: 1 }] })
                    setAddHardware(false)
                  }}>Add</button>
                  <button className="secondary-btn small" onClick={() => setAddHardware(false)}>Cancel</button>
                </div>
              ) : <button className="link-button hardware-add-button" onClick={() => setAddHardware(true)}><Icon name="plus"/> Add Hardware Requirement</button>}

              <label className="field-label">Estimated Time (minutes) <span>*</span></label>
              <input className="text-input estimated-time-input" type="number" min={1} required value={activityDraft.estimatedMinutes} onChange={e => setActivityDraft({...activityDraft, estimatedMinutes:Number(e.target.value)})}/>

                </div>
                <fieldset className="radio-group"><legend>Default Completion Method</legend><small>How should this activity be marked complete?</small>
                  <label><input type="radio" name="completion" checked={activityDraft.completionMethod === 'student'} onChange={() => setActivityDraft({...activityDraft,completionMethod:'student'})}/><span><b>Students agree to complete</b><em>Every student in the group must agree the exercise is complete before moving on. No teacher approval is needed.</em></span></label>
                  <label><input type="radio" name="completion" checked={activityDraft.completionMethod === 'teacher'} onChange={() => setActivityDraft({...activityDraft,completionMethod:'teacher'})}/><span><b>Teacher review</b><em>Finish sends the group's work to you for review. In Live Classroom, mark it complete or return it for changes.</em></span></label>
                  <label><input type="radio" name="completion" checked={activityDraft.completionMethod === 'project'} onChange={() => setActivityDraft({...activityDraft,completionMethod:'project'})}/><span><b>Test cases</b><em>When the group submits, check their code with your inputs and expected results. Every test must pass to mark the exercise complete.</em></span></label>
                  {activityDraft.completionMethod === 'project' && <div className="activity-test-config">
                    <p className="completion-help">Choose a custom block that returns a value, such as an average. Students must make this block available to all sprites in their project. The tests check the value returned by this block.</p>
                    <label>Block name and inputs
                      <input maxLength={300} value={activityDraft.testConfig?.spec ?? ''} placeholder="average %'numbers'" onChange={e => {
                        setTestError('')
                        setActivityDraft({ ...activityDraft, testConfig: { spec: e.target.value, cases: activityDraft.testConfig?.cases ?? '' } })
                      }} />
                    </label>
                    <small className="completion-help">For example, average %'numbers' accepts one input called numbers.</small>
                    <label>Test cases (JSON)
                      <textarea aria-label="Test cases (JSON)" rows={5} maxLength={16000} value={activityDraft.testConfig?.cases ?? ''} placeholder='[{"inputs":[[2,4,6]],"expected":4}]' onChange={e => {
                        setTestError('')
                        setActivityDraft({ ...activityDraft, testConfig: { spec: activityDraft.testConfig?.spec ?? '', cases: e.target.value } })
                      }} />
                    </label>
                    <small className="completion-help">Each case supplies inputs and an expected result. For example, the average of [2, 4, 6] should return 4.</small>
                    <div className="test-case-file-actions"><label className="secondary-btn small file-picker"><Icon name="upload" size={14}/> Upload JSON<input type="file" accept=".json,application/json" aria-label="Upload test cases" onChange={event => { void uploadTestCases(event.target.files?.[0]); event.currentTarget.value = '' }} /></label></div>
                    {testError && <small role="alert">{testError}</small>}
                  </div>}
                  <small className="completion-help">You can also mark any exercise complete yourself in Live Classroom.</small>
                </fieldset>
              </div>
              </div>
            </section>

            <aside className={`activity-side-column ${playlists.length === 0 ? 'empty-side-column' : ''}`}>
              <section className="panel compact-panel playlist-placement-panel">
                <h2>Add to Playlist</h2>
                {playlists.length ? <>
                  <div className="playlist-placement-fields">
                  <select className="text-input" value={targetPlaylist?.id ?? ''} onChange={e => setTargetPlaylistId(e.target.value)}>{playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  <label className="field-label">Position in Playlist</label>
                  <div className="text-input faux-input" title={targetPlaylist && targetPlaylist.activityIds.includes(activityDraft.id) ? `${targetPlaylist.activityIds.indexOf(activityDraft.id)+1}. ${activityDraft.name}` : 'End of playlist'}>{targetPlaylist && targetPlaylist.activityIds.includes(activityDraft.id) ? `${targetPlaylist.activityIds.indexOf(activityDraft.id)+1}. ${activityDraft.name}` : 'End of playlist'}</div>
                  </div>
                  <button className="primary-btn full-width add-to-playlist-btn" onClick={() => void addCurrentActivityToPlaylist().catch(() => {})}>Add to Playlist</button>
                </> : <EmptyState compact title="No playlists available" message="Create a playlist before adding this activity." />}
              </section>
              <section className="panel compact-panel playlist-preview">
                <div className="section-title-row"><h2>Playlist Preview</h2>{targetPlaylist && <button className="text-btn" onClick={() => choosePlaylist(targetPlaylist.id)}>Edit Playlist</button>}</div>
                {targetPlaylist ? <div className="preview-list">
                  {targetPlaylist.activityIds.length ? targetPlaylist.activityIds.map((id,index) => { const a=activities.find(x=>x.id===id); if(!a)return null; return <div key={id} className={`preview-row ${id===activityDraft.id?'highlight':''}`}><strong>{index+1}</strong><span><b>{a.name}</b><small>{a.description}</small></span></div> }) : <EmptyState compact title="Playlist is empty" />}
                </div> : <EmptyState compact title="No playlist selected" />}
              </section>
            </aside>
          </> : <>
            <section className="panel editor-panel empty-panel-center"><EmptyState title="No activity selected" message={activities.length ? 'Select an activity from the list to edit it.' : 'Create an activity to begin.'} /></section>
            <aside className="activity-side-column empty-side-column">
              <section className="panel compact-panel empty-panel-center"><EmptyState title="No activity selected" message="Select an activity before adding it to a playlist." /></section>
              <section className="panel compact-panel empty-panel-center"><EmptyState title="No playlist preview available" /></section>
            </aside>
          </>}
        </div>
      ) : (
        <div className={`playlist-layout ${selectedPlaylist ? '' : 'empty-playlist-layout'}`}>
          <aside className="panel library-panel playlist-library">
            <div className="segmented wide"><button onClick={() => switchMode('activities')}>Activities</button><button className="selected" onClick={() => switchMode('playlists')}>Playlists</button></div>
            <h2>Playlists ({playlists.length})</h2>
            <div className="search-box"><Icon name="search" size={18}/><input value={playlistSearch} onChange={e=>setPlaylistSearch(e.target.value)} placeholder="Search playlists..."/></div>
            <div className="library-list playlist-list">{filteredPlaylists.length ? filteredPlaylists.map(p => <button key={p.id} className={`playlist-card ${p.id===selectedPlaylistId?'active':''}`} onClick={()=>choosePlaylist(p.id)}><Icon name="book" size={28}/><span><strong>{p.name}</strong><small title={p.description}>{p.description}</small><em>{p.activityIds.length} activities</em></span><Icon name="chevron"/></button>) : <EmptyState compact title={playlists.length ? 'No matching playlists' : 'No playlists yet'} message={playlists.length ? 'Try a different search.' : 'Create a playlist to get started.'} />}</div>
          </aside>

          {selectedPlaylist ? <>
            <section className="panel playlist-editor">
              <div className="editor-title-row"><h2>Edit Playlist</h2><div className="button-row playlist-editor-actions"><button type="button" className="secondary-btn" onClick={() => void duplicatePlaylist().catch(() => {})}><Icon name="copy" size={15}/> Duplicate</button><button type="button" className="danger-btn" onClick={() => void deletePlaylist().catch(() => {})}><Icon name="trash" size={15}/> Delete Playlist</button><button className="primary-btn" disabled={!playlistDirty} title="Save playlist (Ctrl+S)" aria-keyshortcuts="Control+s Meta+s" onClick={() => void savePlaylist().catch(() => {})}>Save Playlist</button></div></div>
              <div className="playlist-metadata">
              <div><label className="field-label">Playlist Name <span>*</span></label>
              <input className="text-input" value={playlistDraft.name} onChange={e=>setPlaylistDraft({...playlistDraft,name:e.target.value})}/></div>
              <div><label className="field-label">Description <span className="optional">(optional)</span></label>
              <div className="textarea-wrap"><textarea value={playlistDraft.description} maxLength={500} onChange={e=>setPlaylistDraft({...playlistDraft,description:e.target.value})}/><small>{playlistDraft.description.length}/500</small></div></div>
              </div>

              <div className="playlist-items-title"><h2>Activities in This Playlist ({playlistDraft.activityIds.length})</h2><span><Icon name="clock" size={18}/> Estimated total time: ~{playlistDraft.activityIds.reduce((n,id)=>n+(activities.find(a=>a.id===id)?.estimatedMinutes??0),0)} min</span></div>
              {playlistDraft.activityIds.length ? (
                <div className="playlist-edit-list">
                  {playlistDraft.activityIds.map((id,index)=>{ const a=activities.find(x=>x.id===id); if(!a)return null; return <div
                    className={`playlist-edit-row ${draggedActivityId === id ? 'dragging' : ''}`}
                    key={id}
                    draggable
                    onDragStart={e=>{setDraggedActivityId(id);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',id)}}
                    onDragEnter={e=>{e.preventDefault();if(!draggedActivityId || draggedActivityId===id)return;const from=playlistDraft.activityIds.indexOf(draggedActivityId);if(from!==-1&&from!==index)movePlaylistItem(from,index)}}
                    onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move'}}
                    onDrop={e=>e.preventDefault()}
                    onDragEnd={()=>setDraggedActivityId(null)}
                  >
                    <span className="drag-handle" title="Drag to reorder"><Icon name="grip"/></span><strong>{index+1}</strong><Icon name={a.category==='Phone'?'phone':a.category==='Sensor'?'sensor':'robot'} size={23}/><span className="grow"><b title={a.name}>{a.name}</b><small>{a.description}</small></span><span className="time"><Icon name="clock" size={16}/> ~{a.estimatedMinutes} min</span><button className="small secondary-btn" onClick={()=>chooseActivity(a.id)}>Edit</button><button className="danger-icon" aria-label={`Remove ${a.name} from playlist`} onClick={()=>setPlaylistDraft({...playlistDraft,activityIds:playlistDraft.activityIds.filter((_,i)=>i!==index)})}><Icon name="trash"/></button>
                    <div className="playlist-order-actions"><button type="button" className="secondary-btn small" aria-label={`Move ${a.name} up`} disabled={index===0} onClick={()=>movePlaylistItem(index,index-1)}><Icon name="chevron" className="move-up" size={16}/> Move up</button><button type="button" className="secondary-btn small" aria-label={`Move ${a.name} down`} disabled={index===playlistDraft.activityIds.length-1} onClick={()=>movePlaylistItem(index,index+1)}><Icon name="chevron" className="move-down" size={16}/> Move down</button></div>
                  </div>})}
                </div>
              ) : <EmptyState compact title="No activities in this playlist" message="Add an activity below to begin building the playlist." />}

              <div className="add-activity-bar">
                <select value={addActivityId} onChange={e=>setAddActivityId(e.target.value)} disabled={!activities.some(a=>!playlistDraft.activityIds.includes(a.id))}><option value="">Choose activity to add...</option>{activities.filter(a=>!playlistDraft.activityIds.includes(a.id)).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
                <button className="link-button" disabled={!addActivityId} onClick={()=>{if(addActivityId){setPlaylistDraft({...playlistDraft,activityIds:[...playlistDraft.activityIds,addActivityId]});setAddActivityId('')}}}><Icon name="plus"/> Add Activity to Playlist</button>
              </div>


            </section>
            <section className="panel compact-panel playlist-resource-panel">
              <h2><Icon name="device" size={18}/> Resource Summary</h2>
              <p className="muted">Maximum devices needed at once across this playlist.</p>
              <div className="resource-cards">{resourceSummary.length ? resourceSummary.map(requirement => <div className="resource-card" key={requirement.id}><Icon name={/phone|tablet/i.test(requirement.capability) ? 'phone' : /robot|roboscape/i.test(requirement.capability) ? 'robot' : 'sensor'} size={22}/><span><b>{requirement.capability}</b><small>{requirement.quantity} {requirement.quantity === 1 ? 'device' : 'devices'} required</small></span></div>) : <EmptyState compact title="No hardware required" />}</div>
            </section>
          </> : <>
            <section className="panel playlist-editor empty-panel-center"><EmptyState title="No playlist selected" message={playlists.length ? 'Select a playlist from the list to edit it.' : 'Create a playlist to begin.'} /></section>
            <section className="panel compact-panel playlist-resource-panel empty-panel-center"><EmptyState compact title="No resource summary available" /></section>
          </>}
        </div>
      )}

    </main>
  )
}
