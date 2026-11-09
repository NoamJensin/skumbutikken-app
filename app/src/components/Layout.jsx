import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useLiveQuery } from '../lib/live'
import { ConnBadge } from './ui'
import { ROLE, dateTime } from '../lib/format'

const NAV = [
  ['/', 'Overblik', '◧', ['admin', 'butik']],
  ['/ordrer', 'Kundeordrer', '▤', ['admin', 'butik']],
  ['/skraedder', 'Skrædder', '✂', ['admin', 'butik', 'skraedder']],
  ['/bestillinger', 'Bestillinger', '⇅', ['admin', 'butik']],
  ['/kunder', 'Kundekartotek', '☺', ['admin', 'butik']],
  ['/fakturaer', 'Fakturaer', '₭', ['admin', 'butik']],
  ['/afhentning', 'Afhentning', '⬚', ['admin', 'butik']],
  ['/admin', 'Administration', '⚙', ['admin', 'butik', 'skraedder']]
]

export default function Layout() {
  const { employee, lock, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const nav = useNavigate()
  const notifs = useLiveQuery(['notifications'], async () => {
    const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
    if (error) throw new Error(error.message)
    return data
  }, [employee.id])
  const unread = (notifs.data || []).filter((n) => !n.read_at).length

  const openNotif = async (n) => {
    if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    setNotifOpen(false)
    if (n.order_id) nav(employee.role === 'skraedder' ? '/skraedder?ordre=' + n.order_id : '/ordrer/' + n.order_id)
  }
  const readAll = async () => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
  }

  return (
    <div className={'shell' + (menuOpen ? ' menu-open' : '')}>
      <aside className="side glass">
        <div className="brand">
          <img src="./sb-monogram.png" alt="" />
          <div><div className="brand-name">SKUMBUTIKKEN</div><div className="brand-sub">ALT I KVALITETSSKUM</div></div>
        </div>
        <nav>
          {NAV.filter((n) => n[3].includes(employee.role)).map(([to, label, ic]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenuOpen(false)} className={({ isActive }) => 'nav' + (isActive ? ' active' : '')}>
              <span className="nav-ic">{ic}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="me"><div className="avatar">{employee.display_name.slice(0, 1)}</div>
            <div><b>{employee.display_name}</b><small>{employee.title || ROLE[employee.role]}</small></div></div>
          <div className="row gap">
            <button className="btn soft sm" onClick={lock}>Skift bruger</button>
            <button className="btn ghost sm" onClick={() => { if (confirm('Log helt ud på denne enhed? Du skal bruge adgangskode næste gang.')) logout() }}>Log ud</button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="top glass">
          <button className="btn ghost burger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">☰</button>
          <img className="top-logo" src="./sb-monogram.png" alt="" />
          <div className="top-user"><span className="lbl">Logget ind: </span><b>{employee.display_name}</b></div>
          <div className="grow" />
          <ConnBadge />
          <button className="btn ghost bell" onClick={() => setNotifOpen(!notifOpen)} aria-label="Notifikationer">
            🔔{unread > 0 && <span className="badge">{unread}</span>}
          </button>
        </header>
        {notifOpen && (
          <div className="notif glass">
            <div className="row between"><b>Notifikationer</b>{unread > 0 && <button className="btn ghost sm" onClick={readAll}>Markér alle læst</button>}</div>
            {(notifs.data || []).length === 0 && <div className="muted pad">Ingen notifikationer</div>}
            {(notifs.data || []).map((n) => (
              <button key={n.id} className={'notif-item' + (n.read_at ? '' : ' unread')} onClick={() => openNotif(n)}>
                <b>{n.title}</b>{n.body && <span>{n.body}</span>}<small>{dateTime(n.created_at)}</small>
              </button>
            ))}
          </div>
        )}
        <main className="content"><Outlet /></main>
      </div>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
    </div>
  )
}
