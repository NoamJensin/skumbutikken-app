import { useEffect, useState } from 'react'
import { supabase, rpc } from '../lib/supabase'
import { useLiveQuery } from '../lib/live'
import { Chip, Field, Modal, Segmented } from './ui'
import { dateTime } from '../lib/format'

const settingsQuery = async () => {
  const [s, b, series] = await Promise.all([
    supabase.from('app_settings').select('*').in('key', ['company', 'messaging', 'templates', 'integration_status']),
    supabase.from('bank_profiles').select('*').order('archived').order('name'),
    rpc('invoice_series')
  ])
  if (s.error) throw new Error(s.error.message)
  const m = {}; s.data.forEach((x) => { m[x.key] = x.value })
  return { ...m, banks: b.data || [], series }
}

async function saveSetting(key, value) {
  const { error } = await supabase.from('app_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key)
  if (error) throw new Error(error.message)
}

export default function AdminInvoiceSettings({ setToast }) {
  const q = useLiveQuery(['app_settings', 'bank_profiles'], settingsQuery)
  if (!q.data) return null
  return (
    <>
      <Company d={q.data} setToast={setToast} />
      <Banks d={q.data} setToast={setToast} />
      <Series d={q.data} setToast={setToast} />
      <Messaging d={q.data} setToast={setToast} />
      <Templates d={q.data} setToast={setToast} />
    </>
  )
}

function Company({ d, setToast }) {
  const [v, setV] = useState(d.company || {})
  useEffect(() => { setV(d.company || {}) }, [d.company])
  const set = (k, x) => setV((o) => ({ ...o, [k]: x, confirmed: false }))
  const save = async (confirmed) => { try { await saveSetting('company', { ...v, payment_days: Number(v.payment_days) || 8, confirmed }); setToast(confirmed ? 'Virksomhedsoplysninger bekræftet – fakturering er aktiv' : 'Gemt') } catch (e) { setToast(e.message) } }
  return (
    <section className="card">
      <div className="card-head"><h3>Virksomhedsoplysninger på fakturaen</h3>{d.company && d.company.confirmed ? <Chip kind="green">Bekræftet</Chip> : <Chip kind="red">Ikke bekræftet – fakturering er spærret</Chip>}</div>
      <div className="grid3">
        <Field label="Firmanavn"><input value={v.name || ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="CVR"><input value={v.cvr || ''} onChange={(e) => set('cvr', e.target.value)} /></Field>
        <Field label="Betalingsfrist (dage)"><input type="number" min="0" value={v.payment_days || 8} onChange={(e) => set('payment_days', e.target.value)} /></Field>
        <Field label="Adresse"><input value={v.address || ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Postnr. og by"><input value={v.zip_city || ''} onChange={(e) => set('zip_city', e.target.value)} /></Field>
        <Field label="Telefon"><input value={v.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="E-mail"><input value={v.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Hjemmeside"><input value={v.web || ''} onChange={(e) => set('web', e.target.value)} /></Field>
      </div>
      <div className="row end gap"><button className="btn soft" onClick={() => save(false)}>Gem</button>
        <button className="btn primary" onClick={() => { if (confirm('Bekræft at oplysningerne er korrekte og må stå på fakturaer?')) save(true) }}>Bekræft og aktivér fakturering</button></div>
    </section>
  )
}

function Banks({ d, setToast }) {
  const [edit, setEdit] = useState(null)
  const makeDefault = async (b) => { try { await rpc('set_default_bank', { p_id: b.id }); setToast(b.name + ' er nu standard') } catch (e) { setToast(e.message) } }
  const archive = async (b, a) => { const { error } = await supabase.from('bank_profiles').update({ archived: a }).eq('id', b.id); setToast(error ? error.message : a ? 'Arkiveret' : 'Gendannet') }
  return (
    <section className="card">
      <div className="card-head"><h3>Bankprofiler</h3><button className="btn primary sm" onClick={() => setEdit({ name: '', bank_name: '', reg_no: '', account_no: '' })}>＋ Ny bankprofil</button></div>
      <div className="table">
        {d.banks.map((b) => (
          <div key={b.id} className={'tr static' + (b.archived ? ' inactive' : '')}>
            <span className="td main"><b>{b.name}</b><small>{b.bank_name} · reg. {b.reg_no} · konto {b.account_no}{b.iban ? ' · ' + b.iban : ''}</small></span>
            <span className="td">{b.is_default ? <Chip kind="green">Standard</Chip> : b.archived ? <Chip kind="grey">Arkiveret</Chip> : null}</span>
            <span className="td hide-sm muted small">Ændret {dateTime(b.updated_at)}</span>
            <span className="td row gap">
              {!b.archived && !b.is_default && <button className="btn soft sm" onClick={() => makeDefault(b)}>Gør til standard</button>}
              {!b.archived && <button className="btn ghost sm" onClick={() => setEdit(b)}>Redigér</button>}
              <button className="btn ghost sm" onClick={() => archive(b, !b.archived)}>{b.archived ? 'Gendan' : 'Arkivér'}</button>
            </span>
          </div>
        ))}
      </div>
      {edit && <BankModal b={edit} onClose={() => setEdit(null)} setToast={setToast} />}
    </section>
  )
}
function BankModal({ b, onClose, setToast }) {
  const [v, setV] = useState({ ...b })
  const set = (k, x) => setV((o) => ({ ...o, [k]: x }))
  const save = async () => {
    const body = { name: v.name, bank_name: v.bank_name, reg_no: String(v.reg_no).trim(), account_no: String(v.account_no).replace(/\s/g, ''), iban: v.iban || null, swift: v.swift || null }
    const r = b.id ? await supabase.from('bank_profiles').update(body).eq('id', b.id) : await supabase.from('bank_profiles').insert(body)
    if (r.error) setToast(/check/.test(r.error.message) ? 'Reg.nr. skal være 4 cifre og kontonr. 4–10 cifre' : r.error.message); else { setToast('Bankprofil gemt'); onClose() }
  }
  return (
    <Modal title={b.id ? 'Redigér bankprofil' : 'Ny bankprofil'} onClose={onClose}>
      <div className="grid2">
        <Field label="Navn på profilen" wide><input value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="fx Driftskonto" /></Field>
        <Field label="Bank" wide><input value={v.bank_name} onChange={(e) => set('bank_name', e.target.value)} /></Field>
        <Field label="Reg.nr."><input inputMode="numeric" value={v.reg_no} onChange={(e) => set('reg_no', e.target.value)} /></Field>
        <Field label="Kontonr."><input inputMode="numeric" value={v.account_no} onChange={(e) => set('account_no', e.target.value)} /></Field>
        <Field label="IBAN (valgfri)"><input value={v.iban || ''} onChange={(e) => set('iban', e.target.value)} /></Field>
        <Field label="BIC/SWIFT (valgfri)"><input value={v.swift || ''} onChange={(e) => set('swift', e.target.value)} /></Field>
      </div>
      <p className="muted small">Ændringer påvirker kun nye fakturaer. Udstedte fakturaer beholder de bankoplysninger, de blev udstedt med.</p>
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Fortryd</button><button className="btn primary" disabled={!v.name || !v.bank_name} onClick={save}>Gem</button></div>
    </Modal>
  )
}

function Series({ d, setToast }) {
  const [next, setNext] = useState(d.series ? d.series.next : 1)
  const [prefix, setPrefix] = useState(d.series ? d.series.prefix : '')
  if (!d.series) return null
  const save = async () => { try { await rpc('set_invoice_start', { p_next: Number(next), p_prefix: prefix }); setToast('Nummerserie gemt') } catch (e) { setToast(e.message) } }
  return (
    <section className="card">
      <div className="card-head"><h3>Fakturanummer</h3>{d.series.locked && <Chip kind="grey">Låst efter første faktura</Chip>}</div>
      <div className="grid3">
        <Field label="Næste fakturanummer" hint="Fortsæt jeres eksisterende nummerrække"><input type="number" min="1" disabled={d.series.locked} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="Præfiks (valgfri)"><input disabled={d.series.locked} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="fx 2026-" /></Field>
        <div className="row end">{!d.series.locked && <button className="btn primary" onClick={save}>Gem</button>}</div>
      </div>
    </section>
  )
}

function Messaging({ d, setToast }) {
  const [v, setV] = useState(d.messaging || {})
  useEffect(() => { setV(d.messaging || {}) }, [d.messaging])
  const set = (k, x) => setV((o) => ({ ...o, [k]: x }))
  const i = d.integration_status || {}
  const save = async () => { try { await saveSetting('messaging', { ...v, reminder_days: v.reminder_days === '' ? null : Number(v.reminder_days), reminder_max: Number(v.reminder_max) || 1 }); setToast('Gemt') } catch (e) { setToast(e.message) } }
  return (
    <section className="card">
      <div className="card-head"><h3>Kundebeskeder</h3>
        <div className="row gap"><Chip kind={i.email_configured ? 'green' : 'red'}>E-mail {i.email_configured ? 'tilsluttet' : 'ikke sat op'}</Chip>
          <Chip kind={i.sms_configured ? 'green' : 'red'}>SMS {i.sms_configured ? 'tilsluttet' : 'ikke sat op'}</Chip>
          <small className="muted">Worker kørt {i.last_run ? dateTime(i.last_run) : 'aldrig'}</small></div></div>
      <div className="grid3">
        <Field label="Ved 'Klar til afhentning'" span><Segmented value={v.auto_on_ready ? 'ja' : 'nej'} options={[['ja', 'Send besked + faktura automatisk'], ['nej', 'Kun manuelt']]} onChange={(x) => set('auto_on_ready', x === 'ja')} /></Field>
        <Field label="Påmindelse efter (dage)" hint="Tom = ingen påmindelser"><input type="number" min="1" value={v.reminder_days == null ? '' : v.reminder_days} onChange={(e) => set('reminder_days', e.target.value)} /></Field>
        <Field label="Afsendernavn"><input value={v.from_name || ''} onChange={(e) => set('from_name', e.target.value)} /></Field>
        <Field label="Afsender e-mail"><input value={v.from_email || ''} onChange={(e) => set('from_email', e.target.value)} /></Field>
        <Field label="Svar til"><input value={v.reply_to || ''} onChange={(e) => set('reply_to', e.target.value)} /></Field>
        <Field label="SMS-afsender (maks. 11 tegn)"><input maxLength={11} value={v.sms_sender || ''} onChange={(e) => set('sms_sender', e.target.value)} /></Field>
        <Field label="Maks. antal påmindelser"><input type="number" min="1" value={v.reminder_max || 1} onChange={(e) => set('reminder_max', e.target.value)} /></Field>
      </div>
      <div className="row end"><button className="btn primary" onClick={save}>Gem</button></div>
    </section>
  )
}

const TPL = [['sms_ready', 'SMS: klar til afhentning'], ['email_ready_subject', 'E-mail: klar – emne'], ['email_ready_body', 'E-mail: klar – tekst'],
  ['email_invoice_subject', 'Fakturamail – emne'], ['email_invoice_body', 'Fakturamail – tekst'], ['sms_reminder', 'SMS: påmindelse'],
  ['email_reminder_subject', 'Påmindelse e-mail – emne'], ['email_reminder_body', 'Påmindelse e-mail – tekst']]
function Templates({ d, setToast }) {
  const [v, setV] = useState(d.templates || {})
  useEffect(() => { setV(d.templates || {}) }, [d.templates])
  const save = async () => { try { await saveSetting('templates', v); setToast('Skabeloner gemt') } catch (e) { setToast(e.message) } }
  return (
    <section className="card">
      <div className="card-head"><h3>Beskedskabeloner</h3><small className="muted">Felter: {'{fornavn} {navn} {ordrenr} {titel} {total} {rest} {rest_tekst} {fakturanr}'}</small></div>
      <div className="grid2">
        {TPL.map(([k, l]) => <Field key={k} label={l} wide={k.endsWith('body')}>
          {k.endsWith('subject') ? <input value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
            : <textarea rows={k.startsWith('sms') ? 3 : 6} value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
          {k.startsWith('sms') && <span className="field-hint">{(v[k] || '').length} tegn ({Math.ceil((v[k] || '').length / 153) || 1} SMS)</span>}
        </Field>)}
      </div>
      <div className="row end"><button className="btn primary" onClick={save}>Gem skabeloner</button></div>
    </section>
  )
}
