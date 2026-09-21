// src/components/BottomNav.jsx — phone navigation. Rendered only under
// 768px (see App.jsx); the desktop sidebar is untouched and still the
// only navigation the Electron build ever shows.
//
// Five primary destinations fit comfortably across a phone; the three
// remaining pages live behind "More", which opens as a sheet rather than
// a menu so the targets stay thumb-sized.
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  LayoutDashboard, CheckSquare, Calendar, Wallet, Flame,
  MoreHorizontal, StickyNote, User, Settings as SettingsIcon, Database, X,
} from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import { hapticLight } from '../lib/haptics'

const PRIMARY = [
  { key: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { key: 'tasks', label: 'Tasks', icon: CheckSquare },
  { key: 'calendar', label: 'Calendar', icon: Calendar },
  { key: 'finance', label: 'Finance', icon: Wallet },
  { key: 'habits', label: 'Discipline', icon: Flame },
]

const MORE = [
  { key: 'notes', label: 'Notes', icon: StickyNote },
  { key: 'profile', label: 'About Me', icon: User },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
  { key: 'database', label: 'Your data', icon: Database },
]

export default function BottomNav() {
  const page = useUIStore(s => s.page)
  const setPage = useUIStore(s => s.setPage)
  const [moreOpen, setMoreOpen] = useState(false)

  const go = (key) => { hapticLight(); setPage(key); setMoreOpen(false) }
  const moreActive = MORE.some(m => m.key === page)

  return (
    <>
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setMoreOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(4,6,10,.6)', backdropFilter: 'blur(3px)' }}
          >
            <motion.div
              onClick={e => e.stopPropagation()}
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 36 }}
              className="more-sheet"
            >
              <div className="more-sheet-head">
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>More</h3>
                <button onClick={() => setMoreOpen(false)} className="btn btn-ghost btn-icon" aria-label="Close"><X size={16} /></button>
              </div>
              {MORE.map(item => {
                const Icon = item.icon
                return (
                  <button key={item.key} onClick={() => go(item.key)}
                    className={`more-sheet-item${page === item.key ? ' active' : ''}`}>
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="bottom-nav" role="navigation" aria-label="Main">
        {PRIMARY.map(item => {
          const Icon = item.icon
          const active = page === item.key
          return (
            <button key={item.key} onClick={() => go(item.key)}
              className={`bottom-nav-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}>
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          )
        })}
        <button onClick={() => { hapticLight(); setMoreOpen(v => !v) }}
          className={`bottom-nav-item${moreActive ? ' active' : ''}`} aria-label="More">
          <MoreHorizontal size={20} />
          <span>More</span>
        </button>
      </nav>
    </>
  )
}
