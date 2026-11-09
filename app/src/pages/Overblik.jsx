import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLiveQuery } from '../lib/live'
import { Chip, Empty } from '../components/ui'
import { STATUS, date, daysUntil } from '../lib/format'

function Card({ title, items, empty, tone, render }) {
  return (
    <section className={'card glass tone-' + (tone || 'blue')}>
      <div className="card-head"><h3>{title}</h3><span className="count">{items.length}</span></div>
      {items.length === 0 ? <div className="muted">{empty}</div> : <ul className="list">{items.slice(0, 8).map(render)}</ul>}
    </section>
  )
}

export default function Overblik() {
  const nav = useNavigate()
  const q = useLiveQuery(['orders', 'tailor_tasks', 'comments'], async () => {
    const [o, c] = await Promise.all([
      supabase.from('orders').select('id, order_no, title, status, deadline, needs_reconfirm, prepared_version, confirmed_version, priority, customers(name), tailor_tasks(status, progress, pause_reason, tailor_id)')
        .not('status', 'in', '(afhentet,annulleret)').order('deadline', { ascending: true, nullsFirst: false }),
      supabase.from('comments').select('id, body, created_at, order_id, orders(order_no, title), employees!comments_author_fkey(display_name)')
        .eq('is_question', true).eq('resolved', false).order('created_at', { ascending: false })
    ])
    if (o.error) throw new Error(o.error.message)
    if (c.error) throw new Error(c.error.message)
    return { orders: o.data, questions: c.data }
  })
  if (q.error) return <div className="err pad">{q.error}</div>
  if (!q.data) return <div className="muted pad">Henter…</div>
  const { orders, questions } = q.data
  const task = (o) => (o.tailor_tasks && o.tailor_tasks[0]) || null
  const control = orders.filter((o) => o.status === 'til_kontrol')
  const paused = orders.filter((o) => task(o) && task(o).status === 'pause')
  const awaiting = orders.filter((o) => o.status === 'klar_til_bekraeftelse' || (o.needs_reconfirm))
  const deadline = orders.filter((o) => o.deadline && daysUntil(o.deadline) <= 3 && !['klar_til_afhentning'].includes(o.status))
  const ready = orders.filter((o) => o.status === 'klar_til_afhentning')
  const drafts = orders.filter((o) => o.status === 'kladde' && !o.needs_reconfirm)

  const orderLi = (o, extra) => (
    <li key={o.id}><button className="li-btn" onClick={() => nav('/ordrer/' + o.id)}>
      <b>#{o.order_no}</b> {o.customers ? o.customers.name : '—'} <span className="muted">{o.title}</span>
      <span className="grow" />{extra}
    </button></li>
  )

  return (
    <div className="page">
      <div className="page-head"><h1>Overblik</h1><Link className="btn primary lg" to="/ordrer/ny">＋ Ny ordre</Link></div>
      <div className="cards">
        <Card title="Spørgsmål fra skrædder" tone="red" items={questions} empty="Ingen åbne spørgsmål"
          render={(c) => <li key={c.id}><button className="li-btn" onClick={() => nav('/ordrer/' + c.order_id)}>
            <b>#{c.orders && c.orders.order_no}</b> <span>{c.body}</span><span className="grow" /><small className="muted">{c.employees && c.employees.display_name}</small></button></li>} />
        <Card title="Til kontrol" tone="amber" items={control} empty="Intet venter på kontrol" render={(o) => orderLi(o, <Chip kind="amber">Kontrollér</Chip>)} />
        <Card title="Pause hos skrædder" tone="red" items={paused} empty="Ingen opgaver på pause" render={(o) => orderLi(o, <small className="muted">{task(o).pause_reason}</small>)} />
        <Card title="Tæt på deadline" tone="amber" items={deadline} empty="Ingen ordrer inden for 3 dage"
          render={(o) => orderLi(o, <Chip kind={daysUntil(o.deadline) < 0 ? 'red' : 'amber'}>{daysUntil(o.deadline) < 0 ? 'Overskredet' : date(o.deadline)}</Chip>)} />
        <Card title="Afventer kundens bekræftelse" items={awaiting} empty="Ingen" render={(o) => orderLi(o, o.needs_reconfirm ? <Chip kind="red">Ændret</Chip> : <Chip kind="amber">Klar</Chip>)} />
        <Card title="Klar til afhentning" tone="green" items={ready} empty="Ingen varer klar" render={(o) => orderLi(o, <Chip kind="green">Klar</Chip>)} />
        <Card title="Kladder" tone="grey" items={drafts} empty="Ingen kladder" render={(o) => orderLi(o, <Chip kind={STATUS[o.status][1]}>{STATUS[o.status][0]}</Chip>)} />
        <section className="card glass tone-grey">
          <div className="card-head"><h3>Materialer & bestillinger</h3></div>
          <div className="muted">Skumliste kl. 18.30, manglende materialer og modtagelse kommer i fase 2.</div>
        </section>
      </div>
      {orders.length === 0 && <Empty>Ingen aktive ordrer endnu. Opret den første med “Ny ordre”.</Empty>}
    </div>
  )
}
