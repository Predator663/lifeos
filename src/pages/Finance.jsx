import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import {
  Plus, Trash2, TrendingUp, TrendingDown, Wallet, Target, Repeat, Percent,
  CalendarDays, Award, Download, Loader2, Sparkles, Landmark, Smartphone,
  Banknote, CreditCard, ArrowRightLeft, CheckCircle2, AlertTriangle, Lightbulb,
  Pencil, Archive, ArchiveRestore, RotateCw, PiggyBank, HandCoins, LayoutDashboard,
  Tag, GripVertical, Check, X,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { useFinanceStore } from '../store/useFinanceStore'
import { useUIStore } from '../store/useUIStore'
import { useAiStore } from '../store/useAiStore'
import { useSavingsStore } from '../store/useSavingsStore'
import { useDebtsStore } from '../store/useDebtsStore'
import Savings from './finance/Savings'
import Debts from './finance/Debts'
import { localISO } from '../lib/dates'
import Modal from '../components/Modal'
import AnimatedNumber from '../components/AnimatedNumber'

const PIE_COLORS = ['#e8500a', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ef4444', '#14b8a6', '#f97316']
const ACCOUNT_TYPES = [
  { value: 'bank', label: 'Bank', icon: Landmark },
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'mobile_money', label: 'Mobile Money', icon: Smartphone },
  { value: 'other', label: 'Other', icon: CreditCard },
]
const ACCOUNT_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ef4444', '#14b8a6', '#f97316', '#e8500a']

const empty = { type: 'expense', amount: '', category: 'General', account_id: '', merchant: '', note: '', date: localISO() }
const emptyBudget = { category: 'General', monthly_limit: '' }
const emptyRecurring = { type: 'expense', amount: '', category: 'Rent', account_id: '', note: '', frequency: 'monthly', next_date: localISO() }
const emptyAccount = { id: null, name: '', type: 'bank', institution: '', color: ACCOUNT_COLORS[0], opening_balance: '' }
const emptyTransfer = { from_account_id: '', to_account_id: '', amount: '', note: '', date: localISO() }

function fmt(n) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n || 0) }
function budgetColor(percent) {
  if (percent >= 100) return 'var(--red)'
  if (percent >= 75) return '#eab308'
  return 'var(--green)'
}
function monthLabel(m) {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: 'short' })
}
function dayLabel(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
function accountIcon(type) { return (ACCOUNT_TYPES.find(t => t.value === type) || ACCOUNT_TYPES[3]).icon }

// A clearer, custom chart tooltip shared by every recharts graph on this
// page — colored legend dots, readable labels, and (for the category pie)
// a percent-of-spending readout instead of the raw recharts default.
function ChartTooltip({ active, payload, label, labelFormatter, mode }) {
  if (!active || !payload || !payload.length) return null
  const box = {
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10,
    padding: '9px 12px', fontSize: 12.5, boxShadow: '0 6px 20px rgba(0,0,0,.25)', minWidth: 130,
  }
  const dot = (c) => ({ width: 8, height: 8, borderRadius: 999, background: c, flexShrink: 0, display: 'inline-block' })

  if (mode === 'pie') {
    const p = payload[0]
    const pct = p.payload.__total > 0 ? Math.round((p.value / p.payload.__total) * 100) : 0
    return (
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, marginBottom: 4 }}>
          <span style={dot(p.payload.fill)} />{p.name}
        </div>
        <div style={{ color: 'var(--text2)' }}>{fmt(p.value)} <span style={{ color: 'var(--text3)' }}>· {pct}% of spending</span></div>
      </div>
    )
  }

  const income = payload.find(p => p.dataKey === 'income')?.value
  const expense = payload.find(p => p.dataKey === 'expense')?.value

  return (
    <div style={box}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{labelFormatter ? labelFormatter(label) : label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {payload.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={dot(p.color)} />
            <span style={{ color: 'var(--text3)', flex: 1 }}>{p.name}</span>
            <strong>{fmt(p.value)}</strong>
          </div>
        ))}
      </div>
      {mode === 'bars' && income != null && expense != null && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', color: income - expense >= 0 ? 'var(--green)' : 'var(--red)' }}>
          <span>Net</span><strong>{income - expense >= 0 ? '+' : ''}{fmt(income - expense)}</strong>
        </div>
      )}
    </div>
  )
}

// Small animated pill switch, used for enabling/disabling a recurring transaction.
function Switch({ on, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 36, height: 20, borderRadius: 999, padding: 2, border: 'none', cursor: 'pointer',
        background: on ? 'var(--green)' : 'var(--bg4)', display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start',
        transition: 'background .2s',
      }}
    >
      <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        style={{ width: 16, height: 16, borderRadius: 999, background: '#fff', display: 'block' }} />
    </button>
  )
}

// The row-level "no AI key yet" nudge shown inside Smart Add / Insights
// when Settings has no Anthropic key saved.
function NoKeyPrompt({ text }) {
  const setPage = useUIStore(s => s.setPage)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--text3)' }}>
      <span style={{ flex: 1 }}>{text}</span>
      <button className="btn btn-secondary btn-sm" onClick={() => setPage('settings')}>Open Settings</button>
    </div>
  )
}

