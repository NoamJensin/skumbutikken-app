import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { serverWrite } from './live'
import { draftKey } from './accounts'

// Gemmer felt-ændringer på én række med optimistisk versionskontrol (row_version).
// - Ændringer samles og sendes efter kort pause.
// - "Gemt" vises først når serveren har accepteret.
// - Offline: ændringer bevares som kladde (pr. bruger) og sendes ved genopkobling.
// - Konflikt: rækken er ændret andetsteds → brugerens ændringer bevares, og brugeren vælger.
export function useRowSaver({ table, row, uid, onSaved }) {
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const [pending, setPending] = useState({})
  const pendingRef = useRef({})
  const rowRef = useRef(row)
  rowRef.current = row
  const timer = useRef(null)
  const flushRef = useRef(null)
  const savedTimer = useRef(null)
  const key = row ? draftKey(uid, table + ':' + row.id) : null

  const persist = (p) => {
    pendingRef.current = p
    setPending(p)
    if (!key) return
    try {
      if (Object.keys(p).length) localStorage.setItem(key, JSON.stringify(p))
      else localStorage.removeItem(key)
    } catch (e) { /* ignore */ }
  }

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const r = rowRef.current
    const patch = pendingRef.current
    if (!r || !Object.keys(patch).length) return
    if (!navigator.onLine) { setState('waiting'); return }
    setState('saving')
    const res = await serverWrite(() => supabase.from(table).update(patch)
      .eq('id', r.id).eq('row_version', r.row_version).select().maybeSingle())
    if (res.error) {
      setError(res.error.message); setState(/fetch|network/i.test(res.error.message) ? 'waiting' : 'error'); return
    }
    if (!res.data) { setState('conflict'); return }
    // Fjern kun de felter der blev gemt (nye tastetryk under gemning bevares)
    const rest = { ...pendingRef.current }
    Object.keys(patch).forEach((k) => { if (rest[k] === patch[k]) delete rest[k] })
    persist(rest)
    if (onSaved) onSaved(res.data)
    rowRef.current = res.data
    setState('saved')
    clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 2000)
    if (Object.keys(rest).length) timer.current = setTimeout(() => flushRef.current(), 300)
  }, [table]) // eslint-disable-line react-hooks/exhaustive-deps

  flushRef.current = flush

  // Gendan kladde fra tidligere (fx efter netværksafbrydelse)
  useEffect(() => {
    if (!key) return
    try {
      const d = JSON.parse(localStorage.getItem(key) || 'null')
      if (d && Object.keys(d).length) { persist(d); setState('waiting'); setTimeout(flush, 500) }
    } catch (e) { /* ignore */ }
    const on = () => flush()
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback((field, value, immediate) => {
    persist({ ...pendingRef.current, [field]: value })
    setState(navigator.onLine ? 'saving' : 'waiting')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, immediate ? 0 : 600)
  }, [flush]) // eslint-disable-line react-hooks/exhaustive-deps

  // Konfliktløsning
  const resolve = useCallback(async (keepMine) => {
    const r = rowRef.current
    const { data } = await supabase.from(table).select('*').eq('id', r.id).maybeSingle()
    if (data) { rowRef.current = data; if (onSaved) onSaved(data) }
    if (!keepMine) { persist({}); setState('idle') } else { setState('saving'); setTimeout(flush, 0) }
  }, [table, flush]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = (field) => (Object.prototype.hasOwnProperty.call(pending, field) ? pending[field] : row ? row[field] : undefined)
  return { state, error, pending, set, value, flush, resolve, dirty: Object.keys(pending).length > 0 }
}
