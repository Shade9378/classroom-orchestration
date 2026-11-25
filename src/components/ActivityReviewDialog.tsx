import { useEffect, useRef, useState } from 'react'

type Props = {
  groupName: string
  activityName: string
  decision: 'complete' | 'return'
  onClose: () => void
  onSubmit: (message: string) => Promise<void>
}

export function ActivityReviewDialog({ groupName, activityName, decision, onClose, onSubmit }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const title = decision === 'complete' ? 'Mark complete' : 'Return for changes'
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="activity-review-dialog" aria-labelledby="activity-review-title" onCancel={event => { event.preventDefault(); if (!saving) onClose() }}>
    <form onSubmit={event => {
      event.preventDefault()
      if (saving) return
      setSaving(true)
      setError('')
      void onSubmit(message.trim()).then(onClose).catch(error => {
        setError(error instanceof Error ? error.message : 'Could not save the review. Please try again.')
        setSaving(false)
      })
    }}>
      <h2 id="activity-review-title">{title}</h2>
      <div className="review-message-fields panel-scroll-body">
      <p>{groupName} - {activityName}</p>
      <label htmlFor="activity-review-message">Message to group (optional)</label>
      <textarea id="activity-review-message" value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} rows={4} autoFocus disabled={saving} />
      <p className="muted">Everyone in the group can read this message.</p>
      {error && <p role="alert">{error}</p>}
      </div>
      <div className="activity-review-dialog-actions">
        <button type="button" className="secondary-btn" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" className={decision==='complete'?'success-btn':'danger-btn review-reject'} disabled={saving}>{saving ? 'Saving...' : title}</button>
      </div>
    </form>
  </dialog>
}
