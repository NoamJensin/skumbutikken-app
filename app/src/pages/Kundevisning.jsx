import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase, rpc } from '../lib/supabase'
import { useLive } from '../lib/live'
import { useAuth } from '../lib/auth'
import { PinPad } from '../components/ui'
import { PART_TYPES, kr, date } from '../lib/format'

// Skrivebeskyttet kundevisning på butikkens tablet. Kræver medarbejderens oplåsning for at forlade.
export default function Kundevisning() {
  const { id, version } = useParams()
  const v = Number(version)
  const nav = useNavigate()
  const { employee } = useAuth()
  const [snap, setSnap] = useState(null)
  const [err, setErr] = useState('')
  const [changed, setChanged] = useState(false)
  const [seenAll, setSeenAll] = useState(false)
  const [phase, setPhase] = useState('review') // review | confirming | done | handback
  const [receipt, setReceipt] = useState(null)
  const [urls, setUrls] = useState({})
  const endRef = useRef(null)
  const sending = useRef(false)

  useEffect(() => {
    (async () => {
      const [ver, ord, conf] = await Promise.all([
        supabase.from('order_versions').select('snapshot').eq('order_id', id).eq('version', v).maybeSingle(),
        supabase.from('orders').select('prepared_version').eq('id', id).maybeSingle(),
        supabase.from('order_confirmations').select('confirmed_at').eq('order_id', id).eq('version', v).maybeSingle()
      ])
      if (ver.error || !ver.data) { setErr('Versionen findes ikke'); return }
      setSnap(ver.data.snapshot)
      if (conf.data) { setReceipt({ order_no: ver.data.snapshot.order.order_no, confirmed_at: conf.data.confirmed_at, already: true }); setPhase('done') }
      else if (!ord.data || ord.data.prepared_version !== v) setChanged(true)
      const sk = [].concat(...ver.data.snapshot.parts.map((p) => p.sketches || []))
      if (sk.length) {
        const { data } = await supabase.storage.from('bilag').createSignedUrls(sk, 3600)
        const m = {}; (data || []).forEach((x) => { if (x.signedUrl) m[x.path] = x.signedUrl }); setUrls(m)
      }
    })()
  }, [id, v])

  // Ændres ordren på en anden enhed, må denne version ikke bekræftes
  useLive([{ table: 'orders', filter: 'id=eq.' + id }], async () => {
    const { data } = await supabase.from('orders').select('prepared_version').eq('id', id).maybeSingle()
    if (data && data.prepared_version !== v && phase !== 'done') setChanged(true)
  }, [id, v, phase])

  // Kunden skal have set hele oversigten før "Bekræft" vises
  useEffect(() => {
    if (!endRef.current) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setSeenAll(true) }, { threshold: 0.6 })
    io.observe(endRef.current)
    return () => io.disconnect()
  }, [snap])

  // Spær tilbage-knappen i kundevisning
  useEffect(() => {
    const block = () => history.pushState(null, '', location.href)
    history.pushState(null, '', location.href)
    window.addEventListener('popstate', block)
    return () => window.removeEventListener('popstate', block)
  }, [])

  const confirmIt = async () => {
    if (sending.current) return // gentagne tryk = én bekræftelse
    sending.current = true
    setPhase('confirming')
    try {
      const r = await rpc('confirm_order', { p_order_id: id, p_version: v })
      if (!r.ok) { setChanged(true); setPhase('review') }
      else { setReceipt(r); setPhase('done') }
    } catch (e) {
      // Uklart resultat (fx netværk): bevar status og tjek serveren igen
      setErr('Forbindelsen blev afbrudt. Tryk "Bekræft" igen – det registreres kun én gang.')
      setPhase('review')
    } finally { sending.current = false }
  }

  if (err && !snap) return <div className="kiosk"><div className="err pad">{err}</div><Unlock employee={employee} onOk={() => nav('/ordrer/' + id, { replace: true })} /></div>
  if (!snap) return <div className="kiosk muted pad">Henter…</div>
  const c = snap.customer, t = snap.totals

  if (phase === 'handback') {
    return (
      <div className="kiosk center">
        <div className="handback glass">
          <img src="./sb-monogram.png" alt="" />
          <h2>Tak! Giv venligst tabletten tilbage til medarbejderen.</h2>
          <Unlock employee={employee} onOk={() => nav('/ordrer/' + id, { replace: true })} />
        </div>
      </div>
    )
  }

  if (phase === 'done' && receipt) {
    return (
      <div className="kiosk center">
        <div className="receipt glass">
          <div className="ok-mark">✓</div>
          <h1>Tak for din bestilling</h1>
          <p className="big">Ordrenummer <b>{receipt.order_no || snap.order.order_no}</b></p>
          <p>Bekræftet {new Date(receipt.confirmed_at).toLocaleString('da-DK')}</p>
          <p className="muted">Aftalt færdig: {date(snap.order.deadline)} · {snap.order.delivery_mode === 'levering' ? 'Levering' : 'Afhentning i butikken'}</p>
          <button className="btn primary lg" onClick={() => setPhase('handback')}>Afslut</button>
        </div>
      </div>
    )
  }

  return (
    <div className="kiosk">
      <header className="kiosk-head glass">
        <img src="./sb-monogram.png" alt="" /><div><div className="brand-name">SKUMBUTIKKEN</div><div className="brand-sub">Ordreoversigt til godkendelse</div></div>
        <div className="grow" /><b>Ordre {snap.order.order_no}</b>
      </header>
      {changed && <div className="warn big">Ordren er blevet ændret. Medarbejderen viser dig den nye version, før du kan bekræfte.</div>}
      {err && <div className="warn">{err}</div>}
      <div className="kiosk-body">
        <section className="card glass">
          <h3>Dine oplysninger</h3>
          <div className="kv">
            <span>Navn</span><b>{c.name}{c.company ? ` · ${c.company}` : ''}{c.cvr ? ` (CVR ${c.cvr})` : ''}</b>
            <span>Telefon</span><b>{c.phone || '–'}</b>
            <span>E-mail</span><b>{c.email || '–'}</b>
            <span>Faktureringsadresse</span><b className="pre">{c.billing_address || '–'}</b>
            {c.delivery_address && <><span>Leveringsadresse</span><b className="pre">{c.delivery_address}</b></>}
            <span>Vi kontakter dig via</span><b>{{ sms: 'SMS', email: 'E-mail', telefon: 'Telefon' }[c.preferred_contact]}</b>
          </div>
        </section>
        {snap.order.title && <h2 className="kiosk-title">{snap.order.title}</h2>}
        {snap.parts.map((p, i) => (
          <section key={p.id} className="card glass kpart">
            <div className="row between"><h3>{i + 1}. {p.label}</h3><b>{p.quantity} stk.</b></div>
            <div className="kv">
              <span>Opgave</span><b>{PART_TYPES[p.part_type]}</b>
              {p.length_cm && <><span>Mål ({p.measure_basis === 'skummaal' ? 'skummål' : 'færdige mål'})</span><b>{fmt(p.length_cm)} × {fmt(p.width_cm)} × {fmt(p.thickness_cm)} cm · {p.shape}</b></>}
              {p.foam_type && <><span>Skum</span><b>{p.foam_type}{p.firmness ? ` · ${p.firmness}` : ''}</b></>}
              {p.fabric && <><span>Stof</span><b>{p.fabric}{p.fabric_color ? ` · ${p.fabric_color}` : ''}</b></>}
              {p.fabric && <><span>Lynlås</span><b>{p.zipper ? 'Ja' : 'Nej'}</b></>}
              {p.sewing && <><span>Syning</span><b>{p.sewing}</b></>}
              {p.accessories && <><span>Tilbehør</span><b>{p.accessories}</b></>}
              {p.instructions && <><span>Aftalt arbejde</span><b className="pre">{p.instructions}</b></>}
              <span>Pris</span><b>{p.quantity} × {kr(p.unit_price_ore)} = {kr(p.line_ore)}</b>
            </div>
            {(p.sketches || []).length > 0 && <div className="photos">{p.sketches.map((s) => urls[s] && !s.endsWith('.pdf') ? <img key={s} className="sketch" src={urls[s]} alt="Skitse" /> : null)}</div>}
          </section>
        ))}
        <section className="card glass totals">
          <h3>Pris</h3>
          <dl>
            <dt>Varer</dt><dd>{kr(t.lines_ore)}</dd>
            {t.discount_ore > 0 && <><dt>Rabat</dt><dd>− {kr(t.discount_ore)}</dd></>}
            <dt>Beløb ekskl. moms</dt><dd>{kr(t.base_ore)}</dd>
            <dt>Moms 25 %</dt><dd>{kr(t.vat_ore)}</dd>
            <dt className="b">Total inkl. moms</dt><dd className="b">{kr(t.total_ore)}</dd>
            {t.deposit_ore > 0 && <><dt>Depositum</dt><dd>{kr(t.deposit_ore)}</dd><dt className="b">Restbeløb ved {snap.order.delivery_mode === 'levering' ? 'levering' : 'afhentning'}</dt><dd className="b">{kr(t.rest_ore)}</dd></>}
          </dl>
          <p className="muted">Aftalt færdig: <b>{date(snap.order.deadline)}</b> · {snap.order.delivery_mode === 'levering' ? 'Levering' : 'Afhentning i butikken, Lyngby Hovedgade 112'}</p>
          <p className="muted small">Varerne fremstilles efter dine mål. Kontrollér mål og materialer omhyggeligt.</p>
        </section>
        <div ref={endRef} className="end-marker" />
      </div>
      <footer className="kiosk-foot glass">
        <button className="btn soft lg" onClick={() => setPhase('handback')}>Jeg ønsker rettelser</button>
        <div className="grow" />
        {!seenAll && !changed && <span className="muted">Rul ned og gennemse hele ordren</span>}
        {seenAll && !changed && <button className="btn primary xl" disabled={phase === 'confirming'} onClick={confirmIt}>{phase === 'confirming' ? 'Registrerer…' : 'Bekræft ordre'}</button>}
      </footer>
    </div>
  )
}
const fmt = (n) => String(n).replace('.', ',')

function Unlock({ employee, onOk }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [pw, setPw] = useState('')
  const pin = async (p) => {
    setBusy(true); setErr('')
    try { const r = await rpc('verify_my_pin', { p_pin: p }); if (r.ok) onOk(); else setErr(r.reason === 'laast' ? 'For mange forsøg – brug adgangskode' : 'Forkert PIN') }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const password = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: employee.email, password: pw })
    setBusy(false)
    if (error) setErr('Forkert adgangskode'); else onOk()
  }
  return (
    <div className="unlock">
      <p className="muted">Medarbejder: lås op for at fortsætte ({employee.display_name})</p>
      {employee.has_pin ? <PinPad busy={busy} error={err} onSubmit={pin} /> : (
        <form onSubmit={password} className="stack"><input type="password" placeholder="Adgangskode" value={pw} onChange={(e) => setPw(e.target.value)} />
          {err && <div className="err">{err}</div>}<button className="btn primary" disabled={busy}>Lås op</button></form>
      )}
    </div>
  )
}
