import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLiveQuery, serverWrite } from '../lib/live'
import { useAuth } from '../lib/auth'
import { Chip, Field, Modal } from './ui'
import { TextIn } from './inputs'
import { MAT_STATUS, MAT_CAT, dateTime, qty } from '../lib/format'

// Materialer knyttet til ordren (dannes når kunden bekræfter)
export function OrderMaterials({ orderId, parts }) {
  const q = useLiveQuery([{ table: 'material_lines', filter: 'order_id=eq.' + orderId }], async () => {
    const { data, error } = await supabase.from('material_lines').select('id, part_id, category, description, quantity, unit, status, received_qty, is_correction, batch_id')
      .eq('order_id', orderId).not('status', 'eq', 'annulleret').order('category')
    if (error) throw new Error(error.message)
    return data
  }, [orderId])
  const lines = q.data || []
  const label = (pid) => { const p = parts.find((x) => x.id === pid); return p ? (p.label || 'del') : 'slettet del' }
  return (
    <section className="card">
      <div className="card-head"><h3>Materialer</h3><small className="muted">Oprettes automatisk, når kunden bekræfter</small></div>
      {lines.length === 0 ? <div className="muted">Ingen materialebehov endnu</div> : (
        <div className="mat-table">
          {lines.map((l) => (
            <div key={l.id} className={'mat-row compact' + (l.status === 'rettet' ? ' corr' : '')}>
              <span className="mr-cat"><Chip kind="grey">{MAT_CAT[l.category]}</Chip></span>
              <span className="mr-main"><b>{l.description}</b><small>{label(l.part_id)}{l.is_correction ? ' · rettelse' : ''}</small></span>
              <span className="mr-qty">{qty(l.quantity)} {l.unit}</span>
              <span className="mr-status"><Chip kind={MAT_STATUS[l.status][1]}>{MAT_STATUS[l.status][0]}{l.status === 'delvis' ? ` ${qty(l.received_qty)}/${qty(l.quantity)}` : ''}</Chip></span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Placering, indleverede ting og QR-etiket
export function OrderIntake({ order, onLocation, locked }) {
  const nav = useNavigate()
  const { employee } = useAuth()
  const [add, setAdd] = useState(false)
  const q = useLiveQuery([{ table: 'intake_items', filter: 'order_id=eq.' + order.id }], async () => {
    const { data, error } = await supabase.from('intake_items').select('*').eq('order_id', order.id).order('received_at')
    if (error) throw new Error(error.message)
    return data
  }, [order.id])
  const items = q.data || []
  const ret = async (it) => {
    if (!confirm(`Registrér at "${it.description}" er udleveret til kunden?`)) return
    await serverWrite(() => supabase.from('intake_items').update({ returned_at: new Date().toISOString(), returned_by: employee.id }).eq('id', it.id))
  }
  return (
    <section className="card">
      <div className="card-head"><h3>Placering og indleverede ting</h3>
        <div className="row gap"><button className="btn soft sm" onClick={() => nav('/etiket/' + order.id)}>▦ QR-etiketter</button>
          {!locked && <button className="btn soft sm" onClick={() => setAdd(true)}>＋ Indleveret ting</button>}</div></div>
      <div className="grid2">
        <Field label="Placering af ordren" hint="fx Reol B3, Systue, Lager bag disk"><TextIn value={order.location} onChange={onLocation} disabled={locked} /></Field>
      </div>
      {items.length > 0 && (
        <div className="mat-table">
          {items.map((it) => (
            <div key={it.id} className="mat-row compact">
              <span className="mr-cat"><Chip kind={it.returned_at ? 'green' : 'amber'}>{it.returned_at ? 'Udleveret' : 'Hos os'}</Chip></span>
              <span className="mr-main"><b>{it.quantity} × {it.description}</b><small>Modtaget {dateTime(it.received_at)}{it.returned_at ? ' · udleveret ' + dateTime(it.returned_at) : ''}</small></span>
              <span className="mr-qty">{it.location || '—'}</span>
              <span>{!it.returned_at && <button className="btn ghost sm" onClick={() => ret(it)}>Udlevér</button>}</span>
            </div>
          ))}
        </div>
      )}
      {add && <IntakeModal orderId={order.id} onClose={() => setAdd(false)} />}
    </section>
  )
}

function IntakeModal({ orderId, onClose }) {
  const [v, setV] = useState({ description: '', quantity: 1, location: '' })
  const [err, setErr] = useState('')
  const save = async () => {
    const { error } = await serverWrite(() => supabase.from('intake_items').insert({ order_id: orderId, description: v.description.trim(), quantity: v.quantity, location: v.location || null }))
    if (error) setErr(error.message); else onClose()
  }
  return (
    <Modal title="Registrér indleveret ting" onClose={onClose}>
      <p className="muted">Fx kundens gamle hynder, betræk eller skabelon.</p>
      <Field label="Hvad"><input autoFocus value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="fx Gamle sædehynder med betræk" /></Field>
      <div className="grid2">
        <Field label="Antal"><input type="number" min="1" value={v.quantity} onChange={(e) => setV({ ...v, quantity: Math.max(1, Number(e.target.value) || 1) })} /></Field>
        <Field label="Placering"><input value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} placeholder="fx Reol B3" /></Field>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Fortryd</button><button className="btn primary" disabled={!v.description.trim()} onClick={save}>Gem</button></div>
    </Modal>
  )
}
