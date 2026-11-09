import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { serverWrite } from '../lib/live'
import { Field, Segmented, Modal } from './ui'

const EMPTY = { kind: 'privat', name: '', phone: '', email: '', billing_address: '', delivery_address: '', company: '', cvr: '', preferred_contact: 'sms', notes: '' }

// Find mulige dubletter ud fra telefon og e-mail
export async function findDuplicates(phone, email, excludeId) {
  const digits = (phone || '').replace(/\D/g, '').slice(-8)
  const ors = []
  if (digits.length >= 8) ors.push(`phone.ilike.%${digits.slice(0, 2)}%${digits.slice(2, 4)}%${digits.slice(4, 6)}%${digits.slice(6, 8)}%`)
  if (email && email.includes('@')) ors.push(`email.ilike.${email.trim().replace(/[,()%*]/g, '')}`)
  if (!ors.length) return []
  const { data } = await supabase.from('customers').select('id, name, phone, email').or(ors.join(',')).limit(5)
  return (data || []).filter((c) => c.id !== excludeId)
}

export function CustomerFields({ v, set, errors }) {
  const e = errors || {}
  return (
    <div className="grid2">
      <Field label="Kundetype" wide><Segmented value={v.kind} options={[['privat', 'Privat'], ['erhverv', 'Erhverv']]} onChange={(x) => set('kind', x)} /></Field>
      {v.kind === 'erhverv' && <>
        <Field label="Virksomhed" error={e.company}><input value={v.company || ''} onChange={(x) => set('company', x.target.value)} /></Field>
        <Field label="CVR"><input inputMode="numeric" value={v.cvr || ''} onChange={(x) => set('cvr', x.target.value)} /></Field>
      </>}
      <Field label={v.kind === 'erhverv' ? 'Kontaktperson' : 'Navn'} error={e.name}><input value={v.name || ''} onChange={(x) => set('name', x.target.value)} autoComplete="off" /></Field>
      <Field label="Telefon" error={e.phone}><input type="tel" inputMode="tel" value={v.phone || ''} onChange={(x) => set('phone', x.target.value)} autoComplete="off" /></Field>
      <Field label="E-mail" error={e.email}><input type="email" inputMode="email" value={v.email || ''} onChange={(x) => set('email', x.target.value)} autoComplete="off" /></Field>
      <Field label="Foretrukken kontakt"><Segmented value={v.preferred_contact} options={[['sms', 'SMS'], ['email', 'E-mail'], ['telefon', 'Telefon']]} onChange={(x) => set('preferred_contact', x)} /></Field>
      <Field label="Faktureringsadresse" wide><textarea rows={2} value={v.billing_address || ''} onChange={(x) => set('billing_address', x.target.value)} /></Field>
      <Field label="Leveringsadresse (hvis anden)" wide error={e.delivery_address}><textarea rows={2} value={v.delivery_address || ''} onChange={(x) => set('delivery_address', x.target.value)} /></Field>
      <Field label="Noter" wide><textarea rows={2} value={v.notes || ''} onChange={(x) => set('notes', x.target.value)} /></Field>
    </div>
  )
}

// Opret ny kunde (modal) – med dubletkontrol
export function NewCustomerModal({ initial, onClose, onCreated, onPickExisting }) {
  const [v, setV] = useState({ ...EMPTY, ...(initial || {}) })
  const [dups, setDups] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, x) => setV((o) => ({ ...o, [k]: x }))
  useEffect(() => {
    const t = setTimeout(async () => setDups(await findDuplicates(v.phone, v.email)), 350)
    return () => clearTimeout(t)
  }, [v.phone, v.email])
  const save = async () => {
    if (!v.name.trim()) { setErr('Navn mangler'); return }
    setBusy(true); setErr('')
    const clean = {}
    Object.keys(v).forEach((k) => { clean[k] = typeof v[k] === 'string' ? (v[k].trim() || null) : v[k] })
    clean.name = v.name.trim()
    const { data, error } = await serverWrite(() => supabase.from('customers').insert(clean).select().single())
    setBusy(false)
    if (error) { setErr(error.message); return }
    onCreated(data)
  }
  return (
    <Modal title="Ny kunde" onClose={onClose} wide>
      {dups.length > 0 && (
        <div className="warn">
          <b>Mulig dublet:</b>
          {dups.map((d) => (
            <div key={d.id} className="row between"><span>{d.name} · {d.phone || ''} {d.email || ''}</span>
              {onPickExisting && <button className="btn soft sm" onClick={() => onPickExisting(d)}>Brug denne kunde</button>}</div>
          ))}
        </div>
      )}
      <CustomerFields v={v} set={set} />
      {err && <div className="err">{err}</div>}
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Annullér</button>
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Gemmer…' : 'Opret kunde'}</button></div>
    </Modal>
  )
}