// Add / rename / delete / drag-reorder for Finance's category list.
// Delete is intentionally not optimistic — it can be rejected by the
// backend (a category still used by transactions or a recurring entry
// can't be removed, mirroring how Accounts blocks deleting an account
// with history), so the error has to come from the actual write.
function CategoryManager({ categories, onCreate, onRename, onDelete, onReorder, pushToast }) {
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editValue, setEditValue] = useState('')
  // Reorder needs its own array to drag smoothly; it's reset whenever the
  // store's list changes for a reason other than this component's own
  // drag (an add, a rename, another window).
  const [order, setOrder] = useState(categories)
  useEffect(() => { setOrder(categories) }, [categories])

  async function add() {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    const r = await onCreate(name)
    setAdding(false)
    if (r.ok) setNewName('')
    else pushToast(r.error || 'Could not add that category', 'error')
  }

  function startEdit(name) { setEditing(name); setEditValue(name) }

  async function commitEdit() {
    const name = editValue.trim()
    if (!name || name === editing) { setEditing(null); return }
    const r = await onRename(editing, name)
    if (r.ok) setEditing(null)
    else pushToast(r.error || 'Could not rename that category', 'error')
  }

  async function handleDelete(name) {
    const r = await onDelete(name)
    if (!r.ok) pushToast(r.error || 'Could not delete that category', 'error')
  }

  function handleReorder(next) {
    setOrder(next)
    onReorder(next)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          className="input" style={{ flex: 1 }} placeholder="New category name"
          value={newName} onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
        />
        <button className="btn btn-secondary btn-sm" onClick={add} disabled={adding || !newName.trim()}>
          {adding ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Add
        </button>
      </div>

      <Reorder.Group
        as="div" axis="y" values={order} onReorder={handleReorder}
        style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflow: 'auto' }}
      >
        {order.map(name => (
          <Reorder.Item
            as="div" key={name} value={name}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px 7px 4px',
              background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8,
              cursor: editing === name ? 'default' : 'grab',
            }}
          >
            <GripVertical size={14} color="var(--text3)" style={{ flexShrink: 0 }} />
            {editing === name ? (
              <>
                <input
                  className="input" style={{ flex: 1, height: 30, padding: '2px 8px', fontSize: 13 }}
                  autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null) }}
                />
                <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={commitEdit} title="Save">
                  <Check size={14} color="var(--green)" />
                </button>
                <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={() => setEditing(null)} title="Cancel">
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontSize: 13.5 }}>{name}</span>
                <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={() => startEdit(name)} title="Rename">
                  <Pencil size={13} />
                </button>
                <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={() => handleDelete(name)} title="Delete">
                  <Trash2 size={13} color="var(--red)" />
                </button>
              </>
            )}
          </Reorder.Item>
        ))}
      </Reorder.Group>

      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10, lineHeight: 1.5 }}>
        Drag to reorder — that order is what you'll see in every category picker. A category still used by a transaction or a recurring entry can't be deleted; rename it instead, or move those to another category first.
      </div>
    </div>
  )
}

const INSIGHT_ICONS = { positive: CheckCircle2, warning: AlertTriangle, tip: Lightbulb }
const INSIGHT_COLORS = { positive: 'var(--green)', warning: 'var(--red)', tip: 'var(--blue)' }

