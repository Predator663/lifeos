import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Flame, Pencil, Archive, RotateCcw, CalendarDays, Target, TrendingUp } from 'lucide-react'
import { useHabitsStore } from '../store/useHabitsStore'
import { useUIStore } from '../store/useUIStore'
import Modal from '../components/Modal'
import ProgressRing from '../components/ProgressRing'
import AnimatedNumber from '../components/AnimatedNumber'
import { localISO, addDaysISO } from '../lib/dates'

const ICONS = ['🔥', '💪', '📚', '🧘', '💧', '🏃', '🥗', '😴', '✍️', '🎯']
const COLORS = ['#22c55e', '#e8500a', '#3b82f6', '#a855f7', '#eab308', '#ef4444']
const empty = { name: '', icon: ICONS[0], color: COLORS[0], kind: 'build', target_per_week: 7 }

function daysWindow(n) {
  const days = []
  const today = localISO()
  for (let i = n - 1; i >= 0; i--) days.push(addDaysISO(today, -i))
  return days
}

export default function Habits() {
  const { habits, logsByHabit, streakFor, toggleToday, create, update, archive, unarchive, remove } = useHabitsStore()
  const pushToast = useUIStore(s => s.pushToast)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(empty)
  const [editingId, setEditingId] = useState(null)
  const [historyHabit, setHistoryHabit] = useState(null)
  const [historyLogs, setHistoryLogs] = useState(new Set())
  const days = daysWindow(30)
  const today = days[days.length - 1]

  const activeHabits = habits.filter(h => !h.archived)
  const archivedHabits = habits.filter(h => h.archived)

  // ── Discipline overview — aware of every active habit at once ─────────
  // "On track today" means opposite things depending on kind: for a build
  // habit it's having logged it; for a quit habit it's *not* having
  // logged a slip. Everything downstream (streak, last7/last30) is
  // already normalized per-kind by the backend, so it can be summed the
  // same way regardless of kind.
  const isOnTrackToday = h => (h.kind === 'quit' ? !logsByHabit[h.id]?.has(today) : !!logsByHabit[h.id]?.has(today))
  const doneTodayCount = activeHabits.filter(isOnTrackToday).length
  const todayRate = activeHabits.length > 0 ? Math.round((doneTodayCount / activeHabits.length) * 100) : 0
  const topStreakHabit = activeHabits.reduce((best, h) => (h.streak > (best?.streak ?? -1) ? h : best), null)
  const consistency30 = activeHabits.length > 0
    ? Math.round((activeHabits.reduce((s, h) => s + (h.last30 || 0), 0) / (activeHabits.length * 30)) * 100)
    : 0

  async function save() {
    if (!form.name.trim()) return pushToast('Name the habit', 'error')
    await create(form)
    pushToast('Habit added', 'success')
    setForm(empty)
    setModal(false)
  }

  function openEdit(h) {
    setEditingId(h.id)
    setForm({ name: h.name, icon: h.icon, color: h.color, kind: h.kind || 'build', target_per_week: h.target_per_week || 7 })
  }

  async function saveEdit() {
    if (!form.name.trim()) return pushToast('Name the habit', 'error')
    await update(editingId, form)
    pushToast('Habit updated', 'success')
    setEditingId(null)
    setForm(empty)
  }

  async function openHistory(h) {
    setHistoryHabit(h)
    const from = daysWindow(91)[0]
    const logs = await window.api.habits.getLogs(h.id, from, today)
    setHistoryLogs(new Set(logs.map(l => l.date)))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="page-title">Discipline</h1>
          <p className="page-sub">Consistency compounds — track your streaks.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm(empty); setModal(true) }}><Plus size={16} /> New habit</button>
      </div>

      {activeHabits.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, margin: '18px 0 20px' }}>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <Target size={14} color="var(--text2)" /><span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Today</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              <AnimatedNumber value={doneTodayCount} /> / {activeHabits.length}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>{todayRate}% on track so far</div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .04 }} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <Flame size={14} color="var(--yellow)" /><span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Top streak</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              <AnimatedNumber value={topStreakHabit?.streak || 0} /> <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)' }}>days</span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>{topStreakHabit ? `${topStreakHabit.icon} ${topStreakHabit.name}` : 'No streaks yet'}</div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08 }} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <TrendingUp size={14} color="var(--green)" /><span style={{ fontSize: 11.5, color: 'var(--text3)' }}>30-day consistency</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: consistency30 >= 70 ? 'var(--green)' : consistency30 >= 40 ? 'var(--yellow)' : 'var(--red)' }}>
              <AnimatedNumber value={consistency30} format={v => `${Math.round(v)}%`} />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>across all active habits</div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .12 }} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <CalendarDays size={14} color="var(--text2)" /><span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Active habits</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800 }}><AnimatedNumber value={activeHabits.length} /></div>
            {archivedHabits.length > 0 && <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>+{archivedHabits.length} archived</div>}
          </motion.div>
        </div>
      )}

      {habits.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🔥</div>No habits yet — add your first one.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AnimatePresence initial={true}>
            {[...activeHabits, ...archivedHabits].map((h, i) => {
              const streak = streakFor(h.id)
              const isQuit = h.kind === 'quit'
              const slippedToday = logsByHabit[h.id]?.has(today)
              const onTrackToday = isQuit ? !slippedToday : slippedToday
              const weeklyGoal = !isQuit && h.target_per_week && h.target_per_week < 7 ? h.target_per_week : null
              const ringProgress = isQuit ? (h.bestStreak > 0 ? Math.min(1, streak / h.bestStreak) : (streak > 0 ? 1 : 0)) : Math.min(1, streak / 30)
              return (
                <motion.div key={h.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: h.archived ? .55 : 1, y: 0 }} exit={{ opacity: 0, scale: .96 }}
                  transition={{ delay: Math.min(i, 10) * 0.04 }}
                  whileHover={{ y: -2 }}
                  className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <ProgressRing progress={ringProgress} size={48} color={h.color}>
                    {streak}
                  </ProgressRing>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <span>{h.icon} {h.name}</span>
                      {isQuit && <span className="badge" style={{ background: 'rgba(239,68,68,.12)', color: 'var(--red)' }}>Quitting</span>}
                      {h.archived && <span className="badge" style={{ background: 'var(--bg4)', color: 'var(--text3)' }}>Archived</span>}
                      {!h.archived && !isQuit && streak >= 3 && <span style={{ fontSize: 11, color: 'var(--yellow)' }}><Flame size={11} style={{ display: 'inline', verticalAlign: -1 }} /> {streak} day streak</span>}
                      {!h.archived && isQuit && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{streak} day{streak === 1 ? '' : 's'} clean</span>}
                      {h.bestStreak > streak && <span style={{ fontSize: 11, color: 'var(--text3)' }}>· best {h.bestStreak}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 3, marginBottom: weeklyGoal ? 8 : 0 }}>
                      {days.map(d => {
                        const on = logsByHabit[h.id]?.has(d)
                        const dotColor = on ? (isQuit ? 'var(--red)' : h.color) : 'var(--bg4)'
                        return <div key={d} title={`${d}${isQuit ? (on ? ' — slip' : '') : ''}`} style={{ width: 9, height: 9, borderRadius: 2, background: dotColor }} />
                      })}
                    </div>
                    {weeklyGoal && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text3)', marginBottom: 3 }}>
                          <span>This week</span><span>{h.last7 || 0}/{weeklyGoal}</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 999, background: 'var(--bg4)', overflow: 'hidden' }}>
                          <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, ((h.last7 || 0) / weeklyGoal) * 100)}%` }}
                            transition={{ type: 'spring', stiffness: 90, damping: 20 }}
                            style={{ height: '100%', background: h.color }} />
                        </div>
                      </div>
                    )}
                  </div>
                  {!h.archived && (
                    isQuit ? (
                      <button onClick={() => toggleToday(h.id)} className="btn btn-sm"
                        style={{
                          background: slippedToday ? 'rgba(239,68,68,.12)' : 'transparent',
                          color: slippedToday ? 'var(--red)' : 'var(--text2)',
                          border: `1px solid ${slippedToday ? 'var(--red)' : 'var(--border)'}`, whiteSpace: 'nowrap',
                        }}>
                        {slippedToday ? 'Slipped today ↺' : 'Log a slip'}
                      </button>
                    ) : (
                      <button onClick={() => toggleToday(h.id)} className={`checkbox-circle${onTrackToday ? ' done' : ''}`} style={{ width: 30, height: 30 }}>
                        {onTrackToday && <span style={{ color: '#fff', fontSize: 14 }}>✓</span>}
                      </button>
                    )
                  )}
                  <button className="btn btn-ghost btn-icon" title="History" onClick={() => openHistory(h)}><CalendarDays size={14} /></button>
                  {!h.archived && <button className="btn btn-ghost btn-icon" title="Edit" onClick={() => openEdit(h)}><Pencil size={14} /></button>}
                  {h.archived ? (
                    <button className="btn btn-ghost btn-icon" title="Restore" onClick={() => unarchive(h.id)}><RotateCcw size={14} /></button>
                  ) : (
                    <button className="btn btn-ghost btn-icon" title="Archive" onClick={() => archive(h.id)}><Archive size={14} /></button>
                  )}
                  <button className="btn btn-ghost btn-icon" title="Delete permanently" onClick={() => remove(h.id)}><Trash2 size={14} /></button>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <Modal open={modal} title="New habit" onClose={() => setModal(false)}
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>Add habit</button></>}>
        <HabitForm form={form} setForm={setForm} />
      </Modal>

      <Modal open={!!editingId} title="Edit habit" onClose={() => setEditingId(null)}
        footer={<><button className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button><button className="btn btn-primary" onClick={saveEdit}>Save</button></>}>
        <HabitForm form={form} setForm={setForm} />
      </Modal>

      <Modal open={!!historyHabit} title={historyHabit ? `${historyHabit.icon} ${historyHabit.name} — history` : ''} onClose={() => setHistoryHabit(null)} width={420}>
        {historyHabit && <HabitHistory habit={historyHabit} logs={historyLogs} />}
      </Modal>
    </div>
  )
}

function HabitForm({ form, setForm }) {
  const isQuit = form.kind === 'quit'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>What kind of habit?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setForm({ ...form, kind: 'build' })}
            style={{
              flex: 1, padding: '9px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: !isQuit ? 'var(--accent)' : 'var(--bg3)', color: !isQuit ? '#fff' : 'var(--text2)',
              border: !isQuit ? '1.5px solid var(--accent)' : '1px solid var(--border)',
            }}>
            🌱 Build — do it
          </button>
          <button onClick={() => setForm({ ...form, kind: 'quit' })}
            style={{
              flex: 1, padding: '9px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: isQuit ? 'var(--red)' : 'var(--bg3)', color: isQuit ? '#fff' : 'var(--text2)',
              border: isQuit ? '1.5px solid var(--red)' : '1px solid var(--border)',
            }}>
            🚫 Quit — stop it
          </button>
        </div>
      </div>
      <input className="input" placeholder={isQuit ? 'e.g. Smoking' : 'e.g. Read for 20 minutes'} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
      <div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Icon</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ICONS.map(i => (
            <button key={i} onClick={() => setForm({ ...form, icon: i })}
              style={{ width: 32, height: 32, borderRadius: 8, fontSize: 16, background: form.icon === i ? 'var(--bg4)' : 'var(--bg3)', border: form.icon === i ? '1.5px solid var(--accent)' : '1px solid var(--border)', cursor: 'pointer' }}>
              {i}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Color</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => setForm({ ...form, color: c })}
              style={{ width: 24, height: 24, borderRadius: 999, background: c, border: form.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
          ))}
        </div>
      </div>
      {isQuit ? (
        <div style={{ fontSize: 10.5, color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
          No daily check-in needed — the streak counts days clean automatically. Tap "Log a slip" only on the days you slip up; it resets the current streak but keeps your best one on record.
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Weekly goal — how many days a week?</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3, 4, 5, 6, 7].map(n => (
              <button key={n} onClick={() => setForm({ ...form, target_per_week: n })}
                style={{
                  width: 30, height: 30, borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                  background: form.target_per_week === n ? 'var(--accent)' : 'var(--bg3)',
                  color: form.target_per_week === n ? '#fff' : 'var(--text2)',
                  border: form.target_per_week === n ? '1.5px solid var(--accent)' : '1px solid var(--border)', cursor: 'pointer',
                }}>
                {n}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 5 }}>
            {(form.target_per_week || 7) === 7 ? 'Every day — the streak ring tracks this directly.' : `${form.target_per_week}× a week — a weekly goal bar shows below the streak.`}
          </div>
        </div>
      )}
    </div>
  )
}

// A GitHub-style contribution heatmap for one habit's last 13 weeks, plus
// its headline numbers — aware of the same streak data as the card itself.
function HabitHistory({ habit, logs }) {
  const isQuit = habit.kind === 'quit'
  const days = daysWindow(91)
  const loggedCount = days.filter(d => logs.has(d)).length
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{habit.streak}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>{isQuit ? 'days clean' : 'current streak'}</div>
        </div>
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{habit.bestStreak}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>{isQuit ? 'best clean streak' : 'best streak'}</div>
        </div>
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{loggedCount}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>{isQuit ? 'slips / last 91 days' : 'done / last 91 days'}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 11px)', gridAutoFlow: 'column', gap: 3, justifyContent: 'start', overflowX: 'auto', paddingBottom: 4 }}>
        {days.map((d, i) => (
          <motion.div key={d} title={`${d}${logs.has(d) ? (isQuit ? ' — slip' : ' — done') : ''}`}
            initial={{ opacity: 0, scale: .5 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(i, 60) * 0.004 }}
            style={{ width: 11, height: 11, borderRadius: 3, background: logs.has(d) ? (isQuit ? 'var(--red)' : habit.color) : 'var(--bg4)' }} />
        ))}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 8 }}>
        Each column is roughly one week, oldest on the left.{isQuit ? ' Colored squares mark a slip.' : ''}
      </div>
    </div>
  )
}
