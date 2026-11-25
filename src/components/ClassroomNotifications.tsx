import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { alertSeverityIcon, canDismissAlert, alertFingerprint as fingerprint, type ClassroomAlert } from '../state/classroomAlerts'
import { Icon } from './Icon'

type Severity = ClassroomAlert['severity']
type Notice = { fingerprint: string; severity: Severity; arrivedAt: number; expiresAt: number }
const severities = ['error', 'warning', 'notice'] as const
const labels = { error: 'Errors', warning: 'Warnings', notice: 'Notices' }
const displayMs = 8000
const fadeMs = 400

export function ClassroomNotifications({ alerts, busy, onViewAlerts, onDismissAlert }: {
  onDismissAlert: (alert: ClassroomAlert) => Promise<void>
  alerts: ClassroomAlert[]
  busy: boolean
  onViewAlerts: () => void
}) {
  const seen = useRef(new Set<string>())
  const [notices, setNotices] = useState<Notice[]>([])
  const [pinned, setPinned] = useState({ error: false, warning: false, notice: false })
  const [now, setNow] = useState(Date.now)
  const [reviewBottom, setReviewBottom] = useState(0)
  const [viewport, setViewport] = useState(() => ({ width: innerWidth, height: innerHeight, headerHeight: 84 }))

  useLayoutEffect(() => {
    const review = document.querySelector('.live-title-row')
    const measure = () => setReviewBottom(review?.getBoundingClientRect().bottom ?? 0)
    measure()
    const observer = new ResizeObserver(measure)
    if (review) observer.observe(review)
    return () => observer.disconnect()
  })

  useLayoutEffect(() => {
    const header = document.querySelector('.topbar')
    const resize = () => setViewport({ width: innerWidth, height: innerHeight, headerHeight: header?.getBoundingClientRect().height ?? 84 })
    resize()
    const observer = new ResizeObserver(resize)
    if (header) observer.observe(header)
    window.addEventListener('resize', resize)
    return () => { observer.disconnect(); window.removeEventListener('resize', resize) }
  }, [])

  const width = Math.min(340, viewport.width - 32)
  const top = Math.min(viewport.headerHeight + 12, Math.max(16, viewport.height - 80))

  const signature = JSON.stringify(alerts.map(fingerprint))
  useEffect(() => {
    const current = new Set(alerts.map(fingerprint))
    const arrivedAt = Date.now()
    const additions = alerts.filter(alert => !seen.current.has(fingerprint(alert))).map(alert => ({
      fingerprint: fingerprint(alert), severity: alert.severity, arrivedAt, expiresAt: arrivedAt + displayMs,
    }))
    seen.current = current
    setNow(arrivedAt)
    setNotices(previous => [...previous.filter(item => current.has(item.fingerprint)), ...additions])
  }, [signature])

  useEffect(() => {
    const deadlines = notices.flatMap(item => [
      item.arrivedAt + displayMs,
      ...(!pinned[item.severity] ? [item.expiresAt, item.expiresAt + fadeMs] : []),
    ]).filter(deadline => deadline > now)
    if (!deadlines.length) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(...deadlines) - Date.now()))
    return () => window.clearTimeout(timer)
  }, [notices, pinned, now])

  const counts = {
    error: alerts.filter(alert => alert.severity === 'error').length,
    warning: alerts.filter(alert => alert.severity === 'warning').length,
    notice: alerts.filter(alert => alert.severity === 'notice').length,
  }
  const visible = (item: Notice) => pinned[item.severity] || now < item.expiresAt + fadeMs
  const isExpanded = (severity: Severity) => notices.some(item => item.severity === severity && visible(item))
  const toggle = (severity: Severity) => {
    if (pinned[severity]) {
      setPinned(previous => ({ ...previous, [severity]: false }))
      setNotices(previous => previous.map(item => item.severity === severity ? { ...item, expiresAt: 0 } : item))
    } else {
      setPinned(previous => ({ ...previous, [severity]: true }))
    }
  }

  return <aside className="classroom-notifications" aria-label="Classroom notifications" aria-live="polite"
    style={{ top, width, maxHeight: Math.max(48, viewport.height - top - 16) }}>
    <div className="notification-counts">
      {severities.filter(severity => counts[severity] > 0).map(severity =>
        <button type="button" className={'notification-count ' + severity} key={severity}
          aria-label={labels[severity] + ' (' + counts[severity] + ')'}
          aria-expanded={isExpanded(severity)} aria-pressed={pinned[severity]} aria-controls={'notification-list-' + severity}
          title={pinned[severity] ? 'Click to close' : 'Click to keep open'}
          onClick={() => toggle(severity)}>
          <Icon name={alertSeverityIcon[severity]} size={18}/><strong>{counts[severity]}</strong>
        </button>)}
    </div>
    <div className="notification-feed" style={{ marginTop: reviewBottom ? Math.max(0, reviewBottom + 8 - top - 40) : 0 }} tabIndex={severities.some(isExpanded) ? 0 : -1} hidden={!severities.some(isExpanded)} aria-label="Notification messages">
    {severities.map(severity => <div className="notification-list" id={'notification-list-' + severity} key={severity} hidden={!isExpanded(severity)}>
      {notices.filter(item => item.severity === severity && visible(item)).map(item => {
        const current = alerts.find(alert => fingerprint(alert) === item.fingerprint)
        if (!current) return null
        const fading = !pinned[severity] && now >= item.expiresAt
        return <NotificationCard key={item.fingerprint} alert={current} fading={fading} isNew={now < item.arrivedAt + displayMs} busy={busy} onView={onViewAlerts} onDismiss={onDismissAlert} />
      })}
    </div>)}
    </div>
  </aside>
}

function NotificationCard({ alert, fading, isNew, busy, onView, onDismiss }: {
  alert: ClassroomAlert
  fading: boolean
  isNew: boolean
  busy: boolean
  onView: () => void
  onDismiss: (alert: ClassroomAlert) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const hasMore = alert.detail.length > 90
  return <div className={'classroom-notification ' + alert.severity + (fading ? ' fading' : '')}>
    <div className="notification-heading"><Icon name={alertSeverityIcon[alert.severity]} size={15}/><strong>{alert.title}</strong>{isNew && <span className="notification-new">New</span>}</div>
    <p className={'notification-detail' + (expanded ? ' expanded' : '')}>{alert.detail}</p>
    <div className="notification-actions">
      {alert.approve && <button type="button" className="notification-approve" disabled={busy} onClick={() => void alert.approve?.().catch(() => {})}>{alert.approvalLabel}</button>}
      {alert.reject && <button type="button" className="notification-reject" disabled={busy} onClick={() => void alert.reject?.().catch(() => {})}>Reject</button>}
      {hasMore && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Less' : 'Details'}</button>}
      <button type="button" disabled={busy} onClick={onView}>View alerts</button>
      {canDismissAlert(alert) && <button type="button" aria-label={'Dismiss ' + alert.severity + ': ' + alert.title} disabled={busy} onClick={() => void onDismiss(alert).catch(() => {})}>Dismiss</button>}
    </div>
  </div>
}
