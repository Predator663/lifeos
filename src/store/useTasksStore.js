import { create } from 'zustand'

export const useTasksStore = create((set, get) => ({
  tasks: [],
  loaded: false,

  load: async () => {
    const tasks = await window.api.tasks.getAll()
    set({ tasks, loaded: true })
  },
  create: async (data) => { await window.api.tasks.create(data); await get().load() },
  update: async (id, data) => { await window.api.tasks.update(id, data); await get().load() },
  toggle: async (id) => {
    // optimistic flip for an instant feel, then reconcile with the DB
    set(s => ({ tasks: s.tasks.map(t => t.id === id ? { ...t, status: t.status === 'done' ? 'pending' : 'done' } : t) }))
    const result = await window.api.tasks.toggle(id)
    await get().load()
    return result // { task, nextTask } — nextTask is set when a recurring task just spawned its next occurrence
  },
  remove: async (id) => { await window.api.tasks.delete(id); await get().load() },
}))
