import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Camera, Loader2 } from 'lucide-react'
import { fileSrc } from '../lib/fileSrc'
import { useProfileStore } from '../store/useProfileStore'
import { useTasksStore } from '../store/useTasksStore'
import { useNotesStore } from '../store/useNotesStore'
import { useUIStore } from '../store/useUIStore'

export default function Profile() {
  const profile = useProfileStore(s => s.profile)
  const update = useProfileStore(s => s.update)
  const uploadAvatar = useProfileStore(s => s.uploadAvatar)
  const tasks = useTasksStore(s => s.tasks)
  const notes = useNotesStore(s => s.notes)
  const pushToast = useUIStore(s => s.pushToast)

  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [uploading, setUploading] = useState(false)

  // Keep the editable fields in sync whenever the underlying profile
  // record changes (e.g. right after it first loads).
  useEffect(() => {
    setName(profile?.name || '')
    setBio(profile?.bio || '')
  }, [profile?.updated_at])

  async function handleAvatar() {
    setUploading(true)
    const result = await uploadAvatar()
    setUploading(false)
    if (result) pushToast('Avatar updated', 'success')
  }

  async function save() {
    await update({ name, bio })
    pushToast('Profile saved', 'success')
  }

  const completedTasks = tasks.filter(t => t.status === 'done').length
  const memberSince = profile?.created_at ? profile.created_at.slice(0, 10) : '—'

  return (
    <div>
      <h1 className="page-title">About Me</h1>
      <p className="page-sub">Your profile — stored locally, never leaves this device.</p>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', maxWidth: 640, marginBottom: 24 }}>
        <button
          onClick={handleAvatar}
          disabled={uploading}
          title="Change photo"
          style={{
            position: 'relative', width: 112, height: 112, borderRadius: 999, border: 'none',
            padding: 0, cursor: uploading ? 'default' : 'pointer', overflow: 'hidden',
            background: 'var(--bg3)', flexShrink: 0,
          }}
        >
          <AnimatePresence mode="wait">
            {uploading ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.4)', zIndex: 2 }}>
                <Loader2 size={26} color="#fff" className="spin" />
              </motion.div>
            ) : (
              <motion.div key={profile?.avatar_path || 'empty'} initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .9 }} transition={{ duration: .2 }}
                style={{ position: 'absolute', inset: 0 }}>
                {profile?.avatar_path && fileSrc(profile.avatar_path, profile.updated_at)
                  ? <img src={fileSrc(profile.avatar_path, profile.updated_at)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={40} color="var(--text3)" /></div>}
              </motion.div>
            )}
          </AnimatePresence>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '6px 0', background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, zIndex: 1 }}>
            <Camera size={12} color="#fff" /><span style={{ fontSize: 10, color: '#fff' }}>Change</span>
          </div>
        </button>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input className="input" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
          <textarea className="textarea" placeholder="A short bio or note to yourself..." value={bio} onChange={e => setBio(e.target.value)} />
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save}>Save</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, maxWidth: 640 }}>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card">
          <div style={{ fontSize: 22, fontWeight: 800 }}>{completedTasks}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Tasks completed</div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 }} className="card">
          <div style={{ fontSize: 22, fontWeight: 800 }}>{notes.length}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Notes kept</div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 }} className="card">
          <div style={{ fontSize: 13, fontWeight: 700 }}>{memberSince}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Member since</div>
        </motion.div>
      </div>
    </div>
  )
}
