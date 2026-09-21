import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X } from 'lucide-react'

export default function SubtaskChecklist({ taskId }) {
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState('')

  async function load() {
    if (!taskId) return
    setItems(await window.api.subtasks.getFor(taskId))
  }
  useEffect(() => { load() }, [taskId])

  async function add() {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await window.api.subtasks.create(taskId, title)
    load()
  }
  async function toggle(id) {
    // optimistic flip so the checkbox feels instant
    setItems(items.map(i => i.id === id ? { ...i, done: i.done ? 0 : 1 } : i))
    await window.api.subtasks.toggle(id)
    load()
  }
  async function removeItem(id) {
    await window.api.subtasks.delete(id)
    load()
  }

  const done = items.filter(i => i.done).length
  const percent = items.length ? Math.round((done / items.length) * 100) : 0

  return (
    <div>
      {items.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, height: 5, borderRadius: 99, background: 'var(--bg4)', overflow: 'hidden' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${percent}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 22 }}
              style={{ height: '100%', borderRadius: 99, background: 'var(--accent)' }}
            />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{done}/{items.length}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        <AnimatePresence initial={false}>
          {items.map(item => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8, transition: { duration: .12 } }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--bg3)', borderRadius: 8 }}
            >
              <button
                onClick={() => toggle(item.id)}
                className={`checkbox-circle${item.done ? ' done' : ''}`}
                style={{ width: 17, height: 17 }}
              >
                {!!item.done && <span style={{ fontSize: 9, color: '#fff' }}>✓</span>}
              </button>
              <span style={{ flex: 1, fontSize: 12.5, textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'var(--text3)' : 'var(--text)' }}>
                {item.title}
              </span>
              <button className="btn btn-ghost btn-icon" style={{ padding: 3 }} onClick={() => removeItem(item.id)}><X size={12} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
        {items.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)', padding: '4px 2px' }}>No checklist items yet.</div>}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="input"
          placeholder="Add a checklist item"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          style={{ flex: 1, padding: '7px 10px', fontSize: 12.5 }}
        />
        <button className="btn btn-secondary btn-sm" onClick={add}><Plus size={13} /></button>
      </div>
    </div>
  )
}
