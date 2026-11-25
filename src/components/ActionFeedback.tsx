import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import './ActionFeedback.css'

type Confirmation = { id: string; message: string; expiresAt: number; duration: number }
const FeedbackContext = createContext<(message: string) => void>(() => {})
export const useActionFeedback = () => useContext(FeedbackContext)

type Anchor = { target: Element; top: number; right: number; width: number; height: number }
function FeedbackViewport({ items, onDismiss }: { items: Confirmation[]; onDismiss: (id: string) => void }) {
  const [anchor, setAnchor] = useState<Anchor>(() => ({ target: document.body, height: innerHeight, top: 16, right: 20, width: Math.min(340, innerWidth - 32) }))
  useLayoutEffect(() => {
    if (!items.length) return
    const measure = () => {
      const dialog = [...document.querySelectorAll('dialog[open]')].at(-1)
      const target = dialog ?? document.fullscreenElement ?? document.body
      const header = target === document.body ? document.querySelector('.topbar') : target.querySelector('.device-dialog-header, #activity-review-title, .group-editor-toolbar')
      const feed = document.querySelector('.notification-feed:not([hidden])')
      const counters = document.querySelector('.notification-counts')
      const popup = feed && feed.getBoundingClientRect().height > 0 ? feed : counters && counters.getBoundingClientRect().height > 0 ? counters : null
      const bounds = target === document.body ? popup?.getBoundingClientRect() : target.getBoundingClientRect()
      const top = target === document.body && bounds ? bounds.top : (header?.getBoundingClientRect().bottom ?? 4) + 12
      const next = { target, height: innerHeight, top: Math.max(16, Math.min(top, innerHeight - 100)), right: Math.max(16, bounds ? innerWidth - bounds.right + (target === document.body ? 0 : 16) : 20), width: Math.min(340, innerWidth - 32, bounds && target !== document.body ? bounds.width - 32 : 340) }
      setAnchor(previous => previous.target === next.target && previous.top === next.top && previous.right === next.right && previous.width === next.width && previous.height === next.height ? previous : next)
    }
    measure()
    const observer = new MutationObserver(measure)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-expanded', 'open', 'class'] })
    window.addEventListener('resize', measure)
    document.addEventListener('fullscreenchange', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); document.removeEventListener('fullscreenchange', measure) }
  }, [items.length])
  if (!items.length) return null
  return createPortal(<div className="teacher-action-feedback" aria-label="Teacher action feedback" aria-live="polite" aria-atomic="false" style={{ top: anchor.top, right: anchor.right, width: anchor.width, maxHeight: Math.max(80, anchor.height - anchor.top - 16) }}>
    {items.map(item => <div className="action-confirmation" role="status" key={item.id}>
      <Icon name="check" size={16}/><span>{item.message}</span>
      <button type="button" aria-label={'Dismiss confirmation: ' + item.message} onClick={() => onDismiss(item.id)}><Icon name="x" size={14}/></button>
      <div className="action-confirmation-timer" style={{ animationDuration: item.duration + 'ms', animationDelay: (item.expiresAt - item.duration - Date.now()) + 'ms' }}/>
    </div>)}
  </div>, anchor.target)
}

export function ActionFeedbackProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Confirmation[]>([])
  const notify = useCallback((message: string) => {
    const duration = Math.max(4000, Math.min(8000, message.length * 40))
    setItems(previous => [{ id: crypto.randomUUID(), message, duration, expiresAt: Date.now() + duration }, ...previous].slice(0, 3))
  }, [])
  useEffect(() => {
    if (!items.length) return
    const timeout = window.setTimeout(() => setItems(previous => previous.filter(item => item.expiresAt > Date.now())), Math.max(0, Math.min(...items.map(item => item.expiresAt)) - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [items])
  return <FeedbackContext.Provider value={notify}>{children}<FeedbackViewport items={items} onDismiss={id => setItems(previous => previous.filter(item => item.id !== id))}/></FeedbackContext.Provider>
}
