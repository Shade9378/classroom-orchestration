import { useState } from 'react'
import { GroupChat } from '../components/GroupChat'
import { useStudent } from './useStudent'
import { NetsBloxEditor } from './NetsBloxEditor'
import './student.css'
export default function StudentApp() {
  const student = useStudent()
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('class') ?? '')
  const [name, setName] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpMessage, setHelpMessage] = useState('')
  const [helpSending, setHelpSending] = useState(false)
  const state = student.state
  return <main className="student-app">
    <h1>Student classroom</h1>
    {student.error && <p role="alert">{student.error}</p>}
    {!student.connection ? <form onSubmit={e => { e.preventDefault(); void student.join(code, name) }}>
      <label>Class code <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={12} required autoComplete="off" /></label>
      <label>Your name <input value={name} onChange={e => setName(e.target.value)} maxLength={100} required autoComplete="name" /></label>
      <button disabled={student.busy}>{student.busy ? 'Joining...' : 'Join class'}</button>
    </form> : <>
      <div className="student-summary">
        <span>Student: {state?.participant.name ?? student.connection.name}</span>
        <span>Class: {state?.session.name ?? student.connection.joinCode}</span>
        <span>{student.connected ? 'Connected' : 'Reconnecting...'}</span>
        <button onClick={() => void student.leave()} disabled={student.busy}>Leave class</button>
      </div>
      {!state ? <p>Loading classroom...</p> : <>
        <p data-testid="student-group">Group: {state.group?.name ?? 'Waiting for your teacher to assign a group'}</p>
        <p data-testid="student-activity">Current activity: {state.activity?.name ?? (state.finishedAssignedWork ? 'All assigned exercises completed' : 'Waiting for an activity')}</p>
        {!!state.devices?.length&&<div className="student-device-table"><table aria-label="Assigned devices"><thead><tr><th>Device</th><th>NetsBlox service</th><th>Device ID</th><th>Status</th><th>Control</th></tr></thead><tbody>{state.devices.map(d=><tr key={d.id}><td>{d.name}</td><td>{d.service}</td><td><code>{d.deviceId}</code></td><td>{d.status}</td><td>{d.control?`${d.control.name} is controlling`:'Available'}</td></tr>)}</tbody></table></div>}
        {state.activity?.description && <p className="student-instructions">{state.activity.description}</p>}
        {state.activity && (state.activity.awaitingReview
          ? <p className="student-review-status" role="status">{state.activity.testsFailed
              ? 'Some tests failed. Waiting for teacher review.'
              : state.activity.testing ? 'Submitted. Waiting for the test results.' : 'Waiting for teacher review.'}</p>
          : <>
            {state.activity.completionVote&&<p className="student-vote-status" role="status">{state.activity.completionVote.agreed} of {state.activity.completionVote.total} students agree this exercise is complete.{state.activity.completionVote.hasVoted?' You agreed.':''}{state.activity.completionVote.pendingNames.length?' Waiting for: '+state.activity.completionVote.pendingNames.join(', ')+'.':''}</p>}
            <button type="button" disabled={student.busy || state.session.status !== 'open' || !!state.activity.completionVote?.hasVoted} onClick={() => void student.finishActivity(state.activity!.progressId)}>{state.activity.completionVote?(state.activity.completionVote.hasVoted?'Agreement recorded':'Agree exercise is complete'):'Finish exercise'}</button>
          </>)}
        {state.group && <>
          <p className="student-teammates" data-testid="student-teammates">Group members: {state.group.members.map(m => `${m.name} (${m.status})`).join(', ')}</p>
          <p className="student-assigned-work">Assigned work: {state.group.assignments.map(a => a.name).join(', ') || 'None yet'}</p>
          <GroupChat key={state.group.id} messages={student.messages} disabled={state.session.status !== 'open' || !student.connected} onSend={student.sendMessage} />
          {state.helpPending ? <p role="status">Your group has requested help. Your teacher has been notified.</p> : <>
            <button type="button" disabled={state.session.status !== 'open' || !student.connected} onClick={() => setHelpOpen(value => !value)}>Request help</button>
            {helpOpen && <form className="student-help-form" onSubmit={event => {
              event.preventDefault()
              if (helpSending) return
              setHelpSending(true)
              void student.requestHelp(helpMessage.trim()).then(() => { setHelpMessage(''); setHelpOpen(false) }).catch(() => {}).finally(() => setHelpSending(false))
            }}>
              <label>Help message <textarea value={helpMessage} onChange={event => setHelpMessage(event.target.value)} maxLength={1000} rows={2} required disabled={helpSending} /></label>
              <button disabled={helpSending || !helpMessage.trim() || state.session.status !== 'open' || !student.connected}>{helpSending ? 'Sending...' : 'Send help request'}</button>
              <button type="button" disabled={helpSending} onClick={() => setHelpOpen(false)}>Cancel</button>
            </form>}
          </>}
        </>}
      </>}
      <NetsBloxEditor token={student.connection.token} state={state} lastMessage={student.messages.at(-1)} onSend={student.sendMessage} />
    </>}
  </main>
}
