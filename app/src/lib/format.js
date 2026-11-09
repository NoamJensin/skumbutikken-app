// Beløb lagres som heltal i øre.
const nf = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const kr = (ore) => nf.format((Number(ore) || 0) / 100) + ' kr.'
export const krInput = (ore) => (ore == null ? '' : nf.format((Number(ore) || 0) / 100))
export function parseKr(text) {
  if (text == null) return 0
  const s = String(text).trim().replace(/\s|kr\.?/gi, '')
  if (!s) return 0
  // dansk format: 1.234,50  – accepterer også 1234.5
  let norm = s
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.')
  const v = Number(norm)
  return Number.isFinite(v) ? Math.round(v * 100) : NaN
}
export const num = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','))
export const parseNum = (t) => {
  if (t == null || String(t).trim() === '') return null
  const v = Number(String(t).replace(',', '.'))
  return Number.isFinite(v) ? v : NaN
}
export const date = (d) => (d ? new Date(d).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }) : '–')
export const dateTime = (d) => (d ? new Date(d).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–')
export const daysUntil = (d) => (d ? Math.ceil((new Date(d) - new Date(new Date().toDateString())) / 86400000) : null)

// Samme regel som databasen (order_totals): halvt op, moms 25 %
export function totals(parts, order) {
  const lines = (parts || []).reduce((s, p) => s + (Number(p.quantity) || 0) * (Number(p.unit_price_ore) || 0), 0)
  const net = Math.max(lines - (order.discount_ore || 0), 0)
  let base, vat, total
  if (order.price_mode === 'inkl') { total = net; base = Math.round(total / 1.25); vat = total - base }
  else { base = net; vat = Math.round(base * 0.25); total = base + vat }
  return { lines_ore: lines, discount_ore: order.discount_ore || 0, base_ore: base, vat_ore: vat, total_ore: total,
    deposit_ore: order.deposit_ore || 0, rest_ore: Math.max(total - (order.deposit_ore || 0), 0) }
}

export const STATUS = {
  kladde: ['Kladde', 'grey'],
  klar_til_bekraeftelse: ['Afventer kunden', 'amber'],
  bekraeftet: ['Bekræftet', 'blue'],
  i_arbejde: ['I arbejde', 'blue'],
  til_kontrol: ['Til kontrol', 'amber'],
  klar_til_afhentning: ['Klar til afhentning', 'green'],
  afhentet: ['Afhentet', 'grey'],
  annulleret: ['Annulleret', 'red']
}
export const TASK = {
  tildelt: ['Ny', 'amber'], modtaget: ['Modtaget', 'blue'], i_gang: ['I gang', 'blue'],
  pause: ['Pause', 'red'], faerdig: ['Til kontrol', 'amber'], godkendt: ['Godkendt', 'green']
}
export const PART_TYPES = {
  skum: 'Skum efter mål', hynde_betraek: 'Hynde med betræk', betraek: 'Betræk til eksisterende hynde', andet: 'Andet arbejde'
}
export const ROLE = { admin: 'Administrator', butik: 'Butik', skraedder: 'Skrædder' }
export const FOAM_TYPES = ['22 HL', '22 HL Profil', '27 HR', '32 HR', '36 HR', '50 HR', 'Celciusskum (visco)', 'Latex', 'Bonded', 'Indlægsskum 22 kg']
export const STAGES = ['Tilskæring', 'Syning', 'Montering', 'Finish']
