// Skumbutikken · faktura-PDF efter skabelonen "Skumbutikken_Faktura_Eksempel" (A4)
// Ren JavaScript: bruges af Edge Function (Deno) og af lokale tests (Node).
// Koordinater er målt i eksemplet (pixel) og omregnes til PDF-punkter.

const W = 595.28, H = 841.89
const S = W / 1124 // pixel i eksemplet → punkter
const px = (v) => v * S
const Y = (v) => H - px(v) // top-baseret pixel → PDF y

const C = {
  band: [0.816, 0.871, 0.922],   // lyseblå felter
  ink: [0.29, 0.29, 0.29],       // mørkegrå tekst
  soft: [0.38, 0.38, 0.38],
  line: [0.74, 0.74, 0.74],
  blue: [0.24, 0.62, 0.89],      // SKUMBUTIKKEN
  red: [0.75, 0.3, 0.33]         // lodret streg ved logo
}

export function kr(ore) {
  const neg = ore < 0
  const v = Math.abs(Math.round(ore)) / 100
  const [i, d] = v.toFixed(2).split('.')
  return (neg ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d
}
const qtyTxt = (q) => String(Number(q)).replace('.', ',')
const dDate = (s) => {
  if (!s) return ''
  const d = new Date(s + (String(s).length === 10 ? 'T12:00:00' : ''))
  const m = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december']
  return `${String(d.getDate()).padStart(2, '0')}. ${m[d.getMonth()]} ${d.getFullYear()}`
}

function wrap(font, text, size, maxW) {
  const out = []
  for (const para of String(text || '').split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const t = line ? line + ' ' + word : word
      if (font.widthOfTextAtSize(t, size) <= maxW) line = t
      else {
        if (line) out.push(line)
        // meget lange ord brydes hårdt
        let w = word
        while (font.widthOfTextAtSize(w, size) > maxW) {
          let k = w.length
          while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > maxW) k--
          out.push(w.slice(0, k)); w = w.slice(k)
        }
        line = w
      }
    }
    out.push(line)
  }
  return out
}

// Erstat tegn som WinAnsi ikke kan vise
const safe = (s) => String(s == null ? '' : s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E -ÿ–—•€\n]/g, '')

