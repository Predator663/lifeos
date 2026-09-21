import { create } from 'zustand'

// Mirrors db.cjs's profile.getDriveStatus() — a sanitized view with no
// client secret or tokens, which never leave the main process (see
// electron/drive.cjs and the drive:* IPC handlers in main.cjs).
const emptyStatus = { hasCredentials: false, connected: false, autoBackup: false, frequencyHours: 24, lastBackupAt: null }

export const useDriveStore = create((set, get) => ({
  status: emptyStatus,
  loaded: false,

  load: async () => {
    const status = await window.api.drive.getStatus()
    set({ status, loaded: true })
  },
  saveCredentials: async (data) => { await window.api.drive.saveCredentials(data); await get().load() },
  connect: async () => {
    const r = await window.api.drive.connect()
    await get().load()
    return r
  },
  disconnect: async () => { await window.api.drive.disconnect(); await get().load() },
  setAutoBackup: async (data) => { await window.api.drive.setAutoBackup(data); await get().load() },
  backupNow: async () => {
    const r = await window.api.drive.backupNow()
    await get().load()
    return r
  },
  // Not cached in the store — always fetched fresh when the restore
  // modal opens, since the point is to see what's actually in Drive.
  listBackups: () => window.api.drive.listBackups(),
  restore: (fileId) => window.api.drive.restore(fileId),
}))
