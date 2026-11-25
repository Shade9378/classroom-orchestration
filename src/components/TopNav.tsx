import {useState} from 'react'
import { Icon } from './Icon'

export type MainView = 'live' | 'activities' | 'groups'

export function TopNav({ view, onChange, teacherName, pending, onSignOut }: { view: MainView; onChange: (view: MainView) => void; teacherName?: string | null; pending: boolean; onSignOut: () => void }) {
  const [menuOpen,setMenuOpen]=useState(false)
  const items: { id: MainView; label: string; icon: 'live'|'list'|'users' }[] = [
    { id: 'live', label: 'Live Classroom', icon: 'live' },
    { id: 'activities', label: 'Activities & Playlists', icon: 'list' },
    { id: 'groups', label: 'Group Assignments', icon: 'users' },
  ]
  return (
    <header className={`topbar ${menuOpen?'mobile-menu-open':''}`}>
      <div className="topbar-content">
      <a className="topbar-brand" href="https://www.depauw.edu/academics/majors-and-minors/about-computer-science/" target="_blank" rel="noopener noreferrer">
        <img src="/dp_cs.png" alt="DePauw University Computer Science" />
      </a>
      <button type="button" className="topbar-menu-toggle" aria-expanded={menuOpen} aria-controls="primary-navigation" aria-label={menuOpen?'Close navigation menu':'Open navigation menu'} onClick={()=>setMenuOpen(!menuOpen)}><Icon name={menuOpen?'x':'menu'} size={20}/> Menu</button>
      <nav id="primary-navigation" className="topnav" aria-label="Primary navigation">
        {items.map(item => (
          <button key={item.id} className={`nav-button ${view === item.id ? 'active' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => {onChange(item.id);setMenuOpen(false)}}>
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="topbar-account">
        <span className="teacher-account-name" title={teacherName ?? undefined}>{teacherName}</span>
        <button className="secondary-btn small" disabled={pending} onClick={onSignOut}>Sign out</button>

      </div>
      </div>
    </header>
  )
}
