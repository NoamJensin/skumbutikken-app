import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { useLiveQuery, serverWrite } from '../lib/live'
import { useAuth } from '../lib/auth'
import { Chip, Empty, Modal, Field, Toast } from '../components/ui'
import PartPhotos from '../components/PartPhotos'
import { Comments } from './OrdreEditor'
import { TASK, PART_TYPES, STAGES, date, daysUntil } from '../lib/format'

export default function Skraedder() {
  const { employee, isStaff } = useAuth()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState(null)
  const [toast, setToast] = useState('')
  const known = useRef(null)

  const q = useLiveQuery(['tailor_tasks', 'comments', 'notifications'], async () => {
    const tasks = await rpc(isStaff ? 'all_tasks' : 'my_tasks')
    let tailors = []
    if (isStaff) {
      const { data } = await supabase.from('employees').select('id, display_name').eq('role', 'skraedder').eq('active', true).order('sort_order')
      tailors = data || []
    }
    return { tasks, tailors }
  }, [employee.id])

  // Ny opgave → tydelig besked på skrædderens tablet
  useEffect(() => {
    if (!q.data || isStaff) return
    const ids = new Set(q.data.tasks.map((t) => t.id))
    if (known.current) {
      const fresh = q.data.tasks.filter((t) => !known.current.has(t.id))
      if (fresh.length) { setToast(`Ny opgave: ordre ${fresh[0].order.order_no}`); try { navigator.vibrate && navigator.vibrate([200, 100, 200]) } catch (e) { /* ignore */ } }
    }
    known.current = ids
  }, [q.data, isStaff])

  if (q.error) return <div className="page err">{q.error}</div>
  if (!q.data) return <div className="page muted">Henter opgaver…</div>
  const { tasks, tailors } = q.data
  const curTab = isStaff ? (tab || (tailors[0] && tailors[0].id)) : employee.id
  const mine = tasks.filter((t) => t.tailor_id === curTab)
  const selOrder = params.get('ordre')
  const sel = tasks.find((t) => t.order.id === selOrder)

  return (
    <div className="page">
      <div className="page-head"><h1>{isStaff ? 'Skrædderopgaver' : 'Mine opgaver'}</h1></div>
      {isStaff && (
        <div className="tabs">
          {tailors.map((t) => <button key={t.id} className={'tab' + (curTab === t.id ? ' on' : '')} onClick={() => { setTab(t.id); setParams({}) }}>
            {t.display_name} <span className="count">{tasks.filter((x) => x.tailor_id === t.id && x.status !== 'godkendt').length}</span></button>)}
          {tailors.length === 0 && <div className="muted">Ingen skræddere oprettet endnu (Administration → Medarbejdere)</div>}
        </div>
      )}
      <div className={'split' + (sel ? ' has-sel' : '')}>
        <div className="task-list">
          {mine.length === 0 && <Empty>Ingen opgaver</Empty>}
          {mine.map((t) => {
            const dl = daysUntil(t.order.deadline)
            return (
              <button key={t.id} className={'task glass' + (sel && sel.id === t.id ? ' on' : '') + (t.order.priority === 'hoj' ? ' hot' : '')} onClick={() => setParams({ ordre: t.order.id })}>
                <div className="row between"><b>#{t.order.order_no} {t.order.customer_first_name}</b><Chip kind={TASK[t.status][1]}>{TASK[t.status][0]}</Chip></div>
                <div className="muted">{t.order.title || `${t.parts.length} del(e)`}</div>
                <div className="progress"><i style={{ width: t.progress + '%' }} /><span>{t.progress} %</span></div>
                <div className="row between small">
                  <span className={dl != null && dl < 0 ? 'late' : dl != null && dl <= 2 ? 'soon' : ''}>Deadline {date(t.order.deadline)}</span>
                  {t.open_questions > 0 && <Chip kind="red">{t.open_questions} spørgsmål</Chip>}
                  {t.order.needs_reconfirm && <Chip kind="red">Ændres</Chip>}
                </div>
              </button>
            )
          })}
        </div>
        {sel && <TaskDetail key={sel.id} task={sel} onClose={() => setParams({})} onToast={setToast} reload={q.reload} />}
      </div>
      <Toast msg={toast} onDone={() => setToast('')} />
    </div>
  )
}

