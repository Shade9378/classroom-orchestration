import { useEffect, useRef, useState } from 'react'
import type { GroupChatMessage, HelpRequest } from '../types'
import './GroupChat.css'

type Props = {
  id?: string
  messages: GroupChatMessage[]
  helpRequests?: HelpRequest[]
  disabled: boolean
  onSend: (text: string) => Promise<void>
  onResolveHelp?: (id: string) => Promise<void>
}

export function GroupChat({ id, messages, helpRequests = [], disabled, onSend, onResolveHelp }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const element = list.current
    if (!element) return
    const scrollToLatest = () => { element.scrollTop = element.scrollHeight }
    scrollToLatest()
    const observer = new ResizeObserver(scrollToLatest)
    observer.observe(element)
    return () => observer.disconnect()
  }, [messages.at(-1)?.id])
  return <section id={id} className="mini-card group-chat" aria-label="Group chat">
    <header><h3>Group Chat</h3>{helpRequests.length > 0 && onResolveHelp && <button type="button" disabled={resolving} onClick={() => {
      setResolving(true)
      setError('')
      void Promise.all(helpRequests.map(request => onResolveHelp(request.id))).catch(error => setError(error instanceof Error ? error.message : 'Could not resolve help request.')).finally(() => setResolving(false))
    }}>{resolving ? 'Saving...' : 'Mark help resolved'}</button>}</header>
    <ul ref={list} aria-label="Group messages" tabIndex={0}>
      {messages.map(message => <li key={message.id} className={'chat-message chat-' + message.kind}>
        {message.context && <small>{message.context}</small>}
        {message.kind === 'help' && <small>{message.resolvedAt ? 'Help request resolved' : 'Help requested'}</small>}
        <span><strong>{message.senderName}: </strong>{message.text}</span>
      </li>)}
    </ul>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={event => {
      event.preventDefault()
      if (!text.trim() || sending || disabled) return
      setSending(true)
      setError('')
      void onSend(text.trim()).then(() => setText('')).catch(error => setError(error instanceof Error ? error.message : 'Message failed.')).finally(() => setSending(false))
    }}>
      <input aria-label="Group message" placeholder="Message to group..." value={text} onChange={event => setText(event.target.value)} maxLength={1000} required disabled={disabled || sending} />
      <button type="submit" aria-label="Send to group" disabled={disabled || sending || !text.trim()}>{sending ? 'Sending...' : 'Send'}</button>
    </form>
  </section>
}
