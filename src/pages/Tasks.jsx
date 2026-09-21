import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Trash2, Paperclip, Pencil, ListChecks, Repeat } from 'lucide-react'
import { useTasksStore } from '../store/useTasksStore'
import { useUIStore } from '../store/useUIStore'
import Modal from '../components/Modal'
import AttachmentBar from '../components/AttachmentBar'
import SubtaskChecklist from '../components/SubtaskChecklist'

const PRIORITY_COLOR = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--text3)' }
const FILTERS = ['all', 'pending', 'done']

const empty = { title: '', description: '', due_date: '', due_time: '', priority: 'medium', recurring: 'none' }

export default function Tasks() {
  const { tasks, create, update, toggle, remove } = useTasksStore()
  const pushToast = useUIStore(s => s.pushToast)
  const [filter, setFilter] = useState('pending')
  const [modal, setModal] = useState(null) // null | {} (new) | task (edit)
  const [form, setForm] = useState(empty)

  const visible = tasks.filter(t => filter === 'all' ? true : t.status === filter)

  function openNew() { setForm(empty); setModal({}) }
  function openEdit(t) {
    setForm({ title: t.title, description: t.description, due_date: t.due_date || '', due_time: t.due_time || '', priority: t.priority, recurring: t.recurring, tags: JSON.parse(t.tags || '[]') })
    setModal(t)
  }

  async function save() {
    if (!form.title.trim()) return pushToast('Give the task a title', 'error')
    if (modal.id) await update(modal.id, form)
    else await create(form)
    pushToast(modal.id ? 'Task updated' : 'Task added', 'success')
    setModal(null)
  }

  // Wraps the store's toggle so a completed recurring task surfaces
  // feedback about the next occurrence that was just spawned for it.
  async function handleToggle(t) {
    const result = await toggle(t.id)
    if (result?.nextTask) pushToast(`Recurring — next one due ${result.nextTask.due_date}`, 'success')
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-sub">{tasks.filter(t => t.status === 'pending').length} pending</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> New task</button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} className="btn btn-sm"
            style={{ background: filter === f ? 'var(--bg4)' : 'transparent', color: filter === f ? 'var(--text)' : 'var(--text3)', textTransform: 'capitalize' }}>
            {f}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">✅</div>No tasks here.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AnimatePresence initial={true}>
            {visible.map((t, i) => (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 10, scale: .96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: .96, transition: { duration: .15 } }}
                transition={{ type: 'spring', stiffness: 400, damping: 32, delay: Math.min(i, 10) * 0.03 }}
                className="card"
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}
              >
                <button onClick={() => handleToggle(t)} className={`checkbox-circle${t.status === 'done' ? ' done' : ''}`}>
                  {t.status === 'done' && <span style={{ fontSize: 12, color: '#fff' }}>✓</span>}
                </button>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: PRIORITY_COLOR[t.priority], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--text3)' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t.title}
                    {t.recurring !== 'none' && <Repeat size={11} color="var(--text3)" title={`Repeats ${t.recurring}`} />}
                  </div>
                  {(t.due_date || t.description) && (
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>
                      {t.due_date && `${t.due_date}${t.due_time ? ' · ' + t.due_time : ''}`}
                      {t.due_date && t.description && ' · '}
                      {t.description}
                    </div>
                  )}
                  {t.subtask_total > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                      <div style={{ flex: 1, maxWidth: 160, height: 4, borderRadius: 99, background: 'var(--bg4)', overflow: 'hidden' }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${(t.subtask_done / t.subtask_total) * 100}%` }}
                          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                          style={{ height: '100%', borderRadius: 99, background: 'var(--accent)' }}
                        />
                      </div>
                      <span style={{ fontSize: 10.5, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <ListChecks size={11} /> {t.subtask_done}/{t.subtask_total}
                      </span>
                    </div>
                  )}
                </div>
                <button className="btn btn-ghost btn-icon" onClick={() => openEdit(t)}><Pencil size={14} /></button>
                <button className="btn btn-ghost btn-icon" onClick={() => remove(t.id)}><Trash2 size={14} /></button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal open={!!modal} title={modal?.id ? 'Edit task' : 'New task'} onClose={() => setModal(null)}
        footer={<>
          <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{modal?.id ? 'Save' : 'Add task'}</button>
        </>}>
        {modal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input className="input" placeholder="Task title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} autoFocus />
            <textarea className="textarea" placeholder="Description (optional)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input type="date" className="input" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
              <input type="time" className="input" value={form.due_time} onChange={e => setForm({ ...form, due_time: e.target.value })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <select className="select" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low priority</option>
                <option value="medium">Medium priority</option>
                <option value="high">High priority</option>
              </select>
              <select className="select" value={form.recurring} onChange={e => setForm({ ...form, recurring: e.target.value })}>
                <option value="none">Doesn't repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {form.recurring !== 'none' && (
              <div style={{ fontSize: 11.5, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 5, marginTop: -4 }}>
                <Repeat size={12} /> Completing this task will automatically create the next {form.recurring} occurrence.
              </div>
            )}
            {modal.id && (
              <>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}><ListChecks size={13} /> Checklist</div>
                  <SubtaskChecklist taskId={modal.id} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}><Paperclip size={13} /> Attachments</div>
                  <AttachmentBar parentType="task" parentId={modal.id} />
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
