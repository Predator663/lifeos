import { motion } from 'framer-motion'
import { CheckSquare, Calendar, Wallet, Flame, ArrowUpRight, ArrowDownLeft, PiggyBank, HandCoins } from 'lucide-react'
import { useTasksStore } from '../store/useTasksStore'
import { useEventsStore } from '../store/useEventsStore'
import { useFinanceStore } from '../store/useFinanceStore'
import { useHabitsStore } from '../store/useHabitsStore'
import { useSavingsStore } from '../store/useSavingsStore'
import { useDebtsStore } from '../store/useDebtsStore'
import { localISO } from '../lib/dates'
import { analyzeGoal } from '../lib/savingsMath'
import { dueLabel } from '../lib/format'
import ProgressRing from '../components/ProgressRing'
import { useUIStore } from '../store/useUIStore'

function fmtMoney(n) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n || 0) }
function isToday(dateStr) { if (!dateStr) return false; return dateStr.slice(0, 10) === localISO() }

const cardIn = { hidden: { opacity: 0, y: 14 }, show: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.35, ease: [0.4, 0, 0.2, 1] } }) }

export default function Dashboard() {
  const { tasks } = useTasksStore()
  const { events } = useEventsStore()
  const { summary } = useFinanceStore()
  const { habits, streakFor, toggleToday, logsByHabit } = useHabitsStore()
  const setPage = useUIStore(s => s.setPage)

  const todayTasks = tasks.filter(t => t.status === 'pending' && isToday(t.due_date))
  const upcoming = events.filter(e => new Date(e.start_at) >= new Date(new Date().toDateString())).slice(0, 4)
  const todayISO = localISO()

  const goals = useSavingsStore(s => s.goals).filter(g => !g.archived && g.status === 'active').slice(0, 3)
  const { debts, summary: debtSummary } = useDebtsStore()
  const setFinanceTab = useUIStore(s => s.setFinanceTab)
  const goTo = (tab) => { setFinanceTab(tab); setPage('finance') }
  // Open debts with a due date, soonest (or most overdue) first.
  const dueDebts = debts.filter(d => d.status === 'open' && d.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 3)

  const stats = [
    { label: 'Pending tasks', value: tasks.filter(t => t.status === 'pending').length, icon: CheckSquare, color: 'var(--accent)', page: 'tasks' },
    { label: 'Upcoming events', value: upcoming.length, icon: Calendar, color: 'var(--blue)', page: 'calendar' },
    { label: 'Balance', value: fmtMoney(summary.balance), icon: Wallet, color: summary.balance >= 0 ? 'var(--green)' : 'var(--red)', page: 'finance' },
    { label: 'Habits today', value: `${habits.filter(h => logsByHabit[h.id]?.has(todayISO)).length}/${habits.length}`, icon: Flame, color: 'var(--yellow)', page: 'habits' },
  ]

  return (
    <div>
      <h1 className="page-title">Good to see you 👋</h1>
      <p className="page-sub">Here's everything happening across your life, in one place.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {stats.map((s, i) => (
          <motion.div key={s.label} custom={i} variants={cardIn} initial="hidden" animate="show"
            whileHover={{ y: -3 }} onClick={() => setPage(s.page)}
            className="card" style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${s.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <s.icon size={17} color={s.color} />
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{s.value}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>{s.label}</div>
          </motion.div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        <motion.div custom={4} variants={cardIn} initial="hidden" animate="show" className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Today's tasks</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setPage('tasks')}>View all</button>
          </div>
          {todayTasks.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-icon">🎯</div>
              <div>Nothing due today — clear runway.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {todayTasks.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 10 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: t.priority === 'high' ? 'var(--red)' : t.priority === 'low' ? 'var(--text3)' : 'var(--yellow)' }} />
                  <span style={{ fontSize: 13.5, flex: 1 }}>{t.title}</span>
                  {t.due_time && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{t.due_time}</span>}
                </div>
              ))}
            </div>
          )}
        </motion.div>

        <motion.div custom={5} variants={cardIn} initial="hidden" animate="show" className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Discipline streaks</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setPage('habits')}>View all</button>
          </div>
          {habits.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-icon">🔥</div>
              <div>No habits tracked yet.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {habits.slice(0, 4).map(h => {
                const done = logsByHabit[h.id]?.has(todayISO)
                return (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ProgressRing progress={Math.min(1, streakFor(h.id) / 30)} size={34} stroke={4} color={h.color}>
                      {streakFor(h.id)}
                    </ProgressRing>
                    <span style={{ fontSize: 13, flex: 1 }}>{h.icon} {h.name}</span>
                    <button
                      onClick={() => toggleToday(h.id)}
                      className={`checkbox-circle${done ? ' done' : ''}`}
                      style={{ width: 20, height: 20 }}
                    >
                      {done && <span style={{ fontSize: 11, color: '#fff' }}>✓</span>}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </motion.div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <motion.div custom={6} variants={cardIn} initial="hidden" animate="show" className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}><PiggyBank size={16} color="var(--green)" /> Savings goals</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => goTo('savings')}>View all</button>
          </div>
          {goals.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}><div className="empty-icon">🐷</div><div>No active savings goals.</div></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {goals.map(g => {
                const a = analyzeGoal(g)
                return (
                  <div key={g.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                      <span>{g.icon} {g.name}</span>
                      <span style={{ color: 'var(--text3)' }}>{fmtMoney(g.saved)} / {fmtMoney(g.target_amount)} · {a.percent}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: 'var(--bg4)', overflow: 'hidden' }}>
                      <div style={{ width: `${a.percent}%`, height: '100%', borderRadius: 999, background: g.color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </motion.div>

        <motion.div custom={7} variants={cardIn} initial="hidden" animate="show" className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}><HandCoins size={16} color="var(--purple)" /> Debts</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => goTo('debts')}>View all</button>
          </div>
          {debts.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}><div className="empty-icon">🤝</div><div>No debts tracked.</div></div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}><ArrowDownLeft size={12} color="var(--green)" /> Owed to me</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--green)' }}>{fmtMoney(debtSummary.owedToMe)}</div>
                </div>
                <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}><ArrowUpRight size={12} color="var(--red)" /> I owe</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--red)' }}>{fmtMoney(debtSummary.iOwe)}</div>
                </div>
              </div>
              {dueDebts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {dueDebts.map(d => {
                    const due = dueLabel(d.due_date)
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--bg3)', borderRadius: 10, fontSize: 12.5 }}>
                        <span style={{ flex: 1 }}>{d.direction === 'owed_to_me' ? `${d.person} owes you` : `You owe ${d.person}`} <b>{fmtMoney(d.remaining)}</b></span>
                        <span style={{ color: due.tone === 'bad' ? 'var(--red)' : due.tone === 'warn' ? 'var(--yellow)' : 'var(--text3)', fontSize: 11.5 }}>{due.text}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </motion.div>
      </div>
    </div>
  )
}
