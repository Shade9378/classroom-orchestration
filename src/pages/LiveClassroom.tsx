import { GroupChat } from '../components/GroupChat'
import { ActivityReviewDialog } from '../components/ActivityReviewDialog'
import type { useActivityTests } from '../state/useActivityTests'
import {usePageState} from '../state/usePageState'
import { useEffect, useState } from 'react'
import { alertSeverityIcon, canDismissAlert, type ClassroomAlert } from '../state/classroomAlerts'
import type { Activity, Device, Group, Playlist, Student } from '../types'
import { Icon } from '../components/Icon'
import { StudentRoster } from '../components/StudentRoster'
import { EmptyState } from '../components/EmptyState'
import { GroupEditorViewer } from '../components/GroupEditorViewer'

type Props = { onSendMessage:(groupId:string,text:string)=>Promise<void>; onResolveHelp:(groupId:string,id:string)=>Promise<void>; onDismissAlert:(alert:ClassroomAlert)=>Promise<void>; classroomAlerts: ClassroomAlert[]; alertTarget: { groupId?: string; chat?: boolean } | null; activityTests: ReturnType<typeof useActivityTests>; sessionOpen:boolean; onReviewActivity:(groupId:string,progressId:string,decision:'complete'|'return',message?:string)=>Promise<void>; onOpenDevice?:(id:string)=>void; onManageDevices?:()=>void; sessionId:string; activities: Activity[]; playlists: Playlist[]; students: Student[]; devices: Device[]; groups: Group[]; events: { id: string; groupId?: string | null; type: string; message: string; createdAt: string }[] }

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
const eventTone = (type:string) => {
  if (['PARTICIPANT_JOINED','PARTICIPANT_RECONNECTED','PARTICIPANT_ONLINE'].includes(type)) return 'success'
  if (['PARTICIPANT_LEFT','PARTICIPANT_OFFLINE','PARTICIPANT_REMOVED'].includes(type)) return 'neutral'
  if(type==='PARTICIPANT_AWAY')return 'away'
  if (/(^|_)(ERROR|FAILED|BLOCKED|CONFLICT)(_|$)/.test(type)) return 'error'
  if (/(^|_)(WARNING|DEGRADED|OFFLINE)(_|$)/.test(type)) return 'warning'
  return 'info'
}


