import { create } from 'zustand'

export const useProfileStore = create((set, get) => ({
  profile: null,
  loaded: false,

  load: async () => {
    const profile = await window.api.profile.get()
    set({ profile, loaded: true })
  },
  update: async (data) => { await window.api.profile.update(data); await get().load() },
  // Returns the picker result directly (or null if cancelled) so the caller
  // can show feedback immediately, in addition to the store reconciling.
  uploadAvatar: async () => {
    const result = await window.api.profile.pickAvatar()
    if (result) set({ profile: result })
    return result
  },
  setPin: async (pin) => { await window.api.profile.setPin(pin); await get().load() },
  clearPin: async () => { await window.api.profile.clearPin(); await get().load() },
  verifyPin: (pin) => window.api.profile.verifyPin(pin),
}))
