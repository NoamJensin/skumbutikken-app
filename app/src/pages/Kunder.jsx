import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLiveQuery } from '../lib/live'
import { useAuth } from '../lib/auth'
import { useRowSaver } from '../lib/saver'
import { Chip, Empty, SaveState } from '../components/ui'
import { CustomerFields, NewCustomerModal } from '../components/CustomerForm'
import { STATUS, date } from '../lib/format'

export default function Kunder() {
  const nav = useNavigate()
  const [t, setT] = useState('')
  const [adding, setAdding] = useState(false)
  const q = useLiveQuery(['customers'], async () => {
    const s = t.trim().replace(/[,()%*]/g, '')
    let qq = supabase.from('customers').select('id, name, phone, email, company, kind, updated_at').order('name').limit(200)
    if (s) {
      const digits = s.replace(/\D/g, '')
      const ors = [`name.ilike.%${s}%`, `email.ilike.%${s}%`, `company.ilike.%${s}%`]
      if (digits.length >= 3) ors.push(`phone.ilike.%${digits}%`)
      qq = qq.or(ors.join(','))
    }
    const { data, error } = await qq
    if (error) throw new Error(error.message)
    return data
  }, [t])
  return (
    <div className="page">
      <div className="page-head"><h1>Kundekartotek</h1><button className="btn primary lg" onClick={() => setAdding(true)}>＋ Ny kunde</button></div>
      <input className="search" placeholder="Søg på navn, telefon, e-mail eller virksomhed" value={t} onChange={(e) => setT(e.target.value)} />
      {!q.data ? <div className="muted pad">Henter…</div> : q.data.length === 0 ? <Empty>Ingen kunder</Empty> : (
        <div className="table glass">
          {q.data.map((c) => (
            <button key={c.id} className="tr" onClick={() => nav('/kunder/' + c.id)}>
              <span className="td main"><b>{c.name}</b><small>{c.company || (c.kind === 'erhverv' ? 'Erhverv' : 'Privat')}</small></span>
              <span className="td">{c.phone || '–'}</span><span className="td hide-sm">{c.email || '–'}</span>
            </button>
          ))}
        </div>
      )}
      {adding && <NewCustomerModal onClose={() => setAdding(false)} onCreated={(c) => nav('/kunder/' + c.id)} onPickExisting={(c) => nav('/kunder/' + c.id)} />}
    </div>
  )
}

export function Kundekort() {
  const { id } = useParams()
  const nav = useNavigate()
  const { employee } = useAuth()
  const [row, setRow] = useState(null)
  const q = useLiveQuery(['customers', 'orders'], async () => {
    const [c, o] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).maybeSingle(),
      supabase.from('orders').select('id, order_no, title, status, deadline, created_at, order_parts(label, quantity, length_cm, width_cm, thickness_cm, foam_type, fabric)').eq('customer_id', id).order('created_at', { ascending: false })
    ])
    if (c.error) throw new Error(c.error.message)
    setRow(c.data)
    return { orders: o.data || [] }
  }, [id])
  const s = useRowSaver({ table: 'customers', row, uid: employee.id, onSaved: setRow })
  if (q.error) return <div className="page err">{q.error}</div>
  if (!row || !q.data) return <div className="page muted">Henter…</div>
  const active = q.data.orders.filter((o) => !['afhentet', 'annulleret'].includes(o.status))
  const past = q.data.orders.filter((o) => ['afhentet', 'annulleret'].includes(o.status))
  const OrderRow = (o) => (
    <button key={o.id} className="tr" onClick={() => nav('/ordrer/' + o.id)}>
      <span className="td no">#{o.order_no}</span>
      <span className="td main"><b>{o.title || '—'}</b><small>{(o.order_parts || []).map((p) => `${p.label || 'del'}${p.length_cm ? ` ${p.length_cm}×${p.width_cm}×${p.thickness_cm}` : ''}${p.foam_type ? ' ' + p.foam_type : ''}${p.fabric ? ' · ' + p.fabric : ''}`).join(' | ')}</small></span>
      <span className="td"><Chip kind={STATUS[o.status][1]}>{STATUS[o.status][0]}</Chip></span>
      <span className="td">{date(o.deadline || o.created_at)}</span>
    </button>
  )
  return (
    <div className="page">
      <div className="page-head"><button className="btn ghost" onClick={() => nav(-1)}>←</button><h1 className="grow">{row.name}</h1><SaveState state={s.state} error={s.error} />
        <Link className="btn primary lg" to={'/ordrer/ny?kunde=' + id}>＋ Ny ordre</Link></div>
      {s.state === 'conflict' && <div className="warn">Kunden er ændret på en anden enhed. <button className="btn primary sm" onClick={() => s.resolve(true)}>Gem mine</button> <button className="btn soft sm" onClick={() => s.resolve(false)}>Brug deres</button></div>}
      <section className="card glass"><CustomerFields v={{ ...row, ...s.pending }} set={(k, v) => s.set(k, v)} /></section>
      <section className="card glass"><div className="card-head"><h3>Aktive ordrer ({active.length})</h3></div>
        {active.length ? <div className="table">{active.map(OrderRow)}</div> : <div className="muted">Ingen</div>}</section>
      <section className="card glass"><div className="card-head"><h3>Tidligere ordrer ({past.length})</h3><small className="muted">Åbn en ordre og vælg “Genbestil” for at kopiere mål og materialer</small></div>
        {past.length ? <div className="table">{past.map(OrderRow)}</div> : <div className="muted">Ingen</div>}</section>
      <section className="card glass"><div className="card-head"><h3>Fakturaer og beskedhistorik</h3></div><div className="muted">Kommer i fase 3.</div></section>
    </div>
  )
}
