export function EmptyState({
  title,
  message,
  compact = false,
}: {
  title: string
  message?: string
  compact?: boolean
}) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <span className="empty-state-mark" aria-hidden="true">+</span>
      <strong>{title}</strong>
      {message && <span>{message}</span>}
    </div>
  )
}