function TaskDetail({ task, onClose, onToast, reload }) {
  const [busy, setBusy] = useState(false)
  const [pause, setPause] = useState(false)
  const [comments, setComments] = useState([])
  const [atts, setAtts] = useState([])
  const loadSide = async () => {
    const [c, a] = await Promise.all([
      supabase.from('comments').select('*, employees!comments_author_fkey(display_name, role)').eq('order_id', task.order.id).order('created_at'),
      supabase.from('attachments').select('*').eq('order_id', task.order.id)
    ])
    setComments(c.data || []); setAtts(a.data || [])
  }
  useEffect(() => { loadSide() }, [task.order.id, task.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  useLiveQuery([{ table: 'comments', filter: 'order_id=eq.' + task.order.id }, { table: 'attachments', filter: 'order_id=eq.' + task.order.id }], async () => { await loadSide(); return 1 }, [task.order.id])

  const action = async (a, reason) => {
    setBusy(true)
    try { await serverWrite(() => rpc('task_action', { p_task_id: task.id, p_action: a, p_reason: reason || null })); await reload() }
    catch (e) { onToast(e.message) } finally { setBusy(false) }
  }
  const setProgress = async (part, value, stage) => {
    setBusy(true)
    try { await serverWrite(() => rpc('set_part_progress', { p_task_id: task.id, p_part_id: part.id, p_progress: value, p_stage: stage || null })); await reload() }
    catch (e) { onToast(e.message) } finally { setBusy(false) }
  }
  const done = ['faerdig', 'godkendt'].includes(task.status)

  return (
    <div className="task-detail glass">
      <div className="row between"><h2>#{task.order.order_no} {task.order.title}</h2><button className="btn ghost" onClick={onClose}>✕</button></div>
      <div className="row gap wrap">
        <Chip kind={TASK[task.status][1]}>{TASK[task.status][0]}</Chip>
        <span>Deadline <b>{date(task.order.deadline)}</b></span>
        {task.order.priority === 'hoj' && <Chip kind="red">Haster</Chip>}
        {task.pause_reason && task.status === 'pause' && <span className="muted">Pause: {task.pause_reason}</span>}
      </div>
      {task.order.needs_reconfirm && <div className="warn">Ordren er ved at blive ændret og afventer kundens bekræftelse. Vent med de berørte dele.</div>}
      <div className="progress big"><i style={{ width: task.progress + '%' }} /><span>Samlet {task.progress} %</span></div>

      <div className="row gap wrap actions-row">
        {task.status === 'tildelt' && <button className="btn primary lg" disabled={busy} onClick={() => action('modtag')}>Modtag opgave</button>}
        {['tildelt', 'modtaget', 'pause'].includes(task.status) && <button className="btn primary lg" disabled={busy} onClick={() => action('start')}>{task.status === 'pause' ? 'Genoptag' : 'Start opgave'}</button>}
        {['modtaget', 'i_gang'].includes(task.status) && <button className="btn soft lg" disabled={busy} onClick={() => setPause(true)}>Sæt på pause</button>}
        {!done && <button className="btn green lg" disabled={busy} onClick={() => { if (confirm('Meld hele opgaven færdig til butikkens kontrol?')) action('faerdig') }}>✓ Meld færdig til kontrol</button>}
        {done && <span className="muted">{task.status === 'faerdig' ? 'Venter på butikkens kontrol' : 'Godkendt af butikken'}</span>}
      </div>

      {task.parts.map((p, i) => (
        <div key={p.id} className="tpart">
          <div className="row between"><h3>{i + 1}. {p.label} <small className="muted">× {p.quantity}</small></h3><span className="muted">{PART_TYPES[p.part_type]}</span></div>
          <div className="kv">
            {p.length_cm && <><span>Mål ({p.measure_basis === 'skummaal' ? 'skummål' : 'færdigmål'})</span><b className="big">{f(p.length_cm)} × {f(p.width_cm)} × {f(p.thickness_cm)} cm</b></>}
            {Number(p.seam_allowance_cm) > 0 && <><span>Sømtillæg</span><b>{f(p.seam_allowance_cm)} cm</b></>}
            <span>Form</span><b>{p.shape}</b>
            {p.foam_type && <><span>Skum</span><b>{p.foam_type}{p.firmness ? ' · ' + p.firmness : ''}</b></>}
            {p.fabric && <><span>Stof</span><b>{p.fabric}{p.fabric_color ? ' · ' + p.fabric_color : ''}</b></>}
            {p.fabric && <><span>Lynlås</span><b>{p.zipper ? 'Ja' : 'Nej'}</b></>}
            {p.sewing && <><span>Syning</span><b>{p.sewing}</b></>}
            {p.accessories && <><span>Tilbehør</span><b>{p.accessories}</b></>}
            <span>Materialer</span><b>{{ bestilles: 'Bestilles', lager: 'Fra lager', kunde: 'Kunden medbringer' }[p.material_source]}</b>
            {p.instructions && <><span>Instruktioner</span><b className="pre">{p.instructions}</b></>}
          </div>
          <PartPhotos orderId={task.order.id} partId={p.id} attachments={atts.filter((a) => a.part_id === p.id)} canUpload canDelete={false} onChanged={loadSide} />
          <div className="stage-row">
            <span className="muted">Stadie:</span>
            {STAGES.map((s) => <button key={s} disabled={busy || done} className={'pill' + (p.stage === s ? ' on' : '')} onClick={() => setProgress(p, p.progress, s)}>{s}</button>)}
          </div>
          <div className="pct-row">
            {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
              <button key={v} disabled={busy || done} className={'pct' + (p.progress >= v ? ' on' : '')} onClick={() => setProgress(p, p.progress === v ? v - 10 : v, p.stage)}>{v}</button>
            ))}
          </div>
        </div>
      ))}

      <Comments orderId={task.order.id} comments={comments} />
      {pause && <PauseModal onClose={() => setPause(false)} onSubmit={(r) => { setPause(false); action('pause', r) }} />}
    </div>
  )
}
const f = (n) => String(n).replace('.', ',')

function PauseModal({ onClose, onSubmit }) {
  const [r, setR] = useState('')
  const quick = ['Mangler skum', 'Mangler stof', 'Mangler lynlås/tilbehør', 'Spørgsmål til mål', 'Venter på kunden']
  return (
    <Modal title="Sæt på pause" onClose={onClose}>
      <div className="row gap wrap">{quick.map((x) => <button key={x} className={'pill' + (r === x ? ' on' : '')} onClick={() => setR(x)}>{x}</button>)}</div>
      <Field label="Årsag"><textarea rows={2} value={r} onChange={(e) => setR(e.target.value)} /></Field>
      <div className="row end gap"><button className="btn ghost" onClick={onClose}>Fortryd</button><button className="btn primary" disabled={!r.trim()} onClick={() => onSubmit(r.trim())}>Sæt på pause</button></div>
    </Modal>
  )
}
