import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Database as DatabaseIcon, ChevronLeft, ChevronRight, Trash2, ArchiveRestore,
  Archive, Search, Loader2, ShieldAlert, Inbox,
} from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import Modal from '../components/Modal'
import { fmt, fmtShort } from '../lib/format'
import { hapticLight, hapticWarning, hapticSuccess } from '../lib/haptics'

const isNative = !!(typeof window !== 'undefined' && window.api?.android?.isNative)

// Column-name heuristics so one generic renderer can show money, dates
// and plain text sensibly without every table needing its own component.
function renderValue(col, value) {
  if (value === null || value === undefined || value === '') return <span style={{ color: 'var(--text3)' }}>—</span>
  if (/amount|limit|balance/.test(col)) return fmt(value)
  if (/date$|_at$/.test(col) && typeof value === 'string' && value.length >= 8) {
    const d = fmtShort(value.slice(0, 10))
    return d || String(value)
  }
  return String(value)
}

function labelize(col) {
  return col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function Database() {
  const pushToast = useUIStore(s => s.pushToast)

  const [tables, setTables] = useState(null) // null = loading
  const [active, setActive] = useState(null) // { key, label, ...meta }
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [meta, setMeta] = useState(null) // { idCol, columns, archivedCol }
  const [loadingRows, setLoadingRows] = useState(false)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(null) // row
  const [busyId, setBusyId] = useState(null)

  async function loadTables() {
    const t = await window.api.data.listTables()
    setTables(t)
  }
  useEffect(() => { loadTables() }, [])

  async function openTable(t) {
    hapticLight()
    setActive(t)
    setQuery('')
    setShowArchived(true)
    setLoadingRows(true)
    try {
      const r = await window.api.data.getRows(t.key, { limit: 500, offset: 0 })
      setRows(r.rows); setTotal(r.total); setMeta(r)
    } catch (e) {
      pushToast(e.message || 'Could not load that table', 'error')
      setActive(null)
    } finally {
      setLoadingRows(false)
    }
  }

  function back() { hapticLight(); setActive(null); setRows([]); setMeta(null) }

  async function doDelete(row) {
    const id = row[meta.idCol]
    setBusyId(id)
    try {
      await window.api.data.deleteRow(active.key, id)
      hapticWarning()
      setRows(rs => rs.filter(r => r[meta.idCol] !== id))
      setTotal(t => t - 1)
      setTables(ts => ts.map(t => t.key === active.key ? { ...t, count: t.count - 1 } : t))
      pushToast('Deleted', 'success')
    } catch (e) {
      pushToast(e.message || 'Delete failed', 'error')
    } finally {
      setBusyId(null); setConfirmDelete(null)
    }
  }

  async function toggleArchive(row) {
    const id = row[meta.idCol]
    const isArchived = !!row[meta.archivedCol]
    setBusyId(id)
    try {
      await window.api.data.setArchived(active.key, id, !isArchived)
      hapticSuccess()
      setRows(rs => rs.map(r => r[meta.idCol] === id ? { ...r, [meta.archivedCol]: isArchived ? 0 : 1 } : r))
      setTables(ts => ts.map(t => t.key === active.key
        ? { ...t, archivedCount: t.archivedCount + (isArchived ? -1 : 1) }
        : t))
      pushToast(isArchived ? 'Restored' : 'Archived', 'success')
    } catch (e) {
      pushToast(e.message || 'Could not update', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const visibleRows = useMemo(() => {
    if (!meta) return []
    let list = rows
    if (meta.archivedCol && !showArchived) list = list.filter(r => !r[meta.archivedCol])
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(r => meta.columns.some(c => String(r[c] ?? '').toLowerCase().includes(q)))
    }
    return list
  }, [rows, query, showArchived, meta])

  return (
    <div>
      <AnimatePresence mode="wait">
        {!active ? (
          <motion.div key="list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>
            <h1 className="page-title">Your data</h1>
            <p className="page-sub">
              Every table LifeOS stores on this device — view what's in it, archive what you're not using, or delete rows you don't need.
              {' '}This changes data permanently; back up first from Settings if you're unsure.
            </p>

            {tables === null ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}><Loader2 size={22} className="spin" color="var(--text3)" /></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
                {tables.map((t, i) => (
                  <motion.button
                    key={t.key}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                    onClick={() => openTable(t)}
                    className="card"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
                      border: '1px solid var(--border)', background: 'var(--bg2)', cursor: 'pointer', width: '100%',
                    }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <DatabaseIcon size={18} color="var(--text2)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{t.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                        {t.count} row{t.count === 1 ? '' : 's'}
                        {t.hasArchive && t.archivedCount > 0 ? ` · ${t.archivedCount} archived` : ''}
                      </div>
                    </div>
                    <ChevronRight size={18} color="var(--text3)" style={{ flexShrink: 0 }} />
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="detail" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>
            <button onClick={back} className="btn btn-ghost btn-sm" style={{ marginBottom: 10, paddingLeft: 4 }}>
              <ChevronLeft size={16} /> All data
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <h1 className="page-title">{active.label}</h1>
                <p className="page-sub" style={{ marginBottom: 14 }}>{total} row{total === 1 ? '' : 's'} total</p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', maxWidth: 560 }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                <Search size={14} color="var(--text3)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
                <input className="input" style={{ paddingLeft: 32 }} placeholder="Search this table…"
                  value={query} onChange={e => setQuery(e.target.value)} />
              </div>
              {meta?.archivedCol && (
                <button className="btn btn-secondary btn-sm" onClick={() => setShowArchived(v => !v)}>
                  {showArchived ? 'Hide archived' : 'Show archived'}
                </button>
              )}
            </div>

            {loadingRows ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}><Loader2 size={22} className="spin" color="var(--text3)" /></div>
            ) : visibleRows.length === 0 ? (
              <div className="empty-state">
                <Inbox size={32} style={{ opacity: .5, marginBottom: 8 }} />
                <div>{rows.length === 0 ? 'Nothing here yet.' : 'No rows match your search.'}</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560 }}>
                {visibleRows.map(row => {
                  const id = row[meta.idCol]
                  const archived = meta.archivedCol ? !!row[meta.archivedCol] : false
                  const busy = busyId === id
                  return (
                    <div key={id} className="card" style={{ padding: 14, opacity: archived ? .65 : 1 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginBottom: 10 }}>
                        {meta.columns.map(col => (
                          <div key={col} style={{ fontSize: 12.5 }}>
                            <span style={{ color: 'var(--text3)' }}>{labelize(col)}: </span>
                            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{renderValue(col, row[col])}</span>
                          </div>
                        ))}
                        {archived && <span className="badge" style={{ background: 'var(--bg4)', color: 'var(--text3)' }}>Archived</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        {meta.archivedCol && (
                          <button className="btn btn-secondary btn-sm" onClick={() => toggleArchive(row)} disabled={busy}>
                            {busy ? <Loader2 size={13} className="spin" /> : archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                            {archived ? 'Restore' : 'Archive'}
                          </button>
                        )}
                        <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(row)} disabled={busy}>
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={!!confirmDelete} title="Delete this row?" onClose={() => setConfirmDelete(null)}
        footer={<>
          <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => doDelete(confirmDelete)} disabled={busyId != null}>
            {busyId != null ? <Loader2 size={14} className="spin" /> : null} Delete
          </button>
        </>}>
        <div style={{ display: 'flex', gap: 10, fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.6 }}>
          <ShieldAlert size={18} color="var(--red)" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0 }}>
            This permanently removes the row from {active?.label.toLowerCase()} — and anything linked to it (subtasks, entries, payments,
            attachments) where that applies. This cannot be undone{isNative ? '' : ' from here'}.
            {' '}If you're not sure, export a backup from Settings first.
          </p>
        </div>
      </Modal>
    </div>
  )
}
