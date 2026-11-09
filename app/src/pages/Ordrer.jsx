import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLiveQuery } from '../lib/live'
import { Chip, Empty, Segmented } from '../components/ui'
import { STATUS, date, daysUntil } from '../lib/format'

const FILTERS = [['aktive', 'Aktive'], ['kladde', 'Kladder'], ['arbejde', 'I arbejde'], ['klar', 'Klar'], ['alle', 'Alle']]

export default function Ordrer() {
  const nav = useNavigate()
  const [f, setF] = useState('aktive')
  const [term, setTerm] = useState('')
  const q = useLiveQuery(['orders', 'customers', 'tailor_tasks'], async () => {
    let query = supabase.from('orders')
      .select('id, order_no, title, status, kind, deadline, needs_reconfirm, priority, updated_at, customers(name, phone, email), tailor_tasks(status, progress), employees!orders_assigned_tailor_fkey(display_name)')
      .order('updated_at', { ascending: false }).limit(300)
    if (f === 'aktive') query = query.not('status', 'in', '(afhentet,annulleret)')
    if (f === 'kladde') query = query.in('status', ['kladde', 'klar_til_bekraeftelse'])
    if (f === 'arbejde') query = query.in('status', ['bekraeftet', 'i_arbejde', 'til_kontrol'])
    if (f === 'klar') query = query.eq('status', 'klar_til_afhentning')
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return { rows: data }
  }, [f])

  const t = term.trim().toLowerCase()
  const digits = t.replace(/\D/g, '')
  const rows = ((q.data && q.data.rows) || []).filter((o) => {
    if (!t) return true
    const c = o.customers || {}
    return (o.order_no || '').includes(t) || (o.title || '').toLowerCase().includes(t) ||
      (c.name || '').toLowerCase().includes(t) || (c.email || '').toLowerCase().includes(t) ||
      (digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits))
  })

  return (
    <div className="page">
      <div className="page-head">
        <h1>Kundeordrer</h1>
        <Link className="btn primary lg" to="/ordrer/ny">＋ Ny ordre</Link>
      </div>
      <div className="toolbar">
        <input className="search" placeholder="Søg på kunde, telefon, ordrenr. eller overskrift" value={term} onChange={(e) => setTerm(e.target.value)} />
        <Segmented value={f} options={FILTERS} onChange={setF} />
      </div>
      {q.error && <div className="err">{q.error}</div>}
      {!q.data ? <div className="muted pad">Henter…</div> : rows.length === 0 ? <Empty>Ingen ordrer fundet</Empty> : (
        <div className="table glass">
          {rows.map((o) => {
            const tk = o.tailor_tasks && o.tailor_tasks[0]
            const d = daysUntil(o.deadline)
            return (
              <button key={o.id} className="tr" onClick={() => nav('/ordrer/' + o.id)}>
                <span className="td no">#{o.order_no}</span>
                <span className="td main"><b>{o.customers ? o.customers.name : 'Ingen kunde'}</b><small>{o.title || '—'}{o.kind === 'tilbud' ? ' · tilbud' : ''}</small></span>
                <span className="td"><Chip kind={STATUS[o.status][1]}>{STATUS[o.status][0]}</Chip>{o.needs_reconfirm && <Chip kind="red">Ny bekræftelse</Chip>}</span>
                <span className="td hide-sm">{o.employees ? o.employees.display_name : <span className="muted">Ingen skrædder</span>}{tk ? ` · ${tk.progress} %` : ''}</span>
                <span className={'td dl' + (d != null && d < 0 ? ' late' : d != null && d <= 3 ? ' soon' : '')}>{date(o.deadline)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
