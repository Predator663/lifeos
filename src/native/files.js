// src/native/files.js — attachments and the profile avatar on Android.
//
// Desktop LifeOS stores the ORIGINAL absolute Windows path of an
// attachment and just points at it (`file://C:\Users\...`). Android has no
// such stable, readable path: the file picker hands back a cache copy or
// a content:// URI that stops resolving once the app restarts. So here
// every chosen file is COPIED into the app's own private storage
// (Directory.Data/attachments, Directory.Data/avatar) and the database
// stores a RELATIVE path like `attachments/1735689600000-receipt.jpg`.
//
// Relative rather than absolute on purpose: the absolute path contains
// the Android user id (/data/user/0/...), which can change between
// installs or on a multi-user device. Resolving it at render time from
// the current Data directory keeps old rows working.
//
// A row whose file_path is NOT one of ours — e.g. `C:\Users\Bert\...`
// from a database imported off the PC — is reported as missing rather
// than crashing the page. See src/lib/fileSrc.js.
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { FilePicker } from '@capawesome/capacitor-file-picker'

export const ATTACH_DIR = 'attachments'
export const AVATAR_DIR = 'avatar'

// Absolute file:// URI of Directory.Data, resolved once at startup so
// fileSrc() can stay synchronous (the renderer calls it inside render).
let dataDirUri = ''

export function getDataDirUri() { return dataDirUri }

export async function initFiles() {
  for (const dir of [ATTACH_DIR, AVATAR_DIR]) {
    try { await Filesystem.mkdir({ path: dir, directory: Directory.Data, recursive: true }) }
    catch { /* already exists */ }
  }
  const { uri } = await Filesystem.getUri({ path: '', directory: Directory.Data })
  dataDirUri = uri.replace(/\/+$/, '')
  // Published to the window so src/lib/fileSrc.js (shared with the
  // desktop build) can resolve paths without importing Capacitor.
  window.__lifeosDataDir = dataDirUri
  return dataDirUri
}

// A sanitised, collision-proof file name. Keeps the original extension
// so the Share sheet offers sensible apps.
function safeName(name) {
  const clean = String(name || 'file').replace(/[^\w.\-]+/g, '_').slice(-60)
  return `${Date.now()}-${clean}`
}

function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(String(name || ''))
  return m ? `.${m[1].toLowerCase()}` : '.png'
}

// FilePicker returns either a readable `path` (Android file path) or, for
// content:// sources, base64 `data` when readData is true. Ask for the
// data so a copy always succeeds.
async function pickOne({ images = false } = {}) {
  const res = images
    ? await FilePicker.pickImages({ limit: 1, readData: true })
    : await FilePicker.pickFiles({ limit: 1, readData: true })
  const f = res?.files?.[0]
  return f || null
}

async function copyInto(dir, picked, forcedName) {
  const name = forcedName || safeName(picked.name)
  const rel = `${dir}/${name}`
  if (picked.data) {
    await Filesystem.writeFile({ path: rel, data: picked.data, directory: Directory.Data, recursive: true })
  } else if (picked.path) {
    const src = await Filesystem.readFile({ path: picked.path })
    await Filesystem.writeFile({ path: rel, data: src.data, directory: Directory.Data, recursive: true })
  } else {
    throw new Error('Could not read the selected file.')
  }
  return rel
}

// Mirrors attachments:pick on desktop: returns a path or null if the user
// cancelled. The returned path is already a copy inside app storage, so
// attachments:add can store it verbatim.
export async function pickAttachment() {
  let picked
  try { picked = await pickOne({ images: false }) }
  catch { return null }              // user dismissed the picker
  if (!picked) return null
  return await copyInto(ATTACH_DIR, picked)
}

export async function pickAvatarFile() {
  let picked
  try { picked = await pickOne({ images: true }) }
  catch { return null }
  if (!picked) return null
  // One fixed name per extension, same as the desktop handler, and old
  // avatars with a different extension are cleaned up by the caller.
  return await copyInto(AVATAR_DIR, picked, `avatar${extOf(picked.name)}`)
}

export function isManagedPath(p) {
  const s = String(p || '')
  return s.startsWith(`${ATTACH_DIR}/`) || s.startsWith(`${AVATAR_DIR}/`)
}

export async function exists(relPath) {
  if (!isManagedPath(relPath)) return false
  try {
    await Filesystem.stat({ path: relPath, directory: Directory.Data })
    return true
  } catch { return false }
}

export async function removeFile(relPath) {
  if (!isManagedPath(relPath)) return
  try { await Filesystem.deleteFile({ path: relPath, directory: Directory.Data }) }
  catch { /* already gone — not fatal */ }
}

// Desktop "open in folder" has no Android equivalent; the Share sheet is
// the closest thing — it lets the user open the file in a gallery, a PDF
// viewer, or send it on.
export async function shareFile(relPath, title = 'LifeOS') {
  if (!isManagedPath(relPath)) throw new Error('This file is not stored on this device.')
  const { uri } = await Filesystem.getUri({ path: relPath, directory: Directory.Data })
  await Share.share({ title, url: uri })
}

// Writes text (the report HTML) into app storage and shares it.
export async function shareText(relPath, text, { title = 'LifeOS', mime } = {}) {
  await Filesystem.writeFile({
    path: relPath, data: text, directory: Directory.Data,
    encoding: Encoding.UTF8, recursive: true,
  })
  const { uri } = await Filesystem.getUri({ path: relPath, directory: Directory.Data })
  await Share.share({ title, url: uri, dialogTitle: title })
  return { path: relPath, uri }
}

export function toWebSrc(relPath) {
  if (!isManagedPath(relPath) || !dataDirUri) return null
  return Capacitor.convertFileSrc(`${dataDirUri}/${relPath}`)
}
