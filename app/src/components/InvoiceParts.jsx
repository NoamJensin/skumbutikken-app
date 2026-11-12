import { useState } from 'react'
import { supabase, rpc } from '../lib/supabase'
import { useLiveQuery, serverWrite } from '../lib/live'
import { Chip, Field, Modal, Segmented } from './ui'
import { KrIn } from './inputs'
import { kr, date, dateTime, totals } from '../lib/format'

export const MSG_STATUS = {
  klargjort: ['Klargjort', 'grey'], i_koe: ['I kø', 'blue'], afsendt: ['Afsendt', 'green'], leveret: ['Leveret', 'green'],
  afvist: ['Afvist', 'red'], fejlet: ['Fejlet – prøver igen', 'amber'], uafklaret: ['Uafklaret', 'red'], annulleret: ['Annulleret', 'grey']
}
export const MSG_KIND = { afhentning: 'Afhentningsbesked', faktura: 'Faktura', paamindelse: 'Påmindelse', genafsendelse: 'Genafsendelse' }
const PAY = [['kort', 'Kort'], ['mobilepay', 'MobilePay'], ['kontant', 'Kontant'], ['bankoverfoersel', 'Bankoverførsel'], ['andet', 'Andet']]
const uuid = () => crypto.randomUUID()

export async function openPdf(path) {
  const w = window.open('', '_blank')
  const { data, error } = await supabase.storage.from('fakturaer').createSignedUrl(path, 300)
  if (error) { if (w) w.close(); alert(error.message); return }
  if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl
}

export function InvoiceChip({ inv }) {
  if (inv.kind === 'kreditnota') return <Chip kind="amber">Kreditnota</Chip>
  if (inv.credited) return <Chip kind="grey">Krediteret</Chip>
  return <Chip kind="green">Faktura</Chip>
}

export function MessageList({ jobs, setToast }) {
  if (!jobs.length) return <div className="muted">Ingen beskeder</div>
  const resend = async (j) => {
    if (!confirm(`Send ${j.channel === 'sms' ? 'SMS' : 'e-mail'} igen til ${j.recipient}?`)) return
    try { await rpc('resend_message', { p_job: j.id, p_request: uuid() }); setToast && setToast('Genafsendelse lagt i kø') } catch (e) { setToast && setToast(e.message) }
  }
  return (
    <div className="mat-table">
      {jobs.map((j) => (
        <div key={j.id} className="mat-row compact">
          <span className="mr-cat"><Chip kind="grey">{j.channel === 'sms' ? 'SMS' : 'E-mail'}</Chip></span>
          <span className="mr-main"><b>{MSG_KIND[j.kind]}{j.subject ? ' · ' + j.subject : ''}</b>
            <small>{j.recipient} · {dateTime(j.created_at)}{j.last_error && !['afsendt', 'leveret'].includes(j.status) ? ' · ' + j.last_error : ''}</small></span>
          <span className="mr-qty"><Chip kind={MSG_STATUS[j.status][1]}>{MSG_STATUS[j.status][0]}</Chip></span>
          <span>{['afsendt', 'leveret', 'afvist', 'uafklaret', 'fejlet'].includes(j.status) && <button className="btn ghost sm" onClick={() => resend(j)}>Send igen</button>}</span>
        </div>
      ))}
    </div>
  )
}