export default function Finance() {
  const {
    transactions, summary, budgets, recurring, accounts, categories,
    create, remove, setBudget, deleteBudget, createRecurring, toggleRecurring, removeRecurring,
    createAccount, updateAccount, archiveAccount, unarchiveAccount, deleteAccount, createTransfer,
    createCategory, renameCategory, deleteCategory, reorderCategories,
  } = useFinanceStore()
  // categories comes from the database now (Settings > Categories used to
  // be a hardcoded list). The fallback only covers the brief window before
  // the store's first load resolves — after that `categories` is never
  // actually empty because the table always keeps at least one row.
  const CATS = categories.length ? categories : ['General']
  const pushToast = useUIStore(s => s.pushToast)
  const aiSettings = useAiStore(s => s.settings)
  const tab = useUIStore(s => s.financeTab)
  const setTab = useUIStore(s => s.setFinanceTab)
  const savingsTotal = useSavingsStore(s => s.summary.totalSaved)
  const debtsSummary = useDebtsStore(s => s.summary)

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(empty)
  const [budgetModal, setBudgetModal] = useState(false)
  const [budgetForm, setBudgetForm] = useState(emptyBudget)
  const [recurringModal, setRecurringModal] = useState(false)
  const [recurringForm, setRecurringForm] = useState(emptyRecurring)
  const [exporting, setExporting] = useState(false)
  const [categoryModal, setCategoryModal] = useState(false)

  const [accountModal, setAccountModal] = useState(false)
  const [accountForm, setAccountForm] = useState(emptyAccount)
  const [transferModal, setTransferModal] = useState(false)
  const [transferForm, setTransferForm] = useState(emptyTransfer)

  const [smartText, setSmartText] = useState('')
  const [smartLoading, setSmartLoading] = useState(false)

  const [insights, setInsights] = useState([])
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsAt, setInsightsAt] = useState(null)

  const activeAccounts = accounts.filter(a => !a.archived)
  const archivedAccounts = accounts.filter(a => a.archived)

  // ── Derived analytics ────────────────────────────────────────────────
  const monthlyPivot = useMemo(() => {
    const map = {}
    for (const r of summary.monthly || []) {
      map[r.month] = map[r.month] || { month: r.month, income: 0, expense: 0 }
      map[r.month][r.type] = r.total
    }
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
  }, [summary.monthly])

  const dailyPivot = useMemo(() => {
    const map = {}
    for (const r of summary.last30 || []) {
      map[r.date] = map[r.date] || { date: r.date, income: 0, expense: 0 }
      map[r.date][r.type] = r.total
    }
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ ...d, net: d.income - d.expense }))
  }, [summary.last30])

  // Category pie data with its color baked in, so the tooltip and the
  // slice always agree on which color belongs to which category.
  const categoryData = useMemo(() => {
    const total = (summary.byCategory || []).reduce((a, c) => a + c.total, 0)
    return (summary.byCategory || []).map((c, i) => ({ ...c, fill: PIE_COLORS[i % PIE_COLORS.length], __total: total }))
  }, [summary.byCategory])

  const savingsRate = summary.income > 0 ? Math.round(((summary.income - summary.expense) / summary.income) * 100) : 0
  const last30Expense = (summary.last30 || []).filter(r => r.type === 'expense').reduce((a, r) => a + r.total, 0)
  const avgDailySpend = last30Expense / 30
  const topCategory = summary.byCategory[0] || null
  const thisMonth = monthlyPivot[monthlyPivot.length - 1]
  const lastMonthRow = monthlyPivot[monthlyPivot.length - 2]
  const momChange = (thisMonth && lastMonthRow && lastMonthRow.expense > 0)
    ? Math.round(((thisMonth.expense - lastMonthRow.expense) / lastMonthRow.expense) * 100)
    : null

  // ── Cross-module awareness ──────────────────────────────────────────
  // Balance is aware of Accounts: the breakdown below the headline number
  // and this total (for computing each account's share) come straight
  // from summary.accountsBreakdown, which the accounts-aware balance in
  // the backend already sums the balance from.
  const accountsBreakdown = summary.accountsBreakdown || []
  const accountsTotalPositive = accountsBreakdown.reduce((s, a) => s + Math.max(0, a.balance), 0)
  const unassigned = summary.unassigned || 0

  // Recurring is aware of Balance: turn every *active* recurring line into
  // a monthly-equivalent net effect (weekly ≈ ×4.33) so we can project
  // where the balance is headed, not just what it is today.
  const recurringMonthlyNet = recurring.filter(r => r.active).reduce((sum, r) => {
    const perMonth = r.amount * (r.frequency === 'weekly' ? 4.33 : 1)
    return sum + (r.type === 'income' ? perMonth : -perMonth)
  }, 0)
  const projectedBalance = summary.balance + recurringMonthlyNet

  // Top category is aware of Budgets: find the matching budget, if any,
  // so the KPI card can show how that spending is tracking.
  const topCategoryBudget = topCategory ? budgets.find(b => b.category === topCategory.category) : null

  // ── Transactions ────────────────────────────────────────────────────
  function openAddModal(prefill) {
    // `empty`/`emptyRecurring`'s hardcoded category ('General'/'Rent') may
    // no longer exist if it was renamed or deleted, so fall back to
    // whatever the first real category is.
    const category = CATS.includes(empty.category) ? empty.category : CATS[0]
    setForm({ ...empty, category, account_id: activeAccounts[0]?.id || '', ...(prefill || {}) })
    setModal(true)
  }

  async function save() {
    if (!form.amount || Number(form.amount) <= 0) return pushToast('Enter a valid amount', 'error')
    if (activeAccounts.length > 0 && !form.account_id) return pushToast('Choose an account', 'error')
    await create({ ...form, amount: Number(form.amount), account_id: form.account_id || null })
    pushToast('Transaction added', 'success')
    setForm(empty)
    setModal(false)
  }

  async function saveBudget() {
    if (!budgetForm.monthly_limit || Number(budgetForm.monthly_limit) <= 0) return pushToast('Enter a valid monthly limit', 'error')
    await setBudget(budgetForm.category, Number(budgetForm.monthly_limit))
    pushToast('Budget saved', 'success')
    setBudgetForm(emptyBudget)
    setBudgetModal(false)
  }

  async function saveRecurring() {
    if (!recurringForm.amount || Number(recurringForm.amount) <= 0) return pushToast('Enter a valid amount', 'error')
    await createRecurring({ ...recurringForm, amount: Number(recurringForm.amount), account_id: recurringForm.account_id || null })
    pushToast('Recurring transaction added', 'success')
    setRecurringForm(emptyRecurring)
    setRecurringModal(false)
  }

  async function handleExport() {
    setExporting(true)
    const result = await window.api.finance.exportPdf()
    setExporting(false)
    if (result) pushToast('Report exported', 'success')
  }

  const budgetedCats = new Set(budgets.map(b => b.category))
  const availableForBudget = CATS.filter(c => !budgetedCats.has(c))

  // ── Accounts ────────────────────────────────────────────────────────
  function openAddAccount() {
    setAccountForm({ ...emptyAccount, color: ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length] })
    setAccountModal(true)
  }
  function openEditAccount(a) {
    setAccountForm({ id: a.id, name: a.name, type: a.type, institution: a.institution || '', color: a.color, opening_balance: '' })
    setAccountModal(true)
  }
  async function saveAccount() {
    if (!accountForm.name.trim()) return pushToast('Give the account a name', 'error')
    if (accountForm.id) {
      await updateAccount(accountForm.id, accountForm)
      pushToast('Account updated', 'success')
    } else {
      await createAccount({ ...accountForm, opening_balance: Number(accountForm.opening_balance) || 0 })
      pushToast('Account added', 'success')
    }
    setAccountModal(false)
  }
  async function handleDeleteAccount(id) {
    const r = await deleteAccount(id)
    if (r && r.ok === false) pushToast(r.error, 'error')
    else pushToast('Account deleted', 'success')
  }

  // ── Transfers ───────────────────────────────────────────────────────
  function openTransfer() {
    if (activeAccounts.length < 2) return pushToast('Add at least two accounts first', 'error')
    setTransferForm({ ...emptyTransfer, from_account_id: activeAccounts[0].id, to_account_id: activeAccounts[1].id })
    setTransferModal(true)
  }
  async function saveTransfer() {
    if (!transferForm.amount || Number(transferForm.amount) <= 0) return pushToast('Enter a valid amount', 'error')
    if (transferForm.from_account_id === transferForm.to_account_id) return pushToast('Choose two different accounts', 'error')
    const r = await createTransfer({ ...transferForm, amount: Number(transferForm.amount) })
    if (r && r.ok === false) return pushToast(r.error, 'error')
    pushToast('Transfer recorded', 'success')
    setTransferModal(false)
  }

  // ── AI: Smart Add ───────────────────────────────────────────────────
  async function runSmartAdd() {
    if (!smartText.trim()) return
    setSmartLoading(true)
    const r = await window.api.ai.parseTransaction(smartText.trim())
    setSmartLoading(false)
    if (!r.ok) return pushToast(r.error, 'error')
    const matchedAccount = accounts.find(a => a.name.toLowerCase() === (r.data.account || '').toLowerCase())
    openAddModal({
      type: r.data.type,
      amount: String(r.data.amount),
      category: r.data.category,
      account_id: matchedAccount ? matchedAccount.id : (activeAccounts[0]?.id || ''),
      merchant: r.data.merchant,
      note: r.data.note,
      date: r.data.date,
    })
    setSmartText('')
    pushToast('Parsed — review and confirm below', 'success')
  }

  // ── AI: Insights ────────────────────────────────────────────────────
  async function runInsights() {
    setInsightsLoading(true)
    const r = await window.api.ai.generateInsights()
    setInsightsLoading(false)
    if (!r.ok) return pushToast(r.error, 'error')
    setInsights(r.insights)
    setInsightsAt(new Date())
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="page-title">Finance</h1>
          <p className="page-sub">Track income and expenses at a glance.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Export PDF
          </button>
          <button className="btn btn-secondary" onClick={openTransfer} disabled={activeAccounts.length < 2}
            title={activeAccounts.length < 2 ? 'Add at least two accounts first' : ''}>
            <ArrowRightLeft size={16} /> Transfer
          </button>
          <button className="btn btn-secondary" onClick={() => setCategoryModal(true)}>
            <Tag size={16} /> Categories
          </button>
          <button className="btn btn-primary" onClick={() => openAddModal()}><Plus size={16} /> Add transaction</button>
        </div>
      </div>

      <div className="finance-tabs" style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'overview', label: 'Overview', icon: LayoutDashboard },
          { key: 'savings', label: 'Savings', icon: PiggyBank },
          { key: 'debts', label: 'Debts', icon: HandCoins, badge: debtsSummary.overdueCount },
        ].map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', gap: 7, padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
                color: active ? 'var(--text)' : 'var(--text3)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13.5,
              }}>
              <Icon size={15} color={active ? 'var(--accent)' : 'currentColor'} /> {t.label}
              {t.badge > 0 && <span className="badge" style={{ background: 'rgba(239,68,68,.15)', color: 'var(--red)', padding: '1px 7px' }}>{t.badge}</span>}
              {active && <motion.div layoutId="finance-tab" style={{ position: 'absolute', left: 8, right: 8, bottom: -1, height: 2, borderRadius: 2, background: 'var(--accent)' }} />}
            </button>
          )
        })}
      </div>

      {tab === 'savings' && <Savings />}
      {tab === 'debts' && <Debts />}

      {tab === 'overview' && (<>
      <div className="card" style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
          <Sparkles size={16} color="var(--purple)" /> Smart Add
        </div>
        {aiSettings.has_key ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input" placeholder='Describe it — e.g. "Paid 15000 for lunch at Steers, cash"'
              value={smartText} onChange={e => setSmartText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !smartLoading) runSmartAdd() }}
            />
            <button className="btn btn-primary" onClick={runSmartAdd} disabled={smartLoading || !smartText.trim()} style={{ flexShrink: 0 }}>
              {smartLoading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} Parse
            </button>
          </div>
        ) : (
          <NoKeyPrompt text="Add your Anthropic API key to describe transactions in plain language instead of filling out the form." />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -2 }} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Wallet size={16} color="var(--text2)" /><span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Balance</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: summary.balance >= 0 ? 'var(--green)' : 'var(--red)' }}>
            <AnimatedNumber value={summary.balance} format={fmt} />
          </div>
          {accountsBreakdown.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', background: 'var(--bg4)' }}>
                {accountsBreakdown.filter(a => a.balance > 0).map(a => (
                  <motion.div key={a.id} title={`${a.name}: ${fmt(a.balance)}`}
                    initial={{ width: 0 }} animate={{ width: `${accountsTotalPositive > 0 ? (a.balance / accountsTotalPositive) * 100 : 0}%` }}
                    transition={{ type: 'spring', stiffness: 90, damping: 20 }}
                    style={{ background: a.color, cursor: 'default' }} />
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {accountsBreakdown.slice(0, 2).map(a => `${a.name} ${fmt(a.balance)}`).join(' · ')}
                {accountsBreakdown.length > 2 ? ` · +${accountsBreakdown.length - 2} more` : ''}
              </div>
              {unassigned !== 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2, fontStyle: 'italic' }}>
                  + {fmt(unassigned)} unassigned
                </div>
              )}
              {savingsTotal > 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 4, cursor: 'pointer' }} onClick={() => setTab('savings')}
                  title="Money set aside in savings goals — still in your accounts">
                  {fmt(savingsTotal)} set aside for goals · <span style={{ color: summary.balance - savingsTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(summary.balance - savingsTotal)} free</span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Add an account below to see it broken down here.</div>
          )}
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 }} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <TrendingUp size={16} color="var(--green)" /><span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Income</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)' }}><AnimatedNumber value={summary.income} format={fmt} /></div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 }} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <TrendingDown size={16} color="var(--red)" /><span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Expenses</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--red)' }}><AnimatedNumber value={summary.expense} format={fmt} /></div>
        </motion.div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 20 }}>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .12 }} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <Percent size={14} color="var(--text2)" /><span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Savings rate</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: savingsRate >= 0 ? 'var(--green)' : 'var(--red)' }}>
            <AnimatedNumber value={savingsRate} format={v => `${Math.round(v)}%`} />
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .16 }} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <CalendarDays size={14} color="var(--text2)" /><span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Avg daily spend</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800 }}><AnimatedNumber value={avgDailySpend} format={fmt} /></div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 }} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <Award size={14} color="var(--text2)" /><span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Top category</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{topCategory ? topCategory.category : '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 5 }}>
            {topCategory ? fmt(topCategory.total) : 'No expenses yet'}
            {topCategoryBudget && (
              <span className="badge" style={{ background: `${budgetColor(topCategoryBudget.percent)}22`, color: budgetColor(topCategoryBudget.percent) }}>
                {topCategoryBudget.percent}% of budget
              </span>
            )}
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .24 }} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            {momChange == null ? <TrendingUp size={14} color="var(--text2)" /> : momChange > 0 ? <TrendingUp size={14} color="var(--red)" /> : <TrendingDown size={14} color="var(--green)" />}
            <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Spend vs last month</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: momChange == null ? 'var(--text)' : momChange > 0 ? 'var(--red)' : 'var(--green)' }}>
            {momChange == null ? '—' : <AnimatedNumber value={momChange} format={v => `${v > 0 ? '+' : ''}${Math.round(v)}%`} />}
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .28 }} className="card"
          title="Balance today plus what your active recurring transactions add or take away over a month">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <Repeat size={14} color="var(--text2)" /><span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Projected in 30 days</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: projectedBalance >= 0 ? 'var(--green)' : 'var(--red)' }}>
            <AnimatedNumber value={projectedBalance} format={fmt} />
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>
            from recurring: {recurringMonthlyNet >= 0 ? '+' : ''}{fmt(recurringMonthlyNet)}
          </div>
        </motion.div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}><Landmark size={16} color="var(--text2)" /> Accounts</h3>
          <button className="btn btn-ghost btn-sm" onClick={openAddAccount}><Plus size={13} /> Add account</button>
        </div>
        {accounts.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-icon">🏦</div>
            Add your bank, cash, and mobile money accounts to track real balances and transfers.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
            <AnimatePresence initial={true}>
              {[...activeAccounts, ...archivedAccounts].map((a, i) => {
                const Icon = accountIcon(a.type)
                const shareOfTotal = !a.archived && accountsTotalPositive > 0 && a.balance > 0
                  ? Math.round((a.balance / accountsTotalPositive) * 100) : null
                return (
                  <motion.div key={a.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: a.archived ? .55 : 1, y: 0 }} exit={{ opacity: 0 }}
                    transition={{ delay: Math.min(i, 8) * 0.04 }}
                    whileHover={{ y: -2 }}
                    style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: `${a.color}26`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={16} color={a.color} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{a.institution || ACCOUNT_TYPES.find(t => t.value === a.type)?.label}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button className="btn btn-ghost btn-icon" style={{ padding: 5 }} onClick={() => openEditAccount(a)}><Pencil size={12} /></button>
                        {a.archived
                          ? <>
                              <button className="btn btn-ghost btn-icon" style={{ padding: 5 }} onClick={() => unarchiveAccount(a.id)}><ArchiveRestore size={12} /></button>
                              <button className="btn btn-ghost btn-icon" style={{ padding: 5 }} onClick={() => handleDeleteAccount(a.id)}><Trash2 size={12} /></button>
                            </>
                          : <button className="btn btn-ghost btn-icon" style={{ padding: 5 }} onClick={() => archiveAccount(a.id)}><Archive size={12} /></button>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                      <div style={{ fontSize: 19, fontWeight: 800, color: a.balance >= 0 ? 'var(--text)' : 'var(--red)' }}>{fmt(a.balance)}</div>
                      {shareOfTotal != null && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{shareOfTotal}% of total</span>}
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}><Sparkles size={16} color="var(--purple)" /> AI Insights</h3>
          {aiSettings.has_key && (
            <button className="btn btn-ghost btn-sm" onClick={runInsights} disabled={insightsLoading}>
              {insightsLoading ? <Loader2 size={13} className="spin" /> : <RotateCw size={13} />} {insights.length ? 'Regenerate' : 'Generate'}
            </button>
          )}
        </div>
        {!aiSettings.has_key ? (
          <NoKeyPrompt text="Add your Anthropic API key to get a plain-language read on your spending, budgets, and trends." />
        ) : insights.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-icon">💡</div>
            {insightsLoading ? 'Analyzing your finances…' : 'Generate a quick read on your spending, budgets, and trends.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {insights.map((ins, i) => {
              const Icon = INSIGHT_ICONS[ins.type] || Lightbulb
              return (
                <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', background: 'var(--bg3)', borderRadius: 10 }}>
                  <Icon size={15} color={INSIGHT_COLORS[ins.type]} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 13, lineHeight: 1.5 }}>{ins.text}</span>
                </motion.div>
              )
            })}
            {insightsAt && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Generated {insightsAt.toLocaleTimeString()}</div>}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Income vs. expenses — last 6 months</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyPivot} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text3)' }} axisLine={false} tickLine={false} width={38} />
                <Tooltip content={<ChartTooltip mode="bars" labelFormatter={monthLabel} />} cursor={{ fill: 'var(--bg4)', opacity: 0.4 }} />
                <Bar dataKey="income" name="Income" fill="#22c55e" radius={[4, 4, 0, 0]} animationDuration={700} />
                <Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Spending by category</h3>
          {summary.byCategory.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}><div className="empty-icon">📊</div>No expenses yet.</div>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryData} dataKey="total" nameKey="category" innerRadius={50} outerRadius={80} paddingAngle={3} animationDuration={700}>
                    {categoryData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip mode="pie" />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Daily net — last 30 days</h3>
        {dailyPivot.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}><div className="empty-icon">📈</div>Not enough data yet.</div>
        ) : (
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyPivot}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 10, fill: 'var(--text3)' }} axisLine={false} tickLine={false}
                  interval={Math.max(0, Math.floor(dailyPivot.length / 8))} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text3)' }} axisLine={false} tickLine={false} width={38} />
                <Tooltip content={<ChartTooltip mode="net" labelFormatter={dayLabel} />} cursor={{ fill: 'var(--bg4)', opacity: 0.4 }} />
                <Bar dataKey="net" name="Net" radius={[4, 4, 4, 4]} animationDuration={700}>
                  {dailyPivot.map((d, i) => <Cell key={i} fill={d.net >= 0 ? '#22c55e' : '#ef4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Recent transactions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflow: 'auto' }}>
            <AnimatePresence initial={false}>
              {transactions.slice(0, 20).map(t => {
                const isTransfer = t.type === 'transfer'
                // Debt movements (loans / repayments recorded against an account)
                // move a balance but are neither income nor spending.
                const isDebt = t.type === 'debt_in' || t.type === 'debt_out'
                const inflow = t.type === 'income' || t.type === 'debt_in'
                const dotColor = isTransfer ? 'var(--blue)' : isDebt ? 'var(--purple)' : (inflow ? 'var(--green)' : 'var(--red)')
                const amountColor = dotColor
                const line1 = isTransfer
                  ? `${t.account_name || '—'} → ${t.to_account_name || '—'}`
                  : isDebt
                    ? (t.note || 'Debt')
                    : `${t.category}${t.merchant ? ' · ' + t.merchant : (t.note ? ' · ' + t.note : '')}`
                const line2 = `${!isTransfer && t.account_name ? t.account_name + ' · ' : ''}${t.date}`
                return (
                  <motion.div key={t.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 10 }}>
                    {isTransfer ? <ArrowRightLeft size={12} color={dotColor} style={{ flexShrink: 0 }} />
                      : isDebt ? <HandCoins size={12} color={dotColor} style={{ flexShrink: 0 }} />
                      : <span style={{ width: 8, height: 8, borderRadius: 99, background: dotColor, flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line1}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{line2}</div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: amountColor }}>
                      {isTransfer ? '' : (inflow ? '+' : '-')}{fmt(t.amount)}
                    </span>
                    {t.debt_id
                      ? <button className="btn btn-ghost btn-icon" title="Part of a debt — manage it in the Debts tab" onClick={() => setTab('debts')}><HandCoins size={13} /></button>
                      : <button className="btn btn-ghost btn-icon" onClick={() => remove(t.id)}><Trash2 size={13} /></button>}
                  </motion.div>
                )
              })}
            </AnimatePresence>
            {transactions.length === 0 && <div className="empty-state" style={{ padding: 24 }}><div className="empty-icon">💸</div>No transactions yet.</div>}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}><Target size={16} color="var(--text2)" /> Budgets</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => { setBudgetForm({ category: availableForBudget[0] || CATS[0], monthly_limit: '' }); setBudgetModal(true) }}>
              <Plus size={13} /> Add
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <AnimatePresence initial={false}>
              {budgets.map(b => (
                <motion.div key={b.category} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{b.category}</span>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                      {fmt(b.spent)} / {fmt(b.monthly_limit)}
                      <button className="btn btn-ghost btn-icon" style={{ padding: 4, marginLeft: 6 }} onClick={() => deleteBudget(b.category)}><Trash2 size={12} /></button>
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: 'var(--bg4)', overflow: 'hidden' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, b.percent)}%` }}
                      transition={{ type: 'spring', stiffness: 90, damping: 20 }}
                      style={{ height: '100%', borderRadius: 999, background: budgetColor(b.percent) }}
                    />
                  </div>
                  {b.percent >= 100 && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>Over budget by {fmt(Math.abs(b.remaining))}</div>}
                </motion.div>
              ))}
            </AnimatePresence>
            {budgets.length === 0 && <div className="empty-state" style={{ padding: 24 }}><div className="empty-icon">🎯</div>No budgets set yet.</div>}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}><Repeat size={16} color="var(--text2)" /> Recurring</h3>
            {recurring.some(r => r.active) && (
              <div style={{ fontSize: 11, color: recurringMonthlyNet >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 3 }}>
                Projected monthly impact: {recurringMonthlyNet >= 0 ? '+' : ''}{fmt(recurringMonthlyNet)} — feeds "Projected in 30 days" above
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { setRecurringForm({ ...emptyRecurring, category: CATS.includes(emptyRecurring.category) ? emptyRecurring.category : CATS[0], account_id: activeAccounts[0]?.id || '' }); setRecurringModal(true) }}>
            <Plus size={13} /> Add
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflow: 'auto' }}>
          <AnimatePresence initial={true}>
            {recurring.map((r, i) => (
              <motion.div key={r.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: r.active ? 1 : .5, x: 0 }} exit={{ opacity: 0, x: 8 }}
                transition={{ delay: Math.min(i, 8) * 0.03 }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: r.type === 'income' ? 'var(--green)' : 'var(--red)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>{r.category}{r.note ? ` · ${r.note}` : ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    <span className="badge" style={{ background: 'var(--bg4)', color: 'var(--text2)', marginRight: 6 }}>{r.frequency}</span>
                    {r.account_name ? `${r.account_name} · ` : ''}Next: {r.next_date}
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: r.type === 'income' ? 'var(--green)' : 'var(--red)' }}>
                  {r.type === 'income' ? '+' : '-'}{fmt(r.amount)}
                </span>
                <Switch on={!!r.active} onClick={() => toggleRecurring(r.id)} />
                <button className="btn btn-ghost btn-icon" onClick={() => removeRecurring(r.id)}><Trash2 size={13} /></button>
              </motion.div>
            ))}
          </AnimatePresence>
          {recurring.length === 0 && <div className="empty-state" style={{ padding: 24 }}><div className="empty-icon">🔁</div>No recurring transactions yet.</div>}
        </div>
      </div>

      </>)}

      <Modal open={categoryModal} title="Categories" onClose={() => setCategoryModal(false)} width={420}>
        <CategoryManager
          categories={CATS}
          onCreate={createCategory}
          onRename={renameCategory}
          onDelete={deleteCategory}
          onReorder={reorderCategories}
          pushToast={pushToast}
        />
      </Modal>

      <Modal open={modal} title="Add transaction" onClose={() => setModal(false)}
        footer={<><button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary" onClick={save}>Add</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ flex: 1, background: form.type === 'expense' ? 'var(--red)' : 'var(--bg4)', color: form.type === 'expense' ? '#fff' : 'var(--text2)' }} onClick={() => setForm({ ...form, type: 'expense' })}>Expense</button>
            <button className="btn" style={{ flex: 1, background: form.type === 'income' ? 'var(--green)' : 'var(--bg4)', color: form.type === 'income' ? '#fff' : 'var(--text2)' }} onClick={() => setForm({ ...form, type: 'income' })}>Income</button>
          </div>
          <input type="number" className="input" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} autoFocus />
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="select" style={{ flex: 1 }} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="select" style={{ flex: 1 }} value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">{activeAccounts.length ? 'No account' : 'No accounts yet'}</option>
              {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {activeAccounts.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Tip: add an account below so transactions track real balances.</div>}
          <input className="input" placeholder="Merchant / payee (optional)" value={form.merchant} onChange={e => setForm({ ...form, merchant: e.target.value })} />
          <input className="input" placeholder="Note (optional)" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
          <input type="date" className="input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
        </div>
      </Modal>

      <Modal open={budgetModal} title="Set a budget" onClose={() => setBudgetModal(false)}
        footer={<><button className="btn btn-secondary" onClick={() => setBudgetModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveBudget}>Save</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <select className="select" value={budgetForm.category} onChange={e => setBudgetForm({ ...budgetForm, category: e.target.value })}>
            {CATS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="number" className="input" placeholder="Monthly limit" value={budgetForm.monthly_limit} onChange={e => setBudgetForm({ ...budgetForm, monthly_limit: e.target.value })} autoFocus />
        </div>
      </Modal>

      <Modal open={recurringModal} title="Add recurring transaction" onClose={() => setRecurringModal(false)}
        footer={<><button className="btn btn-secondary" onClick={() => setRecurringModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveRecurring}>Add</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ flex: 1, background: recurringForm.type === 'expense' ? 'var(--red)' : 'var(--bg4)', color: recurringForm.type === 'expense' ? '#fff' : 'var(--text2)' }} onClick={() => setRecurringForm({ ...recurringForm, type: 'expense' })}>Expense</button>
            <button className="btn" style={{ flex: 1, background: recurringForm.type === 'income' ? 'var(--green)' : 'var(--bg4)', color: recurringForm.type === 'income' ? '#fff' : 'var(--text2)' }} onClick={() => setRecurringForm({ ...recurringForm, type: 'income' })}>Income</button>
          </div>
          <input type="number" className="input" placeholder="Amount" value={recurringForm.amount} onChange={e => setRecurringForm({ ...recurringForm, amount: e.target.value })} autoFocus />
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="select" style={{ flex: 1 }} value={recurringForm.category} onChange={e => setRecurringForm({ ...recurringForm, category: e.target.value })}>
              {CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="select" style={{ flex: 1 }} value={recurringForm.account_id} onChange={e => setRecurringForm({ ...recurringForm, account_id: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">No account</option>
              {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <input className="input" placeholder="Note (optional, e.g. 'Salary')" value={recurringForm.note} onChange={e => setRecurringForm({ ...recurringForm, note: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="select" style={{ flex: 1 }} value={recurringForm.frequency} onChange={e => setRecurringForm({ ...recurringForm, frequency: e.target.value })}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <input type="date" className="input" style={{ flex: 1 }} value={recurringForm.next_date} onChange={e => setRecurringForm({ ...recurringForm, next_date: e.target.value })} />
          </div>
        </div>
      </Modal>

      <Modal open={accountModal} title={accountForm.id ? 'Edit account' : 'Add account'} onClose={() => setAccountModal(false)}
        footer={<><button className="btn btn-secondary" onClick={() => setAccountModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveAccount}>{accountForm.id ? 'Save' : 'Add'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input className="input" placeholder="Account name — e.g. 'NMB Salary', 'M-Pesa'" value={accountForm.name}
            onChange={e => setAccountForm({ ...accountForm, name: e.target.value })} autoFocus />
          <div style={{ display: 'flex', gap: 8 }}>
            {ACCOUNT_TYPES.map(t => {
              const Icon = t.icon
              const active = accountForm.type === t.value
              return (
                <button key={t.value} className="btn" style={{ flex: 1, flexDirection: 'column', gap: 4, padding: '10px 6px', background: active ? 'var(--accent)' : 'var(--bg4)', color: active ? '#fff' : 'var(--text2)' }}
                  onClick={() => setAccountForm({ ...accountForm, type: t.value })}>
                  <Icon size={15} /> <span style={{ fontSize: 11 }}>{t.label}</span>
                </button>
              )
            })}
          </div>
          <input className="input" placeholder="Institution (optional) — e.g. 'NMB', 'Tigo Pesa'" value={accountForm.institution}
            onChange={e => setAccountForm({ ...accountForm, institution: e.target.value })} />
          {!accountForm.id && (
            <input type="number" className="input" placeholder="Opening balance (optional)" value={accountForm.opening_balance}
              onChange={e => setAccountForm({ ...accountForm, opening_balance: e.target.value })} />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {ACCOUNT_COLORS.map(c => (
              <button key={c} onClick={() => setAccountForm({ ...accountForm, color: c })}
                style={{ width: 22, height: 22, borderRadius: 999, background: c, border: accountForm.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
            ))}
          </div>
        </div>
      </Modal>

      <Modal open={transferModal} title="Transfer between accounts" onClose={() => setTransferModal(false)}
        footer={<><button className="btn btn-secondary" onClick={() => setTransferModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveTransfer}>Transfer</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select className="select" style={{ flex: 1 }} value={transferForm.from_account_id} onChange={e => setTransferForm({ ...transferForm, from_account_id: Number(e.target.value) })}>
              {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <ArrowRightLeft size={16} color="var(--text3)" style={{ flexShrink: 0 }} />
            <select className="select" style={{ flex: 1 }} value={transferForm.to_account_id} onChange={e => setTransferForm({ ...transferForm, to_account_id: Number(e.target.value) })}>
              {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <input type="number" className="input" placeholder="Amount" value={transferForm.amount} onChange={e => setTransferForm({ ...transferForm, amount: e.target.value })} autoFocus />
          <input className="input" placeholder="Note (optional)" value={transferForm.note} onChange={e => setTransferForm({ ...transferForm, note: e.target.value })} />
          <input type="date" className="input" value={transferForm.date} onChange={e => setTransferForm({ ...transferForm, date: e.target.value })} />
        </div>
      </Modal>
    </div>
  )
}
