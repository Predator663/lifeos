import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { User, Delete } from 'lucide-react'
import { useProfileStore } from '../store/useProfileStore'

const PIN_LEN = 4
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

// Full-screen app-lock gate shown once per launch when a PIN is set.
// Auto-submits once 4 digits are entered; wrong PIN shakes and clears.
export default function Lock({ onUnlock }) {
  const profile = useProfileStore(s => s.profile)
  const verifyPin = useProfileStore(s => s.verifyPin)
  const [digits, setDigits] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    function onKey(e) {
      if (checking) return
      if (/^[0-9]$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits, checking])

  function press(d) {
    if (checking || digits.length >= PIN_LEN) return
    const next = digits + d
    setDigits(next)
    if (next.length === PIN_LEN) submit(next)
  }
  function back() {
    if (!checking) setDigits(d => d.slice(0, -1))
  }

  async function submit(pin) {
    setChecking(true)
    const ok = await verifyPin(pin)
    if (ok) {
      setTimeout(onUnlock, 220) // let the last dot land before the screen swaps out
    } else {
      setError(true)
      setTimeout(() => { setError(false); setDigits(''); setChecking(false) }, 480)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 999, background: 'var(--bg)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22,
      }}
    >
      <motion.div
        initial={{ scale: .8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        style={{
          width: 88, height: 88, borderRadius: 999, overflow: 'hidden', flexShrink: 0,
          background: 'var(--bg3)', border: '2px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {profile?.avatar_path
          ? <img src={`file://${profile.avatar_path}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <User size={34} color="var(--text3)" />}
      </motion.div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Welcome back{profile?.name ? `, ${profile.name}` : ''}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Enter your PIN to unlock LifeOS</div>
      </div>

      <motion.div
        animate={error ? { x: [0, -10, 10, -10, 10, 0] } : { x: 0 }}
        transition={{ duration: .4 }}
        style={{ display: 'flex', gap: 14 }}
      >
        {Array.from({ length: PIN_LEN }).map((_, i) => (
          <motion.div
            key={i}
            animate={{ scale: i < digits.length ? [0.6, 1.15, 1] : 1 }}
            transition={{ duration: .22 }}
            style={{
              width: 14, height: 14, borderRadius: 999, border: '2px solid var(--border)',
              background: i < digits.length ? (error ? 'var(--red)' : 'var(--accent)') : 'transparent',
              transition: 'background .15s',
            }}
          />
        ))}
      </motion.div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 56px)', gap: 12, marginTop: 6 }}>
        {KEYS.map(d => (
          <button key={d} onClick={() => press(d)} className="btn btn-secondary" style={{ height: 56, borderRadius: 999, fontSize: 18 }}>{d}</button>
        ))}
        <div />
        <button onClick={() => press('0')} className="btn btn-secondary" style={{ height: 56, borderRadius: 999, fontSize: 18 }}>0</button>
        <button onClick={back} className="btn btn-ghost" style={{ height: 56, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Delete size={18} />
        </button>
      </div>
    </motion.div>
  )
}
