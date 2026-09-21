import { create } from 'zustand'

const emptySummary = {
  owedToMe: 0, owedToMeCount: 0, iOwe: 0, iOweCount: 0, net: 0,
  overdueCount: 0, overdueOwedToMe: 0, overdueIOwe: 0, dueSoonCount: 0, people: [],
}

export const useDebtsStore = create((set, get) => ({
  debts: [],
  summary: emptySummary,
  loaded: false,

  load: async () => {
    const [debts, summary] = await Promise.all([window.api.debts.getAll(), window.api.debts.summary()])
    set({ debts, summary, loaded: true })
  },
  // All return { ok, error? } so the page can toast validation messages.
  create: async (data) => { const r = await window.api.debts.create(data); await get().load(); return r },
  update: async (id, data) => { const r = await window.api.debts.update(id, data); await get().load(); return r },
  remove: async (id) => { await window.api.debts.delete(id); await get().load() },
  addPayment: async (id, data) => { const r = await window.api.debts.addPayment(id, data); await get().load(); return r },
  settle: async (id, data) => { const r = await window.api.debts.settle(id, data); await get().load(); return r },
  removePayment: async (paymentId) => { const r = await window.api.debts.deletePayment(paymentId); await get().load(); return r },
  // Not cached: fetched fresh when a debt's payment history is expanded.
  getPayments: (debtId) => window.api.debts.getPayments(debtId),
}))
