import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { supabase } from './supabase'

// ---- Forbindelsesstatus (online + realtime) ----
let state = { online: typeof navigator === 'undefined' ? true : navigator.onLine, realtime: 'connecting', pending: 0 }
const subs = new Set()
const emit = () => subs.forEach((f) => f())
function set(patch) { state = { ...state, ...patch }; emit() }
export const connection = {
  subscribe(f) { subs.add(f); return () => subs.delete(f) },
  get() { return state },
  setRealtime(s) { if (state.realtime !== s) set({ realtime: s }) },
  begin() { set({ pending: state.pending + 1 }) },
  end() { set({ pending: Math.max(0, state.pending - 1) }) }
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => set({ online: true }))
  window.addEventListener('offline', () => set({ online: false }))
}
export const useConnection = () => useSyncExternalStore(connection.subscribe, connection.get)

// Kør en skrivning; bekræft først når serveren har accepteret den
export async function serverWrite(fn) {
  connection.begin()
  try { return await fn() } finally { connection.end() }
}

// ---- Realtime: abonnér på tabeller og kald onChange (debounced) ----
// Ved genopkobling kaldes onChange også, så manglende ændringer hentes.
let chanSeq = 0
export function useLive(tables, onChange, deps = []) {
  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(() => {
    let timer = null
    let wasDown = false
    const fire = (payload) => {
      clearTimeout(timer)
      timer = setTimeout(() => cb.current(payload), 120)
    }
    const ch = supabase.channel('live-' + (++chanSeq))
    tables.forEach((t) => {
      const spec = typeof t === 'string' ? { table: t } : t
      ch.on('postgres_changes', { event: '*', schema: 'public', ...spec }, fire)
    })
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        connection.setRealtime('live')
        if (wasDown) fire(null)
        wasDown = false
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        connection.setRealtime('down')
        wasDown = true
      }
    })
    const onOnline = () => fire(null)
    window.addEventListener('online', onOnline)
    const onVis = () => { if (document.visibilityState === 'visible') fire(null) }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVis)
      supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// Hjælper: hent data og hold den frisk via realtime
export function useLiveQuery(tables, loader, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = useRef(null)
  load.current = async () => {
    try { setData(await loader()); setError(null) } catch (e) { setError(e.message) }
  }
  useEffect(() => { load.current() }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useLive(tables, () => load.current(), deps)
  return { data, error, reload: () => load.current() }
}
