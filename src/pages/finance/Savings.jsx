import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Pencil, Archive, ArchiveRestore, PiggyBank, Target, CalendarClock, TrendingUp,
  Wallet, ChevronDown, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Landmark, Trophy, Sparkles,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useSavingsStore } from '../../store/useSavingsStore'
import { useFinanceStore } from '../../store/useFinanceStore'
import { useUIStore } from '../../store/useUIStore'
import Modal from '../../components/Modal'
import ProgressRing from '../../components/ProgressRing'
import AnimatedNumber from '../../components/AnimatedNumber'
import { analyzeGoal, STATE_META, avgMonthlyExpense } from '../../lib/savingsMath'
import { fmt, fmtDate } from '../../lib/format'
import { localISO } from '../../lib/dates'

const ICONS = ['🎯', '💻', '🏠', '🚗', '📚', '✈️', '💍', '🛟', '📱', '🎓', '🏥', '🐄']
const COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#e8500a', '#eab308', '#14b8a6', '#ef4444']
const emptyGoal = { id: null, name: '', icon: ICONS[0], color: COLORS[0], target_amount: '', target_date: '', account_id: '', opening_amount: '', note: '' }

const MILESTONE_TOAST = {
  25: (n) => `A quarter of the way to “${n}” 🎉`,
  50: (n) => `Halfway to “${n}” — keep going! 🔥`,
  75: (n) => `75% of “${n}” saved — nearly there! 💪`,
  100: (n) => `Goal reached: “${n}” 🏆`,
}

function monthShort(m) {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: 'short' })
}
// The last 6 calendar months (oldest first), zero-filled where nothing was saved.
function lastSixMonths(monthly) {
  const byMonth = Object.fromEntries((monthly || []).map(r => [r.month, r.total]))
  const out = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ month: key, total: byMonth[key] || 0 })
  }
  return out
}

function Chip({ color, children }) {
  return <span className="badge" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>{children}</span>
}

function KPI({ icon: Icon, iconColor, label, delay = 0, children, sub, title }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="card" title={title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Icon size={14} color={iconColor || 'var(--text2)'} /><span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{children}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </motion.div>
  )
}

