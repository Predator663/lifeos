// src/lib/haptics.js — thin wrapper around @capacitor/haptics.
//
// A no-op everywhere it can't work: on the Electron desktop build (no
// haptics hardware), on a phone that denies the vibration permission, and
// before the plugin has finished loading. A missed tap of feedback is
// never worth surfacing as an error, so every call swallows its own
// failures rather than asking the caller to handle them.
const isNative = !!(typeof window !== 'undefined' && window.api?.android?.isNative)

let modPromise = null
function getHaptics() {
  if (!isNative) return Promise.resolve(null)
  if (!modPromise) modPromise = import('@capacitor/haptics').catch(() => null)
  return modPromise
}

// Light tick — routine taps: switching tabs, toggling a switch, picking
// an item from a list.
export async function hapticLight() {
  const h = await getHaptics()
  try { await h?.Haptics.impact({ style: h.ImpactStyle.Light }) } catch { /* no haptics hardware */ }
}

// Firmer thump — a completed, positive action: saved, marked done, sent.
export async function hapticSuccess() {
  const h = await getHaptics()
  try { await h?.Haptics.notification({ type: h.NotificationType.Success }) } catch { /* ignore */ }
}

// Sharper double-buzz — something destructive or irreversible: delete,
// archive, replace-the-database style confirmations.
export async function hapticWarning() {
  const h = await getHaptics()
  try { await h?.Haptics.notification({ type: h.NotificationType.Warning }) } catch { /* ignore */ }
}
