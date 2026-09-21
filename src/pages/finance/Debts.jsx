import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Pencil, ArrowDownLeft, ArrowUpRight, HandCoins, Scale, AlertTriangle, CalendarClock,
  ChevronDown, CheckCircle2, Search, MessageCircle, Copy, Phone, Landmark, X,
} from 'lucide-react'
import { useDebtsStore } from '../../store/useDebtsStore'
import { useFinanceStore } from '../../store/useFinanceStore'
import { useUIStore } from '../../store/useUIStore'
import Modal from '../../components/Modal'
import AnimatedNumber from '../../components/AnimatedNumber'
import { fmt, fmtDate, dueLabel } from '../../lib/format'
import { localISO } from '../../lib/dates'
import { reminderMessage, whatsappLink } from '../../lib/debtMath'

const emptyDebt = {
  id: null, direction: 'owed_to_me', person: '', phone: '', amount: '', interest: '',
  start_date: localISO(), due_date: '', note: '', record: false, record_account_id: '',
}
const TONE_COLOR = { bad: 'var(--red)', warn: 'var(--yellow)', muted: 'var(--text3)' }

function KPI({ icon: Icon, iconColor, label, delay = 0, children, sub }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Icon size={14} color={iconColor || 'var(--text2)'} /><span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{children}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </motion.div>
  )
}

