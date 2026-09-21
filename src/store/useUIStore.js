import { create } from 'zustand'

let toastId = 0

export const useUIStore = create((set, get) => ({
  page: 'dashboard',
  setPage: (page) => set({ page }),

  // Which tab of the Finance page is showing: 'overview' | 'savings' | 'debts'.
  financeTab: 'overview',
  setFinanceTab: (financeTab) => set({ financeTab }),

  sidebarCollapsed: false,
  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // A stack of the modals currently open, innermost last. Only the
  // Android hardware back button reads this (App.jsx): pressing back
  // should close the top sheet rather than leave the page under it.
  // Modal.jsx pushes and pops itself, so nothing else has to remember.
  modalStack: [],
  pushModal: (entry) => set(s => ({ modalStack: [...s.modalStack, entry] })),
  popModal: (token) => set(s => ({ modalStack: s.modalStack.filter(m => m.token !== token) })),
  closeTopModal: () => {
    const stack = get().modalStack
    const top = stack[stack.length - 1]
    if (!top) return false
    try { top.onClose?.() } catch { /* a modal that refuses to close is not fatal */ }
    return true
  },

  toasts: [],
  pushToast: (message, kind = 'info') => {
    const id = ++toastId
    set(s => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => get().dismissToast(id), 4000)
  },
  dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))
