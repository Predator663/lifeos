import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'

// Counts up/down to `value` whenever it changes, instead of snapping —
// used across Finance's KPI cards so live updates (a new transaction, a
// budget edit) feel alive rather than just replacing text.
export default function AnimatedNumber({ value, format, duration = 0.8 }) {
  const fmt = format || (n => Math.round(n).toLocaleString())
  const [display, setDisplay] = useState(fmt(0))
  const prev = useRef(0)

  useEffect(() => {
    const controls = animate(prev.current, value || 0, {
      duration,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(fmt(v)),
    })
    prev.current = value || 0
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return <span>{display}</span>
}
