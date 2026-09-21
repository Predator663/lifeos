import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Pin, Search, Paperclip } from 'lucide-react'
import { useNotesStore } from '../store/useNotesStore'
import { useUIStore } from '../store/useUIStore'
import Modal from '../components/Modal'
import AttachmentBar from '../components/AttachmentBar'

export default function Notes() {
  const { notes, create, update, remove } = useNotesStore()
  const pushToast = useUIStore(s => s.pushToast)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ title: '', content: '', pinned: false })

  const visible = notes.filter(n => (n.title + n.content).toLowerCase().includes(query.toLowerCase()))

  async function openNew() {
    const n = await create({ title: 'Untitled', content: '' })
    setForm({ title: n.title, content: n.content, pinned: false })
    setModal(n)
  }
  function openEdit(n) {
    setForm({ title: n.title, content: n.content, pinned: !!n.pinned })
    setModal(n)
  }
  async function saveAndClose() {
    await update(modal.id, form)
    setModal(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="page-title">Notes</h1>
          <p className="page-sub">Capture thoughts, attach photos, keep it all searchable.</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> New note</button>
      </div>

      <div style={{ position: 'relative', maxWidth: 320, marginBottom: 18 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text3)' }} />
        <input className="input" style={{ paddingLeft: 30 }} placeholder="Search notes..." value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      {visible.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📝</div>No notes yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
          <AnimatePresence initial={true}>
            {visible.map((n, i) => (
              <motion.div key={n.id} layout initial={{ opacity: 0, y: 10, scale: .92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: .92 }}
                transition={{ delay: Math.min(i, 12) * 0.03 }}
                whileHover={{ y: -3 }}
                className="card" style={{ cursor: 'pointer', minHeight: 130, display: 'flex', flexDirection: 'column' }}
                onClick={() => openEdit(n)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{n.title || 'Untitled'}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {!!n.pinned && <Pin size={13} color="var(--accent)" fill="var(--accent)" />}
                    <button onClick={(e) => { e.stopPropagation(); remove(n.id) }} className="btn btn-ghost btn-icon" style={{ padding: 3 }}><Trash2 size={13} /></button>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text2)', flex: 1, whiteSpace: 'pre-wrap', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical' }}>
                  {n.content}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 8 }}>{new Date(n.updated_at).toLocaleDateString()}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal open={!!modal} title="Note" width={560} onClose={saveAndClose}
        footer={<button className="btn btn-primary" onClick={saveAndClose}>Done</button>}>
        {modal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input className="input" style={{ fontSize: 16, fontWeight: 700 }} placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} autoFocus />
              <button onClick={() => setForm({ ...form, pinned: !form.pinned })} className="btn btn-ghost btn-icon">
                <Pin size={16} color={form.pinned ? 'var(--accent)' : 'var(--text3)'} fill={form.pinned ? 'var(--accent)' : 'none'} />
              </button>
            </div>
            <textarea className="textarea" style={{ minHeight: 160 }} placeholder="Write anything..." value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} />
            <div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}><Paperclip size={13} /> Attachments</div>
              <AttachmentBar parentType="note" parentId={modal.id} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
