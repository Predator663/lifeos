import { create } from 'zustand'

// Tracks only whether an Anthropic key is set and which model to use —
// the actual key never leaves the main process (see electron/ai.cjs),
// so it's never held in this renderer-side store.
export const useAiStore = create((set, get) => ({
  settings: { has_key: false, model: 'claude-sonnet-5' },
  loaded: false,

  load: async () => {
    const settings = await window.api.ai.getSettings()
    set({ settings, loaded: true })
  },
  save: async (data) => {
    const settings = await window.api.ai.saveSettings(data)
    set({ settings })
    return settings
  },
  clearKey: async () => {
    const settings = await window.api.ai.clearKey()
    set({ settings })
    return settings
  },
}))
