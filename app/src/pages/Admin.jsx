import { useState } from 'react'
import { supabase, adminCall } from '../lib/supabase'
import { useLiveQuery } from '../lib/live'
import { useAuth } from '../lib/auth'
import { Chip, Field, Modal, Segmented, Toast } from '../components/ui'
import { SetPinOverlay } from './Login'
import AdminInvoiceSettings from '../components/AdminInvoiceSettings'
import { ROLE } from '../lib/format'

function genPassword() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const r = new Uint32Array(14); crypto.getRandomValues(r)
  return Array.from(r).map((x) => a[x % a.length]).join('')
}

export default function Admin() {
  const { employee, isAdmin, refreshEmployee } = useAuth()
  const [toast, setToast] = useState('')
  const [pin, setPin] = useState(false)
  const [pw, setPw] = useState(false)
  return (
    <div className="page">
      <div className="page-head"><h1>{isAdmin ? 'Administration' : 'Min profil'}</h1></div>
      <section className="card glass">
        <div className="card-head"><h3>Min profil</h3></div>
        <div className="row gap wrap">
          <span><b>{employee.display_name}</b> · {employee.email} · {ROLE[employee.role]}</span>
          <span className="grow" />
          <button className="btn soft" onClick={() => setPin(true)}>{employee.has_pin ? 'Skift PIN' : 'Opret PIN'}</button>
          <button className="btn soft" onClick={() => setPw(true)}>Skift adgangskode</button>
        </div>
      </section>
      {isAdmin && <Employees setToast={setToast} />}
      {isAdmin && <AdminInvoiceSettings setToast={setToast} />}
      {isAdmin && <section className="card"><div className="card-head"><h3>Leverandører og bestillingstider</h3></div><p className="muted">Findes under Bestillinger → Leverandører og Tidsplan.</p></section>}
      {pin && <SetPinOverlay onDone={async () => { setPin(false); await refreshEmployee(); setToast('PIN gemt') }} />}
      {pw && <PasswordModal onClose={() => setPw(false)} onDone={() => { setPw(false); setToast('Adgangskode ændret') }} />}
      <Toast msg={toast} onDone={() => setToast('')} />
    </div>
  )
}

function PasswordModal({ onClose, onDone }) {
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState('')
  const save = async () => {
    if (a.length < 10) { setErr('Mindst 10 tegn'); return }
    if (a !== b) { setErr('Adgangskoderne er ikke ens'); return }
    const { error } = await supabase.auth.updateUser({ password: a })
    if (error) setErr(error.message); else onDone()
  }
  return (
    <Modal title="Skift adgangskode" onClose={onClose}>
      <Field label="Ny adgangskode"><input type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
      <Field label="Gentag"><input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
      {err && <div className="err">{err}</div>}
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Fortryd</button><button className="btn primary" onClick={save}>Gem</button></div>
    </Modal>
  )
}

function Employees({ setToast }) {
  const { employee } = useAuth()
  const [modal, setModal] = useState(null)
  const q = useLiveQuery(['employees'], async () => {
    const { data, error } = await supabase.from('employees').select('id, display_name, email, role, title, active, has_pin, sort_order').order('active', { ascending: false }).order('sort_order')
    if (error) throw new Error(error.message)
    return data
  })
  const run = async (body, msg) => { try { await adminCall(body); setToast(msg); q.reload() } catch (e) { setToast(e.message) } }
  return (
    <section className="card glass">
      <div className="card-head"><h3>Medarbejdere</h3><button className="btn primary" onClick={() => setModal({ type: 'new' })}>＋ Ny medarbejder</button></div>
      <div className="table">
        {(q.data || []).map((e) => (
          <div key={e.id} className={'tr static' + (e.active ? '' : ' inactive')}>
            <span className="td main"><b>{e.display_name}</b><small>{e.email}</small></span>
            <span className="td"><Chip kind={e.role === 'admin' ? 'blue' : e.role === 'skraedder' ? 'amber' : 'green'}>{ROLE[e.role]}</Chip>{e.title && <small className="muted"> {e.title}</small>}</span>
            <span className="td hide-sm">{e.has_pin ? 'PIN ✓' : <span className="muted">Ingen PIN</span>}</span>
            <span className="td row gap">
              <button className="btn ghost sm" onClick={() => setModal({ type: 'edit', e })}>Redigér</button>
              {e.id !== employee.id && (e.active
                ? <button className="btn ghost sm danger" onClick={() => { if (confirm(`Deaktivér ${e.display_name}? Alle sessioner logges ud med det samme.`)) run({ action: 'set_active', id: e.id, active: false }, 'Deaktiveret og logget ud') }}>Deaktivér</button>
                : <button className="btn ghost sm" onClick={() => run({ action: 'set_active', id: e.id, active: true }, 'Genaktiveret')}>Aktivér</button>)}
            </span>
          </div>
        ))}
      </div>
      {modal && modal.type === 'new' && <NewEmployee onClose={() => setModal(null)} onDone={(pw) => { setModal({ type: 'created', pw }); q.reload() }} />}
      {modal && modal.type === 'created' && (
        <Modal title="Medarbejder oprettet" onClose={() => setModal(null)}>
          <p>Giv medarbejderen denne midlertidige adgangskode. Den vises kun nu:</p>
          <div className="code">{modal.pw.email}<br />{modal.pw.password}</div>
          <p className="muted">Medarbejderen opretter selv sin PIN ved første login og kan skifte adgangskode under Min profil.</p>
          <button className="btn primary" onClick={() => setModal(null)}>OK</button>
        </Modal>
      )}
      {modal && modal.type === 'edit' && <EditEmployee e={modal.e} onClose={() => setModal(null)} setToast={setToast} reload={q.reload} />}
    </section>
  )
}

