import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { useLive, serverWrite } from '../lib/live'
import { useAuth } from '../lib/auth'
import { useRowSaver } from '../lib/saver'
import { Chip, Field, Modal, SaveState, Segmented, Toast } from '../components/ui'
import { TextIn, NumIn, IntIn, KrIn } from '../components/inputs'
import { CustomerFields, NewCustomerModal } from '../components/CustomerForm'
import PartPhotos from '../components/PartPhotos'
import { OrderMaterials, OrderIntake } from '../components/OrderExtras'
import { OrderInvoicing } from '../components/InvoiceParts'
import { STATUS, TASK, PART_TYPES, FOAM_TYPES, kr, dateTime, totals } from '../lib/format'

// ---------- Ny ordre ----------
export function NewOrder() {
  const nav = useNavigate()
  const started = useRef(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (started.current) return
    started.current = true
    const params = new URLSearchParams(location.hash.split('?')[1] || '')
    const cust = params.get('kunde')
    serverWrite(() => supabase.from('orders').insert(cust ? { customer_id: cust } : {}).select('id').single())
      .then(({ data, error }) => { if (error) setErr(error.message); else nav('/ordrer/' + data.id, { replace: true }) })
  }, [nav])
  return <div className="pad">{err ? <div className="err">{err}</div> : <span className="muted">Opretter ordre…</span>}</div>
}