export default function Savings() {
  const { goals, summary, createGoal, updateGoal, archiveGoal, unarchiveGoal, removeGoal, addEntry } = useSavingsStore()
  const financeSummary = useFinanceStore(s => s.summary)
  const accounts = useFinanceStore(s => s.accounts)
  const pushToast = useUIStore(s => s.pushToast)

  const [goalModal, setGoalModal] = useState(false)
  const [goalForm, setGoalForm] = useState(emptyGoal)
  const [fundsModal, setFundsModal] = useState(null) // { goal, mode: 'deposit' | 'withdraw' }
  const [fundsForm, setFundsForm] = useState({ amount: '', date: localISO(), note: '' })
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showArchived, setShowArchived] = useState(false)

  const activeAccounts = accounts.filter(a => !a.archived)
  const live = goals.filter(g => !g.archived)
  const inProgress = live.filter(g => g.status === 'active')
  const achieved = live.filter(g => g.status === 'achieved')
  const archived = goals.filter(g => g.archived)

  const free = (financeSummary.balance || 0) - summary.totalSaved
  const overallPct = summary.activeTarget > 0 ? Math.round((summary.activeSaved / summary.activeTarget) * 100) : 0
  const chartData = useMemo(() => lastSixMonths(summary.monthly), [summary.monthly])
  const hasChartData = chartData.some(r => r.total !== 0)

  // Suggested emergency fund = 3 months of typical spending.
  const monthlyPivot = useMemo(() => {
    const map = {}
    for (const r of financeSummary.monthly || []) {
      map[r.month] = map[r.month] || { month: r.month, expense: 0 }
      if (r.type === 'expense') map[r.month].expense = r.total
    }
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
  }, [financeSummary.monthly])
  const emergencyTarget = Math.round(avgMonthlyExpense(monthlyPivot) * 3)

  // Goals that name an account as "kept in": flag when they hold more
  // than that account actually has.
  const overAllocated = useMemo(() => {
    const perAccount = {}
    for (const g of live) if (g.account_id) perAccount[g.account_id] = (perAccount[g.account_id] || 0) + g.saved
    return accounts
      .filter(a => !a.archived && perAccount[a.id] > a.balance + 0.005)
      .map(a => ({ name: a.name, goals: perAccount[a.id], balance: a.balance }))
  }, [live, accounts])

  // ── Goal form ───────────────────────────────────────────────────────
  function openNew(preset) {
    setGoalForm({ ...emptyGoal, ...(preset || {}) })
    setGoalModal(true)
  }
  function openEdit(g) {
    setGoalForm({
      id: g.id, name: g.name, icon: g.icon, color: g.color, target_amount: String(g.target_amount),
      target_date: g.target_date || '', account_id: g.account_id || '', opening_amount: '', note: g.note || '',
    })
    setGoalModal(true)
  }
  async function saveGoal() {
    if (!goalForm.name.trim()) return pushToast('Give the goal a name', 'error')
    if (!(Number(goalForm.target_amount) > 0)) return pushToast('Enter a target amount', 'error')
    const data = {
      ...goalForm, target_amount: Number(goalForm.target_amount), opening_amount: Number(goalForm.opening_amount) || 0,
      account_id: goalForm.account_id || null, target_date: goalForm.target_date || null,
    }
    const r = goalForm.id ? await updateGoal(goalForm.id, data) : await createGoal(data)
    if (!r.ok) return pushToast(r.error, 'error')
    pushToast(goalForm.id ? 'Goal updated' : 'Goal created', 'success')
    setGoalModal(false)
  }

  // ── Funds ───────────────────────────────────────────────────────────
  function openFunds(goal, mode) {
    setFundsForm({ amount: '', date: localISO(), note: '' })
    setFundsModal({ goal, mode })
  }
  async function saveFunds() {
    const { goal, mode } = fundsModal
    const amt = Number(fundsForm.amount)
    if (!(amt > 0)) return pushToast('Enter an amount', 'error')
    const r = await addEntry(goal.id, { amount: mode === 'withdraw' ? -amt : amt, date: fundsForm.date, note: fundsForm.note })
    if (!r.ok) return pushToast(r.error, 'error')
    setFundsModal(null)
    if (r.milestone) pushToast(MILESTONE_TOAST[r.milestone](goal.name), 'success')
    else pushToast(mode === 'withdraw' ? 'Withdrawn from goal' : 'Added to goal', 'success')
  }

  async function confirmDelete() {
    await removeGoal(deleteTarget.id)
    pushToast('Goal deleted', 'success')
    setDeleteTarget(null)
  }

  const fundsGoalInfo = fundsModal ? analyzeGoal(fundsModal.goal) : null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 14px' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', maxWidth: 560, lineHeight: 1.5 }}>
          Goals set money aside without moving it — it stays in your accounts, and Free to spend shows what's left after your goals.
        </div>
        <button className="btn btn-primary" onClick={() => openNew()}><Plus size={16} /> New goal</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 16 }}>
        <KPI icon={PiggyBank} iconColor="var(--green)" label="Total saved" sub={`${live.length} goal${live.length === 1 ? '' : 's'}`}>
          <span style={{ color: 'var(--green)' }}><AnimatedNumber value={summary.totalSaved} format={fmt} /></span>
        </KPI>
        <KPI icon={Target} label="Progress on active goals" delay={0.04} sub={summary.activeTarget > 0 ? `${fmt(summary.activeSaved)} of ${fmt(summary.activeTarget)}` : 'No active goals'}>
          <AnimatedNumber value={overallPct} format={v => `${Math.round(v)}%`} />
        </KPI>
        <KPI icon={TrendingUp} label="Saved this month" delay={0.08} sub="net of withdrawals">
          <span style={{ color: summary.savedThisMonth >= 0 ? 'var(--text)' : 'var(--red)' }}><AnimatedNumber value={summary.savedThisMonth} format={fmt} /></span>
        </KPI>
        <KPI icon={Wallet} label="Free to spend" delay={0.12} title="Your total balance minus the money set aside in goals"
          sub={`${fmt(financeSummary.balance)} balance − ${fmt(summary.totalSaved)} set aside`}>
          <span style={{ color: free >= 0 ? 'var(--text)' : 'var(--red)' }}><AnimatedNumber value={free} format={fmt} /></span>
        </KPI>
      </div>

      {overAllocated.map(o => (
        <div key={o.name} className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderColor: 'rgba(234,179,8,.4)' }}>
          <AlertTriangle size={15} color="var(--yellow)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>
            Goals kept in <b>{o.name}</b> add up to {fmt(o.goals)}, but the account only holds {fmt(o.balance)}.
          </span>
        </div>
      ))}

      {live.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: 32 }}>
            <div className="empty-icon">🐷</div>
            <div style={{ marginBottom: 14 }}>No savings goals yet — start with something you're working toward.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => openNew()}><Plus size={15} /> New goal</button>
              <button className="btn btn-secondary" onClick={() => openNew({ name: 'Emergency fund', icon: '🛟', color: '#3b82f6', target_amount: emergencyTarget ? String(emergencyTarget) : '' })}>
                <Sparkles size={15} /> Emergency fund{emergencyTarget ? ` (${fmt(emergencyTarget)})` : ''}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {inProgress.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14, marginBottom: 16 }}>
              <AnimatePresence initial={true}>
                {inProgress.map((g, i) => (
                  <GoalCard key={g.id} goal={g} index={i} onDeposit={() => openFunds(g, 'deposit')} onWithdraw={() => openFunds(g, 'withdraw')}
                    onEdit={() => openEdit(g)} onArchive={() => archiveGoal(g.id)} onDelete={() => setDeleteTarget(g)} />
                ))}
              </AnimatePresence>
            </div>
          )}

          {achieved.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
                <Trophy size={14} color="var(--yellow)" /> Achieved
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14 }}>
                {achieved.map((g, i) => (
                  <GoalCard key={g.id} goal={g} index={i} onDeposit={() => openFunds(g, 'deposit')} onWithdraw={() => openFunds(g, 'withdraw')}
                    onEdit={() => openEdit(g)} onArchive={() => archiveGoal(g.id)} onDelete={() => setDeleteTarget(g)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {hasChartData && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Saved per month</h3>
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthShort} tick={{ fontSize: 11, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text3)' }} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  cursor={{ fill: 'var(--bg4)', opacity: 0.4 }}
                  content={({ active, payload }) => active && payload?.length ? (
                    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', fontSize: 12.5 }}>
                      <div style={{ fontWeight: 700, marginBottom: 3 }}>{monthShort(payload[0].payload.month)}</div>
                      <span style={{ color: payload[0].value >= 0 ? 'var(--green)' : 'var(--red)' }}>{payload[0].value >= 0 ? '+' : ''}{fmt(payload[0].value)}</span>
                    </div>
                  ) : null} />
                <Bar dataKey="total" radius={[4, 4, 4, 4]} animationDuration={700}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.total >= 0 ? '#22c55e' : '#ef4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {archived.length > 0 && (
        <div className="card" style={{ marginBottom: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowArchived(v => !v)} style={{ padding: '2px 6px' }}>
            <Archive size={13} /> Archived goals ({archived.length}) <ChevronDown size={13} style={{ transform: showArchived ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          </button>
          {showArchived && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {archived.map(g => (
                <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 10, opacity: .75 }}>
                  <span style={{ fontSize: 16 }}>{g.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{g.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmt(g.saved)} of {fmt(g.target_amount)}</div>
                  </div>
                  <button className="btn btn-ghost btn-icon" title="Restore" onClick={() => unarchiveGoal(g.id)}><ArchiveRestore size={14} /></button>
                  <button className="btn btn-ghost btn-icon" title="Delete permanently" onClick={() => setDeleteTarget(g)}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Goal form ── */}
      <Modal open={goalModal} title={goalForm.id ? 'Edit goal' : 'New savings goal'} onClose={() => setGoalModal(false)}
        footer={<><button className="btn btn-secondary" onClick={() => setGoalModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveGoal}>{goalForm.id ? 'Save' : 'Create goal'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input className="input" placeholder="What are you saving for? e.g. Laptop, School fees" value={goalForm.name}
            onChange={e => setGoalForm({ ...goalForm, name: e.target.value })} autoFocus />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input type="number" className="input" placeholder="Target amount" value={goalForm.target_amount}
              onChange={e => setGoalForm({ ...goalForm, target_amount: e.target.value })} />
            <input type="date" className="input" title="Deadline (optional)" value={goalForm.target_date}
              onChange={e => setGoalForm({ ...goalForm, target_date: e.target.value })} />
          </div>
          {!goalForm.id && (
            <>
              <input type="number" className="input" placeholder="Already saved (optional)" value={goalForm.opening_amount}
                onChange={e => setGoalForm({ ...goalForm, opening_amount: e.target.value })} />
              {emergencyTarget > 0 && !goalForm.target_amount && (
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}
                  onClick={() => setGoalForm({ ...goalForm, name: goalForm.name || 'Emergency fund', icon: '🛟', target_amount: String(emergencyTarget) })}>
                  <Sparkles size={13} /> Suggest 3 months of spending ({fmt(emergencyTarget)})
                </button>
              )}
            </>
          )}
          <select className="select" value={goalForm.account_id} onChange={e => setGoalForm({ ...goalForm, account_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Kept in… (optional)</option>
            {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Icon</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ICONS.map(i => (
                <button key={i} onClick={() => setGoalForm({ ...goalForm, icon: i })}
                  style={{ width: 32, height: 32, borderRadius: 8, fontSize: 16, background: goalForm.icon === i ? 'var(--bg4)' : 'var(--bg3)', border: goalForm.icon === i ? '1.5px solid var(--accent)' : '1px solid var(--border)', cursor: 'pointer' }}>{i}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text3)', marginRight: 4 }}>Color</span>
            {COLORS.map(c => (
              <button key={c} onClick={() => setGoalForm({ ...goalForm, color: c })}
                style={{ width: 22, height: 22, borderRadius: 999, background: c, border: goalForm.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
            ))}
          </div>
          <input className="input" placeholder="Note (optional)" value={goalForm.note} onChange={e => setGoalForm({ ...goalForm, note: e.target.value })} />
        </div>
      </Modal>

      {/* ── Add / withdraw funds ── */}
      <Modal open={!!fundsModal} title={fundsModal ? `${fundsModal.mode === 'withdraw' ? 'Withdraw from' : 'Add to'} ${fundsModal.goal.icon} ${fundsModal.goal.name}` : ''} onClose={() => setFundsModal(null)}
        footer={<><button className="btn btn-secondary" onClick={() => setFundsModal(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={saveFunds}>{fundsModal?.mode === 'withdraw' ? 'Withdraw' : 'Add funds'}</button></>}>
        {fundsModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>
              {fmt(fundsGoalInfo.saved)} saved of {fmt(fundsGoalInfo.target)}
              {fundsModal.mode === 'deposit' && fundsGoalInfo.remaining > 0 && <> · {fmt(fundsGoalInfo.remaining)} to go</>}
            </div>
            <input type="number" className="input" placeholder="Amount" value={fundsForm.amount} autoFocus
              onChange={e => setFundsForm({ ...fundsForm, amount: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') saveFunds() }} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {fundsModal.mode === 'deposit' && fundsGoalInfo.remaining > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => setFundsForm({ ...fundsForm, amount: String(fundsGoalInfo.remaining) })}>Fill the rest ({fmt(fundsGoalInfo.remaining)})</button>
              )}
              {fundsModal.mode === 'deposit' && fundsGoalInfo.need && (
                <button className="btn btn-secondary btn-sm" onClick={() => setFundsForm({ ...fundsForm, amount: String(Math.ceil(fundsGoalInfo.need.amount)) })}>
                  One {fundsGoalInfo.need.per}'s worth ({fmt(fundsGoalInfo.need.amount)})
                </button>
              )}
              {fundsModal.mode === 'withdraw' && fundsGoalInfo.saved > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => setFundsForm({ ...fundsForm, amount: String(fundsGoalInfo.saved) })}>Everything ({fmt(fundsGoalInfo.saved)})</button>
              )}
            </div>
            <input type="date" className="input" value={fundsForm.date} onChange={e => setFundsForm({ ...fundsForm, date: e.target.value })} />
            <input className="input" placeholder="Note (optional)" value={fundsForm.note} onChange={e => setFundsForm({ ...fundsForm, note: e.target.value })} />
          </div>
        )}
      </Modal>

      <Modal open={!!deleteTarget} title="Delete this goal?" onClose={() => setDeleteTarget(null)}
        footer={<><button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button><button className="btn btn-danger" onClick={confirmDelete}>Delete goal</button></>}>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', margin: 0, lineHeight: 1.6 }}>
          “{deleteTarget?.name}” and its deposit history will be removed. Your account balances aren't affected — the {fmt(deleteTarget?.saved)} simply stops being set aside.
          {' '}To keep the history, archive it instead.
        </p>
      </Modal>
    </div>
  )
}

function GoalCard({ goal: g, index, onDeposit, onWithdraw, onEdit, onArchive, onDelete }) {
  const getEntries = useSavingsStore(s => s.getEntries)
  const removeEntry = useSavingsStore(s => s.removeEntry)
  const pushToast = useUIStore(s => s.pushToast)
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState([])
  const info = analyzeGoal(g)
  const meta = STATE_META[info.state]

  // Re-fetch history whenever it's open and the goal's numbers change.
  useEffect(() => {
    if (open) getEntries(g.id).then(setEntries)
  }, [open, g.saved, g.entries_count])

  async function deleteEntry(id) {
    await removeEntry(id)
    pushToast('Entry removed', 'success')
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .96 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }} whileHover={{ y: -2 }}
      className="card" style={{ borderTop: `3px solid ${g.color}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: `${g.color}26`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{g.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</div>
          <Chip color={meta.color}>{meta.label}</Chip>
        </div>
        <button className="btn btn-ghost btn-icon" style={{ padding: 6 }} title="Edit" onClick={onEdit}><Pencil size={13} /></button>
        <button className="btn btn-ghost btn-icon" style={{ padding: 6 }} title="Archive" onClick={onArchive}><Archive size={13} /></button>
        <button className="btn btn-ghost btn-icon" style={{ padding: 6 }} title="Delete" onClick={onDelete}><Trash2 size={13} /></button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <ProgressRing progress={info.percent / 100} size={64} stroke={6} color={g.color}>{info.percent}%</ProgressRing>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{fmt(g.saved)} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)' }}>of {fmt(g.target_amount)}</span></div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{info.achieved ? '🎉 Goal reached' : `${fmt(info.remaining)} to go`}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text2)' }}>
        {g.target_date && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CalendarClock size={12} color="var(--text3)" />
            {fmtDate(g.target_date)}
            {!info.achieved && info.daysLeft != null && (
              <span style={{ color: info.daysLeft < 0 ? 'var(--red)' : 'var(--text3)' }}>
                · {info.daysLeft < 0 ? `${-info.daysLeft} day${info.daysLeft === -1 ? '' : 's'} past` : info.daysLeft === 0 ? 'today' : `${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'} left`}
              </span>
            )}
          </div>
        )}
        {!info.achieved && info.need && (
          <div>Save <b>{fmt(info.need.amount)}</b> per {info.need.per} to finish on time.</div>
        )}
        {!info.achieved && info.projectedDate && (
          <div style={{ color: 'var(--text3)' }}>At your recent pace ({fmt(info.monthlyPace)}/month): {fmtDate(info.projectedDate)}.</div>
        )}
        {info.state === 'new' && <div style={{ color: 'var(--text3)' }}>Add your first deposit to start tracking your pace.</div>}
        {g.account_name && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text3)' }}><Landmark size={12} /> Kept in {g.account_name}</div>
        )}
        {g.note && <div style={{ color: 'var(--text3)' }}>{g.note}</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-primary btn-sm" onClick={onDeposit}><ArrowDownToLine size={13} /> Add funds</button>
        <button className="btn btn-secondary btn-sm" onClick={onWithdraw} disabled={g.saved <= 0}><ArrowUpFromLine size={13} /> Withdraw</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(v => !v)}>
          History <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </button>
      </div>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflow: 'auto' }}>
          {entries.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>No entries yet.</div>}
          {entries.map(e => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', background: 'var(--bg3)', borderRadius: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.note || (e.amount >= 0 ? 'Deposit' : 'Withdrawal')}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{fmtDate(e.date)}</div>
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: e.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>{e.amount >= 0 ? '+' : '−'}{fmt(Math.abs(e.amount))}</span>
              <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={() => deleteEntry(e.id)}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}