function NewEmployee({ onClose, onDone }) {
  const [v, setV] = useState({ display_name: '', email: '', role: 'skraedder', title: '' })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true); setErr('')
    const password = genPassword()
    try { await adminCall({ action: 'create', ...v, password }); onDone({ email: v.email, password }) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Ny medarbejder" onClose={onClose}>
      <Field label="Navn"><input value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} /></Field>
      <Field label="E-mail (bruges til login)"><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
      <Field label="Rolle"><Segmented value={v.role} options={[['skraedder', 'Skrædder'], ['butik', 'Butik'], ['admin', 'Administrator']]} onChange={(x) => setV({ ...v, role: x })} /></Field>
      <Field label="Titel (valgfri)"><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="fx Butiksansvarlig" /></Field>
      {err && <div className="err">{err}</div>}
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Fortryd</button><button className="btn primary" disabled={busy || !v.display_name || !v.email} onClick={save}>{busy ? 'Opretter…' : 'Opret'}</button></div>
    </Modal>
  )
}

function EditEmployee({ e, onClose, setToast, reload }) {
  const [v, setV] = useState({ display_name: e.display_name, role: e.role, title: e.title || '', sort_order: e.sort_order })
  const [newPw, setNewPw] = useState(null)
  const save = async () => {
    const { error } = await supabase.from('employees').update({ ...v, title: v.title || null }).eq('id', e.id)
    if (error) setToast(error.message); else { setToast('Gemt'); reload(); onClose() }
  }
  const resetPw = async () => {
    const password = genPassword()
    try { await adminCall({ action: 'reset_password', id: e.id, password }); setNewPw(password) } catch (x) { setToast(x.message) }
  }
  return (
    <Modal title={'Redigér ' + e.display_name} onClose={onClose}>
      <Field label="Navn"><input value={v.display_name} onChange={(x) => setV({ ...v, display_name: x.target.value })} /></Field>
      <Field label="Rolle"><Segmented value={v.role} options={[['skraedder', 'Skrædder'], ['butik', 'Butik'], ['admin', 'Administrator']]} onChange={(x) => setV({ ...v, role: x })} /></Field>
      <Field label="Titel"><input value={v.title} onChange={(x) => setV({ ...v, title: x.target.value })} /></Field>
      <Field label="Sortering"><input type="number" value={v.sort_order} onChange={(x) => setV({ ...v, sort_order: Number(x.target.value) })} /></Field>
      <div className="row gap wrap">
        <button className="btn soft sm" onClick={resetPw}>Ny adgangskode</button>
        <button className="btn soft sm" onClick={async () => { try { await adminCall({ action: 'clear_pin', id: e.id }); setToast('PIN nulstillet'); reload() } catch (x) { setToast(x.message) } }}>Nulstil PIN</button>
        <button className="btn soft sm" onClick={async () => { try { await adminCall({ action: 'revoke_sessions', id: e.id }); setToast('Alle sessioner logget ud') } catch (x) { setToast(x.message) } }}>Log ud på alle enheder</button>
      </div>
      {newPw && <div className="code">Ny adgangskode: {newPw}</div>}
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Luk</button><button className="btn primary" onClick={save}>Gem</button></div>
    </Modal>
  )
}
