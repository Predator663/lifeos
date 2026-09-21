import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, AlertCircle, X } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'

const ICONS = { success: CheckCircle2, info: Info, error: AlertCircle }
const COLORS = { success: 'var(--green)', info: 'var(--blue)', error: 'var(--red)' }

export default function ToastStack() {
  const { toasts, dismissToast } = useUIStore()
  return (
    <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
      <AnimatePresence>
        {toasts.map(t => {
          const Icon = ICONS[t.kind] || Info
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 60, scale: .9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: .9, transition: { duration: .15 } }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              style={{
                pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12,
                padding: '12px 14px', minWidth: 260, boxShadow: 'var(--shadow)',
              }}
            >
              <Icon size={18} color={COLORS[t.kind]} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 13, flex: 1 }}>{t.message}</span>
              <button onClick={() => dismissToast(t.id)} className="btn btn-ghost btn-icon" style={{ padding: 4 }}>
                <X size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