function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--bg3)', padding: 3, borderRadius: 10 }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} className="btn btn-sm"
          style={{ background: value === o.value ? 'var(--bg4)' : 'transparent', color: value === o.value ? 'var(--text)' : 'var(--text3)', padding: '5px 12px' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function Debts() {
  const { debts, summary, create, update, remove, addPayment } = useDebtsStore()
  const accounts = useFinanceStore(s => s.accounts)
  const pushToast = useUIStore(s => s.pushToast)
  const activeAccounts = accounts.filter(a => !a.archived)

  const [dir, setDir] = useState('all')
  const [status, setStatus] = useState('open')
  const [query, setQuery] = useState('')

  const [debtModal, setDebtModal] = useState(false)
  const [debtForm, setDebtForm] = useState(emptyDebt)
  const [payModal, setPayModal] = useState(null) // debt
  const [payForm, setPayForm] = useState({ amount: '', date: localISO(), note: '', account_id: '' })
  const [remindDebt, setRemindDebt] = useState(null)
  const [remindText, setRemindText] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return debts.filter(d =>
      (dir === 'all' || d.direction === dir) &&
      (status === 'all' || d.status === status) &&
      (!q || d.person.toLowerCase().includes(q) || (d.note || '').toLowerCase().includes(q)))
  }, [debts, dir, status, query])

  const knownPeople = useMemo(() => [...new Set(debts.map(d => d.person.trim()))], [debts])
  const settledCount = debts.filter(d => d.status === 'settled').length

  // ── Debt form ───────────────────────────────────────────────────────
  function openNew(direction = 'owed_to_me') {
    setDebtForm({ ...emptyDebt, direction, start_date: localISO() })
    setDebtModal(true)
  }
  function openEdit(d) {
    setDebtForm({
      id: d.id, direction: d.direction, person: d.person, phone: d.phone || '', amount: String(d.amount),
      interest: d.interest ? String(d.interest) : '', start_date: d.start_date, due_date: d.due_date || '',
      note: d.note || '', record: false, record_account_id: '',
    })
    setDebtModal(true)
  }
  function pickPerson(name) {
    // Re-use a known person's phone number automatically.
    const match = debts.find(d => d.person.trim().toLowerCase() === name.trim().toLowerCase() && d.phone)
    setDebtForm(f => ({ ...f, person: name, phone: f.phone || match?.phone || '' }))
  }
  async function saveDebt() {
    if (!debtForm.person.trim()) return pushToast('Who is this with?', 'error')
    if (!(Number(debtForm.amount) > 0)) return pushToast('Enter an amount', 'error')
    if (debtForm.record && !debtForm.record_account_id) return pushToast('Choose the account to record it in', 'error')
    const data = {
      direction: debtForm.direction, person: debtForm.person.trim(), phone: debtForm.phone.trim(),
      amount: Number(debtForm.amount), interest: Number(debtForm.interest) || 0,
      start_date: debtForm.start_date, due_date: debtForm.due_date || null, note: debtForm.note,
      record_account_id: debtForm.record ? debtForm.record_account_id : null,
    }
    const r = debtForm.id ? await update(debtForm.id, data) : await create(data)
    if (!r.ok) return pushToast(r.error, 'error')
    pushToast(debtForm.id ? 'Debt updated' : 'Debt added', 'success')
    setDebtModal(false)
  }

  // ── Payments ────────────────────────────────────────────────────────
  function openPay(d, full = false) {
    setPayForm({ amount: full ? String(d.remaining) : '', date: localISO(), note: '', account_id: d.account_id || '' })
    setPayModal(d)
  }
  async function savePayment() {
    const amt = Number(payForm.amount)
    if (!(amt > 0)) return pushToast('Enter an amount', 'error')
    const data = { amount: amt, date: payForm.date, note: payForm.note, account_id: payForm.account_id || null }
    const r = await addPayment(payModal.id, data) // settles the debt automatically once nothing is left
    if (!r.ok) return pushToast(r.error, 'error')
    pushToast(r.settled ? 'Debt settled 🎉' : 'Payment recorded', 'success')
    setPayModal(null)
  }

  // ── Reminder ────────────────────────────────────────────────────────
  function openRemind(d) { setRemindDebt(d); setRemindText(reminderMessage(d)) }
  async function copyReminder() {
    await window.api.app.copyText(remindText)
    pushToast('Message copied', 'success')
  }
  function sendWhatsApp() {
    const link = whatsappLink(remindDebt.phone, remindText)
    if (link) window.api.app.openExternal(link)
  }

  async function confirmDelete() {
    await remove(deleteTarget.id)
    pushToast('Debt deleted', 'success')
    setDeleteTarget(null)
  }

  const net = summary.net
  const fmtSigned = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 14px', gap: 10 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', maxWidth: 520, lineHeight: 1.5 }}>
          Track money you've lent and money you've borrowed — with partial payments, due-date reminders, and (optionally) the account it came from or went to.
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="btn btn-secondary" onClick={() => openNew('i_owe')}><ArrowUpRight size={15} /> I owe someone</button>
          <button className="btn btn-primary" onClick={() => openNew('owed_to_me')}><ArrowDownLeft size={15} /> Someone owes me</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 16 }}>
        <KPI icon={ArrowDownLeft} iconColor="var(--green)" label="Owed to me" sub={`${summary.owedToMeCount} open`}>
          <span style={{ color: 'var(--green)' }}><AnimatedNumber value={summary.owedToMe} format={fmt} /></span>
        </KPI>
        <KPI icon={ArrowUpRight} iconColor="var(--red)" label="I owe" delay={0.04} sub={`${summary.iOweCount} open`}>
          <span style={{ color: 'var(--red)' }}><AnimatedNumber value={summary.iOwe} format={fmt} /></span>
        </KPI>
        <KPI icon={Scale} label="Net position" delay={0.08} sub={net > 0 ? 'People owe you more than you owe' : net < 0 ? 'You owe more than you\'re owed' : 'All square'}>
          <span style={{ color: net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--text)' }}><AnimatedNumber value={net} format={fmtSigned} /></span>
        </KPI>
        <KPI icon={AlertTriangle} iconColor={summary.overdueCount ? 'var(--red)' : 'var(--text2)'} label="Overdue" delay={0.12}
          sub={summary.overdueCount
            ? [summary.overdueOwedToMe > 0 && `${fmt(summary.overdueOwedToMe)} owed to you`, summary.overdueIOwe > 0 && `${fmt(summary.overdueIOwe)} you owe`].filter(Boolean).join(' · ')
            : summary.dueSoonCount ? `${summary.dueSoonCount} due within a week` : 'Nothing overdue'}>
          <span style={{ color: summary.overdueCount ? 'var(--red)' : 'var(--text)' }}><AnimatedNumber value={summary.overdueCount} /></span>
        </KPI>
      </div>

      {summary.people.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 9 }}>By person — net of everything still open</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {summary.people.slice(0, 10).map(p => (
              <button key={p.person} onClick={() => { setQuery(p.person); setStatus('open'); setDir('all') }}
                title={p.net > 0 ? `${p.person} owes you` : p.net < 0 ? `You owe ${p.person}` : 'Even'}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 11px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg3)', cursor: 'pointer', color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 12.5 }}>
                <span style={{ fontWeight: 600 }}>{p.person}</span>
                <span style={{ color: p.net > 0 ? 'var(--green)' : p.net < 0 ? 'var(--red)' : 'var(--text3)', fontWeight: 700 }}>{fmtSigned(p.net)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <Segmented value={dir} onChange={setDir} options={[{ value: 'all', label: 'All' }, { value: 'owed_to_me', label: 'Owed to me' }, { value: 'i_owe', label: 'I owe' }]} />
        <Segmented value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'settled', label: `Settled${settledCount ? ` (${settledCount})` : ''}` }, { value: 'all', label: 'Everything' }]} />
        <div style={{ flex: 1, minWidth: 160, position: 'relative' }}>
          <Search size={14} color="var(--text3)" style={{ position: 'absolute', left: 11, top: 11 }} />
          <input className="input" style={{ paddingLeft: 32, paddingRight: query ? 32 : 12 }} placeholder="Search by person or note" value={query} onChange={e => setQuery(e.target.value)} />
          {query && <button className="btn btn-ghost btn-icon" style={{ position: 'absolute', right: 3, top: 3, padding: 6 }} onClick={() => setQuery('')}><X size={13} /></button>}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: 32 }}>
            <div className="empty-icon">🤝</div>
            {debts.length === 0 ? 'No debts tracked yet — add money you\'ve lent or borrowed.' : 'Nothing matches these filters.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <AnimatePresence initial={true}>
            {visible.map((d, i) => (
              <DebtCard key={d.id} debt={d} index={i}
                onPay={() => openPay(d)} onSettle={() => openPay(d, true)} onRemind={() => openRemind(d)}
                onEdit={() => openEdit(d)} onDelete={() => setDeleteTarget(d)} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── Debt form ── */}
      <Modal open={debtModal} title={debtForm.id ? 'Edit debt' : debtForm.direction === 'owed_to_me' ? 'Someone owes me' : 'I owe someone'} onClose={() => setDebtModal(false)}
        footer={<><button className="btn btn-secondary" onClick={() => setDebtModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveDebt}>{debtForm.id ? 'Save' : 'Add debt'}</button></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!debtForm.id && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1, background: debtForm.direction === 'owed_to_me' ? 'var(--green)' : 'var(--bg4)', color: debtForm.direction === 'owed_to_me' ? '#fff' : 'var(--text2)' }}
                onClick={() => setDebtForm({ ...debtForm, direction: 'owed_to_me' })}>They owe me</button>
              <button className="btn" style={{ flex: 1, background: debtForm.direction === 'i_owe' ? 'var(--red)' : 'var(--bg4)', color: debtForm.direction === 'i_owe' ? '#fff' : 'var(--text2)' }}
                onClick={() => setDebtForm({ ...debtForm, direction: 'i_owe' })}>I owe them</button>
            </div>
          )}
          <input className="input" list="debt-people" placeholder={debtForm.direction === 'owed_to_me' ? 'Who owes you?' : 'Who do you owe?'} value={debtForm.person}
            onChange={e => pickPerson(e.target.value)} autoFocus />
          <datalist id="debt-people">{knownPeople.map(p => <option key={p} value={p} />)}</datalist>
          <input className="input" placeholder="Phone (optional — for WhatsApp reminders)" value={debtForm.phone} onChange={e => setDebtForm({ ...debtForm, phone: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input type="number" className="input" placeholder="Amount" value={debtForm.amount} onChange={e => setDebtForm({ ...debtForm, amount: e.target.value })} />
            <input type="number" className="input" placeholder="Interest / fee (optional)" value={debtForm.interest} onChange={e => setDebtForm({ ...debtForm, interest: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Date it happened</div>
              <input type="date" className="input" value={debtForm.start_date} onChange={e => setDebtForm({ ...debtForm, start_date: e.target.value })} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Due date (optional)</div>
              <input type="date" className="input" value={debtForm.due_date} onChange={e => setDebtForm({ ...debtForm, due_date: e.target.value })} />
            </div>
          </div>
          <input className="input" placeholder="What was it for? (optional)" value={debtForm.note} onChange={e => setDebtForm({ ...debtForm, note: e.target.value })} />
          {!debtForm.id && activeAccounts.length > 0 && (
            <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={debtForm.record} onChange={e => setDebtForm({ ...debtForm, record: e.target.checked })} />
                {debtForm.direction === 'owed_to_me' ? 'The money just left one of my accounts' : 'The money just arrived in one of my accounts'}
              </label>
              {debtForm.record && (
                <select className="select" value={debtForm.record_account_id} onChange={e => setDebtForm({ ...debtForm, record_account_id: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">Choose account…</option>
                  {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
                {debtForm.record ? 'Updates that account\'s balance. It won\'t count as income or spending.' : 'Leave unticked for older debts — nothing in your accounts changes.'}
              </div>
            </div>
          )}
          {debtForm.id && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Changing the amount also updates the matching account entry, if one was recorded.</div>}
        </div>
      </Modal>

      {/* ── Payment ── */}
      <Modal open={!!payModal} title={payModal ? (payModal.direction === 'owed_to_me' ? `Payment from ${payModal.person}` : `Payment to ${payModal.person}`) : ''} onClose={() => setPayModal(null)}
        footer={<><button className="btn btn-secondary" onClick={() => setPayModal(null)}>Cancel</button><button className="btn btn-primary" onClick={savePayment}>Record payment</button></>}>
        {payModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>{fmt(payModal.remaining)} remaining of {fmt(payModal.total)}</div>
            <input type="number" className="input" placeholder="Amount" value={payForm.amount} autoFocus
              onChange={e => setPayForm({ ...payForm, amount: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') savePayment() }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setPayForm({ ...payForm, amount: String(payModal.remaining) })}>Everything ({fmt(payModal.remaining)})</button>
              {payModal.remaining > 1 && <button className="btn btn-secondary btn-sm" onClick={() => setPayForm({ ...payForm, amount: String(Math.round(payModal.remaining / 2 * 100) / 100) })}>Half</button>}
            </div>
            <input type="date" className="input" value={payForm.date} onChange={e => setPayForm({ ...payForm, date: e.target.value })} />
            <input className="input" placeholder="Note (optional)" value={payForm.note} onChange={e => setPayForm({ ...payForm, note: e.target.value })} />
            {activeAccounts.length > 0 && (
              <div>
                <select className="select" value={payForm.account_id} onChange={e => setPayForm({ ...payForm, account_id: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">Don't record in an account</option>
                  {activeAccounts.map(a => <option key={a.id} value={a.id}>{payModal.direction === 'owed_to_me' ? 'Received into' : 'Paid from'} {a.name}</option>)}
                </select>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>Choosing an account moves its balance by this amount (not counted as income or spending).</div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Reminder ── */}
      <Modal open={!!remindDebt} title={remindDebt ? `Remind ${remindDebt.person}` : ''} onClose={() => setRemindDebt(null)}
        footer={<>
          <button className="btn btn-secondary" onClick={copyReminder}><Copy size={14} /> Copy</button>
          <button className="btn btn-primary" onClick={sendWhatsApp} disabled={!remindDebt || !whatsappLink(remindDebt.phone, 'x')}
            title={remindDebt && !remindDebt.phone ? 'Add a phone number to this debt to enable WhatsApp' : ''}>
            <MessageCircle size={14} /> Open in WhatsApp
          </button></>}>
        {remindDebt && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea className="textarea" style={{ minHeight: 120 }} value={remindText} onChange={e => setRemindText(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              {remindDebt.phone ? 'Opens WhatsApp with this message ready — you press send.' : 'No phone number saved for this debt — copy the message, or edit the debt to add a number.'}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!deleteTarget} title="Delete this debt?" onClose={() => setDeleteTarget(null)}
        footer={<><button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button><button className="btn btn-danger" onClick={confirmDelete}>Delete debt</button></>}>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', margin: 0, lineHeight: 1.6 }}>
          The debt with <b>{deleteTarget?.person}</b> and its payment history will be removed. Any account transactions it created stay as they are, so your balances don't change —
          delete those separately from Recent transactions if needed. If it's simply paid off, use “Settle” instead.
        </p>
      </Modal>
    </div>
  )
}

function DebtCard({ debt: d, index, onPay, onSettle, onRemind, onEdit, onDelete }) {
  const getPayments = useDebtsStore(s => s.getPayments)
  const removePayment = useDebtsStore(s => s.removePayment)
  const pushToast = useUIStore(s => s.pushToast)
  const [open, setOpen] = useState(false)
  const [payments, setPayments] = useState([])

  const mine = d.direction === 'owed_to_me'
  const accent = mine ? 'var(--green)' : 'var(--red)'
  const settled = d.status === 'settled'
  const due = !settled ? dueLabel(d.due_date) : null

  useEffect(() => {
    if (open) getPayments(d.id).then(setPayments)
  }, [open, d.paid, d.payments_count])

  async function deletePayment(id) {
    await removePayment(id)
    pushToast('Payment removed', 'success')
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: settled ? .7 : 1, y: 0 }} exit={{ opacity: 0, scale: .97 }}
      transition={{ delay: Math.min(index, 8) * 0.03 }}
      className="card" style={{ padding: '14px 16px', borderLeft: `3px solid ${settled ? 'var(--bg4)' : d.overdue ? 'var(--red)' : accent}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: `color-mix(in srgb, ${accent} 15%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {mine ? <ArrowDownLeft size={17} color={accent} /> : <ArrowUpRight size={17} color={accent} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>{d.person}</span>
            <span className="badge" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>{mine ? 'Owes me' : 'I owe'}</span>
            {settled && <span className="badge" style={{ background: 'rgba(34,197,94,.15)', color: 'var(--green)' }}><CheckCircle2 size={11} /> Settled</span>}
            {due && <span style={{ fontSize: 11.5, color: TONE_COLOR[due.tone], fontWeight: due.tone === 'bad' ? 700 : 500 }}>{due.text}</span>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>{fmtDate(d.start_date)}</span>
            {d.due_date && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><CalendarClock size={11} /> due {fmtDate(d.due_date)}</span>}
            {d.phone && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={11} /> {d.phone}</span>}
            {d.account_name && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Landmark size={11} /> {d.account_name}</span>}
          </div>
          {d.note && <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 4 }}>{d.note}</div>}

          <div style={{ marginTop: 10 }}>
            <div style={{ height: 6, borderRadius: 999, background: 'var(--bg4)', overflow: 'hidden' }}>
              <motion.div initial={{ width: 0 }} animate={{ width: `${d.percent}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20 }}
                style={{ height: '100%', borderRadius: 999, background: 'var(--green)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              <span>{fmt(d.paid)} paid{d.interest > 0 ? ` · includes ${fmt(d.interest)} interest` : ''}</span>
              <span>{d.percent}%</span>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: settled ? 'var(--text3)' : accent }}>{fmt(settled ? d.total : d.remaining)}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{settled ? 'total, settled' : `left of ${fmt(d.total)}`}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {!settled && <button className="btn btn-primary btn-sm" onClick={onPay}><HandCoins size={13} /> Record payment</button>}
        {!settled && <button className="btn btn-secondary btn-sm" onClick={onSettle}><CheckCircle2 size={13} /> Settle in full</button>}
        {!settled && mine && <button className="btn btn-secondary btn-sm" onClick={onRemind}><MessageCircle size={13} /> Remind</button>}
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(v => !v)}>
          Payments{d.payments_count ? ` (${d.payments_count})` : ''} <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </button>
        <button className="btn btn-ghost btn-icon" style={{ padding: 6 }} title="Edit" onClick={onEdit}><Pencil size={13} /></button>
        <button className="btn btn-ghost btn-icon" style={{ padding: 6 }} title="Delete" onClick={onDelete}><Trash2 size={13} /></button>
      </div>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10, maxHeight: 200, overflow: 'auto' }}>
          {payments.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>No payments yet.</div>}
          {payments.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', background: 'var(--bg3)', borderRadius: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5 }}>{p.note || 'Payment'}{p.account_name ? ` · ${p.account_name}` : ''}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{fmtDate(p.date)}</div>
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--green)' }}>{fmt(p.amount)}</span>
              <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} title="Remove this payment" onClick={() => deletePayment(p.id)}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}
