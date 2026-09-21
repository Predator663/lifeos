import { create } from 'zustand'

const emptyStatus = {
  enabled: false, connected: false, calendarGranted: false, needsReconnect: false,
  pending: 0, lastSentAt: null, lastError: '', quietEnabled: false, quietStart: '22:00', quietEnd: '07:00',
}

// Mirrors db.cjs phone.getStatus() — no tokens or IDs, just what the UI needs.
export const usePhoneStore = create((set, get) => ({
  status: emptyStatus,
  loaded: false,

  load: async () => {
    const status = await window.api.phone.getStatus()
    set({ status, loaded: true })
  },
  setEnabled: async (on) => { const status = await window.api.phone.setEnabled(on); set({ status }) },
  setQuiet: async (data) => { const status = await window.api.phone.setQuiet(data); set({ status }) },
  sendTest: async () => { const r = await window.api.phone.sendTest(); await get().load(); return r },
}))
