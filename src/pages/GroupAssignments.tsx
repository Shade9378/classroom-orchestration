import {usePageState} from '../state/usePageState'
import { useEffect, useState } from 'react'
import { missingHardwareRequirements,deviceRequirementWarning,groupHardwareAssignment } from '../state/hardware'
import type { Activity, AutoDeviceAssignmentResult, Device, Group, Playlist, Student } from '../types'
import { Icon } from '../components/Icon'
import { StudentRoster } from '../components/StudentRoster'
import { EmptyState } from '../components/EmptyState'

type Props = {
  onManageDevices?:()=>void
  onOpenDevice?:(id:string)=>void
  activities: Activity[]
  playlists: Playlist[]
  students: Student[]
  devices: Device[]
  groups: Group[]
  actions: {
    resetEditor:(groupId:string)=>Promise<void>
    removeStudent: (id:string)=>Promise<void>
    createGroup: (name: string) => Promise<{ id: string; name: string }>
    deleteGroup: (id: string) => Promise<void>
    deleteGroups: (ids:string[])=>Promise<void>
    autoGroupStudents: (participantIds:string[])=>Promise<void>
    unassignStudents: (participantIds:string[])=>Promise<void>
    moveStudents: (groupId: string, participantIds: string[]) => Promise<void>
    assignWork: (groupIds: string[], kind: 'activity'|'playlist', id: string) => Promise<void>
    removeWork: (groupId: string, kind: 'activity'|'playlist', id: string) => Promise<void>
    autoAssignDevices:(deviceIds:string[])=>Promise<AutoDeviceAssignmentResult>
    unassignDevices:(deviceIds:string[])=>Promise<void>
    assignDevices: (groupId: string, deviceIds: string[]) => Promise<void>
  }
}