export async function renderInvoicePdf(PDFLib, snap, logoBytes) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib
  const doc = await PDFDocument.create()
  doc.setTitle(`${snap.kind === 'kreditnota' ? 'Kreditnota' : 'Faktura'} ${snap.invoice_no}`)
  doc.setAuthor(snap.company && snap.company.name || 'Skumbutikken')
  doc.setCreator('Skumbutikken intern app')
  const reg = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo = logoBytes ? await doc.embedPng(logoBytes) : null
  const col = (c) => rgb(c[0], c[1], c[2])

  const T = (page, text, x, y, size, font, color, align) => {
    const s = safe(text)
    const w = font.widthOfTextAtSize(s, size)
    const xx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
    page.drawText(s, { x: xx, y, size, font, color: col(color || C.ink) })
  }
  const spaced = (page, text, x, y, size, font, color, tracking) => {
    let cx = x
    for (const ch of safe(text)) { page.drawText(ch, { x: cx, y, size, font, color: col(color) }); cx += font.widthOfTextAtSize(ch, size) + tracking }
  }

  const isCredit = snap.kind === 'kreditnota'
  const comp = snap.company || {}
  const cust = snap.customer || {}
  const lines = snap.lines || []
  const tot = snap.totals || {}

  // Kolonner (pixel i eksemplet)
  const X_DESC = 117, X_QTY = 610, X_PRICE = 778, X_TOTAL = 1008, DESC_W = px(440)
  const FS = 9.6 // varelinje-skrift
  const ROW = 29 // pt pr. linje (eksemplet: 55 px)

  // Forbered varelinjer med ombrydning
  const rows = lines.map((l) => ({ l, wrapped: wrap(reg, safe(l.description), FS, DESC_W) }))
  const rowH = (r) => ROW + (r.wrapped.length - 1) * 12

  const pages = []
  const newPage = (first) => {
    const p = doc.addPage([W, H])
    p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) })
    pages.push(p)
    if (first) {
      // ---- Topfelt ----
      p.drawRectangle({ x: 0, y: Y(367), width: W, height: px(367), color: col(C.band) })
      T(p, isCredit ? 'KREDITNOTA' : 'FAKTURA', px(117), Y(152), 21.5, bold, C.ink)
      T(p, isCredit ? 'Kreditnota nummer' : 'Faktura nummer', px(117), Y(207), 9.5, reg, C.ink)
      T(p, snap.invoice_no, px(117), Y(231), 9.5, reg, C.ink)
      T(p, 'Dato', px(117), Y(278), 9.5, reg, C.ink)
      T(p, dDate(snap.issued_date), px(117), Y(302), 9.5, reg, C.ink)
      // supplerende lovpligtige felter i samme stil
      T(p, 'Ordrenummer', px(330), Y(207), 9.5, reg, C.ink)
      T(p, snap.order && snap.order.order_no, px(330), Y(231), 9.5, reg, C.ink)
      T(p, isCredit ? 'Krediterer faktura' : 'Leveringsdato', px(330), Y(278), 9.5, reg, C.ink)
      T(p, isCredit ? snap.credits : dDate(snap.delivery_date), px(330), Y(302), 9.5, reg, C.ink)
      // Logo: monogram | streg | ordmærke
      if (logo) {
        const h = px(106), w = h * (logo.width / logo.height)
        p.drawImage(logo, { x: px(661), y: Y(218), width: w, height: h })
      }
      p.drawRectangle({ x: px(747), y: Y(233), width: 1.1, height: px(135), color: col(C.red) })
      T(p, 'SKUMBUTIKKEN', px(765), Y(184), 18.5, bold, C.blue)
      spaced(p, 'ALT I KVALITETSSKUM', px(779), Y(198), 6.2, bold, C.ink, 2.3)
      spaced(p, 'CVR-NR:' + (comp.cvr || ''), px(840), Y(212), 4.6, reg, C.soft, 1.6)
      // ---- Kunde ----
      T(p, 'KUNDE', px(117), Y(463), 10, bold, C.ink)
      const cl = []
      if (cust.company) cl.push(cust.company)
      if (cust.name) cl.push(cust.company ? 'Att.: ' + cust.name : cust.name)
      String(cust.address || '').split('\n').filter(Boolean).forEach((a) => cl.push(a))
      if (cust.cvr) cl.push('CVR ' + cust.cvr)
      cl.slice(0, 5).forEach((t, i) => T(p, t, px(117), Y(489 + i * 33), 9.5, reg, C.ink))
    }
    return p
  }
  const tableHead = (p, top) => {
    p.drawRectangle({ x: 0, y: Y(top + 68), width: W, height: px(68), color: col(C.band) })
    const by = Y(top + 39)
    T(p, 'VARE BESKRIVELSE', px(X_DESC), by, 9.8, bold, C.ink)
    T(p, 'ANTAL', px(X_QTY), by, 9.8, bold, C.ink, 'center')
    T(p, 'PRIS', px(X_PRICE), by, 9.8, bold, C.ink, 'center')
    T(p, 'TOTAL', px(X_TOTAL), by, 9.8, bold, C.ink, 'right')
    return Y(top + 68)
  }

  // Højde der skal være plads til på sidste side: totaler/bank (+ sidefod)
  const extraRows = (snap.paid_ore > 0 ? 2 : 0)
  const TOTALS_H = px(250) + extraRows * px(46)
  const FOOTER_TOP = Y(1281) // NOTER-feltets overkant
  const PAGE_BOTTOM = 60

  let p = newPage(true)
  let y = tableHead(p, 633) - px(64) // første linje (eksemplet: 798 px)
  rows.forEach((r, idx) => {
    const need = rowH(r)
    if (y - need < PAGE_BOTTOM + 30 && idx > 0) {
      T(p, 'Fortsættes på næste side', px(X_TOTAL), PAGE_BOTTOM, 8, reg, C.soft, 'right')
      p = newPage(false)
      T(p, (isCredit ? 'Kreditnota ' : 'Faktura ') + snap.invoice_no + ' (fortsat)', px(117), H - 50, 11, bold, C.ink)
      y = tableHead(p, 120) - px(64)
    }
    const l = r.l
    r.wrapped.forEach((t, k) => T(p, t, px(X_DESC), y - k * 12, FS, reg, C.ink))
    T(p, qtyTxt(l.quantity), px(X_QTY), y, FS, reg, C.ink, 'center')
    T(p, kr(l.unit_price_ore), px(X_PRICE), y, FS, reg, C.ink, 'center')
    T(p, kr(l.line_ore), px(X_TOTAL), y, FS, reg, C.ink, 'right')
    y -= need
  })
  // Plads til totaler + sidefod på sidste side?
  if (y - TOTALS_H < FOOTER_TOP) {
    p = newPage(false)
    T(p, (isCredit ? 'Kreditnota ' : 'Faktura ') + snap.invoice_no + ' (fortsat)', px(117), H - 50, 11, bold, C.ink)
    y = H - 80
  }

  // ---- Skillestreg, bank og totaler ----
  const sepY = Math.min(Y(938), y + px(55) - px(20))
  p.drawRectangle({ x: px(600), y: sepY, width: px(412), height: 1.2, color: col(C.line) })
  const tY = sepY - px(66)
  T(p, 'BANK DETALJER', px(112), tY, 10, bold, C.ink)
  const b = snap.bank || {}
  T(p, b.bank_name, px(112), tY - px(49), 9.5, reg, C.ink)
  T(p, 'Regnr. ' + (b.reg_no || ''), px(112), tY - px(82), 9.5, reg, C.ink)
  T(p, 'Kontonr. ' + (b.account_no || ''), px(112), tY - px(114), 9.5, reg, C.ink)
  if (b.iban) T(p, 'IBAN ' + b.iban + (b.swift ? '  ·  BIC ' + b.swift : ''), px(112), tY - px(146), 8, reg, C.soft)

  const mode = snap.price_mode === 'inkl' ? 'inkl.' : 'ekskl.'
  const rowsT = [
    ['Sub Total (ekskl. moms)', kr(tot.base_ore), reg],
    ['Moms 25%', kr(tot.vat_ore), reg],
    ['Total inkl. moms', kr(tot.total_ore), bold]
  ]
  if (snap.paid_ore > 0) {
    rowsT.push(['Betalt', '-' + kr(snap.paid_ore), reg])
    rowsT.push(['Til betaling', kr(snap.rest_ore), bold])
  }
  rowsT.forEach(([l, v, f], i) => {
    const ty = tY - i * px(46)
    T(p, l, px(599), ty, 10, f, C.ink)
    T(p, v + ' kr.', px(X_TOTAL), ty, 10, f, C.ink, 'right')
  })
  T(p, `Varelinjer er angivet ${mode} moms`, px(599), tY - rowsT.length * px(46) + 4, 7, reg, C.soft)

  // ---- Sidefod: kontakt + NOTER ----
  const ic = (yy, kind) => {
    const cx = px(124), cy = yy + 3.2
    if (kind === 'tel') { p.drawRectangle({ x: cx - 5, y: cy - 4, width: 10, height: 8, color: col(C.ink) }); p.drawCircle({ x: cx, y: cy, size: 2, color: rgb(1, 1, 1) }) }
    if (kind === 'mail') { p.drawRectangle({ x: cx - 5.5, y: cy - 3.5, width: 11, height: 7, color: col(C.ink) }); p.drawLine({ start: { x: cx - 5.5, y: cy + 3.5 }, end: { x: cx, y: cy - 0.5 }, thickness: 0.8, color: rgb(1, 1, 1) }); p.drawLine({ start: { x: cx + 5.5, y: cy + 3.5 }, end: { x: cx, y: cy - 0.5 }, thickness: 0.8, color: rgb(1, 1, 1) }) }
    if (kind === 'pin') { p.drawCircle({ x: cx, y: cy + 1.2, size: 4, color: col(C.ink) }); p.drawCircle({ x: cx, y: cy + 1.2, size: 1.5, color: rgb(1, 1, 1) }) }
    if (kind === 'web') { p.drawCircle({ x: cx, y: cy, size: 5, borderColor: col(C.ink), borderWidth: 1 }); p.drawLine({ start: { x: cx - 5, y: cy }, end: { x: cx + 5, y: cy }, thickness: 0.7, color: col(C.ink) }); p.drawEllipse({ x: cx, y: cy, xScale: 2.2, yScale: 5, borderColor: col(C.ink), borderWidth: 0.7 }) }
  }
  const fy = [1316, 1362, 1408, 1453, 1498].map((v) => Y(v))
  ic(fy[0], 'tel'); T(p, comp.phone || '', px(152), fy[0], 9.5, reg, C.ink)
  ic(fy[1], 'mail'); T(p, comp.email || '', px(152), fy[1], 9.5, reg, C.ink)
  ic(fy[2], 'pin'); T(p, comp.web || '', px(152), fy[2], 9.5, reg, C.ink)
  ic(fy[3], 'web'); T(p, (comp.address || '') + ',', px(152), fy[3], 9.5, reg, C.ink)
  T(p, comp.zip_city || '', px(152), fy[4], 9.5, reg, C.ink)

  p.drawRectangle({ x: px(563), y: Y(1349), width: W - px(563), height: px(68), color: col(C.band) })
  T(p, 'NOTER', px(600), Y(1320), 10, bold, C.ink)
  const notes = []
  if (isCredit && snap.reason) notes.push('Årsag: ' + snap.reason)
  String(snap.notes || '').split('\n').filter(Boolean).forEach((n) => { if (!(isCredit && n.startsWith('Årsag'))) notes.push(n) })
  if (!isCredit && snap.due_date) notes.push('Betalingsfrist: ' + dDate(snap.due_date))
  let ny = Y(1390)
  for (const n of notes) for (const t of wrap(reg, safe(n), 8.4, px(500))) { if (ny < 40) break; T(p, t, px(600), ny, 8.4, reg, C.ink); ny -= 11.5 }

  // ---- Sidetal ----
  if (pages.length > 1) pages.forEach((pg, i) => T(pg, `Side ${i + 1} af ${pages.length}`, W - 28, 18, 7.5, reg, C.soft, 'right'))
  return await doc.save()
}
