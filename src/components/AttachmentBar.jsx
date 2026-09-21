import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, FileText, Image as ImageIcon, FolderOpen, FileWarning } from 'lucide-react'
import { fileSrc } from '../lib/fileSrc'
import { useUIStore } from '../store/useUIStore'

const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
const isImage = (name) => IMG_EXT.some(ext => name.toLowerCase().endsWith(ext))

export default function AttachmentBar({ parentType, parentId }) {
  const [items, setItems] = useState([])
  const pushToast = useUIStore(s => s.pushToast)

  async function load() {
    if (!parentId) return
    const rows = await window.api.attachments.getFor(parentType, parentId)
    setItems(rows)
  }
  useEffect(() => { load() }, [parentId])

  async function addFile() {
    const path = await window.api.attachments.pick()
    if (!path) return
    await window.api.attachments.add(parentType, parentId, path)
    load()
  }
  // Desktop opens the containing folder; Android shares the file. Either
  // way a row whose file isn't reachable here says so instead of failing
  // silently.
  async function openAttachment(a) {
    if (!fileSrc(a.file_path)) {
      pushToast('That file is not available on this device.', 'error')
      return
    }
    const res = await window.api.attachments.openInFolder(a.file_path)
    if (res && res.ok === false) pushToast(res.error || 'Could not open that file.', 'error')
  }

  async function removeFile(id) {
    await window.api.attachments.remove(id, parentType)
    load()
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <AnimatePresence initial={false}>
        {items.map(a => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .8 }}
            style={{ position: 'relative', width: 64, height: 64, borderRadius: 10, overflow: 'hidden', background: 'var(--bg3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            onClick={() => openAttachment(a)}
            title={fileSrc(a.file_path) ? a.file_name : `${a.file_name} — file not available on this device`}
          >
            {/* fileSrc returns null when the row points somewhere this
                device cannot reach — typically an attachment added on the
                PC, whose C:\Users\... path came across with an imported
                database. Show a placeholder rather than a broken image. */}
            {!fileSrc(a.file_path) ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 4, textAlign: 'center' }}>
                <FileWarning size={18} color="var(--text3)" />
                <span style={{ fontSize: 7.5, lineHeight: 1.1, color: 'var(--text3)' }}>Not on this device</span>
              </div>
            ) : isImage(a.file_name) ? (
              <img src={fileSrc(a.file_path)} alt={a.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <FileText size={22} color="var(--text3)" />
            )}
            <button
              onClick={(e) => { e.stopPropagation(); removeFile(a.id) }}
              style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: 999, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <X size={11} color="#fff" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      <button
        onClick={addFile}
        style={{ width: 64, height: 64, borderRadius: 10, border: '1.5px dashed var(--border)', background: 'transparent', color: 'var(--text3)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: 2 }}
      >
        <Plus size={16} />
        <span style={{ fontSize: 9 }}>Add</span>
      </button>
    </div>
  )
}
