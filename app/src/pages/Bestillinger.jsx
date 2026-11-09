import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { useLiveQuery, serverWrite } from '../lib/live'
import { useAuth } from '../lib/auth'
import { Chip, Empty, Field, Modal, Segmented, Toast } from '../components/ui'
import { NumIn } from '../components/inputs'
import { MAT_STATUS, MAT_CAT, BATCH_STATUS, TASK, WEEKDAYS, date, dateTime, qty } from '../lib/format'

const TABS = [['skum', 'Skumliste'], ['stof', 'Stof & tilbehør'], ['afventer', 'Afventer liste'], ['rettelser', 'Rettelser'], ['leverandoerer', 'Leverandører'], ['plan', 'Tidsplan']]
const LINE_SEL = 'id, order_id, part_id, category, description, spec, quantity, unit, source, status, received_qty, supplier_id, batch_id, needed_by, is_correction, follow_up_done, note, released_at, orders(order_no, title, deadline, customers(name), tailor_tasks(status, progress, tailor_id))'

export default function Bestillinger() {
  const [tab, setTab] = useState('skum')
  const [toast, setToast] = useState('')
  const q = useLiveQuery(['material_lines', 'order_batches', 'suppliers', 'tailor_tasks'], async () => {
    const [b, open, corr, sup, emp, set] = await Promise.all([
      supabase.from('order_batches').select('*').order('created_at', { ascending: false }).limit(60),
      supabase.from('material_lines').select(LINE_SEL).is('batch_id', null).eq('status', 'afventer').order('released_at'),
      supabase.from('material_lines').select(LINE_SEL).or('and(status.eq.rettet,follow_up_done.eq.false),and(is_correction.eq.true,status.in.(afventer,paa_liste))').order('updated_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('employees').select('id, display_name'),
      supabase.from('app_settings').select('*')
    ])
    const e = [b, open, corr, sup, emp, set].find((x) => x.error)
    if (e) throw new Error(e.error.message)
    const settings = {}; set.data.forEach((s) => { settings[s.key] = s.value })
    return { batches: b.data, open: open.data, corrections: corr.data, suppliers: sup.data, employees: emp.data, settings }
  })
  if (q.error) return <div className="page"><div className="page-head"><h1>Bestillinger</h1></div><div className="err">{q.error}</div></div>
  const d = q.data
  const followUps = d ? d.corrections.filter((l) => l.status === 'rettet' && !l.follow_up_done).length : 0
  return (
    <div className="page">
      <div className="page-head">
        <h1>Bestillinger</h1>
        <button className="btn soft" onClick={async () => { try { const id = await rpc('run_batch_now', { p_kind: 'skum' }); setToast(id ? 'Ekstra skumliste dannet' : 'Ingen nye skumlinjer') } catch (e) { setToast(e.message) } }}>Dan skumliste nu</button>
        <button className="btn soft" onClick={async () => { try { const id = await rpc('run_batch_now', { p_kind: 'stof' }); setToast(id ? 'Ekstra stofliste dannet' : 'Ingen nye stof-/tilbehørslinjer') } catch (e) { setToast(e.message) } }}>Dan stofliste nu</button>
      </div>
      <div className="tabs">
        {TABS.map(([k, l]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}
          {k === 'afventer' && d && d.open.length > 0 && <span className="count">{d.open.length}</span>}
          {k === 'rettelser' && followUps > 0 && <span className="count">{followUps}</span>}</button>)}
      </div>
      {!d ? <div className="muted pad">Henter…</div> : (
        <>
          {(tab === 'skum' || tab === 'stof') && <Batches kind={tab} d={d} setToast={setToast} />}
          {tab === 'afventer' && <Pending d={d} />}
          {tab === 'rettelser' && <Corrections d={d} setToast={setToast} />}
          {tab === 'leverandoerer' && <Suppliers d={d} setToast={setToast} />}
          {tab === 'plan' && <Schedule d={d} setToast={setToast} />}
        </>
      )}
      <Toast msg={toast} onDone={() => setToast('')} />
    </div>
  )
}

function nextRun(cfg) {
  if (!cfg) return null
  const [h, m] = (cfg.time || '18:30').split(':').map(Number)
  const now = new Date()
  for (let i = 0; i < 8; i++) {
    const d = new Date(now); d.setDate(now.getDate() + i); d.setHours(h, m, 0, 0)
    const iso = ((d.getDay() + 6) % 7) + 1
    if ((cfg.days || []).includes(iso) && d > now) return d
  }
  return null
}

function Batches({ kind, d, setToast }) {
  const list = d.batches.filter((b) => b.kind === kind)
  const [sel, setSel] = useState(null)
  const cur = list.find((b) => b.id === sel) || list[0]
  const nr = nextRun(d.settings.batch_schedule && d.settings.batch_schedule[kind])
  return (
    <div className="batch-wrap">
      <div className="batch-list">
        <div className="card mini">
          <div className="muted small">Næste automatiske liste</div>
          <b>{nr ? nr.toLocaleString('da-DK', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</b>
          <div className="muted small">Dannes på serveren – også når alle enheder er slukket</div>
        </div>
        {list.length === 0 && <Empty>Ingen lister endnu</Empty>}
        {list.map((b) => (
          <button key={b.id} className={'task' + (cur && cur.id === b.id ? ' on' : '')} onClick={() => setSel(b.id)}>
            <div className="row between"><b>{date(b.run_date)}{b.version > 1 ? ` · nr. ${b.version}` : ''}</b><Chip kind={BATCH_STATUS[b.status][1]}>{BATCH_STATUS[b.status][0]}</Chip></div>
            <div className="muted small">Cutoff {dateTime(b.cutoff)}{b.manual ? ' · ekstra kørsel' : ''}</div>
          </button>
        ))}
      </div>
      {cur ? <BatchDetail key={cur.id} b={cur} d={d} setToast={setToast} /> : <div />}
    </div>
  )
}

function BatchDetail({ b, d, setToast }) {
  const nav = useNavigate()
  const q = useLiveQuery([{ table: 'material_lines', filter: 'batch_id=eq.' + b.id }], async () => {
    const { data, error } = await supabase.from('material_lines').select(LINE_SEL).eq('batch_id', b.id).order('category').order('released_at')
    if (error) throw new Error(error.message)
    return data
  }, [b.id])
  const lines = q.data || []
  const sup = (id) => (d.suppliers.find((s) => s.id === id) || {}).name || 'Ingen leverandør'
  const emp = (id) => (d.employees.find((e) => e.id === id) || {}).display_name || ''
  const next = { dannet: ['godkendt', 'Godkend liste'], godkendt: ['sendt', 'Markér sendt til leverandør'], sendt: ['bekraeftet', 'Leverandør har bekræftet'] }[b.status]
  const advance = async () => { try { await serverWrite(() => rpc('set_batch_status', { p_batch: b.id, p_status: next[0] })); setToast('Status opdateret') } catch (e) { setToast(e.message) } }

  const csv = () => {
    const head = ['Ordre', 'Kunde', 'Kategori', 'Beskrivelse', 'Mængde', 'Enhed', 'Leverandør', 'Ønsket senest', 'Status', 'Modtaget']
    const rows = lines.map((l) => [l.orders.order_no, l.orders.customers ? l.orders.customers.name : '', MAT_CAT[l.category], l.description, qty(l.quantity), l.unit, sup(l.supplier_id), l.needed_by || '', MAT_STATUS[l.status][0], qty(l.received_qty)])
    const txt = [head].concat(rows).map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }))
    a.download = `${b.kind === 'skum' ? 'skumliste' : 'stofliste'}-${b.run_date}${b.version > 1 ? '-' + b.version : ''}.csv`
    a.click()
  }

  const groups = {}
  lines.forEach((l) => { const k = b.kind === 'skum' ? 'all' : (l.supplier_id || 'none'); (groups[k] = groups[k] || []).push(l) })
  const orderIds = Array.from(new Set(lines.map((l) => l.order_id)))
  const tasks = orderIds.map((id) => { const l = lines.find((x) => x.order_id === id); const t = l.orders.tailor_tasks && l.orders.tailor_tasks[0]; return { id, o: l.orders, t } }).filter((x) => x.t)

  return (
    <div className="card batch-detail print-area">
      <div className="card-head">
        <div><h2>{b.kind === 'skum' ? 'Skumbestillingsliste' : 'Stof, lynlåse og tilbehør'}</h2>
          <div className="muted small">{date(b.run_date)}{b.version > 1 ? ` · liste nr. ${b.version}` : ''} · cutoff {dateTime(b.cutoff)} · {lines.length} linjer</div></div>
        <div className="row gap wrap no-print">
          <Chip kind={BATCH_STATUS[b.status][1]}>{BATCH_STATUS[b.status][0]}</Chip>
          <button className="btn soft sm" onClick={csv}>CSV</button>
          <button className="btn soft sm" onClick={() => window.print()}>Udskriv / PDF</button>
          {next && <button className="btn primary sm" onClick={advance}>{next[1]}</button>}
        </div>
      </div>
      <div className="steps no-print">{['dannet', 'godkendt', 'sendt', 'bekraeftet', 'modtaget'].map((s) => <span key={s} className={Object.keys(BATCH_STATUS).indexOf(s) <= Object.keys(BATCH_STATUS).indexOf(b.status) ? 'on' : ''}>{STEP[s]}</span>)}</div>
      {Object.entries(groups).map(([k, ls]) => (
        <div key={k} className="sup-group">
          {b.kind !== 'skum' && <h3>{k === 'none' ? 'Ingen leverandør valgt' : sup(k)}</h3>}
          <div className="mat-table">
            {ls.map((l) => <LineRow key={l.id} l={l} kind={b.kind} batchStatus={b.status} d={d} setToast={setToast} onOpen={() => nav('/ordrer/' + l.order_id)} />)}
          </div>
        </div>
      ))}
      {b.kind === 'stof' && tasks.length > 0 && (
        <div className="sup-group">
          <h3>Tilhørende skrædderarbejde</h3>
          <div className="mat-table">
            {tasks.map(({ id, o, t }) => (
              <div key={id} className="mat-row">
                <span className="mr-no">#{o.order_no}</span>
                <span className="mr-main"><b>{o.title || '—'}</b><small>{o.customers ? o.customers.name : ''} · deadline {date(o.deadline)}</small></span>
                <span>{emp(t.tailor_id)}</span>
                <Chip kind={TASK[t.status][1]}>{TASK[t.status][0]} · {t.progress} %</Chip>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LineRow({ l, kind, batchStatus, d, setToast, onOpen }) {
  const [recv, setRecv] = useState(false)
  const canEdit = ['paa_liste'].includes(l.status) && ['dannet', 'godkendt'].includes(batchStatus)
  const receivable = ['bestilt', 'bekraeftet', 'delvis', 'paa_liste'].includes(l.status)
  const s = l.spec || {}
  const upd = async (patch) => { const { error } = await serverWrite(() => supabase.from('material_lines').update(patch).eq('id', l.id)); if (error) setToast(error.message) }
  return (
    <div className={'mat-row' + (l.is_correction ? ' corr' : '')}>
      <button className="mr-no link-btn" onClick={onOpen}>#{l.orders.order_no}</button>
      <span className="mr-main">
        <b>{kind === 'skum' ? `${s.foam_type || ''} ${s.firmness || ''}` : `${MAT_CAT[l.category]}: ${l.description}`}</b>
        {kind === 'skum'
          ? <small>{s.label} · {fmt(s.length_cm)} × {fmt(s.width_cm)} × {fmt(s.thickness_cm)} cm · {s.shape}{s.measure_basis === 'faerdigmaal' ? ' · færdigmål' : ''}</small>
          : <small>{l.orders.customers ? l.orders.customers.name : ''}</small>}
        {l.is_correction && <small className="err">Rettelse til tidligere bestilling</small>}
      </span>
      <span className="mr-qty">
        {canEdit && l.category === 'stof'
          ? <span className="row gap"><NumIn value={l.quantity} onChange={(v) => upd({ quantity: v || 0 })} style={{ width: 80 }} />m</span>
          : <b>{qty(l.quantity)} {l.unit}</b>}
      </span>
      {kind !== 'skum' && canEdit
        ? <select className="mr-sup" value={l.supplier_id || ''} onChange={(e) => upd({ supplier_id: e.target.value || null })}>
            <option value="">Leverandør…</option>{d.suppliers.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        : <span className="mr-sup muted small">Senest {date(l.needed_by)}</span>}
      <span className="mr-status"><Chip kind={MAT_STATUS[l.status][1]}>{MAT_STATUS[l.status][0]}{l.status === 'delvis' ? ` ${qty(l.received_qty)}/${qty(l.quantity)}` : ''}</Chip></span>
      <span className="no-print">{receivable && batchStatus !== 'dannet' && <button className="btn soft sm" onClick={() => setRecv(true)}>Modtag</button>}</span>
      {recv && <ReceiveModal l={l} onClose={() => setRecv(false)} setToast={setToast} />}
    </div>
  )
}
const STEP = { dannet: 'Klargjort', godkendt: 'Godkendt', sendt: 'Sendt', bekraeftet: 'Bekræftet', modtaget: 'Modtaget' }
const fmt = (n) => (n == null ? '?' : String(Number(n)).replace('.', ','))

function ReceiveModal({ l, onClose, setToast }) {
  const rest = Math.max(Number(l.quantity) - Number(l.received_qty), 0)
  const [v, setV] = useState(rest || 1)
  const [note, setNote] = useState('')
  const save = async () => {
    try { const r = await serverWrite(() => rpc('receive_line', { p_line: l.id, p_qty: v, p_note: note || null })); setToast(r.status === 'modtaget' ? 'Modtaget' : 'Delvis modtaget registreret'); onClose() }
    catch (e) { setToast(e.message) }
  }
  return (
    <Modal title="Registrér modtagelse" onClose={onClose}>
      <p><b>#{l.orders.order_no}</b> · {l.description}</p>
      <p className="muted">Bestilt {qty(l.quantity)} {l.unit} · allerede modtaget {qty(l.received_qty)} {l.unit}</p>
      <Field label={`Modtaget nu (${l.unit})`}><NumIn value={v} onChange={(x) => setV(x)} /></Field>
      <Field label="Bemærkning"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="fx restordre på 1 stk." /></Field>
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Fortryd</button><button className="btn primary" disabled={!v || v <= 0} onClick={save}>Registrér</button></div>
    </Modal>
  )
}

function Pending({ d }) {
  const nav = useNavigate()
  if (!d.open.length) return <Empty>Ingen materialer afventer næste liste</Empty>
  const by = { skum: d.open.filter((l) => l.category === 'skum'), stof: d.open.filter((l) => l.category !== 'skum') }
  return (
    <div className="cards two">
      {[['skum', 'Kommer på næste skumliste'], ['stof', 'Kommer på næste stof-/tilbehørsliste']].map(([k, t]) => (
        <section key={k} className="card">
          <div className="card-head"><h3>{t}</h3><span className="count">{by[k].length}</span></div>
          <ul className="list">{by[k].map((l) => (
            <li key={l.id}><button className="li-btn" onClick={() => nav('/ordrer/' + l.order_id)}><b>#{l.orders.order_no}</b><span>{MAT_CAT[l.category]}: {l.description}</span><span className="grow" /><small className="muted">{qty(l.quantity)} {l.unit}</small></button></li>
          ))}</ul>
        </section>
      ))}
    </div>
  )
}

function Corrections({ d, setToast }) {
  const nav = useNavigate()
  if (!d.corrections.length) return <Empty>Ingen rettelser til opfølgning</Empty>
  return (
    <section className="card">
      <div className="card-head"><h3>Ændringer efter afsendelse</h3><small className="muted">Kontakt leverandøren om de røde linjer, og markér dem som fulgt op</small></div>
      <div className="mat-table">
        {d.corrections.map((l) => (
          <div key={l.id} className={'mat-row' + (l.status === 'rettet' ? ' corr' : '')}>
            <button className="mr-no link-btn" onClick={() => nav('/ordrer/' + l.order_id)}>#{l.orders.order_no}</button>
            <span className="mr-main"><b>{MAT_CAT[l.category]}: {l.description}</b><small>{l.note || (l.is_correction ? 'Ny linje der erstatter en afsendt bestilling' : '')}</small></span>
            <span className="mr-qty">{qty(l.quantity)} {l.unit}</span>
            <span className="mr-sup" />
            <span className="mr-status"><Chip kind={MAT_STATUS[l.status][1]}>{l.status === 'rettet' ? 'Afsendt – skal rettes' : MAT_STATUS[l.status][0]}</Chip></span>
            <span>{l.status === 'rettet' && !l.follow_up_done && <button className="btn soft sm" onClick={async () => { try { await rpc('mark_followed_up', { p_line: l.id }); setToast('Markeret som fulgt op') } catch (e) { setToast(e.message) } }}>Fulgt op</button>}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

const CATS = [['skum', 'Skum'], ['stof', 'Stof'], ['tilbehoer', 'Tilbehør'], ['andet', 'Andet']]
function Suppliers({ d, setToast }) {
  const [edit, setEdit] = useState(null)
  return (
    <section className="card">
      <div className="card-head"><h3>Leverandører</h3><button className="btn primary sm" onClick={() => setEdit({ name: '', category: 'skum', active: true })}>＋ Ny leverandør</button></div>
      {d.suppliers.length === 0 && <div className="muted">Ingen leverandører endnu. Opret fx Carpenter (skum).</div>}
      <div className="table">
        {d.suppliers.map((s) => (
          <div key={s.id} className={'tr static' + (s.active ? '' : ' inactive')}>
            <span className="td main"><b>{s.name}</b><small>{s.contact || ''} {s.email || ''} {s.phone || ''}</small></span>
            <span className="td"><Chip kind="blue">{CATS.find((c) => c[0] === s.category)[1]}</Chip></span>
            <span className="td hide-sm muted small">{s.customer_no ? 'Kundenr. ' + s.customer_no : ''}</span>
            <span className="td"><button className="btn ghost sm" onClick={() => setEdit(s)}>Redigér</button></span>
          </div>
        ))}
      </div>
      {edit && <SupplierModal s={edit} onClose={() => setEdit(null)} setToast={setToast} />}
    </section>
  )
}
function SupplierModal({ s, onClose, setToast }) {
  const [v, setV] = useState({ ...s })
  const set = (k, x) => setV((o) => ({ ...o, [k]: x }))
  const save = async () => {
    const body = { name: v.name, category: v.category, email: v.email || null, phone: v.phone || null, contact: v.contact || null, customer_no: v.customer_no || null, notes: v.notes || null, active: v.active }
    const r = s.id ? await supabase.from('suppliers').update(body).eq('id', s.id) : await supabase.from('suppliers').insert(body)
    if (r.error) setToast(r.error.message); else { setToast('Gemt'); onClose() }
  }
  return (
    <Modal title={s.id ? 'Redigér leverandør' : 'Ny leverandør'} onClose={onClose}>
      <div className="grid2">
        <Field label="Navn" wide><input value={v.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Kategori" wide><Segmented value={v.category} options={CATS} onChange={(x) => set('category', x)} /></Field>
        <Field label="Kontaktperson"><input value={v.contact || ''} onChange={(e) => set('contact', e.target.value)} /></Field>
        <Field label="Kundenummer hos leverandør"><input value={v.customer_no || ''} onChange={(e) => set('customer_no', e.target.value)} /></Field>
        <Field label="E-mail"><input type="email" value={v.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Telefon"><input type="tel" value={v.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Noter" wide><textarea rows={2} value={v.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        <Field label="Aktiv"><Segmented value={v.active ? 'ja' : 'nej'} options={[['ja', 'Aktiv'], ['nej', 'Inaktiv']]} onChange={(x) => set('active', x === 'ja')} /></Field>
      </div>
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Fortryd</button><button className="btn primary" disabled={!v.name.trim()} onClick={save}>Gem</button></div>
    </Modal>
  )
}

function Schedule({ d, setToast }) {
  const { isAdmin } = useAuth()
  const [cfg, setCfg] = useState(d.settings.batch_schedule || {})
  const [defs, setDefs] = useState(d.settings.default_suppliers || {})
  const save = async () => {
    const a = await supabase.from('app_settings').update({ value: cfg, updated_at: new Date().toISOString() }).eq('key', 'batch_schedule')
    const b = await supabase.from('app_settings').update({ value: defs, updated_at: new Date().toISOString() }).eq('key', 'default_suppliers')
    setToast(a.error || b.error ? (a.error || b.error).message : 'Tidsplan gemt')
  }
  const setK = (k, patch) => setCfg((c) => ({ ...c, [k]: { ...(c[k] || {}), ...patch } }))
  return (
    <section className="card">
      <div className="card-head"><h3>Tidsplan for bestillingslister</h3><small className="muted">Dansk tid · sommer- og vintertid håndteres automatisk</small></div>
      {[['skum', 'Skumliste'], ['stof', 'Stof- og tilbehørsliste']].map(([k, l]) => (
        <div key={k} className="grid3 sched">
          <Field label={l + ' – tidspunkt'}><input type="time" disabled={!isAdmin} value={(cfg[k] && cfg[k].time) || '18:30'} onChange={(e) => setK(k, { time: e.target.value })} /></Field>
          <Field label="Bestillingsdage" span>
            <div className="row gap wrap">{WEEKDAYS.map(([n, w]) => {
              const on = ((cfg[k] && cfg[k].days) || []).includes(n)
              return <button key={n} type="button" disabled={!isAdmin} className={'pill' + (on ? ' on' : '')}
                onClick={() => setK(k, { days: on ? cfg[k].days.filter((x) => x !== n) : [...((cfg[k] && cfg[k].days) || []), n].sort() })}>{w}</button>
            })}</div>
          </Field>
        </div>
      ))}
      <h3>Standardleverandør</h3>
      <div className="grid3">
        {[['skum', 'Skum'], ['stof', 'Stof'], ['tilbehoer', 'Lynlås og tilbehør']].map(([k, l]) => (
          <Field key={k} label={l}><select disabled={!isAdmin} value={defs[k] || ''} onChange={(e) => setDefs({ ...defs, [k]: e.target.value || null })}>
            <option value="">Ingen</option>{d.suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        ))}
      </div>
      {isAdmin ? <div className="row end"><button className="btn primary" onClick={save}>Gem tidsplan</button></div> : <div className="muted small">Kun administrator kan ændre tidsplanen.</div>}
    </section>
  )
}
