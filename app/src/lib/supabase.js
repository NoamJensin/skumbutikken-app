import { createClient } from '@supabase/supabase-js'

// Offentlige nøgler (beskyttet af adgangsregler i databasen). Kan overskrives via .env
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://bxphyanqubgwehhqwzow.supabase.co'
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_j2eSoutyNx-IaSIMYU6Jzg_YuJe5v-E'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sb-session' },
  realtime: { params: { eventsPerSecond: 20 } }
})

export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args || {})
  if (error) throw new Error(error.message)
  return data
}

export async function adminCall(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    let msg = error.message
    try { const j = await error.context.json(); if (j && j.error) msg = j.error } catch (e) { /* ignore */ }
    throw new Error(msg)
  }
  return data
}
