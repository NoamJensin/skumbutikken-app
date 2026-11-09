import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { serverWrite } from '../lib/live'
import { useAuth } from '../lib/auth'
import { Modal } from './ui'

const KINDS = { foto: 'Foto', skitse: 'Skitse', skabelon: 'Skabelon' }

// Komprimér billeder før upload (tablets tager store fotos)
async function shrink(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/heic') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))
    return blob ? new File([blob], 'foto.jpg', { type: 'image/jpeg' }) : file
  } catch (e) { return file }
}

export default function PartPhotos({ orderId, partId, attachments, canUpload, canDelete, onChanged }) {
  const { employee } = useAuth()
  const [urls, setUrls] = useState({})
  const [kind, setKind] = useState('foto')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState(null)
  const input = useRef(null)
  const paths = attachments.map((a) => a.path).join('|')

  useEffect(() => {
    let alive = true
    if (!attachments.length) { setUrls({}); return }
    supabase.storage.from('bilag').createSignedUrls(attachments.map((a) => a.path), 3600).then(({ data }) => {
      if (!alive || !data) return
      const m = {}; data.forEach((x) => { if (x.signedUrl) m[x.path] = x.signedUrl }); setUrls(m)
    })
    return () => { alive = false }
  }, [paths]) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files) => {
    setBusy(true)
    try {
      for (const f0 of Array.from(files)) {
        const f = await shrink(f0)
        const ext = f.type === 'application/pdf' ? 'pdf' : f.type === 'image/png' ? 'png' : 'jpg'
        const path = `${orderId}/${partId}/${crypto.randomUUID()}.${ext}`
        const up = await serverWrite(() => supabase.storage.from('bilag').upload(path, f, { contentType: f.type }))
        if (up.error) throw new Error(up.error.message)
        const ins = await serverWrite(() => supabase.from('attachments').insert({ order_id: orderId, part_id: partId, path, kind, uploaded_by: employee.id }))
        if (ins.error) throw new Error(ins.error.message)
      }
      onChanged && onChanged()
    } catch (e) { alert('Upload fejlede: ' + e.message) } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  const remove = async (a) => {
    if (!confirm('Slet bilaget?')) return
    await supabase.storage.from('bilag').remove([a.path])
    await supabase.from('attachments').delete().eq('id', a.id)
    setView(null); onChanged && onChanged()
  }

  return (
    <div className="photos">
      {attachments.map((a) => (
        <button key={a.id} className="thumb" onClick={() => setView(a)} title={KINDS[a.kind]}>
          {a.path.endsWith('.pdf') ? <span>PDF</span> : urls[a.path] ? <img src={urls[a.path]} alt={KINDS[a.kind]} /> : <span>…</span>}
          <i>{KINDS[a.kind]}</i>
        </button>
      ))}
      {canUpload && (
        <div className="upl">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn soft sm" disabled={busy} onClick={() => input.current && input.current.click()}>{busy ? 'Uploader…' : '📷 Tilføj'}</button>
          <input ref={input} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => upload(e.target.files)} />
        </div>
      )}
      {view && (
        <Modal title={KINDS[view.kind]} onClose={() => setView(null)} wide>
          {view.path.endsWith('.pdf') ? <a className="btn soft" href={urls[view.path]} target="_blank" rel="noreferrer">Åbn PDF</a>
            : <img className="big-img" src={urls[view.path]} alt="" />}
          {canDelete && <button className="btn ghost danger" onClick={() => remove(view)}>Slet</button>}
        </Modal>
      )}
    </div>
  )
}
