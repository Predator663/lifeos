// src/lib/fileSrc.js — one place that turns a stored attachment/avatar
// path into something an <img src> can load.
//
// Desktop behaviour is unchanged: `file://` + the absolute Windows path
// that electron/main.cjs stored. On Android the database holds a path
// relative to the app's private data directory (see src/native/files.js),
// which has to go through Capacitor's local-file bridge.
//
// Returns null when the file cannot exist on this device — for example an
// attachment row copied over from the PC database, whose `C:\Users\...`
// path means nothing on a phone. Callers render a
// "file not available on this device" placeholder instead of a broken
// image.

export function isNative() {
  return typeof window !== 'undefined' && !!window.__lifeosNative
}

export function fileSrc(path, cacheBust) {
  if (!path) return null
  const suffix = cacheBust ? `?t=${encodeURIComponent(cacheBust)}` : ''

  if (!isNative()) return `file://${path}${suffix}`

  const rel = String(path)
  const managed = rel.startsWith('attachments/') || rel.startsWith('avatar/')
  const base = window.__lifeosDataDir
  if (!managed || !base) return null

  const convert = window.Capacitor?.convertFileSrc
  const abs = `${base}/${rel}`
  return `${convert ? convert(abs) : abs}${suffix}`
}
