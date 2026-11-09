import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLiveQuery } from '../lib/live'
import { useAuth } from '../lib/auth'
import { Chip } from '../components/ui'
import { STATUS, date, dateTime, daysUntil, kr, totals } from '../lib/format'

function greeting() {
  const h = new Date().getHours()
  if (h < 10) return 'Godmorgen'
  if (h < 12) return 'God formiddag'
  if (h < 18) return 'God eftermiddag'
  return 'Godaften'
}
const startOfWeek = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x }
const weekNo = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 86400000 + 1) / 7) }

function Spark({ values }) {
  const w = 160, h = 90, max = Math.max(1, ...values)
  const pts = values.map((v, i) => [10 + (i * (w - 20)) / Math.max(1, values.length - 1), h - 12 - (v / max) * (h - 30)])
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {pts.map((p, i) => <line key={i} x1={p[0]} x2={p[0]} y1="6" y2={h - 10} className="spark-grid" />)}
      <path d={d} className="spark-line" />
      <circle cx={last[0]} cy={last[1]} r="6" className="spark-halo" /><circle cx={last[0]} cy={last[1]} r="3.5" className="spark-dot" />
    </svg>
  )
}

function Bars({ data, highlight }) {
  const max = Math.max(1, ...data.map((d) => d.v))
  return (
    <div className="bars">
      {data.map((d, i) => (
        <div key={i} className="bar-col">
          <div className="bar-track">
            {i === highlight && <span className="bar-tip">{d.v} {d.v === 1 ? 'ordre' : 'ordrer'}</span>}
            <div className={'bar' + (i === highlight ? ' hi' : d.v === max ? ' mid' : '')} style={{ height: Math.max(6, (d.v / max) * 100) + '%' }} />
          </div>
          <span className="bar-lbl">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

function Segments({ value }) {
  const on = Math.round(value / 10)
  return <span className="segs">{Array.from({ length: 10 }).map((_, i) => <i key={i} className={i < on ? 'on' : ''} />)}</span>
}

function Attn({ title, items, empty, tone, render }) {
  return (
    <section className={'card tone-' + tone}>
      <div className="card-head"><h3>{title}</h3><span className="count">{items.length}</span></div>
      {items.length === 0 ? <div className="muted">{empty}</div> : <ul className="list">{items.slice(0, 6).map(render)}</ul>}
    </section>
  )
}

export default function Overblik() {
  const nav = useNavigate()
  const { employee } = useAuth()
  const since = new Date(Date.now() - 42 * 86400000).toISOString()
  const q = useLiveQuery(['orders', 'tailor_tasks', 'comments', 'order_parts'], async () => {
    const [o, recent, c, tl] = await Promise.all([
      supabase.from('orders').select('id, order_no, title, status, deadline, needs_reconfirm, prepared_version, confirmed_version, priority, price_mode, discount_ore, deposit_ore, updated_at, customers(name), tailor_tasks(status, progress, pause_reason, tailor_id), order_parts(quantity, unit_price_ore)')
        .not('status', 'in', '(afhentet,annulleret)').order('deadline', { ascending: true, nullsFirst: false }),
      supabase.from('orders').select('id, order_no, title, status, created_at, updated_at, customers(name)').gte('created_at', since).order('updated_at', { ascending: false }).limit(400),
      supabase.from('comments').select('id, body, created_at, order_id, orders(order_no, title), employees!comments_author_fkey(display_name)')
        .eq('is_question', true).eq('resolved', false).order('created_at', { ascending: false }),
      supabase.from('employees').select('id, display_name').eq('role', 'skraedder').eq('active', true).order('sort_order')
    ])
    const e = [o, recent, c, tl].find((r) => r.error)
    if (e) throw new Error(e.error.message)
    return { orders: o.data, recent: recent.data, questions: c.data, tailors: tl.data }
  })

  const head = (
    <div className="hero">
      <div>
        <h1>{greeting()}, {employee.display_name}.</h1>
        <p>Her er butikkens ordrer, skræddernes arbejde og det, der kræver din opmærksomhed i dag.</p>
      </div>
      <div className="hero-actions">
        <Link className="btn outline-w" to="/kunder">Kundekartotek</Link>
        <Link className="btn white" to="/ordrer/ny">＋ Ny ordre</Link>
      </div>
    </div>
  )
  if (q.error) return <div className="page">{head}<div className="err">{q.error}</div></div>
  if (!q.data) return <div className="page">{head}<div className="muted pad">Henter…</div></div>

  const { orders, recent, questions, tailors } = q.data
  const task = (o) => (o.tailor_tasks && o.tailor_tasks[0]) || null
  const control = orders.filter((o) => o.status === 'til_kontrol')
  const paused = orders.filter((o) => task(o) && task(o).status === 'pause')
  const awaiting = orders.filter((o) => o.status === 'klar_til_bekraeftelse' || o.needs_reconfirm)
  const deadline = orders.filter((o) => o.deadline && daysUntil(o.deadline) <= 3 && o.status !== 'klar_til_afhentning')
  const ready = orders.filter((o) => o.status === 'klar_til_afhentning')
  const drafts = orders.filter((o) => o.status === 'kladde' && !o.needs_reconfirm)
  const attention = questions.length + control.length + paused.length + awaiting.filter((o) => o.needs_reconfirm).length + deadline.filter((o) => daysUntil(o.deadline) < 0).length
  const value = orders.filter((o) => o.confirmed_version).reduce((s, o) => s + totals(o.order_parts, o).total_ore, 0)

  // Nye ordrer pr. dag (7 dage) og pr. uge (6 uger)
  const days = Array.from({ length: 7 }).map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6 + i); return d })
  const perDay = days.map((d) => recent.filter((o) => { const c = new Date(o.created_at); return c >= d && c < new Date(d.getTime() + 86400000) }).length)
  const weekStarts = Array.from({ length: 6 }).map((_, i) => { const s = startOfWeek(new Date()); s.setDate(s.getDate() - (5 - i) * 7); return s })
  const perWeek = weekStarts.map((s) => ({ label: 'Uge ' + weekNo(s), v: recent.filter((o) => { const c = new Date(o.created_at); return c >= s && c < new Date(s.getTime() + 7 * 86400000) }).length }))
  const thisWeek = perWeek[5].v, lastWeek = perWeek[4].v
  const trend = lastWeek ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null

  const tailorRows = tailors.map((t) => {
    const ts = orders.map(task).filter((x) => x && x.tailor_id === t.id && x.status !== 'godkendt')
    const avg = ts.length ? Math.round(ts.reduce((s, x) => s + x.progress, 0) / ts.length) : 0
    return { t, n: ts.length, avg, paused: ts.filter((x) => x.status === 'pause').length }
  })

  let headline = 'Alt kører efter planen.'
  let sub = `${orders.length} aktive ordrer. Ingen åbne spørgsmål eller opgaver på pause.`
  if (attention > 0) {
    headline = `${attention} ${attention === 1 ? 'ting kræver' : 'ting kræver'} din opmærksomhed.`
    const parts = []
    if (questions.length) parts.push(`${questions.length} spørgsmål fra skrædder`)
    if (control.length) parts.push(`${control.length} til kontrol`)
    if (paused.length) parts.push(`${paused.length} på pause`)
    const late = deadline.filter((o) => daysUntil(o.deadline) < 0).length
    if (late) parts.push(`${late} over deadline`)
    sub = parts.join(', ') + '.'
  }

  const orderLi = (o, extra) => (
    <li key={o.id}><button className="li-btn" onClick={() => nav('/ordrer/' + o.id)}>
      <b>#{o.order_no}</b><span>{o.customers ? o.customers.name : '—'}</span><span className="grow" />{extra}
    </button></li>
  )

  return (
    <div className="page">
      {head}
      <div className="dash">
        <section className="card kpi">
          <div className="kpi-head"><span className="kpi-ic">▤</span><span>Aktive ordrer</span></div>
          <div className="kpi-body">
            <div>
              <div className="kpi-num">{orders.length}</div>
              <div className="kpi-sub">{trend == null ? `${thisWeek} nye denne uge` : <><b className={trend >= 0 ? 'up' : 'down'}>{trend >= 0 ? '↗' : '↘'} {Math.abs(trend)} %</b> nye ordrer vs. sidste uge</>}</div>
            </div>
            <div className="kpi-chart"><Spark values={perDay} /><div className="spark-lbl">{days.map((d, i) => <span key={i}>{'MTOTFLS'[(d.getDay() + 6) % 7]}</span>)}</div></div>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><div><div className="muted small">Bekræftet ordreværdi i gang</div><div className="kpi-num sm">{kr(value)}</div></div><Chip kind="blue">inkl. moms</Chip></div>
          <div className="mini-stats">
            <div><b>{orders.filter((o) => ['bekraeftet', 'i_arbejde'].includes(o.status)).length}</b><span>I arbejde</span></div>
            <div><b>{control.length}</b><span>Til kontrol</span></div>
            <div><b>{ready.length}</b><span>Klar til afhentning</span></div>
            <div><b>{drafts.length + awaiting.length}</b><span>Kladder / tilbud</span></div>
          </div>
        </section>

        <section className="card feature">
          <h2>{headline}</h2>
          <p>{sub}</p>
          <div className="grow" />
          <button className="btn white" onClick={() => nav(control.length ? '/ordrer/' + control[0].id : '/ordrer')}>{control.length ? 'Gå til kontrol' : 'Se ordrer'}</button>
        </section>

        <section className="card">
          <div className="card-head"><div><h3>Skræddernes arbejde</h3><div className="muted small">Aktive opgaver og gennemsnitlig fremdrift</div></div>
            <Link className="btn soft sm" to="/skraedder">Åbn</Link></div>
          {tailorRows.length === 0 && <div className="muted">Ingen skræddere oprettet endnu</div>}
          {tailorRows.map((r) => (
            <div key={r.t.id} className="trow">
              <div><b>{r.t.display_name}</b><div className="muted small">{r.n} {r.n === 1 ? 'opgave' : 'opgaver'}{r.paused ? ` · ${r.paused} på pause` : ''}</div></div>
              <Segments value={r.avg} /><b className="pct-txt">{r.avg} %</b>
            </div>
          ))}
        </section>

        <section className="card">
          <div className="card-head"><h3>Seneste aktivitet</h3><Link className="link" to="/ordrer">Se alle</Link></div>
          <ul className="activity">
            {recent.slice(0, 5).map((o) => (
              <li key={o.id}><button onClick={() => nav('/ordrer/' + o.id)}>
                <span className="act-av">{((o.customers && o.customers.name) || '#').slice(0, 1)}</span>
                <span className="act-main"><b>{o.customers ? o.customers.name : 'Ingen kunde'}</b><small>#{o.order_no} · {dateTime(o.updated_at)}</small></span>
                <Chip kind={STATUS[o.status][1]}>{STATUS[o.status][0]}</Chip>
              </button></li>
            ))}
            {recent.length === 0 && <li className="muted">Ingen ordrer de sidste 6 uger</li>}
          </ul>
        </section>

        <section className="card">
          <div className="card-head"><div><h3>Nye ordrer</h3><div className="muted small">Pr. uge, seneste 6 uger</div></div></div>
          <Bars data={perWeek} highlight={5} />
        </section>
      </div>

      <h2 className="section-title">Kræver opmærksomhed</h2>
      <div className="cards">
        <Attn title="Spørgsmål fra skrædder" tone="red" items={questions} empty="Ingen åbne spørgsmål"
          render={(c) => <li key={c.id}><button className="li-btn" onClick={() => nav('/ordrer/' + c.order_id)}>
            <b>#{c.orders && c.orders.order_no}</b><span>{c.body}</span><span className="grow" /><small className="muted">{c.employees && c.employees.display_name}</small></button></li>} />
        <Attn title="Til kontrol" tone="amber" items={control} empty="Intet venter på kontrol" render={(o) => orderLi(o, <Chip kind="amber">Kontrollér</Chip>)} />
        <Attn title="Pause hos skrædder" tone="red" items={paused} empty="Ingen opgaver på pause" render={(o) => orderLi(o, <small className="muted">{task(o).pause_reason}</small>)} />
        <Attn title="Tæt på deadline" tone="amber" items={deadline} empty="Ingen ordrer inden for 3 dage"
          render={(o) => orderLi(o, <Chip kind={daysUntil(o.deadline) < 0 ? 'red' : 'amber'}>{daysUntil(o.deadline) < 0 ? 'Overskredet' : date(o.deadline)}</Chip>)} />
        <Attn title="Afventer kundens bekræftelse" tone="blue" items={awaiting} empty="Ingen" render={(o) => orderLi(o, o.needs_reconfirm ? <Chip kind="red">Ændret</Chip> : <Chip kind="amber">Klar</Chip>)} />
        <Attn title="Klar til afhentning" tone="green" items={ready} empty="Ingen varer klar" render={(o) => orderLi(o, <Chip kind="green">Klar</Chip>)} />
      </div>
    </div>
  )
}