// ---------- Ordreformular ----------
export default function OrdreEditor() {
  const { id } = useParams()
  const nav = useNavigate()
  const { employee, isAdmin } = useAuth()
  const [d, setD] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [errs, setErrs] = useState([])
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState(null)

  const load = useCallback(async () => {
    const [o, p, t, c, a, v, cf, emps] = await Promise.all([
      supabase.from('orders').select('*').eq('id', id).maybeSingle(),
      supabase.from('order_parts').select('*').eq('order_id', id).order('sort').order('created_at'),
      supabase.from('tailor_tasks').select('*').eq('order_id', id).maybeSingle(),
      supabase.from('comments').select('*, employees!comments_author_fkey(display_name, role)').eq('order_id', id).order('created_at'),
      supabase.from('attachments').select('*').eq('order_id', id).order('created_at'),
      supabase.from('order_versions').select('version, prepared_at, prepared_by, employees!order_versions_prepared_by_fkey(display_name)').eq('order_id', id).order('version', { ascending: false }),
      supabase.from('order_confirmations').select('version, confirmed_at').eq('order_id', id),
      supabase.from('employees').select('id, display_name, role, active').order('sort_order')
    ])
    const firstErr = [o, p, t, c, a, v, cf, emps].find((r) => r.error)
    if (firstErr) { setLoadErr(firstErr.error.message); return }
    if (!o.data) { setLoadErr('Ordren findes ikke'); return }
    let customer = null
    if (o.data.customer_id) {
      const r = await supabase.from('customers').select('*').eq('id', o.data.customer_id).maybeSingle()
      customer = r.data
    }
    setD({ order: o.data, parts: p.data, task: t.data, comments: c.data, attachments: a.data, versions: v.data,
      confirmations: cf.data, employees: emps.data, customer })
  }, [id])

  useEffect(() => { load() }, [load])
  useLive([
    { table: 'orders', filter: 'id=eq.' + id }, { table: 'order_parts', filter: 'order_id=eq.' + id },
    { table: 'tailor_tasks', filter: 'order_id=eq.' + id }, { table: 'comments', filter: 'order_id=eq.' + id },
    { table: 'attachments', filter: 'order_id=eq.' + id }, 'customers'
  ], load, [id])

  const order = d && d.order
  const saver = useRowSaver({ table: 'orders', row: order, uid: employee.id,
    onSaved: (row) => setD((x) => (x ? { ...x, order: row } : x)) })
  const custSaver = useRowSaver({ table: 'customers', row: d && d.customer, uid: employee.id,
    onSaved: (row) => setD((x) => (x ? { ...x, customer: row } : x)) })

  const errFor = (field, partId) => {
    const e = errs.find((x) => x.field === field && (partId ? x.part_id === partId : !x.part_id))
    return e ? e.msg : null
  }

  if (loadErr) return <div className="page"><div className="err">{loadErr}</div></div>
  if (!d) return <div className="page muted">Henter ordre…</div>

  const o = { ...order, ...saver.pending }
  const locked = ['afhentet', 'annulleret'].includes(order.status)
  const tailors = d.employees.filter((e) => e.role === 'skraedder' && e.active)
  const tot = totals(d.parts, o)
  const awaitingCustomer = order.prepared_version && order.prepared_version !== order.confirmed_version
  const confirmedSet = new Set(d.confirmations.map((c) => c.version))

  const act = async (label, fn) => {
    setBusy(label)
    try { await saver.flush(); await custSaver.flush(); await fn() } catch (e) { setToast(e.message) } finally { setBusy('') }
  }

  const prepare = () => act('prepare', async () => {
    const { data: fresh } = await supabase.from('orders').select('row_version').eq('id', id).single()
    const r = await rpc('prepare_order', { p_order_id: id, p_row_version: fresh.row_version })
    if (!r.ok) {
      if (r.reason === 'mangler') { setErrs(r.errors); setToast('Udfyld de markerede felter'); setTimeout(() => { const el = document.querySelector('.has-err'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, 50) }
      else setToast(r.msg || 'Kunne ikke klargøre')
      await load(); return
    }
    setErrs([])
    nav(`/kunde/${id}/${r.version}`)
  })

  const addPart = (part_type) => act('add', async () => {
    const sort = d.parts.reduce((m, p) => Math.max(m, p.sort), 0) + 1
    const { error } = await serverWrite(() => supabase.from('order_parts').insert({ order_id: id, part_type, sort, label: '' }))
    if (error) throw new Error(error.message)
    await load()
  })
  const copyPart = (p) => act('copy', async () => {
    const skip = ['id', 'created_at', 'updated_at', 'row_version', 'progress', 'stage', 'created_by', 'updated_by']
    const n = {}
    Object.keys(p).forEach((k) => { if (!skip.includes(k)) n[k] = p[k] })
    n.sort = d.parts.reduce((m, x) => Math.max(m, x.sort), 0) + 1
    n.label = (p.label || 'Del') + ' (kopi)'
    const { error } = await serverWrite(() => supabase.from('order_parts').insert(n))
    if (error) throw new Error(error.message)
    await load()
  })
  const deletePart = (p) => act('del', async () => {
    if (!confirm(`Slet "${p.label || 'del'}"?`)) return
    const { error } = await serverWrite(() => supabase.from('order_parts').delete().eq('id', p.id))
    if (error) throw new Error(error.message)
    await load()
  })
  const pickCustomer = (c) => { saver.set('customer_id', c.id, true); setModal(null); setD((x) => ({ ...x, customer: c })); setTimeout(load, 400) }

  const copyToNew = () => act('copy-order', async () => {
    const { data: n, error } = await serverWrite(() => supabase.from('orders').insert({
      customer_id: order.customer_id, title: order.title, price_mode: order.price_mode, assigned_tailor: order.assigned_tailor
    }).select('id').single())
    if (error) throw new Error(error.message)
    const skip = ['id', 'order_id', 'created_at', 'updated_at', 'row_version', 'progress', 'stage', 'created_by', 'updated_by']
    const rows = d.parts.map((p) => { const r = { order_id: n.id }; Object.keys(p).forEach((k) => { if (!skip.includes(k)) r[k] = p[k] }); return r })
    if (rows.length) { const e2 = await serverWrite(() => supabase.from('order_parts').insert(rows)); if (e2.error) throw new Error(e2.error.message) }
    setToast('Kopieret til ny ordre – kontrollér pris, mål og materialer')
    nav('/ordrer/' + n.id)
  })

  const status = STATUS[order.status]
  return (
    <div className="page editor">
      <div className="page-head sticky glass">
        <button className="btn ghost" onClick={() => nav(-1)}>←</button>
        <div className="grow">
          <h1>#{order.order_no} {order.kind === 'tilbud' && <small className="muted">tilbud</small>}</h1>
          <div className="row gap wrap"><Chip kind={status[1]}>{status[0]}</Chip>
            {order.needs_reconfirm && <Chip kind="red">Ændret – kræver ny kundebekræftelse</Chip>}
            {d.task && <Chip kind={TASK[d.task.status][1]}>Skrædder: {TASK[d.task.status][0]} · {d.task.progress} %</Chip>}
          </div>
        </div>
        <SaveState state={saver.state === 'idle' ? custSaver.state : saver.state} error={saver.error || custSaver.error} />
      </div>

      {(saver.state === 'conflict' || custSaver.state === 'conflict') && (
        <div className="warn">
          <b>Ordren er ændret på en anden enhed.</b> Dine indtastninger er bevaret.
          <div className="row gap"><button className="btn primary sm" onClick={() => { saver.resolve(true); custSaver.resolve(true) }}>Gem mine ændringer oven på</button>
            <button className="btn soft sm" onClick={() => { saver.resolve(false); custSaver.resolve(false) }}>Kassér mine og vis deres</button></div>
        </div>
      )}
      {errs.length > 0 && <div className="warn"><b>Ordren kan ikke sendes til kunden endnu.</b> {errs.length} felt(er) mangler – de er markeret med rødt.</div>}

      {/* Kunde */}
      <section className={'card glass' + (errFor('customer') ? ' has-err' : '')}>
        <div className="card-head"><h3>Kunde</h3>
          {!locked && <div className="row gap"><button className="btn soft sm" onClick={() => setModal('pick')}>{d.customer ? 'Skift kunde' : 'Find kunde'}</button>
            <button className="btn soft sm" onClick={() => setModal('new')}>＋ Ny kunde</button></div>}</div>
        {errFor('customer') && <div className="field-err">{errFor('customer')}</div>}
        {d.customer ? (
          <fieldset disabled={locked}>
            <CustomerFields v={{ ...d.customer, ...custSaver.pending }} set={(k, v) => custSaver.set(k, v)}
              errors={{ name: errFor('customer.name'), phone: errFor('customer.phone'), email: errFor('customer.email'), company: errFor('customer.company'), delivery_address: errFor('customer.delivery_address') }} />
          </fieldset>
        ) : <div className="muted">Ingen kunde valgt</div>}
      </section>

      {/* Aftale */}
      <section className="card glass">
        <div className="card-head"><h3>Aftale</h3></div>
        <fieldset disabled={locked} className="grid3">
          <Field label="Overskrift" wide><TextIn value={o.title} onChange={(v) => saver.set('title', v)} placeholder="fx Hynder til båd" /></Field>
          <Field label="Aftalt færdigdato" error={errFor('deadline')}>
            <input type="date" value={o.deadline || ''} onChange={(e) => saver.set('deadline', e.target.value || null, true)} /></Field>
          <Field label="Udlevering"><Segmented value={o.delivery_mode} options={[['afhentning', 'Afhentning'], ['levering', 'Levering']]} onChange={(v) => saver.set('delivery_mode', v, true)} /></Field>
          <Field label="Prioritet"><Segmented value={o.priority} options={[['normal', 'Normal'], ['hoj', 'Haster']]} onChange={(v) => saver.set('priority', v, true)} /></Field>
          <Field label="Skrædder" hint="Opgaven vises hos skrædderen, når kunden har bekræftet">
            <select value={o.assigned_tailor || ''} onChange={(e) => saver.set('assigned_tailor', e.target.value || null, true)}>
              <option value="">Ingen (kun skum / butikken)</option>
              {tailors.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
            </select></Field>
          <Field label="Priser er"><Segmented value={o.price_mode} options={[['ekskl', 'Ekskl. moms'], ['inkl', 'Inkl. moms']]} onChange={(v) => saver.set('price_mode', v, true)} /></Field>
          <Field label="Rabat"><KrIn value={o.discount_ore} onChange={(v) => saver.set('discount_ore', v, true)} /></Field>
          <Field label="Depositum"><KrIn value={o.deposit_ore} onChange={(v) => saver.set('deposit_ore', v, true)} /></Field>
          <Field label="Interne noter (vises ikke for kunden)" wide><TextIn multiline value={o.internal_notes} onChange={(v) => saver.set('internal_notes', v)} /></Field>
        </fieldset>
      </section>

      {/* Dele */}
      <section className={'card glass' + (errFor('parts') ? ' has-err' : '')}>
        <div className="card-head"><h3>Ordredele ({d.parts.length})</h3></div>
        {errFor('parts') && <div className="field-err">{errFor('parts')}</div>}
        {d.parts.map((p, i) => (
          <PartCard key={p.id} part={p} index={i} uid={employee.id} locked={locked} errFor={errFor}
            attachments={d.attachments.filter((a) => a.part_id === p.id)} orderId={id}
            onCopy={() => copyPart(p)} onDelete={() => deletePart(p)} onChanged={load} />
        ))}
        {!locked && <div className="row gap wrap add-parts">
          {Object.entries(PART_TYPES).map(([k, l]) => <button key={k} className="btn soft" onClick={() => addPart(k)} disabled={!!busy}>＋ {l}</button>)}
        </div>}
      </section>

      {/* Pris */}
      <section className="card glass totals">
        <div className="card-head"><h3>Pris</h3><small className="muted">Priser {o.price_mode === 'inkl' ? 'inkl.' : 'ekskl.'} moms</small></div>
        <dl>
          <dt>Varelinjer</dt><dd>{kr(tot.lines_ore)}</dd>
          {tot.discount_ore > 0 && <><dt>Rabat</dt><dd>− {kr(tot.discount_ore)}</dd></>}
          <dt>Grundlag ekskl. moms</dt><dd>{kr(tot.base_ore)}</dd>
          <dt>Moms 25 %</dt><dd>{kr(tot.vat_ore)}</dd>
          <dt className="b">Total inkl. moms</dt><dd className="b">{kr(tot.total_ore)}</dd>
          {tot.deposit_ore > 0 && <><dt>Depositum</dt><dd>− {kr(tot.deposit_ore)}</dd><dt className="b">Restbeløb</dt><dd className="b">{kr(tot.rest_ore)}</dd></>}
        </dl>
      </section>

      {/* Handlinger */}
      <section className="card glass actions">
        <div className="card-head"><h3>Næste skridt</h3></div>
        <div className="row gap wrap">
          {!locked && (order.status === 'kladde' || order.needs_reconfirm) && !awaitingCustomer &&
            <button className="btn primary lg" disabled={!!busy} onClick={prepare}>{busy === 'prepare' ? 'Kontrollerer…' : 'Klar til kundens bekræftelse →'}</button>}
          {awaitingCustomer && <button className="btn primary lg" onClick={() => nav(`/kunde/${id}/${order.prepared_version}`)}>Vis kundevisning (version {order.prepared_version})</button>}
          {d.task && d.task.status === 'faerdig' && !order.needs_reconfirm && <>
            <button className="btn green lg" disabled={!!busy} onClick={() => act('ok', async () => { await rpc('task_action', { p_task_id: d.task.id, p_action: 'godkend' }); setToast('Godkendt – klar til afhentning') })}>✓ Godkend kontrol</button>
            <button className="btn soft lg" disabled={!!busy} onClick={() => setModal('reject')}>Send retur til skrædder</button>
          </>}
          {!d.task && ['bekraeftet', 'i_arbejde', 'til_kontrol'].includes(order.status) && !order.needs_reconfirm &&
            <button className="btn green lg" disabled={!!busy} onClick={() => act('ready', async () => { await rpc('order_to_control', { p_order_id: id }) })}>✓ Kontrolleret – klar til afhentning</button>}
          {order.status === 'klar_til_afhentning' &&
            <button className="btn primary lg" disabled={!!busy} onClick={() => act('pickup', async () => { if (confirm('Registrér at kunden har afhentet hele ordren?')) await rpc('mark_picked_up', { p_order_id: id }) })}>Registrér afhentning</button>}
          <button className="btn ghost" onClick={copyToNew} disabled={!!busy || !order.customer_id}>Genbestil (kopiér til ny ordre)</button>
          {!locked && <button className="btn ghost danger" onClick={() => setModal('cancel')}>Annullér ordre</button>}
          {isAdmin && order.status === 'kladde' && !order.confirmed_version &&
            <button className="btn ghost danger" onClick={() => act('delete', async () => { if (!confirm('Slet kladden permanent?')) return; const r = await supabase.from('orders').delete().eq('id', id); if (r.error) throw new Error(r.error.message); nav('/ordrer') })}>Slet kladde</button>}
        </div>
        {order.status === 'klar_til_afhentning' && <p className="muted">Faktura og afhentningsbesked dannes automatisk – se "Faktura og betaling".</p>}
      </section>

      {order.confirmed_version && <OrderInvoicing order={o} parts={d.parts} onSetBank={(v) => saver.set('bank_profile_id', v, true)} setToast={setToast} />}
      {order.confirmed_version && <OrderMaterials orderId={id} parts={d.parts} />}
      <OrderIntake order={o} locked={locked} onLocation={(v) => saver.set('location', v)} />

      <Comments orderId={id} comments={d.comments} canResolve />

      <section className="card glass">
        <div className="card-head"><h3>Historik</h3></div>
        {d.versions.length === 0 ? <div className="muted">Ingen versioner endnu</div> : (
          <ul className="list">{d.versions.map((v) => (
            <li key={v.version} className="row gap"><b>Version {v.version}</b>
              <span className="muted">klargjort {dateTime(v.prepared_at)} af {v.employees && v.employees.display_name}</span>
              <span className="grow" />{confirmedSet.has(v.version) ? <Chip kind="green">Bekræftet af kunden {dateTime(d.confirmations.find((c) => c.version === v.version).confirmed_at)}</Chip> : <Chip kind="grey">Ikke bekræftet</Chip>}
            </li>))}</ul>
        )}
        <div className="muted small">Oprettet {dateTime(order.created_at)} · senest ændret {dateTime(order.updated_at)}</div>
      </section>

      {modal === 'pick' && <PickCustomer onClose={() => setModal(null)} onPick={pickCustomer} onNew={() => setModal('new')} />}
      {modal === 'new' && <NewCustomerModal onClose={() => setModal(null)} onCreated={pickCustomer} onPickExisting={pickCustomer} />}
      {modal === 'reject' && <ReasonModal title="Send retur til skrædder" label="Hvad skal rettes?" onClose={() => setModal(null)}
        onSubmit={(r) => act('reject', async () => { await rpc('task_action', { p_task_id: d.task.id, p_action: 'afvis', p_reason: r }); setModal(null) })} />}
      {modal === 'cancel' && <ReasonModal title="Annullér ordre" label="Årsag" onClose={() => setModal(null)}
        onSubmit={(r) => act('cancel', async () => { await rpc('cancel_order', { p_order_id: id, p_reason: r }); setModal(null) })} />}
      <Toast msg={toast} onDone={() => setToast('')} />
    </div>
  )
}

function ReasonModal({ title, label, onClose, onSubmit }) {
  const [v, setV] = useState('')
  return (
    <Modal title={title} onClose={onClose}>
      <Field label={label}><textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Field>
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Fortryd</button>
        <button className="btn primary" disabled={!v.trim()} onClick={() => onSubmit(v.trim())}>OK</button></div>
    </Modal>
  )
}

function PickCustomer({ onClose, onPick, onNew }) {
  const [t, setT] = useState('')
  const [rows, setRows] = useState([])
  useEffect(() => {
    const h = setTimeout(async () => {
      const s = t.trim().replace(/[,()%*]/g, '')
      let q = supabase.from('customers').select('id, name, phone, email, company').order('updated_at', { ascending: false }).limit(20)
      if (s) {
        const digits = s.replace(/\D/g, '')
        const ors = [`name.ilike.%${s}%`, `email.ilike.%${s}%`, `company.ilike.%${s}%`]
        if (digits.length >= 3) ors.push(`phone.ilike.%${digits}%`)
        q = q.or(ors.join(','))
      }
      const { data } = await q
      setRows(data || [])
    }, 200)
    return () => clearTimeout(h)
  }, [t])
  return (
    <Modal title="Find kunde" onClose={onClose}>
      <input className="search" autoFocus placeholder="Navn, telefon eller e-mail" value={t} onChange={(e) => setT(e.target.value)} />
      <div className="pick-list">
        {rows.map((c) => <button key={c.id} className="li-btn" onClick={() => onPick(c)}><b>{c.name}</b>{c.company && <span> · {c.company}</span>}<span className="grow" /><small className="muted">{c.phone} {c.email}</small></button>)}
        {rows.length === 0 && <div className="muted pad">Ingen kunder fundet</div>}
      </div>
      <button className="btn soft" onClick={onNew}>＋ Opret ny kunde</button>
    </Modal>
  )
}

function PartCard({ part, index, uid, locked, errFor, attachments, orderId, onCopy, onDelete, onChanged }) {
  const s = useRowSaver({ table: 'order_parts', row: part, uid })
  const p = { ...part, ...s.pending }
  const t = p.part_type
  const foam = t === 'skum' || t === 'hynde_betraek'
  const fabric = t === 'hynde_betraek' || t === 'betraek'
  const dims = t !== 'andet'
  const e = (f) => errFor(f, part.id)
  const anyErr = ['label', 'length_cm', 'width_cm', 'thickness_cm', 'foam_type', 'fabric', 'instructions'].some((f) => e(f))
  return (
    <div className={'part' + (anyErr ? ' has-err' : '')}>
      <div className="part-head">
        <span className="part-no">{index + 1}</span>
        <div className="grow"><TextIn value={p.label} onChange={(v) => s.set('label', v || '')} placeholder="Betegnelse, fx Sædehynde venstre" disabled={locked} className={e('label') ? 'bad' : ''} />
          {e('label') && <span className="field-err">{e('label')}</span>}</div>
        <SaveState state={s.state} error={s.error} />
        {!locked && <><button className="btn ghost sm" onClick={onCopy} title="Kopiér del">⧉ Kopiér</button>
          <button className="btn ghost sm danger" onClick={onDelete} title="Slet del">✕</button></>}
      </div>
      {s.state === 'conflict' && <div className="warn small">Delen er ændret andetsteds. <button className="btn primary sm" onClick={() => s.resolve(true)}>Gem mine</button> <button className="btn soft sm" onClick={() => s.resolve(false)}>Brug deres</button></div>}
      <fieldset disabled={locked} className="grid4">
        <Field label="Type" wide><Segmented value={t} options={Object.entries(PART_TYPES)} onChange={(v) => s.set('part_type', v, true)} /></Field>
        <Field label="Antal"><IntIn value={p.quantity} onChange={(v) => s.set('quantity', v, true)} /></Field>
        {dims && <>
          <Field label="Længde (cm)" error={e('length_cm')}><NumIn value={p.length_cm} onChange={(v) => s.set('length_cm', v, true)} /></Field>
          <Field label="Bredde (cm)" error={e('width_cm')}><NumIn value={p.width_cm} onChange={(v) => s.set('width_cm', v, true)} /></Field>
          <Field label="Tykkelse (cm)" error={e('thickness_cm')}><NumIn value={p.thickness_cm} onChange={(v) => s.set('thickness_cm', v, true)} /></Field>
          <Field label="Form"><select value={p.shape} onChange={(x) => s.set('shape', x.target.value, true)}>
            {['rektangel', 'trapez', 'rund', 'med udskæring', 'efter skabelon', 'specialform'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Målene er" span><Segmented value={p.measure_basis} options={[['faerdigmaal', 'Færdigmål'], ['skummaal', 'Skummål']]} onChange={(v) => s.set('measure_basis', v, true)} /></Field>
          {fabric && <Field label="Sømtillæg (cm)"><NumIn value={p.seam_allowance_cm} onChange={(v) => s.set('seam_allowance_cm', v == null ? 0 : v, true)} /></Field>}
        </>}
        {foam && <>
          <Field label="Skumtype" error={e('foam_type')}><TextIn value={p.foam_type} onChange={(v) => s.set('foam_type', v)} list="foamtypes" /></Field>
          <Field label="Fasthed"><TextIn value={p.firmness} onChange={(v) => s.set('firmness', v)} placeholder="fx blød / medium / fast" /></Field>
        </>}
        {fabric && <>
          <Field label="Stof" error={e('fabric')}><TextIn value={p.fabric} onChange={(v) => s.set('fabric', v)} placeholder="fx Kvadrat Hallingdal 65" /></Field>
          <Field label="Farve"><TextIn value={p.fabric_color} onChange={(v) => s.set('fabric_color', v)} /></Field>
          <Field label="Lynlås"><Segmented value={p.zipper ? 'ja' : 'nej'} options={[['nej', 'Nej'], ['ja', 'Ja']]} onChange={(v) => s.set('zipper', v === 'ja', true)} /></Field>
          <Field label="Syning"><TextIn value={p.sewing} onChange={(v) => s.set('sewing', v)} placeholder="fx kantbånd, paspoil" /></Field>
          <Field label="Tilbehør"><TextIn value={p.accessories} onChange={(v) => s.set('accessories', v)} /></Field>
        </>}
        <Field label="Materialer" span><Segmented value={p.material_source} options={[['bestilles', 'Bestilles'], ['lager', 'Fra lager'], ['kunde', 'Kunden medbringer']]} onChange={(v) => s.set('material_source', v, true)} /></Field>
        <Field label="Stykpris"><KrIn value={p.unit_price_ore} onChange={(v) => s.set('unit_price_ore', v, true)} /></Field>
        <Field label={t === 'andet' ? 'Beskrivelse af opgaven' : 'Instruktioner til værkstedet'} wide error={e('instructions')}>
          <TextIn multiline value={p.instructions} onChange={(v) => s.set('instructions', v)} /></Field>
      </fieldset>
      <div className="row between part-foot">
        <PartPhotos orderId={orderId} partId={part.id} attachments={attachments} canUpload={!locked} canDelete={!locked} onChanged={onChanged} />
        <span className="muted">Linje: <b>{kr((p.quantity || 0) * (p.unit_price_ore || 0))}</b>{part.progress > 0 && <> · fremdrift {part.progress} %{part.stage ? ' · ' + part.stage : ''}</>}</span>
      </div>
      <datalist id="foamtypes">{FOAM_TYPES.map((f) => <option key={f} value={f} />)}</datalist>
    </div>
  )
}

export function Comments({ orderId, comments, canResolve }) {
  const { employee } = useAuth()
  const [txt, setTxt] = useState('')
  const [q, setQ] = useState(false)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!txt.trim()) return
    setBusy(true)
    const { error } = await serverWrite(() => supabase.from('comments').insert({ order_id: orderId, body: txt.trim(), is_question: q, author: employee.id }))
    setBusy(false)
    if (!error) { setTxt(''); setQ(false) } else alert(error.message)
  }
  return (
    <section className="card glass">
      <div className="card-head"><h3>Spørgsmål og kommentarer</h3></div>
      <div className="thread">
        {comments.length === 0 && <div className="muted">Ingen kommentarer</div>}
        {comments.map((c) => (
          <div key={c.id} className={'msg' + (c.author === employee.id ? ' mine' : '') + (c.is_question && !c.resolved ? ' q' : '')}>
            <div className="msg-head"><b>{c.employees && c.employees.display_name}</b><small>{dateTime(c.created_at)}</small>
              {c.is_question && (c.resolved ? <Chip kind="green">Besvaret</Chip> : <Chip kind="red">Spørgsmål</Chip>)}</div>
            <div>{c.body}</div>
            {canResolve && c.is_question && !c.resolved && <button className="btn ghost sm" onClick={() => supabase.from('comments').update({ resolved: true }).eq('id', c.id)}>Markér besvaret</button>}
          </div>
        ))}
      </div>
      <div className="compose">
        <textarea rows={2} placeholder="Skriv en kommentar…" value={txt} onChange={(e) => setTxt(e.target.value)} />
        <div className="row gap"><label className="check"><input type="checkbox" checked={q} onChange={(e) => setQ(e.target.checked)} /> Spørgsmål</label>
          <button className="btn primary" disabled={busy || !txt.trim()} onClick={send}>Send</button></div>
      </div>
    </section>
  )
}
