import { motion } from 'framer-motion'
import { LayoutDashboard, CheckSquare, Calendar, Wallet, Flame, StickyNote, User, Settings, Database, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'tasks', label: 'Tasks', icon: CheckSquare },
  { key: 'calendar', label: 'Calendar', icon: Calendar },
  { key: 'finance', label: 'Finance', icon: Wallet },
  { key: 'habits', label: 'Discipline', icon: Flame },
  { key: 'notes', label: 'Notes', icon: StickyNote },
  { key: 'profile', label: 'About Me', icon: User },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'database', label: 'Your data', icon: Database },
]

export default function Sidebar() {
  const { page, setPage, sidebarCollapsed, toggleSidebar } = useUIStore()

  return (
    <motion.aside
      animate={{ width: sidebarCollapsed ? 76 : 224 }}
      transition={{ type: 'spring', stiffness: 300, damping: 32 }}
      style={{
        background: 'var(--bg2)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', flexShrink: 0, padding: '16px 12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px 22px', overflow: 'hidden' }}>
        <div style={{ fontSize: 22, flexShrink: 0 }}>✨</div>
        {!sidebarCollapsed && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="heading"
            style={{ fontSize: 18, fontWeight: 800, whiteSpace: 'nowrap' }}>
            LifeOS
          </motion.span>
        )}
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        {NAV.map(item => {
          const Icon = item.icon
          const active = page === item.key
          return (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'transparent', color: active ? 'var(--text)' : 'var(--text3)',
                fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13.5, textAlign: 'left',
                transition: 'color .2s',
              }}
            >
              {active && (
                <motion.div layoutId="nav-active" transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  style={{ position: 'absolute', inset: 0, background: 'var(--bg4)', borderRadius: 10, zIndex: 0 }} />
              )}
              <Icon size={18} style={{ position: 'relative', zIndex: 1, flexShrink: 0, color: active ? 'var(--accent)' : 'inherit' }} />
              {!sidebarCollapsed && <span style={{ position: 'relative', zIndex: 1, whiteSpace: 'nowrap' }}>{item.label}</span>}
            </button>
          )
        })}
      </nav>

      <button onClick={toggleSidebar} className="btn btn-ghost btn-icon" style={{ alignSelf: sidebarCollapsed ? 'center' : 'flex-end' }}>
        {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
    </motion.aside>
  )
}
