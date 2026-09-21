import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useIsMobile } from '../lib/useIsMobile'
import { useUIStore } from '../store/useUIStore'

// One modal component serves both platforms. Above 768px it is exactly
// what it always was — a centred, spring-scaled card — so the desktop
// build looks and animates identically. At phone widths the same content
// slides up from the bottom as a sheet, full-width, with safe-area
// padding so the footer buttons clear the gesture bar.
//
// While open it also registers itself on the UI store's modal stack, so
// Android's hardware back button closes the sheet instead of navigating
// away underneath it.
let modalToken = 0

export default function Modal({ open, title, onClose, children, footer, width = 480 }) {
  const isMobile = useIsMobile()
  const tokenRef = useRef(null)
  const pushModal = useUIStore(s => s.pushModal)
  const popModal = useUIStore(s => s.popModal)

  useEffect(() => {
    if (!open) return
    const token = ++modalToken
    tokenRef.current = token
    pushModal({ token, onClose })
    return () => popModal(token)
  }, [open, onClose])

  const surface = isMobile
    ? {
      width: '100%', maxWidth: '100%', maxHeight: '92vh', overflow: 'auto',
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: '18px 18px 0 0', boxShadow: 'var(--shadow)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }
    : {
      width, maxWidth: '92vw', maxHeight: '86vh', overflow: 'auto',
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 16, boxShadow: 'var(--shadow)',
    }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(4,6,10,.6)', backdropFilter: 'blur(3px)',
            zIndex: 200, display: 'flex',
            alignItems: isMobile ? 'flex-end' : 'center',
            justifyContent: 'center',
          }}
        >
          <motion.div
            onClick={e => e.stopPropagation()}
            initial={isMobile ? { y: '100%' } : { opacity: 0, scale: .92, y: 16 }}
            animate={isMobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={isMobile ? { y: '100%', transition: { duration: .18 } } : { opacity: 0, scale: .95, y: 8, transition: { duration: .15 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            style={surface}
          >
            {isMobile && (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
                <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)' }} />
              </div>
            )}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 20px', borderBottom: '1px solid var(--border)',
              position: isMobile ? 'sticky' : 'static', top: 0,
              background: 'var(--bg2)', zIndex: 1,
            }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
              <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={16} /></button>
            </div>
            <div style={{ padding: 20 }}>{children}</div>
            {footer && (
              <div style={{
                display: 'flex', justifyContent: 'flex-end', gap: 10,
                padding: '14px 20px', borderTop: '1px solid var(--border)',
                position: isMobile ? 'sticky' : 'static', bottom: 0, background: 'var(--bg2)',
              }}>{footer}</div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
