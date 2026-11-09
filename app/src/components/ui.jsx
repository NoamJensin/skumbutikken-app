import { useEffect, useState } from 'react'
import { useConnection } from '../lib/live'

export function Chip({ kind, children }) {
  return <span className={'chip chip-' + (kind || 'grey')}>{children}</span>
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && onClose) onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget && onClose) onClose() }}>
      <div className={'modal glass' + (wide ? ' modal-wide' : '')} role="dialog" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3>{onClose && <button className="btn ghost" onClick={onClose} aria-label="Luk">✕</button>}</div>
        {children}
      </div>
    </div>
  )
}

export function PinPad({ length = 4, onSubmit, busy, error, label }) {
  const [pin, setPin] = useState('')
  useEffect(() => { if (error) setPin('') }, [error])
  const press = (d) => {
    if (busy) return
    const next = (pin + d).slice(0, 6)
    setPin(next)
  }
  return (
    <div className="pinpad">
      {label && <div className="pin-label">{label}</div>}
      <div className="pin-dots">{Array.from({ length: Math.max(length, pin.length) }).map((_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}</div>
      {error && <div className="err">{error}</div>}
      <div className="pin-grid">
        {['1','2','3','4','5','6','7','8','9'].map((d) => <button key={d} className="pin-key" onClick={() => press(d)}>{d}</button>)}
        <button className="pin-key soft" onClick={() => setPin(pin.slice(0, -1))} aria-label="Slet">⌫</button>
        <button className="pin-key" onClick={() => press('0')}>0</button>
        <button className="pin-key ok" disabled={pin.length < 4 || busy} onClick={() => onSubmit(pin)}>{busy ? '…' : 'OK'}</button>
      </div>
    </div>
  )
}

export function ConnBadge() {
  const c = useConnection()
  let cls = 'ok', txt = 'Online'
  if (!c.online) { cls = 'bad'; txt = 'Offline – afventer forbindelse' }
  else if (c.pending > 0) { cls = 'busy'; txt = 'Gemmer…' }
  else if (c.realtime === 'down') { cls = 'bad'; txt = 'Genopretter forbindelse…' }
  else if (c.realtime === 'connecting') { cls = 'busy'; txt = 'Forbinder…' }
  return <span className={'conn conn-' + cls} title="Forbindelsesstatus"><i />{txt}</span>
}

// Status for et enkelt felt/formular: idle | saving | saved | waiting | error | conflict
export function SaveState({ state, error }) {
  if (state === 'saving') return <span className="save s-saving">Gemmer…</span>
  if (state === 'saved') return <span className="save s-saved">✓ Gemt</span>
  if (state === 'waiting') return <span className="save s-wait">Afventer forbindelse</span>
  if (state === 'conflict') return <span className="save s-err">Ændret på anden enhed</span>
  if (state === 'error') return <span className="save s-err">{error || 'Fejl'}</span>
  return null
}

export function Field({ label, error, children, hint, wide, span }) {
  return (
    <label className={'field' + (error ? ' has-err' : '') + (wide ? ' wide' : '') + (span ? ' span2' : '')}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-err">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function Segmented({ value, options, onChange, disabled }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled}
          className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  )
}

export function Empty({ children }) { return <div className="empty">{children}</div> }

export function Toast({ msg, onDone }) {
  useEffect(() => { if (msg) { const t = setTimeout(onDone, 3500); return () => clearTimeout(t) } }, [msg, onDone])
  if (!msg) return null
  return <div className="toast glass">{msg}</div>
}
