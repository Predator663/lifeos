import { create } from 'zustand'

export const useEventsStore = create((set, get) => ({
  events: [],
  loaded: false,

  load: async () => {
    const events = await window.api.events.getAll()
    set({ events, loaded: true })
  },
  create: async (data) => { await window.api.events.create(data); await get().load() },
  update: async (id, data) => { await window.api.events.update(id, data); await get().load() },
  remove: async (id) => { await window.api.events.delete(id); await get().load() },
}))
