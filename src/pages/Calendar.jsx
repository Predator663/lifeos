import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Plus, Trash2, Paperclip } from 'lucide-react'
import { useEventsStore } from '../store/useEventsStore'
import { useUIStore } from '../store/useUIStore'
import Modal from '../components/Modal'
import AttachmentBar from '../components/AttachmentBar'
import { localISO } from '../lib/dates'

const COLORS = ['#e8500a', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ef4444']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const emptyForm = { title: '', description: '', start_date: '', start_time: '09:00', end_time: '', location: '', color: COLORS[0], reminder_minutes_before: 10 }

export default function CalendarPage() {
  const { events, create, update, remove } = useEventsStore()
  const pushToast = useUIStore(s => s.pushToast)
  const [cursor, setCursor] = useState(new Date())
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const year = cursor.getFullYear(), month = cursor.getMonth()
  const firstDay = new Date(year, month, 1)
  const startOffset = firstDay.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = useMemo(() => {
    const arr = []
    for (let i = 0; i < startOffset; i++) arr.push(null)
    for (let d = 1; d <= daysInMonth; d++) arr.push(d)
    return arr
  }, [year, month])

  const eventsByDay = useMemo(() => {
    const map = {}
    for (const e of events) {
      const d = new Date(e.start_at)
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate()
        map[day] = map[day] || []
        map[day].push(e)
      }
    }
    return map
  }, [events, year, month])

  function openNew(day) {
    const dateStr = localISO(new Date(year, month, day || new Date().getDate()))
    setForm({ ...emptyForm, start_date: dateStr })
    setModal({})
  }
  function openEdit(ev) {
    const d = new Date(ev.start_at)
    setForm({
      title: ev.title, description: ev.description, start_date: localISO(d),
      start_time: d.toTimeString().slice(0, 5), end_time: ev.end_at ? new Date(ev.end_at).toTimeString().slice(0, 5) : '',
      location: ev.location, color: ev.color, reminder_minutes_before: ev.reminder_minutes_before,
    })
    setModal(ev)
  }

  async function save() {
    if (!form.title.trim() || !form.start_date) return pushToast('Add a title and date', 'error')
    const start_at = new Date(`${form.start_date}T${form.start_time || '09:00'}`).toISOString()
    const end_at = form.end_time ? new Date(`${form.start_date}T${form.end_time}`).toISOString() : null
    const data = { title: form.title, description: form.description, start_at, end_at, location: form.location, color: form.color, reminder_minutes_before: Number(form.reminder_minutes_before) }
    if (modal.id) await update(modal.id, data)
    else await create(data)
    pushToast(modal.id ? 'Event updated' : 'Event added', 'success')
    setModal(null)
  }

  const todayNum = new Date().getDate()
  const isCurrentMonth = new Date().getFullYear() === year && new Date().getMonth() === month

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-sub">{cursor.toLocaleString('default', { month: 'long', year: 'numeric' })}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-icon" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={16} /></button>
          <button className="btn btn-secondary btn-icon" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={16} /></button>
          <button className="btn btn-primary" onClick={() => openNew()}><Plus size={16} /> New event</button>
        </div>
      </div>

      <div className="calendar-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginTop: 10 }}>
        {WEEKDAYS.map(d => <div key={d} style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, textAlign: 'center', padding: '4px 0' }}>{d}</div>)}
        {cells.map((day, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: day ? 1 : 0, y: 0 }}
            transition={{ delay: Math.min(i, 21) * 0.012 }}
            whileHover={day ? { y: -2, borderColor: '#2c3444' } : {}}
            onClick={() => day && openNew(day)}
            className="card calendar-cell"
            style={{
              minHeight: 96, padding: 8, cursor: day ? 'pointer' : 'default',
              background: day ? 'var(--bg2)' : 'transparent', border: day ? '1px solid var(--border)' : 'none',
            }}
          >
            {day && (
              <>
                <div style={{
                  fontSize: 12, fontWeight: 700, marginBottom: 4, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999,
                  background: isCurrentMonth && day === todayNum ? 'var(--accent)' : 'transparent', color: isCurrentMonth && day === todayNum ? '#fff' : 'var(--text2)',
                }}>
                  {day}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(eventsByDay[day] || []).slice(0, 3).map(ev => (
                    <div key={ev.id} onClick={(e) => { e.stopPropagation(); openEdit(ev) }}
                      style={{ fontSize: 10.5, padding: '2px 5px', borderRadius: 5, background: `${ev.color}25`, color: ev.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ev.title}
                    </div>
                  ))}
                  {(eventsByDay[day] || []).length > 3 && <div style={{ fontSize: 9.5, color: 'var(--text3)' }}>+{eventsByDay[day].length - 3} more</div>}
                </div>
              </>
            )}
          </motion.div>
        ))}
      </div>

      <Modal open={!!modal} title={modal?.id ? 'Edit event' : 'New event'} onClose={() => setModal(null)}
        footer={<>
          {modal?.id && <button className="btn btn-danger" onClick={() => { remove(modal.id); setModal(null) }}><Trash2 size={14} /> Delete</button>}
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{modal?.id ? 'Save' : 'Add event'}</button>
        </>}>
        {modal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input className="input" placeholder="Event title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} autoFocus />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <input type="date" className="input" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
              <input type="time" className="input" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} />
              <input type="time" className="input" placeholder="End" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} />
            </div>
            <input className="input" placeholder="Location (optional)" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
            <textarea className="textarea" placeholder="Description (optional)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>Color</span>
              {COLORS.map(c => (
                <button key={c} onClick={() => setForm({ ...form, color: c })}
                  style={{ width: 22, height: 22, borderRadius: 999, background: c, border: form.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
              ))}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>Remind</span>
              <select className="select" style={{ width: 110 }} value={form.reminder_minutes_before} onChange={e => setForm({ ...form, reminder_minutes_before: e.target.value })}>
                <option value={0}>At start</option>
                <option value={10}>10 min before</option>
                <option value={30}>30 min before</option>
                <option value={60}>1 hour before</option>
                <option value={1440}>1 day before</option>
              </select>
            </div>
            {modal.id && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}><Paperclip size={13} /> Attachments</div>
                <AttachmentBar parentType="event" parentId={modal.id} />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
