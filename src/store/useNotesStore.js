import { create } from 'zustand'

export const useNotesStore = create((set, get) => ({
  notes: [],
  loaded: false,

  load: async () => {
    const notes = await window.api.notes.getAll()
    set({ notes, loaded: true })
  },
  create: async (data) => { const n = await window.api.notes.create(data); await get().load(); return n },
  update: async (id, data) => { await window.api.notes.update(id, data); await get().load() },
  remove: async (id) => { await window.api.notes.delete(id); await get().load() },
}))