export function GroupAssignments({ activities, playlists, students, devices, groups, actions, onManageDevices, onOpenDevice }: Props) {
  const [subview,setSubview]=usePageState<'groups'|'resources'>('assignmentTab','groups',['groups','resources'])
  const [selectedStudents, setSelectedStudents] = useState<string[]>([])
  useEffect(()=>{setSelectedStudents(prev=>{const kept=prev.filter(id=>students.some(s=>s.id===id));return kept.length===prev.length?prev:kept})},[students])
  const [targetGroupId, setTargetGroupId] = useState('')
  const [assignKind, setAssignKind] = useState<'playlist'|'activity'>('playlist')
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(playlists[0]?.id ?? '')
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [selectedDevices, setSelectedDevices] = useState<string[]>([])
  useEffect(()=>{setSelectedDevices(prev=>{const kept=prev.filter(id=>devices.some(d=>d.id===id));return kept.length===prev.length?prev:kept})},[devices])
  const allDevicesSelected=devices.length>0&&devices.every(d=>selectedDevices.includes(d.id))
  const someDevicesSelected=!allDevicesSelected&&devices.some(d=>selectedDevices.includes(d.id))
  const [resourceTargetGroupId,setResourceTargetGroupId]=usePageState('resourceGroup','',['',...groups.map(g=>g.id)])
  const [autoAssigning,setAutoAssigning]=useState(false)
  const [autoResult,setAutoResult]=useState<AutoDeviceAssignmentResult|null>(null)
  const workRevision=JSON.stringify({groups:groups.map(g=>[g.id,g.assignedActivityIds,g.assignedPlaylistIds,g.activityId,g.playlistId]),activities:activities.map(a=>[a.id,a.requirements]),playlists:playlists.map(p=>[p.id,p.activityIds])})
  useEffect(()=>{setAutoResult(null)},[workRevision])
  const [search, setSearch] = useState('')

  const toggle = (id:string, list:string[], setter:(v:string[])=>void) => setter(list.includes(id) ? list.filter(x=>x!==id) : [...list,id])
  const titleCase = (value:string) => value.charAt(0).toUpperCase() + value.slice(1)
  const groupColorClass = (groupId?:string) => {
    if (!groupId) return 'group-color-none'
    const index = groups.findIndex(g=>g.id===groupId)
    return `group-color-${(Math.max(index,0)%4)+1}`
  }

  const createGroup = async (forWork=false) => {
    const max = groups.reduce((n, g) => Math.max(n, Number(g.name.match(/Group\s+(\d+)/i)?.[1] ?? 0)), 0)
    const group = await actions.createGroup(`Group ${max + 1}`)
    setTargetGroupId(group.id)
    if(forWork)setSelectedGroups([group.id])
  }
  const removeSelectedGroup = async (id=targetGroupId) => {
    if (!id) return
    await actions.deleteGroup(id)
    setSelectedGroups(prev => prev.filter(groupId => groupId !== id))
    if(resourceTargetGroupId===id)setResourceTargetGroupId('')
    setTargetGroupId(previous=>previous===id?'':previous)
  }

  const removeWorkGroups=async()=>{
    if(!selectedGroups.length)return
    const removed=[...selectedGroups]
    await actions.deleteGroups(removed)
    setSelectedGroups(previous=>previous.filter(id=>!removed.includes(id)))
    setTargetGroupId(previous=>removed.includes(previous)?'':previous)
    if(removed.includes(resourceTargetGroupId))setResourceTargetGroupId('')
  }

  const assignedPlaylistIdsFor = (g:Group) => g.assignedPlaylistIds ?? (g.playlistId ? [g.playlistId] : [])
  const assignedActivityIdsFor = (g:Group) => g.assignedActivityIds ?? (g.activityId && !g.playlistId ? [g.activityId] : [])


  const moveStudents = async () => {
    if (!targetGroupId || !selectedStudents.length) return
    await actions.moveStudents(targetGroupId, selectedStudents)
    setSelectedStudents([])
  }
  const autoGroupStudents = async () => {
    if(!selectedStudents.length || !groups.length)return
    await actions.autoGroupStudents(selectedStudents)
    setSelectedStudents([])
  }
  const unassignStudents = async () => {
    const assigned=selectedStudents.filter(id=>students.some(s=>s.id===id && s.groupId))
    if(!assigned.length)return
    await actions.unassignStudents(assigned)
    setSelectedStudents([])
  }
  const assignWork = async () => {
    if (!selectedAssignmentId || !selectedGroups.length) return
    await actions.assignWork(selectedGroups, assignKind, selectedAssignmentId)
  }
  const workUnassignTargets=groups.filter(g=>selectedGroups.includes(g.id)&&(assignKind==='playlist'?assignedPlaylistIdsFor(g):assignedActivityIdsFor(g)).includes(selectedAssignmentId))
  const unassignWork=async()=>{
    for(const group of workUnassignTargets)await actions.removeWork(group.id,assignKind,selectedAssignmentId)
  }
  const removeWork = async (groupId: string, kind: 'playlist'|'activity', id: string) => {
    await actions.removeWork(groupId, kind, id)
  }
  const assignDevices = async () => {
    if (!resourceTargetGroupId || !selectedDevices.length) return
    const target=groups.find(g=>g.id===resourceTargetGroupId)
    const activity=target?groupHardwareAssignment(target,activities,playlists):undefined
    const warning=deviceRequirementWarning(devices.filter(d=>selectedDevices.includes(d.id)),activity)
    if(warning&&!window.confirm(warning))return
    await actions.assignDevices(resourceTargetGroupId, selectedDevices)
    setSelectedDevices([])
  }

  const autoAssignDevices=async()=>{
    if(!selectedDevices.length||autoAssigning)return
    setAutoAssigning(true)
    setAutoResult(null)
    try{
      const result=await actions.autoAssignDevices(selectedDevices)
      setAutoResult(result)
      setSelectedDevices([])
    }finally{setAutoAssigning(false)}
  }
  const unassignDevices=async()=>{
    const assigned=selectedDevices.filter(id=>devices.some(d=>d.id===id&&d.assignedGroupId))
    if(!assigned.length)return
    await actions.unassignDevices(assigned)
    setSelectedDevices([])
  }

  const filteredStudents = students.filter(s=>s.name.toLowerCase().includes(search.toLowerCase()))
  const assignmentItems = assignKind==='playlist' ? playlists : activities

  const readiness = groups.map(g=>{
    const assignment=groupHardwareAssignment(g,activities,playlists)
    const groupDevices=devices.filter(d=>g.deviceIds.includes(d.id) || d.assignedGroupId===g.id)
    const requirements=assignment.requirements
    const missing = missingHardwareRequirements(requirements, groupDevices, true)
    const conflicts=groupDevices.filter(d=>d.assignedGroupId && d.assignedGroupId!==g.id)
    const unavailable=groupDevices.filter(d=>d.status!=='online')
    return {g,missing,conflicts,groupDevices,unavailable}
  })

  const selectedResourceGroup = groups.find(g => g.id === resourceTargetGroupId)
  const selectedResourceWork=selectedResourceGroup?[
    ...assignedPlaylistIdsFor(selectedResourceGroup).flatMap(id=>{const item=playlists.find(p=>p.id===id);return item?[{...item,kind:'Playlist' as const,icon:'list' as const}]:[]}),
    ...assignedActivityIdsFor(selectedResourceGroup).flatMap(id=>{const item=activities.find(a=>a.id===id);return item?[{...item,kind:'Activity' as const,icon:'file' as const}]:[]}),
  ]:[]

  const selectedResourceRequirements=selectedResourceGroup?groupHardwareAssignment(selectedResourceGroup,activities,playlists).requirements:[]

  return <main className="page-shell group-page">
    <div className="subnav">
      <button className={subview==='groups'?'active':''} onClick={()=>setSubview('groups')}>Groups &amp; Activities</button>
      <button className={subview==='resources'?'active':''} onClick={()=>setSubview('resources')}>Resource Allocation</button>
    </div>

    {subview==='groups' ? <div className="assignment-layout">
      <section className="panel assignment-column student-group-column">
        <div className="step-heading"><span className="step-number blue">1</span><div><h2>Students &amp; Groups</h2><p>Select students and assign them to a group</p></div><button className="secondary-btn small" disabled={!selectedStudents.length || !groups.length} title={!groups.length?'Create a group first':'Balance selected students across all groups'} onClick={()=>void autoGroupStudents().catch(()=>{})}>Auto Group</button></div>
        <div className="search-box"><Icon name="search" size={18}/><input placeholder="Search students..." value={search} onChange={e=>setSearch(e.target.value)}/><span>{students.length} students</span></div>

        {filteredStudents.length ? (
          <StudentRoster students={filteredStudents} groups={groups} selectedIds={selectedStudents} allSelected={students.length>0 && students.every(s=>selectedStudents.includes(s.id))} partiallySelected={selectedStudents.length>0 && selectedStudents.length<students.length} onSelectAll={checked=>setSelectedStudents(checked?students.map(s=>s.id):[])} onToggle={id=>toggle(id,selectedStudents,setSelectedStudents)} onRemove={actions.removeStudent} />
          ) : <EmptyState compact title={students.length ? 'No matching students' : 'No students available'} message={students.length ? 'Try a different search.' : 'Students will appear here after they join a classroom session.'} />}

        <div className="assignment-box">
          <div className="assignment-box-header">
            <div className="assignment-box-title">
              <h3><Icon name="users" size={18}/> Assign selected students to group</h3>
              <small>({selectedStudents.length} selected)</small>
            </div>
            <div className="group-management-actions">
              <button className="secondary-btn small" onClick={() => void createGroup().catch(() => {})}><Icon name="plus"/> New Group</button>
              <button className="danger-btn small" disabled={!targetGroupId} onClick={() => void removeSelectedGroup().catch(() => {})}><Icon name="trash"/> Remove Group</button>
            </div>
          </div>
          {groups.length ? <div className="group-choice-grid">{groups.map(g=><label className={`group-choice ${groupColorClass(g.id)} ${targetGroupId===g.id?'selected':''}`} key={g.id}><input type="radio" name="student-target" checked={targetGroupId===g.id} onChange={()=>setTargetGroupId(g.id)}/><span><b title={g.name}>{g.name}</b><small>{g.studentIds.length} students</small></span></label>)}</div> : <EmptyState compact title="No groups available" message="Create a group to start organizing students." />}
          <div className="student-membership-actions">
          <button className="primary-btn" disabled={!selectedStudents.length || !targetGroupId} onClick={() => void moveStudents().catch(() => {})}><Icon name="play"/> {targetGroupId ? `Move ${selectedStudents.length} Students to ${groups.find(g=>g.id===targetGroupId)?.name}` : 'Select a group'}</button>
          <button type="button" className="secondary-btn" disabled={!selectedStudents.some(id=>students.some(s=>s.id===id && s.groupId))} onClick={()=>void unassignStudents().catch(()=>{})}>Unassign</button>
          </div>
        </div>
      </section>

      <section className="panel assignment-column work-assignment-column">
        <div className="step-heading"><span className="step-number purple">2</span><div><h2>Assign Activities / Playlists</h2><p>Assign one or more activities or playlists to each group</p></div></div>
        <div className="segmented assignment-kind-tabs"><button className={assignKind==='playlist'?'selected':''} onClick={()=>{setAssignKind('playlist');setSelectedAssignmentId(playlists[0]?.id??'')}}>Playlists</button><button className={assignKind==='activity'?'selected':''} onClick={()=>{setAssignKind('activity');setSelectedAssignmentId(activities[0]?.id??'')}}>Single Activities</button></div>

        {assignmentItems.length ? <div className="assignment-list">{assignmentItems.map(item=><div className={`assignment-item ${selectedAssignmentId===item.id?'selected':''}`} key={item.id}>
          <label className="assignment-item-selector" title={`Select ${item.name}`}><input type="radio" name="work" aria-label={item.name} checked={selectedAssignmentId===item.id} onChange={()=>setSelectedAssignmentId(item.id)}/><Icon name={assignKind==='playlist'?'file':'robot'} size={24}/></label>
          <details className="assigned-work-text"><summary><b title={item.name}>{item.name}</b>{item.description&&<p>{item.description}</p>}<span className="assigned-work-expand"><span className="when-collapsed">View full</span><span className="when-expanded">Show less</span><Icon name="chevron" size={13}/></span></summary></details>
          <span className="meta">{assignKind==='playlist'?`${(item as Playlist).activityIds.length} activities`:`~${(item as Activity).estimatedMinutes} min`}</span>
        </div>)}</div> : <EmptyState compact title={assignKind==='playlist' ? 'No playlists available' : 'No activities available'} message={`Create a ${assignKind==='playlist'?'playlist':'activity'} in Activities & Playlists first.`} />}

        <div className="assignment-box">
          <div className="assignment-box-header">
            <div className="assignment-box-title">
              <h3><Icon name="users" size={18}/> Add to group(s)</h3>
              <small>({selectedGroups.length} selected)</small>
            </div>
            <div className="group-management-actions">
              <button className="secondary-btn small" onClick={()=>void createGroup(true).catch(()=>{})}><Icon name="plus"/> New Group</button>
              <button className="danger-btn small" disabled={!selectedGroups.length} title={!selectedGroups.length?'Select groups to remove':undefined} onClick={()=>void removeWorkGroups().catch(()=>{})}><Icon name="trash"/> {selectedGroups.length>1?'Remove Groups':'Remove Group'}</button>
            </div>
          </div>
          {groups.length ? <div className="group-choice-grid">{groups.map(g=><label className={`group-choice ${groupColorClass(g.id)} ${selectedGroups.includes(g.id)?'selected':''}`} key={g.id}><input type="checkbox" checked={selectedGroups.includes(g.id)} onChange={()=>toggle(g.id,selectedGroups,setSelectedGroups)}/><span><b title={g.name}>{g.name}</b><small>{g.studentIds.length} students</small></span></label>)}</div> : <EmptyState compact title="No groups available" />}
          <div className="work-assignment-actions">
          <button className="primary-btn" disabled={!selectedAssignmentId || !selectedGroups.length} onClick={() => void assignWork().catch(() => {})}><Icon name="plus"/> Add {assignKind==='playlist'?'Playlist':'Activity'} to {selectedGroups.length} Group{selectedGroups.length===1?'':'s'}</button>
          <button className="secondary-btn" disabled={!workUnassignTargets.length} title={`Unassign the selected ${assignKind} from ${workUnassignTargets.length} group(s)`} onClick={()=>void unassignWork().catch(()=>{})}>Unassign</button>
          </div>
        </div>
      </section>

      <section className="panel assignment-column preview-column">
        <div className="step-heading"><span className="step-number blue">3</span><div><h2>Assignment Preview</h2></div></div>
        {groups.length ? <div className="preview-groups">{groups.map(g=>{
          const assignedPlaylists = assignedPlaylistIdsFor(g).map(id=>playlists.find(p=>p.id===id)).filter((p): p is Playlist => Boolean(p))
          const assignedActivities = assignedActivityIdsFor(g).map(id=>activities.find(a=>a.id===id)).filter((a): a is Activity => Boolean(a))
          const assignmentCount = assignedPlaylists.length + assignedActivities.length
          return <div className={`assignment-preview-card ${groupColorClass(g.id)}`} key={g.id}>
            <div className="section-title-row">
              <div><h3><Icon name="users"/> {g.name}</h3><small>{g.studentIds.length} students</small></div>
              <span className={`status-pill ${assignmentCount?'running':'idle'}`}>{assignmentCount ? `${assignmentCount} Assigned` : 'Unassigned'}</span>
            </div>
            <button className="secondary-btn small" onClick={()=>{
              if(window.confirm(`Reset ${g.name} to the current activity's starter? This deletes this group's saved edits for that activity.`))void actions.resetEditor(g.id).catch(()=>{})
            }}>Reset to starter</button>
            {assignmentCount ? <div className="assigned-work-list">
              {assignedPlaylists.map(p=><div className="assignment-preview-content" key={`playlist-${p.id}`}>
                <Icon name="file"/>
                <details className="assigned-work-text"><summary><b title={p.name}>Playlist: {p.name}</b>{p.description&&<p>{p.description}</p>}<em>{p.activityIds.length} activities - ~{p.activityIds.reduce((n,id)=>n+(activities.find(a=>a.id===id)?.estimatedMinutes??0),0)} min</em><span className="assigned-work-expand"><span className="when-collapsed">View full</span><span className="when-expanded">Show less</span><Icon name="chevron" size={13}/></span></summary></details>
                <button className="remove-assignment-btn" title={`Remove ${p.name} from ${g.name}`} onClick={() => void removeWork(g.id,'playlist',p.id).catch(() => {})}><Icon name="trash" size={15}/> Remove</button>
              </div>)}
              {assignedActivities.map(a=><div className="assignment-preview-content" key={`activity-${a.id}`}>
                <Icon name="robot"/>
                <details className="assigned-work-text"><summary><b title={a.name}>Activity: {a.name}</b>{a.description&&<p>{a.description}</p>}<em>~{a.estimatedMinutes} min</em><span className="assigned-work-expand"><span className="when-collapsed">View full</span><span className="when-expanded">Show less</span><Icon name="chevron" size={13}/></span></summary></details>
                <button className="remove-assignment-btn" title={`Remove ${a.name} from ${g.name}`} onClick={() => void removeWork(g.id,'activity',a.id).catch(() => {})}><Icon name="trash" size={15}/> Remove</button>
              </div>)}
            </div> : <div className="assignment-preview-content empty"><Icon name="file"/><span><b>No work assigned</b><small>Add a playlist or activity to this group.</small></span></div>}
          </div>
        })}</div> : <EmptyState title="No groups to preview" message="Assignment information will appear here once groups are available." />}
      </section>
    </div> : <div className="resource-layout">
      <section className="panel resource-column device-pool-column">
        <div className="step-heading"><span className="step-number green">1</span><div><h2>Device Pool</h2><p>Select available hardware</p></div><button className="secondary-btn small" onClick={onManageDevices}><Icon name="plus" size={15}/> Connect device</button></div>
        <div className="search-box"><Icon name="search"/><input placeholder="Search devices..."/><span>{devices.length} devices</span></div>
        {devices.length ? <div className="resource-device-list">
          <div className="resource-device-row header"><span>Status</span><span className="resource-device-name"><input type="checkbox" aria-label="Select all devices" title="Select all devices" checked={allDevicesSelected} ref={node=>{if(node)node.indeterminate=someDevicesSelected}} onChange={e=>setSelectedDevices(e.target.checked?devices.map(d=>d.id):[])}/><span>Device name</span></span><span>Current group</span></div>
          {devices.map(d=><div className="resource-device-row resource-device-details" key={d.id} onClick={e=>{if(!(e.target as HTMLElement).closest('input,button'))onOpenDevice?.(d.id)}}>
            <span className={`device-status ${d.status}`}><span className={`status-dot ${d.status}`}></span>{titleCase(d.status)}</span>
            <span className="resource-device-name"><input type="checkbox" aria-label={`Select ${d.name}`} checked={selectedDevices.includes(d.id)} onChange={()=>toggle(d.id,selectedDevices,setSelectedDevices)}/><button type="button" className="device-name-trigger resource-device-label" aria-label={`View ${d.name} details`} onClick={()=>onOpenDevice?.(d.id)}><Icon name={d.type==='Phone'?'phone':d.type==='Robot'?'robot':'sensor'} size={17}/><span><b>{d.name}</b><small>{d.capability}</small></span></button></span>
            <span className={`group-tag ${groupColorClass(d.assignedGroupId)}`}>{d.assignedGroupId?groups.find(g=>g.id===d.assignedGroupId)?.name.replace('Group ','G'):'Unassigned'}</span>
          </div>)}
        </div> : <EmptyState title="No devices available" message="Connected classroom devices will appear in this pool." />}
      </section>

      <section className="panel resource-column">
        <div className="step-heading"><span className="step-number purple">2</span><div><h2>Assign Devices</h2><p>Assign selected devices to a group</p></div><button className="secondary-btn small" title="Match selected unassigned devices to each group's assigned activities and playlists" disabled={!selectedDevices.length || !groups.length || autoAssigning} onClick={()=>void autoAssignDevices().catch(()=>{})}>{autoAssigning?'Assigning...':'Auto-Assign'}</button></div>
        {autoResult&&<div className="selected-device-summary" role="status"><strong>{autoResult.assignedCount} device{autoResult.assignedCount===1?'':'s'} assigned.</strong>{autoResult.shortages.length?<><p>Still needed:</p><ul>{autoResult.shortages.map(s=><li key={s.groupId}>{s.groupName}: {s.requirements.map(r=>`${r.quantity}x ${r.capability}`).join(', ')}</li>)}</ul></>:<p>All assigned work requirements have assigned devices.</p>}</div>}
        <div className="assignment-box resource-assignment-box">
        <h3><Icon name="device" size={18}/> Assign selected devices to group</h3>
        {selectedDevices.length ? <div className="selected-device-summary"><strong>{selectedDevices.length} devices selected</strong><div>{selectedDevices.map(id=><span className="chip" key={id}>{devices.find(d=>d.id===id)?.name}</span>)}</div></div> : <div className="selected-device-summary empty-selected-device-summary"><strong>No devices selected</strong></div>}
        {groups.length ? <div className="group-choice-grid">{groups.map(g=><label className={`group-choice ${groupColorClass(g.id)} ${resourceTargetGroupId===g.id?'selected':''}`} key={g.id}><input type="radio" name="resource-target" checked={resourceTargetGroupId===g.id} onChange={()=>setResourceTargetGroupId(g.id)}/><span><b title={g.name}>{g.name}</b><small>{g.studentIds.length} students</small></span></label>)}</div> : <EmptyState compact title="No groups available" />}
        <div className="resource-assignment-actions"><button className="primary-btn full-width" disabled={!selectedDevices.length || !resourceTargetGroupId} onClick={() => void assignDevices().catch(() => {})}><Icon name="plus" size={18}/> {resourceTargetGroupId ? `Assign ${selectedDevices.length} Devices to ${groups.find(g=>g.id===resourceTargetGroupId)?.name}` : 'Select a group'}</button>

        <button className="secondary-btn full-width" disabled={!selectedDevices.some(id=>devices.some(d=>d.id===id&&d.assignedGroupId))} onClick={()=>void unassignDevices().catch(()=>{})}>Unassign selected devices</button></div>
        </div>
        <div className={`assignment-box selected-group-detail ${groupColorClass(selectedResourceGroup?.id)}`}>
          <h3><Icon name="group" size={18}/> Selected Group Details</h3>
          <div className={`selected-group-detail-body panel-scroll-body${selectedResourceGroup ? '' : ' empty-group-detail'}`}>
          {selectedResourceGroup ? <>
            <p><b>{selectedResourceGroup.name}</b> - {selectedResourceGroup.studentIds.length} members</p>
            <div className="detail-block assigned-work-detail">
              <div className="assigned-work-detail-header"><small>Assigned work</small><button type="button" className="secondary-btn small" aria-label={`Edit assigned work for ${selectedResourceGroup.name}`} onClick={()=>{setSelectedGroups([selectedResourceGroup.id]);setTargetGroupId(selectedResourceGroup.id);setSubview('groups')}}><Icon name="edit" size={14}/> Edit</button></div>
              {selectedResourceWork.length?<ul className="assigned-work-detail-list">{selectedResourceWork.map(item=><li key={`${item.kind}-${item.id}`}><Icon name={item.icon} size={17}/><details className="assigned-work-text"><summary><small>{item.kind}</small><b title={item.name}>{item.name}</b>{item.description&&<p>{item.description}</p>}<span className="assigned-work-expand"><span className="when-collapsed">View full</span><span className="when-expanded">Show less</span><Icon name="chevron" size={13}/></span></summary></details></li>)}</ul>:<p className="muted">No work assigned.</p>}
            </div>
            <div className="detail-block"><small>Requirements for all assigned work</small><div className="chip-row">{selectedResourceRequirements.length ? selectedResourceRequirements.map(r=><span className="chip requirement-chip" key={r.id}><Icon name={/phone|tablet/i.test(r.capability)?'phone':/robot|roboscape/i.test(r.capability)?'robot':'sensor'} size={14}/>{r.quantity}x {r.capability}</span>) : <span className="muted">No requirements available.</span>}</div></div>
          </> : <EmptyState compact title="No group selected" message="Select a group above to view its assignment details." />}
          </div>
        </div>
      </section>

      <section className="panel resource-column readiness-column">
        <div className="step-heading"><span className="step-number green">3</span><div><h2>Hardware Assignment Preview &amp; Readiness</h2><p>Check whether each group has what it needs</p></div></div>
        {readiness.length ? <div className="readiness-grid">{readiness.map(({g,missing,conflicts,groupDevices,unavailable})=><div className={`readiness-card ${groupColorClass(g.id)} ${conflicts.length||g.status==='blocked'?'conflict':missing.length||unavailable.length?'warning':'ready'}`} key={g.id}><h3><Icon name="group" size={20}/>{g.name}</h3><strong className="readiness-state">{conflicts.length?'Conflict':g.status==='blocked'?(missing.length?'Blocked - Missing: '+missing.map(m=>`${m.quantity}x ${m.capability}`).join(', '):'Blocked'):missing.length?`Missing: ${missing.map(m=>`${m.quantity}x ${m.capability}`).join(', ')}`:unavailable.length?'Assigned - devices unavailable':'Ready'}</strong><div>{groupDevices.map(d=><button type="button" className="device-name-trigger" aria-label={`View ${d.name} details`} onClick={()=>onOpenDevice?.(d.id)} key={d.id}><span className={`status-dot ${d.status}`} title={titleCase(d.status)}/><Icon name={d.type==='Robot'?'robot':d.type==='Phone'?'phone':'sensor'} size={16}/>{d.name}</button>)}</div>{(conflicts.length>0||(!missing.length&&unavailable.length>0))&&<small>{conflicts.length?'Device assigned elsewhere':`All requirements assigned. ${unavailable.map(d=>`${d.name}: ${titleCase(d.status)}`).join(', ')}`}</small>}</div>)}</div> : <EmptyState title="No groups available" message="Resource readiness will appear here once groups are available." />}
      </section>
    </div>}
  </main>
}
