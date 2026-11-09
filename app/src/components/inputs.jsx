import { useEffect, useRef, useState } from 'react'
import { krInput, parseKr, num, parseNum } from '../lib/format'

// Tekstfelt der committer løbende (gemmeren debouncer)
export function TextIn({ value, onChange, multiline, ...rest }) {
  const [v, setV] = useState(value || '')
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setV(value || '') }, [value])
  const p = {
    value: v, onFocus: () => { focused.current = true },
    onBlur: () => { focused.current = false },
    onChange: (e) => { setV(e.target.value); onChange(e.target.value === '' ? null : e.target.value) }, ...rest
  }
  return multiline ? <textarea rows={3} {...p} /> : <input type="text" {...p} />
}

// Tal (cm m.m.) – dansk komma, committer ved blur/enter
export function NumIn({ value, onChange, ...rest }) {
  const [v, setV] = useState(num(value))
  const [bad, setBad] = useState(false)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setV(num(value)) }, [value])
  const commit = () => {
    const n = parseNum(v)
    if (Number.isNaN(n)) { setBad(true); return }
    setBad(false)
    if (n !== (value == null ? null : Number(value))) onChange(n)
  }
  return <input type="text" inputMode="decimal" className={bad ? 'bad' : ''} value={v}
    onFocus={() => { focused.current = true }}
    onBlur={() => { focused.current = false; commit() }}
    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    onChange={(e) => setV(e.target.value)} {...rest} />
}

export function IntIn({ value, onChange, min = 1, ...rest }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, (Number(value) || min) - 1))} aria-label="Færre">−</button>
      <NumIn value={value} onChange={(n) => onChange(Math.max(min, Math.round(n || min)))} {...rest} />
      <button type="button" onClick={() => onChange((Number(value) || 0) + 1)} aria-label="Flere">＋</button>
    </div>
  )
}

// Beløb i kr. → gemmes i øre
export function KrIn({ value, onChange, ...rest }) {
  const [v, setV] = useState(krInput(value))
  const [bad, setBad] = useState(false)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setV(krInput(value)) }, [value])
  const commit = () => {
    const o = parseKr(v)
    if (Number.isNaN(o) || o < 0) { setBad(true); return }
    setBad(false); setV(krInput(o))
    if (o !== Number(value || 0)) onChange(o)
  }
  return <div className="kr-in"><input type="text" inputMode="decimal" className={bad ? 'bad' : ''} value={v}
    onFocus={() => { focused.current = true }}
    onBlur={() => { focused.current = false; commit() }}
    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    onChange={(e) => setV(e.target.value)} {...rest} /><span>kr.</span></div>
}
