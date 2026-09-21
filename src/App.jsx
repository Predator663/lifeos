import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Sidebar from './components/Sidebar'
import BottomNav from './components/BottomNav'
import { useIsMobile } from './lib/useIsMobile'
import ToastStack from './components/Toast'
import Lock from './components/Lock'
import { useUIStore } from './store/useUIStore'
import { useTasksStore } from './store/useTasksStore'
import { useEventsStore } from './store/useEventsStore'
import { useFinanceStore } from './store/useFinanceStore'
import { useHabitsStore } from './store/useHabitsStore'
import { useNotesStore } from './store/useNotesStore'
import { useProfileStore } from './store/useProfileStore'
import { useAiStore } from './store/useAiStore'
import { useDriveStore } from './store/useDriveStore'
import { useSavingsStore } from './store/useSavingsStore'
import { useDebtsStore } from './store/useDebtsStore'
import { usePhoneStore } from './store/usePhoneStore'

import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import CalendarPage from './pages/Calendar'
import Finance from './pages/Finance'
import Habits from './pages/Habits'
import Notes from './pages/Notes'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import Database from './pages/Database'

const PAGES = { dashboard: Dashboard, tasks: Tasks, calendar: CalendarPage, finance: Finance, habits: Habits, notes: Notes, profile: Profile, settings: Settings, database: Database }

export default function App() {
  const page = useUIStore(s => s.page)
  const loadTasks = useTasksStore(s => s.load)
  const loadEvents = useEventsStore(s => s.load)
  const loadFinance = useFinanceStore(s => s.load)
  const loadHabits = useHabitsStore(s => s.load)
  const loadNotes = useNotesStore(s => s.load)
  const profile = useProfileStore(s => s.profile)
  const loadProfile = useProfileStore(s => s.load)
  const loadAi = useAiStore(s => s.load)
  const loadDrive = useDriveStore(s => s.load)
  const loadSavings = useSavingsStore(s => s.load)
  const loadDebts = useDebtsStore(s => s.load)
  const loadPhone = usePhoneStore(s => s.load)

  // Gates the app shell until a PIN (if one is set) is entered. Once
  // unlocked this stays true for the rest of the renderer's lifetime —
  // hiding to the tray and reopening doesn't re-lock, only a fresh launch does.
  const [unlocked, setUnlocked] = useState(false)
  const isMobile = useIsMobile()
  const setPage = useUIStore(s => s.setPage)
  const closeTopModal = useUIStore(s => s.closeTopModal)

  useEffect(() => {
    // Initial load of every domain up front — small local SQLite reads are
    // sub-millisecond, so there's no meaningful cost to loading everything
    // once instead of lazily per page.
    loadTasks(); loadEvents(); loadFinance(); loadHabits(); loadNotes(); loadProfile(); loadAi(); loadDrive()
    loadSavings(); loadDebts(); loadPhone()

    // The main process broadcasts db:changed whenever ANY write happens —
    // including background ones like the notification scheduler marking a
    // task notified, or an automatic Drive backup completing. Every store
    // reconciles, so whatever page is open always reflects the true
    // database state with no manual refresh.
    const unsubscribe = window.api.onDbChanged(({ table }) => {
      if (table === 'tasks' || table === 'all') loadTasks()
      if (table === 'events' || table === 'all') loadEvents()
      if (table === 'finance' || table === 'all') loadFinance()
      if (table === 'habits' || table === 'all') loadHabits()
      if (table === 'notes' || table === 'all') loadNotes()
      if (table === 'profile' || table === 'all') { loadProfile(); loadAi(); loadDrive(); loadPhone() }
      if (table === 'savings' || table === 'all') loadSavings()
      if (table === 'debts' || table === 'all') loadDebts()
      if (table === 'phone') loadPhone()
    })
    return unsubscribe
  }, [])

  // Android's hardware/gesture back button. Priority is the one users
  // expect from any Android app: close what's on top, else step back to
  // the Dashboard, else leave. On Electron this effect never registers
  // anything, so desktop behaviour is unchanged.
  useEffect(() => {
    if (!window.api?.android?.isNative) return
    let remove = () => {}
    let cancelled = false
    import('@capacitor/app').then(({ App: CapApp }) => {
      if (cancelled) return
      const handle = CapApp.addListener('backButton', () => {
        if (closeTopModal()) return
        if (useUIStore.getState().page !== 'dashboard') { setPage('dashboard'); return }
        CapApp.exitApp()
      })
      remove = () => { handle.then(h => h.remove()).catch(() => {}) }
    }).catch(() => {})
    return () => { cancelled = true; remove() }
  }, [])

  // profile starts null until the first load resolves — treat "unknown yet"
  // as locked-out so the Dashboard never flashes before a PIN check completes.
  if (!profile) return null
  if (profile.has_pin && !unlocked) return <Lock onUnlock={() => setUnlocked(true)} />

  const Page = PAGES[page] || Dashboard

  return (
    <div className={`app-shell${isMobile ? ' mobile' : ''}`}>
      {!isMobile && <Sidebar />}
      <main className="app-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: .12 } }}
            transition={{ duration: .22, ease: [0.4, 0, 0.2, 1] }}
          >
            <Page />
          </motion.div>
        </AnimatePresence>
      </main>
      {isMobile && <BottomNav />}
      <ToastStack />
    </div>
  )
}
