import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useLiveQuery } from '../lib/live'
import { ConnBadge } from './ui'
import { ROLE, dateTime } from '../lib/format'

const NAV = [
  ['/', 'Overblik', '◧', ['admin', 'butik']],
  ['/ordrer', 'Ordrer', '▤', ['admin', 'butik']],
  ['/skraedder', 'Skrædder', '✂', ['admin', 'butik', 'skraedder']],
  ['/bestillinger', 'Bestillinger', '⇅', ['admin', 'butik']],
  ['/kunder', 'Kunder', '☺', ['admin', 'butik']],
  ['/fakturaer', 'Fakturaer', '₭', ['admin', 'butik']],
  ['/afhentning', 'Afhentning', '⬚', ['admin', 'butik']],
]

export default function Layout() {
  const { employee, lock, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [meOpen, setMeOpen] = useState(false)
  const nav = useNavigate()
  const loc = useLocation()
  useEffect(() => { setMenuOpen(false); setNotifOpen(false); setMeOpen(false) }, [loc.pathname])

  const notifs = useLiveQuery(['notifications'], async () => {
    const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
    if (error) throw new Error(error.message)
    return data
  }, [employee.id])
  const unread = (notifs.data || []).filter((n) => !n.read_at).length
  const items = NAV.filter((n) => n[3].includes(employee.role))

  const openNotif = async (n) => {
    if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    setNotifOpen(false)
    if (n.order_id) nav(employee.role === 'skraedder' ? '/skraedder?ordre=' + n.order_id : '/ordrer/' + n.order_id)
  }
  const readAll = async () => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
  }

  return (
    <div className="shell">
      <header className="topbar">
        <button className="icon-btn burger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">☰</button>
        <div className="logo" onClick={() => nav('/')}>
          <img src="./sb-monogram.png" alt="" />
          <div><div className="logo-name">Skumbutikken</div><div className="logo-sub">Alt i kvalitetsskum</div></div>
        </div>
        <nav className="pills">
          {items.map(([to, label, ic]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => 'pill-nav' + (isActive ? ' active' : '')}>
              <span className="pn-ic">{ic}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="top-right">
          <ConnBadge />
          <button className="icon-btn bell" onClick={() => { setNotifOpen(!notifOpen); setMeOpen(false) }} aria-label="Notifikationer">
            <span>🔔</span>{unread > 0 && <i className="dot">{unread}</i>}
          </button>
          <button className="me-btn" onClick={() => { setMeOpen(!meOpen); setNotifOpen(false) }} aria-label="Min konto">
            <span className="avatar">{employee.display_name.slice(0, 1)}</span>
            <span className="me-name">{employee.display_name}</span>
          </button>
        </div>
      </header>

      {meOpen && (
        <div className="popover me-pop">
          <div className="row gap"><span className="avatar lg">{employee.display_name.slice(0, 1)}</span>
            <div><b>{employee.display_name}</b><div className="muted small">{employee.title || ROLE[employee.role]}</div></div></div>
          <button className="btn soft" onClick={() => { setMeOpen(false); nav('/admin') }}>⚙ {employee.role === 'admin' ? 'Administration' : 'Min profil'}</button>
          <button className="btn soft" onClick={lock}>Skift bruger</button>
          <button className="btn ghost danger" onClick={() => { if (confirm('Log helt ud på denne enhed? Du skal bruge adgangskode næste gang.')) logout() }}>Log ud</button>
        </div>
      )}
      {notifOpen && (
        <div className="popover notif">
          <div className="row between"><b>Notifikationer</b>{unread > 0 && <button className="btn ghost sm" onClick={readAll}>Markér alle læst</button>}</div>
          {(notifs.data || []).length === 0 && <div className="muted pad">Ingen notifikationer</div>}
          {(notifs.data || []).map((n) => (
            <button key={n.id} className={'notif-item' + (n.read_at ? '' : ' unread')} onClick={() => openNotif(n)}>
              <b>{n.title}</b>{n.body && <span>{n.body}</span>}<small>{dateTime(n.created_at)}</small>
            </button>
          ))}
        </div>
      )}
      {menuOpen && (
        <>
          <div className="scrim" onClick={() => setMenuOpen(false)} />
          <nav className="drawer">
            {items.concat([['/admin', employee.role === 'admin' ? 'Administration' : 'Min profil', '⚙']]).map(([to, label, ic]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => 'drawer-link' + (isActive ? ' active' : '')}>
                <span className="pn-ic">{ic}</span>{label}
              </NavLink>
            ))}
          </nav>
        </>
      )}
      <main className="content"><Outlet /></main>
    </div>
  )
}