export function LiveClassroom({ onSendMessage, onResolveHelp, onDismissAlert, classroomAlerts, alertTarget, activityTests, sessionOpen, onReviewActivity, onOpenDevice, onManageDevices, sessionId, activities, students, devices, groups, events }: Props) {
  const [selectedGroupId,setSelectedGroupId]=usePageState('liveGroup',groups[0]?.id??'',groups.map(g=>g.id))
  const [overviewMode,setOverviewMode]=usePageState<'groups'|'devices'|'alerts'|'students'>('overviewTab','groups',['groups','devices','alerts','students'])
  const [review, setReview] = useState<{ groupId: string; groupName: string; progressId: string; activityName: string; decision: 'complete' | 'return' } | null>(null)
  const [alertSeverity, setAlertSeverity] = usePageState<'all' | 'notice' | 'warning' | 'error'>('alertSeverity', 'all', ['all', 'notice', 'warning', 'error'])
  const [studentSearch, setStudentSearch] = useState('')

  useEffect(() => {
    if (!alertTarget) return
    setOverviewMode('alerts')
    setAlertSeverity('all')
    if (alertTarget.groupId) setSelectedGroupId(alertTarget.groupId)
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(alertTarget.chat ? '#group-chat' : alertTarget.groupId ? '#activity-review' : '.overview-alerts')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [alertTarget, setOverviewMode, setSelectedGroupId, setAlertSeverity])


  const group = groups.find(g => g.id === selectedGroupId) ?? groups[0]
  const activity = activities.find(a => a.id === group?.activityId)
  const currentProgress = group?.progress?.find(p => p.status === 'in_progress' || p.status === 'submitted')
  const reviewProgress = currentProgress?.id
  const submissionId = currentProgress?.submissionId
  const testResult = currentProgress?.testResult
  const testError = submissionId ? activityTests.errors[submissionId] : undefined
  const members = group ? students.filter(s => group.studentIds.includes(s.id)) : []
  const groupDevices = group ? devices.filter(d => group.deviceIds.includes(d.id) || d.assignedGroupId === group.id) : []
  const filteredStudents = students.filter(s => s.name.toLowerCase().includes(studentSearch.toLowerCase()))

  const groupColorClass = (groupId?: string) => {
    if (!groupId) return 'group-color-none'
    const index = groups.findIndex(g => g.id === groupId)
    return `group-color-${(Math.max(index, 0) % 4) + 1}`
  }

  const activityForGroup = (g: Group) => activities.find(a => a.id === g.activityId)
  const devicesForGroup = (g: Group) => devices.filter(d => g.deviceIds.includes(d.id) || d.assignedGroupId === g.id)
  const memberNamesForGroup = (g: Group) => students.filter(s => g.studentIds.includes(s.id)).map(s => s.name)

  const progressForGroup = (g: Group) => {
    const total = g.progress?.length ?? 0
    const completed = g.progress?.filter(p => p.status === 'completed').length ?? 0
    return {
      label: total ? completed + '/' + total + ' completed' : g.activityId ? 'Current activity' : 'No activity assigned',
      percent: total ? Math.round((completed / total) * 100) : 0,
    }
  }
  const progressRows = (group?.progress ?? []).flatMap((progress, index) => {
    const item = activities.find(a => a.id === progress.activityId)
    return item ? [{ item, state: progress.status, testResult: progress.testResult, completionVotes:progress.completionVotes,requiredVotes:progress.requiredVotes, key: progress.id ?? index }] : []
  })

  const recentEvents = events.filter(e => !!group && e.groupId === group.id).slice(0, 5).map(e => ({
    time: new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    text: e.message,
    tone: eventTone(e.type),
  }))

  const alertCount = classroomAlerts.length
  const alertCounts = { all: alertCount, notice: classroomAlerts.filter(alert => alert.severity === 'notice').length, warning: classroomAlerts.filter(alert => alert.severity === 'warning').length, error: classroomAlerts.filter(alert => alert.severity === 'error').length }
  const filteredAlerts = classroomAlerts.filter(alert => alertSeverity === 'all' || alert.severity === alertSeverity)

  return (
    <main className="page-shell live-page">
      {review && <ActivityReviewDialog key={review.progressId + review.decision} groupName={review.groupName} activityName={review.activityName} decision={review.decision}
        onClose={() => setReview(null)} onSubmit={message => onReviewActivity(review.groupId, review.progressId, review.decision, message)} /> }
      <div className="live-grid">
        <section className="panel live-main">
          {!group ? (
            <div className="live-no-selection">
              <EmptyState
                title="No group selected"
                message={groups.length ? 'Select a group below to open its live classroom view.' : 'Groups will appear here once they are available.'}
              />
            </div>
          ) : (
            <>
              <div className="live-title-row">
                <div>
                  <h2 title={group.name + ' - Live View'}>{group.name} - Live View</h2>
                  <p>{members.length} members</p>
                </div>
                  <span className={`status-pill ${group.status}`}><span className={`status-dot ${group.status}`}></span>{titleCase(group.status)}</span>
                <div className="live-header-controls">
                  {sessionOpen && reviewProgress && <div className="live-review-actions">
                    {currentProgress?.status === 'submitted' && <span className="status-pill degraded">Waiting for review</span>}
                    <button type="button" className="success-btn small" onClick={() => setReview({ groupId: group.id, groupName: group.name, progressId: reviewProgress, activityName: activity?.name ?? 'Exercise', decision: 'complete' })}><Icon name="check" size={14}/>Mark complete</button>
                    {activity?.completionMethod === 'project' && activity.testConfig && submissionId && <button type="button" className="secondary-btn small"
                      disabled={!!activityTests.running} onClick={() => void activityTests.run(group.id, reviewProgress, submissionId, true)}>
                      {activityTests.running === reviewProgress ? 'Running tests...' : 'Run tests'}
                    </button>}
                    {currentProgress?.status === 'submitted' && <button type="button" className="danger-btn review-reject small" onClick={() => setReview({ groupId: group.id, groupName: group.name, progressId: reviewProgress, activityName: activity?.name ?? 'Exercise', decision: 'return' })}>Return for changes</button>}
                  </div>}
                </div>
              </div>

              <div className="live-content-grid">
                <div className="netsblox-card">
                  <div className="section-title-row" id="activity-review"><h3>Project in NetsBlox</h3></div>
                  {testError && <p role="alert">{testError}</p>}
                  {testResult && <details open className="activity-test-results">
                    <summary>{testResult.cases.filter(item => item.passed).length} of {testResult.cases.length} tests passed</summary>
                    <ol>{testResult.cases.map((item, index) => <li key={index}>{item.passed ? 'Passed' : 'Failed'} - {item.detail}</li>)}</ol>
                  </details>}
                  <GroupEditorViewer key={`${sessionId}:${group.id}`} sessionId={sessionId} groupId={group.id} groupName={group.name} />
                </div>

                <div className="live-detail-stack">
                  <div className="live-detail-row two">
                    <section className="mini-card">
                      <h3><Icon name="users" size={18}/> Group Members ({members.length})</h3>
                      <div className="mini-card-scroll">{members.length ? members.map(s => <div className="member-row" key={s.id}><span className={`status-dot ${s.status}`}></span><span className="grow">{s.name}</span><em className={s.status}>{titleCase(s.status)}</em></div>) : <EmptyState compact title="No students in this group" />}</div>
                    </section>
                    <section className="mini-card assigned-devices-card">
                      <h3><Icon name="robot" size={18}/> Assigned Devices ({groupDevices.length})</h3>
                      <div className="mini-card-scroll">{groupDevices.length ? groupDevices.map(d => <button type="button" className="device-row device-details-row" key={d.id} aria-label={`View ${d.name} details`} onClick={()=>onOpenDevice?.(d.id)}><span>{d.name}</span><span className={`device-status ${d.status}`}><span className={`status-dot ${d.status}`}></span>{titleCase(d.status)}</span></button>) : <EmptyState compact title="No devices assigned" />}</div>
                    </section>
                  </div>

                    <section className="mini-card progress-card">
                      <div className="progress-card-header">
                        <div>
                          <h3>Activity Progress</h3>
                        </div>
                        {progressRows.length > 0 && (
                          <span>{progressRows.filter(row => row.state === 'completed').length} of {progressRows.length} completed</span>
                        )}
                      </div>
                      <div className="mini-card-scroll">{progressRows.length ? progressRows.map((row, index) => (
                        <div className="progress-row" key={row.key}>
                          <span className={`progress-bullet ${row.state === 'completed' ? 'done' : (row.state === 'in_progress' || row.state === 'submitted') ? 'current' : ''}`}>
                            {row.state === 'completed' ? <Icon name="check" size={12}/> : index + 1}
                          </span>
                          <span className="progress-name">{row.item!.name}</span>
                          <span className="progress-time">{row.item!.estimatedMinutes} min</span>
                          <em className={row.state === 'completed' ? 'done' : (row.state === 'in_progress' || row.state === 'submitted') ? 'current' : ''}>
                            {row.state === 'completed' ? (row.testResult?.passed ? 'Tests passed' : 'Completed') : row.state === 'submitted' ? 'In Review' : row.state === 'in_progress' ? (row.requiredVotes!==undefined?`${row.completionVotes??0}/${row.requiredVotes} agree`:'In Progress') : 'Pending'}
                          </em>
                        </div>
                      )) : <EmptyState compact title="No progress available" />}</div>
                    </section>

                  <GroupChat key={group.id} id="group-chat" messages={group.messages ?? []} helpRequests={group.helpRequests} disabled={!sessionOpen}
                    onSend={text => onSendMessage(group.id, text)} onResolveHelp={id => onResolveHelp(group.id, id)} />
                  <section className="mini-card recent-events-card">
                    <h3><Icon name="clock" size={18}/> Recent Events</h3>
                    {recentEvents.length ? (
                      <div className="recent-events-list">
                        {recentEvents.map((event, index) => (
                          <div className="event-row" key={`${event.time}-${index}`}>
                            <span className={`event-dot ${event.tone}`}></span>
                            <time>{event.time}</time>
                            <span>{event.text}</span>
                          </div>
                        ))}
                      </div>
                    ) : <EmptyState compact title="No recent events" />}
                  </section>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="panel overview-panel">
          <div className="overview-top">
            <div className="segmented overview-seg">
              <button className={overviewMode==='groups'?'selected':''} onClick={()=>setOverviewMode('groups')}><Icon name="users"/> Groups</button>
              <button className={overviewMode==='devices'?'selected':''} onClick={()=>setOverviewMode('devices')}><Icon name="device"/> Devices</button>
              <button className={overviewMode==='students'?'selected':''} onClick={()=>setOverviewMode('students')}><Icon name="users"/> Students</button>
              <button className={overviewMode==='alerts'?'selected':''} onClick={()=>setOverviewMode('alerts')}><Icon name="alert"/> Alerts ({alertCount})</button>
            </div>
          </div>

          {overviewMode === 'students' ? <div className="overview-students">
            <h3>Students ({students.length})</h3>
            <div className="search-box"><Icon name="search" size={17}/><input value={studentSearch} onChange={e=>setStudentSearch(e.target.value)} placeholder="Search students..."/></div>
            {filteredStudents.length ? (
              <StudentRoster students={filteredStudents} groups={groups} />
            ) : (
              <EmptyState compact title={students.length ? 'No matching students' : 'No students available'} />
            )}
          </div> : overviewMode === 'groups' ? (
            groups.length ? <div className="group-card-grid">{groups.map(g => {
              const gActivity = activityForGroup(g)
              const gDevices = devicesForGroup(g)
              const memberNames = memberNamesForGroup(g)
              const gProgress = progressForGroup(g)
              return <button key={g.id} className={`group-card ${groupColorClass(g.id)} ${g.id===group?.id?'selected':''} ${g.status==='degraded'?'degraded':''}`} onClick={()=>setSelectedGroupId(g.id)}>
                <div className="group-card-header">
                  <span className={`status-dot ${g.status}`}></span>
                  <div><strong>{g.name}</strong><small><Icon name="users" size={13}/> {g.studentIds.length} members{memberNames.length ? ` - ${memberNames.join(', ')}` : ''}</small></div>
                  <span className={`status-pill ${g.status}`}>{titleCase(g.status)}</span>
                </div>
                <div className="group-card-body"><small>Current Activity</small><strong>{gActivity?.name ?? 'No activity assigned'}</strong></div>
                <div className="group-monitor-progress">
                  <div className="group-monitor-progress-header"><small>Progress</small><span>{gProgress.label}</span></div>
                  <div className="group-monitor-track" aria-label={`${g.name} progress`}>
                    <span className="group-monitor-fill" style={{ width: `${gProgress.percent}%` }} />
                  </div>
                </div>
                <div className="group-devices"><small>Devices</small><div>{gDevices.length ? gDevices.map(d => <span key={d.id}><span className={`status-dot ${d.status}`}></span>{d.name}</span>) : <span>No devices assigned</span>}</div></div>
              </button>
            })}</div> : <EmptyState title="No groups available" message="Groups will appear here after students are organized into groups." />
          ) : overviewMode === 'devices' ? (<div className="overview-devices"><div className="device-overview-actions"><button className="primary-btn small" disabled={!sessionId} onClick={onManageDevices}>Connect device</button></div>{
            devices.length ? <div className="device-overview-table"><div className="device-table header"><span>Device</span><span>Type / Capability</span><span>Status</span><span>Assigned To</span></div>{devices.map(d => <button type="button" className="device-table device-details-row" key={d.id} aria-label={`View ${d.name} details`} onClick={()=>onOpenDevice?.(d.id)}><span>{d.name}</span><span>{d.capability}</span><span className="overview-device-status"><span className={`status-dot ${d.status}`}></span>{titleCase(d.status)}</span><span>{d.assignedGroupId ? <span title={groups.find(g=>g.id===d.assignedGroupId)?.name} className={`group-tag ${groupColorClass(d.assignedGroupId)}`}>{groups.find(g=>g.id===d.assignedGroupId)?.name.replace('Group ','G')}</span> : <span title="Unassigned" className="group-tag group-color-none">Unassigned</span>}</span></button>)}</div> : <EmptyState title="No devices available" message="Available classroom devices will appear here once they are connected." />}</div>
          ) : <div className="overview-alerts">
            <div className="alert-filters" role="tablist" aria-label="Alert severity">
              {(['all', 'notice', 'warning', 'error'] as const).map(severity => <button type="button" role="tab" id={'alert-filter-' + severity} key={severity} className={'alert-filter ' + severity}
                aria-selected={alertSeverity === severity} aria-controls="alert-filter-results" onClick={() => setAlertSeverity(severity)}>
                <span className="alert-filter-label"><Icon name={severity==='all'?'layers':alertSeverityIcon[severity]} size={14}/>{titleCase(severity)}</span><span className="alert-filter-count">{alertCounts[severity]}</span>
              </button>)}
            </div>
            <div className="alert-filter-results" id="alert-filter-results" role="tabpanel" aria-labelledby={'alert-filter-' + alertSeverity}>
            {filteredAlerts.length ? <div className="alerts-list">
              {filteredAlerts.map(alert => (
                <div className={`alert-card ${alert.severity}`} key={alert.key}>
                  <Icon name={alertSeverityIcon[alert.severity]} size={20}/>
                  <div>
                    <strong>{alert.title}</strong>
                    <small>{alert.detail}</small>
                    {alert.approve && <button type="button" className="primary-btn small alert-primary-action" onClick={() => void alert.approve?.().catch(() => {})}>{alert.approvalLabel}</button>}
                    {canDismissAlert(alert) && <button type="button" className="text-btn" onClick={() => void onDismissAlert(alert).catch(() => {})}>Dismiss</button>}
                    {alert.reject && <button type="button" className="danger-btn review-reject small" onClick={() => void alert.reject?.().catch(() => {})}>Reject</button>}
                  </div>
                </div>
              ))}
            </div> : <EmptyState compact title={alertSeverity === 'all' ? 'No alerts available' : 'No ' + alertSeverity + ' alerts'} />}
            </div>
          </div>}
        </section>
      </div>
    </main>
  )
}
