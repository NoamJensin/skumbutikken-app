import { useNavigate } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { useLiveQuery } from '../lib/live'
import { Empty } from '../components/ui'
import { kr, totals, dateTime } from '../lib/format'

export default function Afhentning() {
  const nav = useNavigate()
  const q = useLiveQuery(['orders'], async () => {
    const { data, error } = await supabase.from('orders')
      .select('id, order_no, title, updated_at, price_mode, discount_ore, deposit_ore, customers(name, phone), order_parts(label, quantity, unit_price_ore)')
      .eq('status', 'klar_til_afhentning').order('updated_at')
    if (error) throw new Error(error.message)
    return data
  })
  const pickup = async (o) => {
    if (!confirm(`Registrér at ${o.customers ? o.customers.name : 'kunden'} har afhentet ordre ${o.order_no}?`)) return
    try { await rpc('mark_picked_up', { p_order_id: o.id }) } catch (e) { alert(e.message) }
  }
  return (
    <div className="page">
      <div className="page-head"><h1>Afhentning</h1></div>
      {!q.data ? <div className="muted pad">Henter…</div> : q.data.length === 0 ? <Empty>Ingen varer klar til afhentning</Empty> : (
        <div className="cards">
          {q.data.map((o) => {
            const t = totals(o.order_parts, o)
            return (
              <section key={o.id} className="card glass tone-green">
                <div className="card-head"><h3>#{o.order_no} {o.customers && o.customers.name}</h3><small className="muted">klar {dateTime(o.updated_at)}</small></div>
                <div className="muted">{o.title}</div>
                <ul className="list">{o.order_parts.map((p, i) => <li key={i}>{p.quantity} × {p.label}</li>)}</ul>
                <div className="row between"><span>Restbeløb</span><b>{kr(t.rest_ore)}</b></div>
                <div className="row gap"><button className="btn soft" onClick={() => nav('/ordrer/' + o.id)}>Åbn</button><button className="btn primary grow" onClick={() => pickup(o)}>Registrér afhentning</button></div>
              </section>
            )
          })}
        </div>
      )}
      <p className="muted">Placering af varer, delvis afhentning og kundens indleverede ting kommer i fase 2–3.</p>
    </div>
  )
}

export function Kommer({ title, text }) {
  return <div className="page"><div className="page-head"><h1>{title}</h1></div><section className="card glass"><p>{text}</p></section></div>
}