// Fakturaer, betalinger og beskeder på ordren
export function OrderInvoicing({ order, parts, onSetBank, setToast }) {
  const [modal, setModal] = useState(null)
  const q = useLiveQuery([{ table: 'invoices', filter: 'order_id=eq.' + order.id }, { table: 'payments', filter: 'order_id=eq.' + order.id }, { table: 'message_jobs', filter: 'order_id=eq.' + order.id }, 'bank_profiles'], async () => {
    const [inv, pay, msg, banks, comp] = await Promise.all([
      supabase.from('invoices').select('id, invoice_no, kind, issued_at, total_ore, pdf_status, pdf_path, pdf_error, credits_invoice_id, bank_profile_id').eq('order_id', order.id).order('issued_at'),
      supabase.from('payments').select('*').eq('order_id', order.id).order('paid_at'),
      supabase.from('message_jobs').select('*').eq('order_id', order.id).order('created_at', { ascending: false }),
      supabase.from('bank_profiles').select('*').eq('archived', false).order('name'),
      supabase.from('app_settings').select('value').eq('key', 'company').maybeSingle()
    ])
    const e = [inv, pay, msg, banks].find((x) => x.error)
    if (e) throw new Error(e.error.message)
    const credited = new Set(inv.data.filter((i) => i.kind === 'kreditnota').map((i) => i.credits_invoice_id))
    return { invoices: inv.data.map((i) => ({ ...i, credited: credited.has(i.id) })), payments: pay.data, jobs: msg.data, banks: banks.data, company: comp.data ? comp.data.value : {} }
  }, [order.id])
  if (!q.data) return null
  const { invoices, payments, jobs, banks, company } = q.data
  const active = invoices.find((i) => i.kind === 'faktura' && !i.credited)
  const paid = payments.reduce((s, p) => s + Number(p.amount_ore), 0)
  const t = totals(parts, order)
  const defBank = banks.find((b) => b.is_default)
  const chosen = banks.find((b) => b.id === order.bank_profile_id) || (order.bank_profile_id ? null : defBank)
  const canIssue = order.confirmed_version && !active

  return (
    <section className="card">
      <div className="card-head"><h3>Faktura og betaling</h3>
        <div className="row gap wrap">
          <button className="btn soft sm" onClick={() => setModal('pay')}>＋ Registrér betaling</button>
          {canIssue && <button className="btn primary sm" onClick={() => setModal('issue')}>Udsted faktura</button>}
        </div></div>
      <div className="grid3">
        <Field label="Bankprofil på fakturaen" hint={order.bank_profile_id ? '' : 'Standardprofilen bruges'}>
          <select value={order.bank_profile_id || ''} onChange={(e) => onSetBank(e.target.value || null)} disabled={!!active}>
            <option value="">Standard{defBank ? ` (${defBank.name})` : ' – ingen valgt!'}</option>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.reg_no} {b.account_no}</option>)}
          </select></Field>
        <div className="mini-stats" style={{ gridColumn: 'span 2' }}>
          <div><b>{kr(t.total_ore)}</b><span>Ordretotal inkl. moms</span></div>
          <div><b>{kr(paid)}</b><span>Indbetalt</span></div>
          <div><b>{kr(Math.max(t.total_ore - paid, 0))}</b><span>Restsaldo</span></div>
          <div><b>{active ? '#' + active.invoice_no : '—'}</b><span>Aktiv faktura</span></div>
        </div>
      </div>
      {!company.confirmed && <div className="warn small">Virksomhedsoplysninger er ikke bekræftet. Administrator skal bekræfte dem under Administration, før der kan udstedes fakturaer.</div>}
      {!chosen && <div className="warn small">Ingen aktiv bankprofil. Vælg en profil, ellers afventer fakturaen.</div>}
      {invoices.length > 0 && (
        <div className="mat-table">
          {invoices.map((i) => (
            <div key={i.id} className="mat-row compact">
              <span className="mr-cat"><InvoiceChip inv={i} /></span>
              <span className="mr-main"><b>#{i.invoice_no} · {kr(i.total_ore)}</b><small>Udstedt {dateTime(i.issued_at)}{i.pdf_status === 'fejl' ? ' · PDF-fejl: ' + i.pdf_error : i.pdf_status === 'afventer' ? ' · PDF dannes…' : ''}</small></span>
              <span className="mr-qty">{i.pdf_status === 'klar' && <button className="btn soft sm" onClick={() => openPdf(i.pdf_path)}>PDF</button>}</span>
              <span className="row gap">
                {i.kind === 'faktura' && !i.credited && <button className="btn ghost sm" onClick={async () => { try { await rpc('send_invoice_email', { p_invoice: i.id }); setToast('Fakturamail lagt i kø') } catch (e) { setToast(e.message) } }}>Mail</button>}
                {i.kind === 'faktura' && !i.credited && <button className="btn ghost sm danger" onClick={() => setModal({ credit: i })}>Kreditnota</button>}
              </span>
            </div>
          ))}
        </div>
      )}
      {payments.length > 0 && (
        <div className="mat-table">
          {payments.map((p) => (
            <div key={p.id} className="mat-row compact">
              <span className="mr-cat"><Chip kind="green">Betaling</Chip></span>
              <span className="mr-main"><b>{kr(p.amount_ore)} · {(PAY.find((x) => x[0] === p.method) || [0, p.method])[1]}</b><small>{dateTime(p.paid_at)}{p.note ? ' · ' + p.note : ''}</small></span>
              <span /><span />
            </div>
          ))}
        </div>
      )}
      <h3 className="sub">Kundebeskeder</h3>
      <MessageList jobs={jobs} setToast={setToast} />
      {modal === 'issue' && <IssueModal order={order} parts={parts} bank={chosen} paid={paid} onClose={() => setModal(null)} setToast={setToast} />}
      {modal === 'pay' && <PayModal order={order} rest={Math.max(t.total_ore - paid, 0)} onClose={() => setModal(null)} setToast={setToast} />}
      {modal && modal.credit && <CreditModal inv={modal.credit} onClose={() => setModal(null)} setToast={setToast} />}
    </section>
  )
}

