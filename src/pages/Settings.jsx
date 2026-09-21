import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Power, HardDrive, Info, Lock, LogOut, Sparkles, KeyRound, Cloud, UploadCloud, History, ExternalLink, Loader2, Smartphone, BellRing, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Share2, Download, DatabaseBackup, Database, ChevronRight } from 'lucide-react'
import { useUIStore } from '../store/useUIStore'
import { useProfileStore } from '../store/useProfileStore'
import { useAiStore } from '../store/useAiStore'
import { useDriveStore } from '../store/useDriveStore'
import { usePhoneStore } from '../store/usePhoneStore'
import Modal from '../components/Modal'

function fmtBytes(n) {
  n = Number(n) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// window.api.android only exists in the Capacitor build (see
// src/native/bridge.js), so this is false on Electron and every
// desktop-only card below renders exactly as it always did.
const isNative = !!(typeof window !== 'undefined' && window.api?.android?.isNative)

export default function Settings() {
  const [autoLaunch, setAutoLaunch] = useState(null)

  // ── Android: notification permission + Backup & transfer ──────────
  const [notifState, setNotifState] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [importCandidate, setImportCandidate] = useState(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!isNative) return
    window.api.android.notificationStatus().then(setNotifState).catch(() => {})
  }, [])

  async function askNotifications() {
    const r = await window.api.android.requestNotifications()
    setNotifState(r)
    if (r.granted) pushToast('Reminders enabled', 'success')
    else pushToast('Notifications are still blocked — enable them in Android Settings > Apps > LifeOS.', 'error')
  }

  async function exportDb() {
    setExporting(true)
    const r = await window.api.android.exportDatabase()
    setExporting(false)
    if (r.ok) pushToast(`Exported ${fmtBytes(r.size)}`, 'success')
    else if (!r.cancelled) pushToast(r.error || 'Export failed', 'error')
  }

  async function pickImport() {
    const r = await window.api.android.pickImport()
    if (r.ok) { setImportCandidate(r); return }
    if (!r.cancelled) pushToast(r.error || 'That file could not be read', 'error')
  }

  async function confirmImport() {
    setImporting(true)
    const r = await window.api.android.confirmImport()
    setImporting(false)
    setImportCandidate(null)
    if (r.ok) pushToast('Database replaced — everything reloaded', 'success')
    else pushToast(r.error || 'Import failed', 'error')
  }
  const pushToast = useUIStore(s => s.pushToast)
  const setPage = useUIStore(s => s.setPage)
  const profile = useProfileStore(s => s.profile)
  const setPin = useProfileStore(s => s.setPin)
  const clearPin = useProfileStore(s => s.clearPin)

  const aiSettings = useAiStore(s => s.settings)
  const saveAi = useAiStore(s => s.save)
  const clearAiKey = useAiStore(s => s.clearKey)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [modelDraft, setModelDraft] = useState(aiSettings.model)
  const [savingAi, setSavingAi] = useState(false)

  const [pinModal, setPinModal] = useState(false)
  const [pinDraft, setPinDraft] = useState('')
  const [quitModal, setQuitModal] = useState(false)

  const driveStatus = useDriveStore(s => s.status)
  const saveDriveCredentials = useDriveStore(s => s.saveCredentials)
  const connectDrive = useDriveStore(s => s.connect)
  const disconnectDrive = useDriveStore(s => s.disconnect)
  const setDriveAutoBackup = useDriveStore(s => s.setAutoBackup)
  const backupNow = useDriveStore(s => s.backupNow)
  const listDriveBackups = useDriveStore(s => s.listBackups)
  const restoreDriveBackup = useDriveStore(s => s.restore)

  const phoneStatus = usePhoneStore(s => s.status)
  const setPhoneEnabled = usePhoneStore(s => s.setEnabled)
  const setPhoneQuiet = usePhoneStore(s => s.setQuiet)
  const sendPhoneTest = usePhoneStore(s => s.sendTest)
  const [sendingTest, setSendingTest] = useState(false)

  const [editingDriveCreds, setEditingDriveCreds] = useState(false)
  const [clientIdDraft, setClientIdDraft] = useState('')
  const [clientSecretDraft, setClientSecretDraft] = useState('')
  const [savingDriveCreds, setSavingDriveCreds] = useState(false)
  const [connectingDrive, setConnectingDrive] = useState(false)
  const [backingUp, setBackingUp] = useState(false)

  const [restoreModal, setRestoreModal] = useState(false)
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [backups, setBackups] = useState([])
  const [restoreTarget, setRestoreTarget] = useState(null) // the backup file picked for the confirm step
  const [restoring, setRestoring] = useState(false)

  useEffect(() => { window.api.settings.getAutoLaunch().then(setAutoLaunch) }, [])
  useEffect(() => { setModelDraft(aiSettings.model) }, [aiSettings.model])

  async function saveAiSettings() {
    setSavingAi(true)
    await saveAi({ apiKey: apiKeyDraft.trim(), model: modelDraft.trim() || 'claude-sonnet-5' })
    setSavingAi(false)
    setApiKeyDraft('')
    pushToast('AI settings saved', 'success')
  }
  async function removeAiKey() {
    await clearAiKey()
    pushToast('API key removed', 'success')
  }

  async function toggleAutoLaunch() {
    const next = await window.api.settings.setAutoLaunch(!autoLaunch)
    setAutoLaunch(next)
    pushToast(next ? 'LifeOS will start with Windows' : 'Auto-start disabled', 'success')
  }

  async function savePin() {
    if (!/^\d{4}$/.test(pinDraft)) return pushToast('PIN must be exactly 4 digits', 'error')
    await setPin(pinDraft)
    pushToast('App lock enabled', 'success')
    setPinDraft('')
    setPinModal(false)
  }
  async function removePin() {
    await clearPin()
    pushToast('App lock disabled', 'success')
  }

  async function saveDriveCreds() {
    if (!clientIdDraft.trim() || !clientSecretDraft.trim()) return pushToast('Enter both the Client ID and Client Secret', 'error')
    setSavingDriveCreds(true)
    await saveDriveCredentials({ clientId: clientIdDraft.trim(), clientSecret: clientSecretDraft.trim() })
    setSavingDriveCreds(false)
    setClientIdDraft(''); setClientSecretDraft('')
    setEditingDriveCreds(false)
    pushToast('Drive credentials saved', 'success')
  }

  async function handleConnectDrive() {
    setConnectingDrive(true)
    const r = await connectDrive()
    setConnectingDrive(false)
    if (r.ok) pushToast('Google connected', 'success')
    else pushToast(r.error, 'error')
  }

  async function handleDisconnectDrive() {
    await disconnectDrive()
    pushToast('Google disconnected', 'success')
  }

  async function togglePhone() {
    await setPhoneEnabled(!phoneStatus.enabled)
    pushToast(phoneStatus.enabled ? 'Phone alerts off' : 'Phone alerts on', 'success')
  }
  async function handleSendTest() {
    setSendingTest(true)
    const r = await sendPhoneTest()
    setSendingTest(false)
    if (r.ok) pushToast('Test alert sent — it should reach your phone within a minute or two', 'success')
    else pushToast(r.error, 'error')
  }

  async function handleBackupNow() {
    setBackingUp(true)
    const r = await backupNow()
    setBackingUp(false)
    if (r.ok) pushToast('Backed up to Google Drive', 'success')
    else pushToast(r.error, 'error')
  }

  async function toggleAutoBackup() {
    await setDriveAutoBackup({ enabled: !driveStatus.autoBackup, frequencyHours: driveStatus.frequencyHours })
  }

  async function openRestoreModal() {
    setRestoreModal(true)
    setRestoreTarget(null)
    setBackupsLoading(true)
    const r = await listDriveBackups()
    setBackupsLoading(false)
    if (r.ok) setBackups(r.files)
    else { pushToast(r.error, 'error'); setRestoreModal(false) }
  }

  async function confirmRestore() {
    setRestoring(true)
    const r = await restoreDriveBackup(restoreTarget.id)
    // On success LifeOS relaunches itself immediately, so there's no
    // meaningful "restoring..." state to clear — only handle failure here.
    if (!r.ok) { setRestoring(false); pushToast(r.error, 'error') }
  }

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">LifeOS runs entirely on your machine — Google features are optional and use your own Google account.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
        {/* Auto-launch is a Windows feature */}
        {!isNative && (<>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Power size={18} color="var(--accent)" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Start with Windows</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Launches minimized to the tray on login, so tracking and reminders never stop.</div>
          </div>
          <button
            onClick={toggleAutoLaunch}
            style={{
              width: 44, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative',
              background: autoLaunch ? 'var(--accent)' : 'var(--bg4)', transition: 'background .2s', flexShrink: 0,
            }}
          >
            <motion.div animate={{ x: autoLaunch ? 22 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              style={{ position: 'absolute', top: 2, width: 20, height: 20, borderRadius: 999, background: '#fff' }} />
          </button>
        </motion.div>
        </>)}

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .04 }} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(239,68,68,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Lock size={18} color="var(--red)" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>App lock</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              {profile?.has_pin ? 'A 4-digit PIN is required whenever LifeOS starts.' : 'Require a 4-digit PIN whenever LifeOS starts.'}
            </div>
          </div>
          {profile?.has_pin
            ? <button className="btn btn-danger btn-sm" onClick={removePin}>Remove</button>
            : <button className="btn btn-secondary btn-sm" onClick={() => setPinModal(true)}>Set PIN</button>}
        </motion.div>

        {/* ── Android-only: notification permission banners + Backup & transfer ── */}
        {isNative && (<>
          {/* Android reminders are scheduled ahead of time (see
              src/native/scheduler.js). Without the runtime permission
              nothing fires at all, so say so plainly rather than letting
              reminders silently never arrive. */}
          {notifState && !notifState.granted && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 }} className="card"
              style={{ display: 'flex', alignItems: 'center', gap: 14, borderColor: 'var(--red)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(239,68,68,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AlertTriangle size={18} color="var(--red)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Reminders are off</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>Android is blocking notifications, so task, event, debt and savings reminders will not arrive.</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={askNotifications}>Allow</button>
            </motion.div>
          )}

          {notifState && notifState.granted && notifState.exactAlarms === 'denied' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 }} className="card"
              style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(234,179,8,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <BellRing size={18} color="var(--yellow)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Reminders may arrive late</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>Exact alarms are not permitted, so Android may delay a reminder while it batches wake-ups.</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => window.api.android.openExactAlarmSettings()}>Fix</button>
            </motion.div>
          )}

          {/* ── Manage your data ── */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .055 }} className="card"
            onClick={() => setPage('database')}
            style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(232,80,10,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Database size={18} color="var(--accent)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Manage your data</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Browse every table on this phone — archive or delete tasks, transactions, notes and more.</div>
            </div>
            <ChevronRight size={18} color="var(--text3)" style={{ flexShrink: 0 }} />
          </motion.div>

          {/* ── Backup & transfer ── */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .06 }} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(59,130,246,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <DatabaseBackup size={18} color="var(--blue)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Backup &amp; transfer</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  Move your LifeOS database between this phone and your PC. This is a one-off copy, <strong>not live sync</strong> — whichever copy you import wins, and changes made on the other device since are lost.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={exportDb} disabled={exporting}>
                {exporting ? <Loader2 size={14} className="spin" /> : <Share2 size={14} />} Export database
              </button>
              <button className="btn btn-secondary btn-sm" onClick={pickImport}>
                <Download size={14} /> Import database
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10, lineHeight: 1.5 }}>
              On the PC the file lives at <code>%APPDATA%\\LifeOS\\lifeos.db</code>. Copy it to the phone (or pick a Drive backup) and import it here. Attachments added on the PC stay on the PC — those rows will show as unavailable.
            </div>
          </motion.div>
        </>)}

        {/* ── Desktop only: manage your data (Android has its own card above, next to Backup & transfer) ── */}
        {!isNative && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .055 }} className="card"
            onClick={() => setPage('database')}
            style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(232,80,10,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Database size={18} color="var(--accent)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Manage your data</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Browse every table in the database — archive or delete tasks, transactions, notes and more.</div>
            </div>
            <ChevronRight size={18} color="var(--text3)" style={{ flexShrink: 0 }} />
          </motion.div>
        )}

        {/* Google account: desktop-only OAuth */}
        {!isNative && (<>
        {/* ── Google account: one connection for Drive backup + phone alerts ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .06 }} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(59,130,246,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Cloud size={18} color="var(--blue)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Google account</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                One connection to your own Google account powers Drive backups and phone alerts. No server of ours is involved — LifeOS talks to Google directly from this PC.
              </div>
            </div>
            {driveStatus.connected && !driveStatus.needsReconnect && (
              <span className="badge" style={{ background: 'rgba(34,197,94,.15)', color: 'var(--green)' }}>Connected</span>
            )}
            {driveStatus.needsReconnect && (
              <span className="badge" style={{ background: 'rgba(239,68,68,.15)', color: 'var(--red)' }}>Expired</span>
            )}
          </div>

          {!driveStatus.connected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(!driveStatus.hasCredentials || editingDriveCreds) ? (
                <>
                  <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
                    Connecting needs a free Google OAuth "Desktop app" client of your own — LifeOS never ships a shared one, so everything stays under your own Google account and quota.{' '}
                    <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', display: 'inline-flex' }}
                      onClick={() => window.api.app.openExternal('https://console.cloud.google.com/apis/credentials')}>
                      Open Google Cloud Console <ExternalLink size={11} style={{ marginLeft: 4 }} />
                    </button>
                    {' '}→ enable the <b>Google Drive API</b> and the <b>Google Calendar API</b> for your project → create an OAuth client ID → Application type: <b>Desktop app</b> → paste the two values below.
                    Google will show an "unverified app" warning when you connect — that's expected for your own personal client; choose Advanced → Go to LifeOS (unsafe) to proceed.
                    <br /><b>Tip:</b> on the OAuth consent screen, set the publishing status to <b>In production</b>. Apps left in "Testing" have their sign-in expire every 7 days.
                  </div>
                  <input className="input" placeholder="Client ID" value={clientIdDraft} onChange={e => setClientIdDraft(e.target.value)} />
                  <input className="input" type="password" placeholder="Client Secret" value={clientSecretDraft} onChange={e => setClientSecretDraft(e.target.value)} />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    {driveStatus.hasCredentials && <button className="btn btn-secondary btn-sm" onClick={() => setEditingDriveCreds(false)}>Cancel</button>}
                    <button className="btn btn-primary btn-sm" onClick={saveDriveCreds} disabled={savingDriveCreds}>
                      {savingDriveCreds ? 'Saving…' : 'Save credentials'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text3)' }}>Credentials saved — connect your Google account to use Drive backup and phone alerts.</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingDriveCreds(true)}>Edit</button>
                  <button className="btn btn-primary btn-sm" onClick={handleConnectDrive} disabled={connectingDrive}>
                    {connectingDrive ? <Loader2 size={14} className="spin" /> : <Cloud size={14} />} Connect Google
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {driveStatus.needsReconnect && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--red)', background: 'rgba(239,68,68,.08)', padding: '9px 11px', borderRadius: 9 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  Google stopped accepting LifeOS's sign-in (it was revoked, or it expired — this happens every 7 days if your OAuth consent screen is still in "Testing"). Reconnect to restore backups and phone alerts.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
                {[
                  { ok: driveStatus.scopes.drive, label: 'Drive backup', note: 'Only files LifeOS itself creates' },
                  { ok: driveStatus.scopes.calendar, label: 'Phone alerts (Calendar)', note: 'Only a private "LifeOS Alerts" calendar it creates' },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {row.ok ? <CheckCircle2 size={14} color="var(--green)" /> : <XCircle size={14} color="var(--text3)" />}
                    <span style={{ fontWeight: 600 }}>{row.label}</span>
                    <span style={{ color: 'var(--text3)' }}>{row.ok ? `— ${row.note}` : '— permission not granted'}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                {(!driveStatus.scopes.calendar || !driveStatus.scopes.drive) && !driveStatus.needsReconnect && (
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text3)' }}>Reconnect and leave every box ticked on Google's screen to grant the missing permission.</span>
                )}
                <button className="btn btn-secondary btn-sm" onClick={handleConnectDrive} disabled={connectingDrive}>
                  {connectingDrive ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Reconnect
                </button>
                <button className="btn btn-ghost btn-sm" onClick={handleDisconnectDrive}>Disconnect</button>
              </div>
            </div>
          )}
        </motion.div>
        </>)}

        {/* Drive backup needs the desktop OAuth loopback */}
        {!isNative && (<>
        {/* ── Google Drive backup ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .07 }} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: driveStatus.scopes.drive ? 14 : 0 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(59,130,246,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <UploadCloud size={18} color="var(--blue)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Google Drive Backup</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                Backs up your LifeOS database (tasks, events, finance, savings, debts, habits, notes) to a private folder in your own Drive. Linked attachment files and your profile photo aren't included.
              </div>
            </div>
          </div>

          {!driveStatus.scopes.drive ? (
            <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 10 }}>
              {driveStatus.connected ? 'Drive permission wasn\'t granted — reconnect Google above and leave the Drive box ticked.' : 'Connect your Google account above to turn this on.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>
                {driveStatus.lastBackupAt
                  ? `Last backed up ${new Date(driveStatus.lastBackupAt).toLocaleString()}`
                  : 'No backup yet — back up now to get started.'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={handleBackupNow} disabled={backingUp}>
                  {backingUp ? <Loader2 size={14} className="spin" /> : <UploadCloud size={14} />} Back up now
                </button>
                <button className="btn btn-secondary btn-sm" onClick={openRestoreModal}>
                  <History size={14} /> Restore from backup
                </button>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Auto-backup</span>
                <button
                  onClick={toggleAutoBackup}
                  style={{
                    width: 40, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative',
                    background: driveStatus.autoBackup ? 'var(--accent)' : 'var(--bg4)', transition: 'background .2s', flexShrink: 0,
                  }}
                >
                  <motion.div animate={{ x: driveStatus.autoBackup ? 20 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    style={{ position: 'absolute', top: 2, width: 18, height: 18, borderRadius: 999, background: '#fff' }} />
                </button>
                {driveStatus.autoBackup && (
                  <select className="select" style={{ width: 100 }} value={driveStatus.frequencyHours}
                    onChange={e => setDriveAutoBackup({ enabled: true, frequencyHours: Number(e.target.value) })}>
                    <option value={24}>Daily</option>
                    <option value={168}>Weekly</option>
                  </select>
                )}
              </div>
            </div>
          )}
        </motion.div>
        </>)}

        {/* Phone relay: pointless on the phone itself */}
        {!isNative && (<>
        {/* ── Phone notifications (via Google Calendar) ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .075 }} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(34,197,94,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Smartphone size={18} color="var(--green)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Phone notifications</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
                Every reminder LifeOS shows on this PC — tasks, events, debt due dates, savings deadlines — is also sent to your phone through your Google account, and appears as a normal notification from the Google Calendar app. Alerts wait in a queue while you're offline and go out as soon as the internet is back.
              </div>
            </div>
            {phoneStatus.enabled && phoneStatus.calendarGranted && (
              <span className="badge" style={{ background: 'rgba(34,197,94,.15)', color: 'var(--green)' }}>On</span>
            )}
          </div>

          {!driveStatus.connected ? (
            <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Connect your Google account above to turn this on — the same account your phone is signed in to.</div>
          ) : !driveStatus.scopes.calendar ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text3)' }}>Calendar permission hasn't been granted yet. Reconnect Google and leave the Calendar box ticked.</span>
              <button className="btn btn-primary btn-sm" onClick={handleConnectDrive} disabled={connectingDrive}>
                {connectingDrive ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Reconnect
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Send notifications to my phone</span>
                <button
                  onClick={togglePhone}
                  style={{
                    width: 44, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative',
                    background: phoneStatus.enabled ? 'var(--accent)' : 'var(--bg4)', transition: 'background .2s', flexShrink: 0,
                  }}
                >
                  <motion.div animate={{ x: phoneStatus.enabled ? 22 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    style={{ position: 'absolute', top: 2, width: 20, height: 20, borderRadius: 999, background: '#fff' }} />
                </button>
              </div>

              {phoneStatus.enabled && (
                <>
                  <div style={{ fontSize: 12.5, color: 'var(--text3)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span>
                      {phoneStatus.lastSentAt ? `Last alert sent ${new Date(phoneStatus.lastSentAt).toLocaleString()}` : 'No alert sent yet — try the test below.'}
                      {phoneStatus.pending > 0 && ` · ${phoneStatus.pending} waiting to send`}
                    </span>
                    {phoneStatus.lastError && <span style={{ color: 'var(--red)' }}>{phoneStatus.lastError}</span>}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={handleSendTest} disabled={sendingTest}>
                      {sendingTest ? <Loader2 size={14} className="spin" /> : <BellRing size={14} />} Send test alert
                    </button>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Quiet hours</span>
                    <button
                      onClick={() => setPhoneQuiet({ enabled: !phoneStatus.quietEnabled, start: phoneStatus.quietStart, end: phoneStatus.quietEnd })}
                      style={{
                        width: 40, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative',
                        background: phoneStatus.quietEnabled ? 'var(--accent)' : 'var(--bg4)', transition: 'background .2s', flexShrink: 0,
                      }}
                    >
                      <motion.div animate={{ x: phoneStatus.quietEnabled ? 20 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        style={{ position: 'absolute', top: 2, width: 18, height: 18, borderRadius: 999, background: '#fff' }} />
                    </button>
                    {phoneStatus.quietEnabled && (
                      <>
                        <input type="time" className="input" style={{ width: 106 }} value={phoneStatus.quietStart}
                          onChange={e => setPhoneQuiet({ enabled: true, start: e.target.value, end: phoneStatus.quietEnd })} />
                        <span style={{ fontSize: 12, color: 'var(--text3)' }}>to</span>
                        <input type="time" className="input" style={{ width: 106 }} value={phoneStatus.quietEnd}
                          onChange={e => setPhoneQuiet({ enabled: true, start: phoneStatus.quietStart, end: e.target.value })} />
                      </>
                    )}
                  </div>
                  {phoneStatus.quietEnabled && (
                    <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Alerts that come up during quiet hours are held and sent afterwards (as one summary if several pile up). Desktop notifications aren't affected.</div>
                  )}

                  <div style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.6, background: 'var(--bg3)', padding: '9px 11px', borderRadius: 9 }}>
                    <b>On your phone:</b> sign in to the same Google account and open the Google Calendar app once. Make sure the <b>LifeOS Alerts</b> calendar is switched on (Calendar → Settings → LifeOS Alerts → Sync / Show) and that Calendar's notifications are allowed in your phone settings. Alerts arrive about a minute after they fire on the PC, and only while this PC is on and LifeOS is running.
                  </div>
                </>
              )}
            </div>
          )}
        </motion.div>
        </>)}

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08 }} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(168,85,247,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Sparkles size={18} color="var(--purple)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>AI Assistant</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                Powers Finance's Smart Add and Insights. Your key is stored locally and only sent to Anthropic when you use those features.
              </div>
            </div>
            <span className="badge" style={{
              background: aiSettings.has_key ? 'rgba(34,197,94,.15)' : 'var(--bg4)',
              color: aiSettings.has_key ? 'var(--green)' : 'var(--text3)',
            }}>
              {aiSettings.has_key ? 'Connected' : 'Not set'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <KeyRound size={14} color="var(--text3)" style={{ flexShrink: 0 }} />
              <input
                className="input" type="password"
                placeholder={aiSettings.has_key ? 'API key saved — enter a new one to replace it' : 'sk-ant-...'}
                value={apiKeyDraft} onChange={e => setApiKeyDraft(e.target.value)}
              />
            </div>
            <input className="input" placeholder="Model (e.g. claude-sonnet-5)" value={modelDraft} onChange={e => setModelDraft(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {aiSettings.has_key && <button className="btn btn-danger btn-sm" onClick={removeAiKey}>Remove key</button>}
              <button className="btn btn-primary btn-sm" onClick={saveAiSettings} disabled={savingAi || (!apiKeyDraft.trim() && modelDraft.trim() === aiSettings.model)}>
                {savingAi ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </motion.div>

        {/* Quitting to a tray icon is a desktop idea */}
        {!isNative && (<>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .12 }} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(239,68,68,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LogOut size={18} color="var(--red)" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Quit LifeOS completely</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              Closing the window only minimizes to the tray — reminders and recurring items keep running in the background.
              This stops all of that: the notification poll, the tray icon, and the database connection.
            </div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={() => setQuitModal(true)}>Quit</button>
        </motion.div>
        </>)}

        {/* Windows file location — replaced by Backup & transfer on Android */}
        {!isNative && (<>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .16 }} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(59,130,246,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HardDrive size={18} color="var(--blue)" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Your data</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Stored locally in a single SQLite file under your Windows user profile (AppData/Roaming/LifeOS). Back it up by copying <code>lifeos.db</code>.</div>
          </div>
        </motion.div>
        </>)}

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 }} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(168,85,247,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Info size={18} color="var(--purple)" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>LifeOS v1.1.0</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Tasks, calendar, finance (savings goals and debts included), discipline, and notes — one local app, no server, no account.</div>
          </div>
        </motion.div>
      </div>

      <Modal open={pinModal} title="Set a 4-digit PIN" onClose={() => setPinModal(false)}
        footer={<><button className="btn btn-secondary" onClick={() => setPinModal(false)}>Cancel</button><button className="btn btn-primary" onClick={savePin}>Save</button></>}>
        <input
          className="input" type="password" inputMode="numeric" maxLength={4}
          placeholder="4-digit PIN" value={pinDraft} autoFocus
          onChange={e => setPinDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={e => { if (e.key === 'Enter') savePin() }}
        />
      </Modal>

      {/* Replacing the database is destructive and irreversible, so the
          file has already been opened and checked by this point and the
          user is told exactly what is about to land. */}
      <Modal open={!!importCandidate} title="Replace all data on this phone?"
        onClose={() => { setImportCandidate(null); window.api.android.cancelImport() }}
        footer={<>
          <button className="btn btn-ghost" onClick={() => { setImportCandidate(null); window.api.android.cancelImport() }}>Cancel</button>
          <button className="btn btn-danger" onClick={confirmImport} disabled={importing}>
            {importing ? <Loader2 size={14} className="spin" /> : null} Replace everything
          </button>
        </>}>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text2)' }}>
          <p style={{ marginTop: 0 }}>
            <strong style={{ color: 'var(--text)' }}>{importCandidate?.name}</strong> ({fmtBytes(importCandidate?.size)}) is a valid LifeOS database containing{' '}
            {importCandidate?.counts?.tasks ?? 0} tasks, {importCandidate?.counts?.transactions ?? 0} transactions,{' '}
            {importCandidate?.counts?.debts ?? 0} debts and {importCandidate?.counts?.notes ?? 0} notes.
          </p>
          <p style={{ color: 'var(--red)' }}>
            Importing it <strong>replaces ALL data on this phone</strong>. Anything currently in LifeOS here — tasks, transactions, habits, notes — is deleted and cannot be recovered unless you exported it first.
          </p>
        </div>
      </Modal>

      <Modal open={quitModal} title="Quit LifeOS completely?" onClose={() => setQuitModal(false)}
        footer={<>
          <button className="btn btn-secondary" onClick={() => setQuitModal(false)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => window.api.app.quit()}>Quit completely</button>
        </>}>
        <p style={{ fontSize: 13.5, color: 'var(--text2)', margin: 0, lineHeight: 1.6 }}>
          This ends the background session entirely — the 30-second reminder/recurrence check will stop running,
          the tray icon will disappear, and you won't get notifications until you reopen LifeOS yourself.
          {' '}Auto-start on Windows login is unaffected, so it'll still launch normally next time you sign in.
        </p>
      </Modal>

      <Modal open={restoreModal} title={restoreTarget ? 'Restore this backup?' : 'Restore from Drive'} onClose={() => setRestoreModal(false)}
        footer={restoreTarget ? <>
          <button className="btn btn-secondary" onClick={() => setRestoreTarget(null)} disabled={restoring}>Back</button>
          <button className="btn btn-danger" onClick={confirmRestore} disabled={restoring}>
            {restoring ? <Loader2 size={14} className="spin" /> : null} Restore &amp; restart
          </button>
        </> : null}>
        {restoreTarget ? (
          <p style={{ fontSize: 13.5, color: 'var(--text2)', margin: 0, lineHeight: 1.6 }}>
            This replaces everything currently in LifeOS with the backup from{' '}
            <b>{new Date(restoreTarget.createdTime).toLocaleString()}</b> and restarts the app. Anything you've
            entered since that backup will be lost.
          </p>
        ) : backupsLoading ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            <Loader2 size={18} className="spin" />
          </div>
        ) : backups.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            No backups found in Drive yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {backups.map(f => (
              <button key={f.id} onClick={() => setRestoreTarget(f)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
                  padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg3)',
                  cursor: 'pointer', textAlign: 'left', color: 'var(--text1)', fontSize: 13,
                }}>
                <span>{new Date(f.createdTime).toLocaleString()}</span>
                <span style={{ color: 'var(--text3)', fontSize: 12 }}>{fmtBytes(f.size)}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
