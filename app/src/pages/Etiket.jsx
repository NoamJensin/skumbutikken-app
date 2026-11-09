import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { date } from '../lib/format'

// QR-etiketter: én for ordren og én pr. ordredel. QR åbner ordren i appen (kræver login).
export default function Etiket() {
  const { id } = useParams()
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [qr, setQr] = useState({})
  useEffect(() => {
    (async () => {
      const [o, p] = await Promise.all([
        supabase.from('orders').select('id, order_no, title, deadline, location, customers(name, phone)').eq('id', id).single(),
        supabase.from('order_parts').select('id, label, quantity, length_cm, width_cm, thickness_cm').eq('order_id', id).order('sort')
      ])
      if (o.error) return
      setD({ o: o.data, parts: p.data || [] })
      const base = location.origin + location.pathname + '#/ordrer/' + id
      const m = { order: await QRCode.toDataURL(base, { margin: 1, width: 240, color: { dark: '#0c3a49' } }) }
      for (const part of p.data || []) m[part.id] = await QRCode.toDataURL(base + '?del=' + part.id, { margin: 1, width: 240, color: { dark: '#0c3a49' } })
      setQr(m)
    })()
  }, [id])
  if (!d) return <div className="kiosk muted pad">Henter…</div>
  const f = (n) => (n == null ? '?' : String(Number(n)).replace('.', ','))
  return (
    <div className="labels-page">
      <div className="row gap no-print labels-bar">
        <button className="btn white" onClick={() => nav(-1)}>← Tilbage</button>
        <div className="grow" />
        <button className="btn white" onClick={() => window.print()}>Udskriv etiketter</button>
      </div>
      <div className="labels">
        <div className="label">
          {qr.order && <img src={qr.order} alt="QR" />}
          <div><div className="l-no">#{d.o.order_no}</div><b>{d.o.customers && d.o.customers.name}</b>
            <div>{d.o.title}</div><div className="l-small">Færdig {date(d.o.deadline)}{d.o.location ? ' · ' + d.o.location : ''}</div>
            <div className="l-small">{d.parts.length} del(e)</div></div>
        </div>
        {d.parts.map((p, i) => (
          <div key={p.id} className="label">
            {qr[p.id] && <img src={qr[p.id]} alt="QR" />}
            <div><div className="l-no">#{d.o.order_no} · {i + 1}/{d.parts.length}</div><b>{p.label || 'Del ' + (i + 1)}</b>
              <div>{p.quantity} stk.{p.length_cm ? ` · ${f(p.length_cm)}×${f(p.width_cm)}×${f(p.thickness_cm)} cm` : ''}</div>
              <div className="l-small">{d.o.customers && d.o.customers.name}</div></div>
          </div>
        ))}
      </div>
    </div>
  )
}
