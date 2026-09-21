import { create } from 'zustand'
import { localISO, addDaysISO } from '../lib/dates'

// Local calendar dates — toISOString() would give the UTC date, which is
// yesterday for the first hours of every day in UTC+ zones (e.g. Tanzania).
function todayISO() { return localISO() }
function daysAgoISO(n) { return addDaysISO(localISO(), -n) }

export const useHabitsStore = create((set, get) => ({
  habits: [], // each habit row includes a `streak` field computed server-side from full history
  logsByHabit: {}, // { [habitId]: Set of 'YYYY-MM-DD' done dates, last 30 days — powers the heatmap only }
  loaded: false,

  load: async () => {
    const habits = await window.api.habits.getAll()
    const from = daysAgoISO(29)
    const to = todayISO()
    const logsByHabit = {}
    for (const h of habits) {
      const logs = await window.api.habits.getLogs(h.id, from, to)
      logsByHabit[h.id] = new Set(logs.map(l => l.date))
    }
    set({ habits, logsByHabit, loaded: true })
  },
  create: async (data) => { await window.api.habits.create(data); await get().load() },
  update: async (id, data) => { await window.api.habits.update(id, data); await get().load() },
  archive: async (id) => { await window.api.habits.archive(id); await get().load() },
  unarchive: async (id) => { await window.api.habits.unarchive(id); await get().load() },
  remove: async (id) => { await window.api.habits.delete(id); await get().load() },
  toggleToday: async (habitId) => {
    await window.api.habits.toggleLog(habitId, todayISO())
    await get().load()
  },
  // Sourced from the backend, which walks the habit's FULL log history —
  // stays correct indefinitely instead of capping out around 30 days.
  streakFor: (habitId) => {
    const h = get().habits.find(x => x.id === habitId)
    return h ? h.streak : 0
  },
}))
