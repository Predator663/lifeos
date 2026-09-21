import { create } from 'zustand'

export const useFinanceStore = create((set, get) => ({
  transactions: [],
  summary: { income: 0, expense: 0, balance: 0, byCategory: [], last30: [] },
  budgets: [],
  recurring: [],
  accounts: [],
  categories: [],
  loaded: false,

  load: async () => {
    const [transactions, summary, budgets, recurring, accounts, categories] = await Promise.all([
      window.api.finance.getAll(),
      window.api.finance.summary(),
      window.api.finance.getBudgets(),
      window.api.finance.getRecurring(),
      window.api.accounts.getAll(),
      window.api.finance.getCategories(),
    ])
    set({ transactions, summary, budgets, recurring, accounts, categories, loaded: true })
  },
  create: async (data) => { await window.api.finance.create(data); await get().load() },
  remove: async (id) => { await window.api.finance.delete(id); await get().load() },

  // ── Categories ───────────────────────────────────────────────────────
  createCategory: async (name) => {
    const r = await window.api.finance.createCategory(name)
    if (r.ok) await get().load()
    return r
  },
  renameCategory: async (oldName, newName) => {
    const r = await window.api.finance.renameCategory(oldName, newName)
    if (r.ok) await get().load()
    return r
  },
  deleteCategory: async (name) => {
    const r = await window.api.finance.deleteCategory(name)
    if (r.ok) await get().load()
    return r
  },
  reorderCategories: async (names) => {
    set({ categories: names })   // optimistic — the drag should not visibly snap back
    await window.api.finance.reorderCategories(names)
  },

  setBudget: async (category, limit) => { await window.api.finance.setBudget(category, limit); await get().load() },
  deleteBudget: async (category) => { await window.api.finance.deleteBudget(category); await get().load() },

  createRecurring: async (data) => { await window.api.finance.createRecurring(data); await get().load() },
  toggleRecurring: async (id) => { await window.api.finance.toggleRecurring(id); await get().load() },
  removeRecurring: async (id) => { await window.api.finance.deleteRecurring(id); await get().load() },

  // ── Accounts ──────────────────────────────────────────────────────────
  createAccount: async (data) => { await window.api.accounts.create(data); await get().load() },
  updateAccount: async (id, data) => { await window.api.accounts.update(id, data); await get().load() },
  archiveAccount: async (id) => { await window.api.accounts.archive(id); await get().load() },
  unarchiveAccount: async (id) => { await window.api.accounts.unarchive(id); await get().load() },
  deleteAccount: async (id) => {
    const r = await window.api.accounts.delete(id)
    await get().load()
    return r
  },
  createTransfer: async (data) => {
    const r = await window.api.finance.createTransfer(data)
    await get().load()
    return r
  },
}))
