import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase, rpc } from './supabase'
import { listAccounts, upsertAccount, updateToken, removeAccount, clearUserDrafts } from './accounts'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

const LOCK_AFTER_MS = 10 * 60 * 1000 // automatisk skærmlås efter 10 min uden aktivitet

async function loadEmployee(uid) {
  const { data, error } = await supabase.from('employees')
    .select('id, display_name, email, role, title, active, has_pin').eq('id', uid).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [employee, setEmployee] = useState(null)
  const [locked, setLocked] = useState(true)
  const [ready, setReady] = useState(false)
  const lastActivity = useRef(Date.now())

  // Hold enhedens gemte refresh-token opdateret ved rotation
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (s && s.user) updateToken(s.user.id, s.refresh_token)
      if (event === 'SIGNED_OUT') { setEmployee(null); setLocked(true) }
    })
    supabase.auth.getSession().then(async ({ data }) => {
      const s = data.session
      setSession(s)
      if (s) {
        try {
          const e = await loadEmployee(s.user.id)
          if (e && e.active) { setEmployee(e); setLocked(true) } // altid låst ved app-start → PIN/adgangskode
        } catch (err) { /* offline: forbliv låst */ }
      }
      setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Inaktivitetslås
  useEffect(() => {
    const mark = () => { lastActivity.current = Date.now() }
    const evs = ['pointerdown', 'keydown', 'touchstart', 'scroll']
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }))
    const t = setInterval(() => {
      if (!locked && employee && Date.now() - lastActivity.current > LOCK_AFTER_MS && !location.hash.startsWith('#/kunde/')) setLocked(true)
    }, 15000)
    return () => { evs.forEach((e) => window.removeEventListener(e, mark)); clearInterval(t) }
  }, [locked, employee])

  const signInPassword = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Forkert e-mail eller adgangskode' : error.message)
    const e = await loadEmployee(data.user.id)
    if (!e || !e.active) {
      await supabase.auth.signOut({ scope: 'local' })
      throw new Error('Brugeren er ikke aktiv. Kontakt administrator.')
    }
    upsertAccount({ id: e.id, name: e.display_name, role: e.role, email: e.email, refresh_token: data.session.refresh_token })
    setEmployee(e); setLocked(false); lastActivity.current = Date.now()
    return e
  }, [])

  // Skift til en konto på enheden med PIN
  const switchWithPin = useCallback(async (acc, pin) => {
    const cur = (await supabase.auth.getSession()).data.session
    if (!cur || cur.user.id !== acc.id) {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: acc.refresh_token })
      if (error || !data.session) {
        removeAccount(acc.id)
        throw new Error('Sessionen er udløbet eller tilbagekaldt. Log ind med adgangskode.')
      }
    }
    const res = await rpc('verify_my_pin', { p_pin: pin })
    if (!res.ok) {
      setLocked(true)
      if (res.reason === 'laast') throw new Error('For mange forkerte forsøg. Låst til ' + new Date(res.until).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }))
      if (res.reason === 'ingen_pin') throw new Error('Ingen PIN oprettet. Log ind med adgangskode.')
      if (res.reason === 'inaktiv') { removeAccount(acc.id); throw new Error('Brugeren er deaktiveret.') }
      throw new Error('Forkert PIN' + (res.left != null ? ` (${res.left} forsøg tilbage)` : ''))
    }
    const e = await loadEmployee(acc.id)
    setEmployee(e); setLocked(false); lastActivity.current = Date.now()
    return e
  }, [])

  const lock = useCallback(() => setLocked(true), [])

  const logout = useCallback(async () => {
    const uid = employee && employee.id
    if (uid) { clearUserDrafts(uid); removeAccount(uid) }
    try { await supabase.auth.signOut({ scope: 'local' }) } catch (e) { /* ignore */ }
    try { if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k.includes('runtime')).map((k) => caches.delete(k))) } } catch (e) { /* ignore */ }
    setEmployee(null); setLocked(true)
  }, [employee])

  const refreshEmployee = useCallback(async () => {
    if (employee) setEmployee(await loadEmployee(employee.id))
  }, [employee])

  const value = { ready, session, employee, locked, signInPassword, switchWithPin, lock, logout, refreshEmployee,
    accounts: listAccounts, isStaff: !!employee && (employee.role === 'admin' || employee.role === 'butik'),
    isAdmin: !!employee && employee.role === 'admin' }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
