import { create } from 'zustand'

const emptySummary = { totalSaved: 0, activeCount: 0, achievedCount: 0, activeTarget: 0, activeSaved: 0, savedThisMonth: 0, monthly: [] }

export const useSavingsStore = create((set, get) => ({
  goals: [],
  summary: emptySummary,
  loaded: false,

  load: async () => {
    const [goals, summary] = await Promise.all([window.api.savings.getAll(), window.api.savings.summary()])
    set({ goals, summary, loaded: true })
  },
  // These return the { ok, error } result so the page can toast validation messages.
  createGoal: async (data) => { const r = await window.api.savings.createGoal(data); await get().load(); return r },
  updateGoal: async (id, data) => { const r = await window.api.savings.updateGoal(id, data); await get().load(); return r },
  archiveGoal: async (id) => { await window.api.savings.archiveGoal(id); await get().load() },
  unarchiveGoal: async (id) => { await window.api.savings.unarchiveGoal(id); await get().load() },
  removeGoal: async (id) => { await window.api.savings.deleteGoal(id); await get().load() },
  // amount is signed: positive = deposit, negative = withdrawal.
  // Resolves to { ok, goal, milestone } — milestone is 25/50/75/100 when this entry just crossed one.
  addEntry: async (goalId, data) => { const r = await window.api.savings.addEntry(goalId, data); await get().load(); return r },
  removeEntry: async (id) => { const r = await window.api.savings.deleteEntry(id); await get().load(); return r },
  // Not cached: fetched fresh when a goal's history is expanded.
  getEntries: (goalId) => window.api.savings.getEntries(goalId),
}))