function IssueModal({ order, parts, bank, paid, onClose, setToast }) {
  const [req] = useState(uuid)
  const [busy, setBusy] = useState(false)
  const t = totals(parts, order)
  const issue = async () => {
    setBusy(true)
    try { const r = await serverWrite(() => rpc('issue_invoice', { p_order_id: order.id, p_bank: bank ? bank.id : null, p_request: req })); setToast('Faktura ' + r.invoice_no + ' udstedt – PDF dannes'); onClose() }
    catch (e) { setToast(/BANKPROFIL/.test(e.message) ? 'Vælg en aktiv bankprofil' : /VIRKSOMHED/.test(e.message) ? 'Virksomhedsoplysninger skal bekræftes af administrator' : /ALLEREDE/.test(e.message) ? 'Ordren er allerede faktureret' : e.message) }
    finally { setBusy(false) }
  }
  return (
    <Modal title="Forhåndsvisning af faktura" onClose={onClose} wide>
      <div className="inv-preview">
        <div className="ip-head"><b>FAKTURA</b><span>Ordre {order.order_no} · nummer tildeles ved udstedelse</span></div>
        <div className="ip-lines">
          {parts.map((p) => <div key={p.id} className="row between"><span>{p.label || 'Del'}</span><span>{p.quantity} × {kr(p.unit_price_ore)}</span><b>{kr(p.quantity * p.unit_price_ore)}</b></div>)}
          {t.discount_ore > 0 && <div className="row between"><span>Rabat</span><span /><b>− {kr(t.discount_ore)}</b></div>}
        </div>
        <div className="grid2">
          <div><b>Bank detaljer</b>{bank ? <div>{bank.bank_name}<br />Regnr. {bank.reg_no}<br />Kontonr. {bank.account_no}</div> : <div className="err">Ingen aktiv bankprofil</div>}</div>
          <dl className="ip-tot"><dt>Sub total (ekskl. moms)</dt><dd>{kr(t.base_ore)}</dd><dt>Moms 25 %</dt><dd>{kr(t.vat_ore)}</dd><dt><b>Total</b></dt><dd><b>{kr(t.total_ore)}</b></dd>
            {paid > 0 && <><dt>Betalt</dt><dd>− {kr(paid)}</dd></>}</dl>
        </div>
      </div>
      <p className="muted small">Fakturaen låses ved udstedelse. Senere rettelser kræver en kreditnota.</p>
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Fortryd</button><button className="btn primary" disabled={busy || !bank} onClick={issue}>{busy ? 'Udsteder…' : 'Udsted faktura'}</button></div>
    </Modal>
  )
}

function PayModal({ order, rest, onClose, setToast }) {
  const [req] = useState(uuid)
  const [v, setV] = useState({ amount: rest, method: 'kort', note: '' })
  const save = async () => {
    try { await serverWrite(() => rpc('register_payment', { p_order: order.id, p_amount_ore: v.amount, p_method: v.method, p_note: v.note || null, p_request: req })); setToast('Betaling registreret'); onClose() }
    catch (e) { setToast(e.message) }
  }
  return (
    <Modal title="Registrér betaling" onClose={onClose}>
      <Field label="Beløb"><KrIn value={v.amount} onChange={(x) => setV({ ...v, amount: x })} /></Field>
      <Field label="Betalingsmåde"><Segmented value={v.method} options={PAY} onChange={(x) => setV({ ...v, method: x })} /></Field>
      <Field label="Note"><input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="fx depositum" /></Field>
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Fortryd</button><button className="btn primary" disabled={!v.amount} onClick={save}>Registrér</button></div>
    </Modal>
  )
}

function CreditModal({ inv, onClose, setToast }) {
  const [req] = useState(uuid)
  const [reason, setReason] = useState('')
  const save = async () => {
    try { const r = await serverWrite(() => rpc('create_credit_note', { p_invoice: inv.id, p_reason: reason, p_request: req })); setToast('Kreditnota ' + r.invoice_no + ' oprettet. Du kan nu udstede en ny faktura.'); onClose() }
    catch (e) { setToast(e.message) }
  }
  return (
    <Modal title={'Kreditnota til faktura ' + inv.invoice_no} onClose={onClose}>
      <p>Hele fakturaen på {kr(inv.total_ore)} krediteres. Bagefter kan der udstedes en ny, rettet faktura på ordren.</p>
      <Field label="Årsag (vises på kreditnotaen)"><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Fortryd</button><button className="btn primary" disabled={!reason.trim()} onClick={save}>Opret kreditnota</button></div>
    </Modal>
  )
}

export function fmtDue(d) { return date(d) }
