import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLiveQuery } from '../lib/live'
import { Empty, Segmented, Toast, Chip } from '../components/ui'
import { InvoiceChip, openPdf, MessageList, MSG_STATUS } from '../components/InvoiceParts'
import { kr, date } from '../lib/format'

export default function Fakturaer() {
  const nav = useNavigate()
  const [f, setF] = useState('alle')
  const [t, setT] = useState('')
  const [toast, setToast] = useState('')
  const q = useLiveQuery(['invoices', 'message_jobs', 'payments'], async () => {
    const [inv, msg, integ] = await Promise.all([
      supabase.from('invoices').select('id, invoice_no, kind, order_id, issued_at, due_date, total_ore, paid_ore, pdf_status, pdf_path, pdf_error, credits_invoice_id, snapshot->customer->>name, snapshot->order->>order_no').order('issued_at', { ascending: false }).limit(500),
      supabase.from('message_jobs').select('*').in('status', ['afvist', 'uafklaret', 'fejlet', 'klargjort']).order('created_at', { ascending: false }).limit(100),
      supabase.from('app_settings').select('value').eq('key', 'integration_status').maybeSingle()
    ])
    if (inv.error) throw new Error(inv.error.message)
    const credited = new Set(inv.data.filter((i) => i.kind === 'kreditnota').map((i) => i.credits_invoice_id))
    return { invoices: inv.data.map((i) => ({ ...i, credited: credited.has(i.id) })), problems: msg.data || [], integ: integ.data ? integ.data.value : {} }
  })
  const d = q.data
  const s = t.trim().toLowerCase()
  const rows = d ? d.invoices.filter((i) => (f === 'alle' || (f === 'kredit' ? i.kind === 'kreditnota' : i.kind === 'faktura' && !i.credited)) &&
    (!s || String(i.invoice_no).includes(s) || String(i.order_no || '').includes(s) || String(i.name || '').toLowerCase().includes(s))) : []
  const sum = rows.reduce((a, i) => a + Number(i.total_ore), 0)

  const csv = () => {
    const head = ['Nummer', 'Type', 'Dato', 'Ordre', 'Kunde', 'Total inkl. moms']
    const lines = rows.map((i) => [i.invoice_no, i.kind, String(i.issued_at).slice(0, 10), i.order_no, i.name, (i.total_ore / 100).toFixed(2).replace('.', ',')])
    const txt = [head].concat(lines).map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv' })); a.download = 'fakturaer.csv'; a.click()
  }

  return (
    <div className="page">
      <div className="page-head"><h1>Fakturaer</h1><button className="btn soft" onClick={csv}>Eksportér til bogholder (CSV)</button></div>
      {d && (!d.integ.email_configured || !d.integ.sms_configured) && (
        <div className="warn">
          <b>Afsendelse er ikke sat helt op endnu.</b>
          {!d.integ.email_configured && <span>E-mail (Resend) mangler – fakturamails og e-mailbeskeder venter i køen.</span>}
          {!d.integ.sms_configured && <span>SMS (GatewayAPI) mangler – SMS'er venter i køen.</span>}
          <span className="muted small">Beskederne sendes automatisk, så snart nøglerne er lagt ind.</span>
        </div>
      )}
      <div className="toolbar">
        <input className="search" placeholder="Søg på fakturanr., ordrenr. eller kunde" value={t} onChange={(e) => setT(e.target.value)} />
        <Segmented value={f} options={[['alle', 'Alle'], ['aktive', 'Fakturaer'], ['kredit', 'Kreditnotaer']]} onChange={setF} />
      </div>
      {!d ? <div className="muted pad">Henter…</div> : rows.length === 0 ? <Empty>Ingen fakturaer endnu. De udstedes automatisk, når en ordre meldes klar til afhentning.</Empty> : (
        <div className="table glass">
          {rows.map((i) => (
            <div key={i.id} className="tr static inv-row">
              <span className="td main"><b>#{i.invoice_no} · {i.name}</b><small>Ordre {i.order_no} · {date(i.issued_at)}{i.kind === 'faktura' && i.due_date ? ' · forfald ' + date(i.due_date) : ''}</small></span>
              <span className="td"><InvoiceChip inv={i} /></span>
              <span className="td"><b>{kr(i.total_ore)}</b></span>
              <span className="td row gap">
                {i.pdf_status === 'klar' ? <button className="btn soft sm" onClick={() => openPdf(i.pdf_path)}>PDF</button> : <Chip kind={i.pdf_status === 'fejl' ? 'red' : 'amber'}>{i.pdf_status === 'fejl' ? 'PDF-fejl' : 'PDF dannes'}</Chip>}
                <button className="btn ghost sm" onClick={() => nav('/ordrer/' + i.order_id)}>Ordre</button>
              </span>
            </div>
          ))}
          <div className="tr static"><span className="td main"><b>I alt ({rows.length})</b></span><span /><span className="td"><b>{kr(sum)}</b></span><span /></div>
        </div>
      )}
      {d && d.problems.length > 0 && (
        <section className="card">
          <div className="card-head"><h3>Beskeder der kræver opfølgning</h3><small className="muted">{Object.entries(MSG_STATUS).filter(([k]) => ['afvist', 'uafklaret', 'fejlet', 'klargjort'].includes(k)).map(([, v]) => v[0]).join(' · ')}</small></div>
          <MessageList jobs={d.problems} setToast={setToast} />
        </section>
      )}
      <Toast msg={toast} onDone={() => setToast('')} />
    </div>
  )
}
