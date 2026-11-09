import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { rpc } from '../lib/supabase'
import { PinPad } from '../components/ui'
import { ROLE } from '../lib/format'

export default function Login() {
  const { signInPassword, switchWithPin } = useAuth()
  const accounts = useAuth().accounts()
  const [mode, setMode] = useState(accounts.length ? 'pick' : 'password')
  const [acc, setAcc] = useState(null)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const doPassword = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      await signInPassword(email, pw)
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const doPin = async (pin) => {
    setBusy(true); setErr('')
    try { await switchWithPin(acc, pin) } catch (x) {
      setErr(x.message)
      if (/adgangskode|deaktiveret/i.test(x.message)) { setEmail(acc.email); setMode('password') }
    } finally { setBusy(false) }
  }

  return (
    <div className="login-wrap">
      <div className="login glass">
        <div className="login-brand">
          <img src="./sb-monogram.png" alt="Skumbutikken" />
          <div><div className="brand-name big">SKUMBUTIKKEN</div><div className="brand-sub">Medarbejder</div></div>
        </div>

        {mode === 'pick' && (
          <>
            <h2>Vælg medarbejder</h2>
            <div className="acc-grid">
              {accounts.map((a) => (
                <button key={a.id} className="acc" onClick={() => { setAcc(a); setErr(''); setMode('pin') }}>
                  <div className="avatar lg">{a.name.slice(0, 1)}</div><b>{a.name}</b><small>{ROLE[a.role]}</small>
                </button>
              ))}
              <button className="acc add" onClick={() => { setEmail(''); setErr(''); setMode('password') }}>
                <div className="avatar lg">＋</div><b>Anden medarbejder</b><small>Log ind med e-mail</small>
              </button>
            </div>
          </>
        )}

        {mode === 'pin' && acc && (
          <>
            <h2>Hej {acc.name}</h2>
            <PinPad label="Indtast din PIN" busy={busy} error={err} onSubmit={doPin} />
            <div className="row center gap">
              <button className="btn ghost" onClick={() => { setMode('pick'); setErr('') }}>← Tilbage</button>
              <button className="btn ghost" onClick={() => { setEmail(acc.email); setErr(''); setMode('password') }}>Brug adgangskode</button>
            </div>
          </>
        )}

        {mode === 'password' && (
          <form onSubmit={doPassword} className="stack">
            <h2>Log ind</h2>
            <label className="field"><span className="field-label">E-mail</span>
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label className="field"><span className="field-label">Adgangskode</span>
              <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
            {err && <div className="err">{err}</div>}
            <button className="btn primary lg" disabled={busy}>{busy ? 'Logger ind…' : 'Log ind'}</button>
            {accounts.length > 0 && <button type="button" className="btn ghost" onClick={() => { setMode('pick'); setErr('') }}>← Vælg medarbejder</button>}
          </form>
        )}
      </div>
    </div>
  )
}

export function SetPinOverlay({ onDone }) {
  const [first, setFirst] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (pin) => {
    if (!first) { setFirst(pin); setErr(''); return }
    if (pin !== first) { setFirst(null); setErr('PIN-koderne var ikke ens. Prøv igen.'); return }
    setBusy(true)
    try { await rpc('set_my_pin', { p_pin: pin }); onDone() } catch (x) { setErr(x.message); setFirst(null) } finally { setBusy(false) }
  }
  return (
    <div className="modal-bg"><div className="modal glass">
      <h3>Opret PIN til hurtigt brugerskift</h3>
      <p className="muted">4–6 cifre. Bruges på fælles tablets og når skærmen er låst.</p>
      <PinPad key={first ? 'b' : 'a'} label={first ? 'Gentag PIN' : 'Vælg PIN'} busy={busy} error={err} onSubmit={submit} />
      <button className="btn ghost" onClick={onDone}>Spring over</button>
    </div></div>
  )
}
