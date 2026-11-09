// Konti der er logget ind på denne enhed (til hurtigt brugerskift med PIN).
// Hver post: { id, name, role, email, refresh_token }
const KEY = 'sb-device-accounts'

export function listAccounts() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch (e) { return [] }
}
function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch (e) { /* ignore */ } }

export function upsertAccount(acc) {
  const list = listAccounts().filter((a) => a.id !== acc.id)
  list.push(acc)
  list.sort((a, b) => a.name.localeCompare(b.name, 'da'))
  save(list)
}
export function updateToken(id, refresh_token) {
  const list = listAccounts()
  const a = list.find((x) => x.id === id)
  if (a && refresh_token && a.refresh_token !== refresh_token) { a.refresh_token = refresh_token; save(list) }
}
export function removeAccount(id) { save(listAccounts().filter((a) => a.id !== id)) }

// Brugerbundne kladder
export const draftKey = (uid, key) => `draft:${uid}:${key}`
export function clearUserDrafts(uid) {
  const del = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(`draft:${uid}:`)) del.push(k)
  }
  del.forEach((k) => localStorage.removeItem(k))
}
