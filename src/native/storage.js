// src/native/storage.js — where lifeos.db actually lives on the phone.
//
// sql.js keeps the whole database in memory, so unlike better-sqlite3 on
// the desktop nothing reaches disk on its own: every write has to be
// serialised and written out by us. Two rules make that safe:
//
//   1. Debounce (~300ms). A single user action can be a dozen statements
//      (a debt payment writes a payment row, a transaction row and a
//      status update). Serialising once at the end of the burst keeps
//      saves off the critical path without risking much.
//   2. Temp file, then rename. Android can kill the process at any moment.
//      Writing straight over lifeos.db means a kill mid-write leaves a
//      truncated, unopenable database; writing lifeos.db.tmp and renaming
//      it means the old file stays intact until the new one is complete.
//
// The debounce is why flush() exists and why bridge.js calls it on
// appStateChange/visibilitychange — see STEP 5 of ANDROID.md.
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'

export const DB_FILENAME = 'lifeos.db'
const TMP_FILENAME = 'lifeos.db.tmp'
const SAVE_DEBOUNCE_MS = 300

// btoa() on a megabyte-plus string built with String.fromCharCode(...bytes)
// blows the argument limit, so the conversion is chunked.
export function bytesToBase64(bytes) {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(b64) {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function createCapacitorStorage(SQL) {
  let exporter = null
  let timer = null
  let writing = null      // the in-flight save, so flush() can await it
  let pending = false

  async function writeBytes(bytes) {
    const data = bytesToBase64(bytes)
    await Filesystem.writeFile({ path: TMP_FILENAME, data, directory: Directory.Data, recursive: true })
    // rename() overwrites the destination, which is what makes the swap
    // atomic from the app's point of view.
    await Filesystem.rename({
      from: TMP_FILENAME, to: DB_FILENAME,
      directory: Directory.Data, toDirectory: Directory.Data,
    })
  }

  async function doSave() {
    if (!exporter) return
    pending = false
    const bytes = exporter()
    writing = writeBytes(bytes)
    try {
      await writing
    } catch (e) {
      // Non-fatal: the in-memory database is still correct and the next
      // write (or the pause flush) will retry. Losing the save silently
      // would be worse than a console entry the user can be asked for.
      console.error('LifeOS: could not save the database —', e.message)
    } finally {
      writing = null
    }
  }

  return {
    SQL,

    attach(fn) { exporter = fn },

    async load() {
      try {
        const res = await Filesystem.readFile({ path: DB_FILENAME, directory: Directory.Data })
        return base64ToBytes(res.data)
      } catch (_) {
        // First ever launch (or the file was cleared): db.js creates the
        // schema from scratch when it gets null.
        return null
      }
    },

    markDirty() {
      pending = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; doSave() }, SAVE_DEBOUNCE_MS)
    },

    // Writes immediately, skipping the debounce — used when Android
    // backgrounds the app, when the database is replaced by an import,
    // and by Settings -> Export database.
    async saveNow(bytes) {
      if (timer) { clearTimeout(timer); timer = null }
      pending = false
      await writeBytes(bytes)
    },

    async flush(getBytes) {
      if (timer) { clearTimeout(timer); timer = null }
      if (writing) await writing
      if (!pending) return
      pending = false
      await writeBytes(getBytes())
    },
  }
}

// Reads an arbitrary file (an imported database picked from storage) as
// bytes. Kept here so bridge.js has one place to go for filesystem work.
export async function readFileBytes(path) {
  const res = await Filesystem.readFile({ path })
  return base64ToBytes(res.data)
}

export async function writeDataFile(path, bytes) {
  await Filesystem.writeFile({
    path, data: bytesToBase64(bytes), directory: Directory.Data, recursive: true,
  })
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data })
  return uri
}

export async function writeDataText(path, text) {
  await Filesystem.writeFile({
    path, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true,
  })
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data })
  return uri
}
