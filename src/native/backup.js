// src/native/backup.js — Settings -> Backup & transfer.
//
// This is the only way data moves between the PC build and the phone, so
// it has to be careful: an import REPLACES everything on the device.
// Nothing is touched until the incoming bytes have been opened as a real
// SQLite database and checked for the tables LifeOS expects, so picking
// the wrong file fails loudly instead of wiping the phone.
//
// Deliberately not a sync: two copies of lifeos.db that are both being
// edited cannot be merged by a file copy, and the UI says so plainly.
import { Filesystem, Directory } from '@capacitor/filesystem'
import { FilePicker } from '@capawesome/capacitor-file-picker'
import { bytesToBase64, base64ToBytes } from './storage.js'
import { shareFile } from './files.js'
import { localISO } from '../lib/dates.js'

const EXPORT_DIR = 'exports'

// Every table the app reads. A file missing any of these is not a LifeOS
// database (or is so old it predates the tables), and importing it would
// leave the UI throwing on first render.
const REQUIRED_TABLES = [
  'tasks', 'events', 'transactions', 'accounts', 'savings_goals',
  'debts', 'habits', 'notes', 'profile',
]

// "SQLite format 3\0"
const SQLITE_MAGIC = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00]

export function looksLikeSqlite(bytes) {
  if (!bytes || bytes.length < 100) return false
  return SQLITE_MAGIC.every((b, i) => bytes[i] === b)
}

// Opens the candidate in a throwaway sql.js database so a corrupt or
// unrelated file is rejected before the live one is closed.
export function validateDatabase(SQL, bytes) {
  if (!looksLikeSqlite(bytes)) {
    return { ok: false, error: 'That file is not a SQLite database.' }
  }
  let probe
  try {
    probe = new SQL.Database(bytes)
    const res = probe.exec("SELECT name FROM sqlite_master WHERE type='table'")
    const names = new Set((res[0]?.values || []).map(r => String(r[0])))
    const missing = REQUIRED_TABLES.filter(t => !names.has(t))
    if (missing.length) {
      return { ok: false, error: `This does not look like a LifeOS database (missing: ${missing.slice(0, 3).join(', ')}).` }
    }
    const counts = {}
    for (const t of ['tasks', 'transactions', 'notes', 'debts']) {
      try { counts[t] = probe.exec(`SELECT COUNT(*) FROM ${t}`)[0].values[0][0] } catch { counts[t] = 0 }
    }
    return { ok: true, counts }
  } catch (e) {
    return { ok: false, error: `Could not read that file: ${e.message}` }
  } finally {
    try { probe?.close() } catch { /* ignore */ }
  }
}

// Writes the current database out and hands it to the Android share
// sheet — Drive, Gmail, a USB transfer, whatever the user prefers.
export async function exportDatabase(bytes) {
  const name = `LifeOS-backup-${localISO()}.db`
  const rel = `${EXPORT_DIR}/${name}`
  await Filesystem.writeFile({
    path: rel, data: bytesToBase64(bytes),
    directory: Directory.Data, recursive: true,
  })
  await shareFile(rel, 'LifeOS database backup')
  return { path: rel, name, size: bytes.length }
}

// Picks a file and returns its bytes. Returns null when the user backs
// out of the picker. No `.db` MIME filter: Android file providers report
// application/octet-stream, application/x-sqlite3 or nothing at all
// depending on where the file came from, and filtering hides valid files.
export async function pickDatabaseFile() {
  let res
  try { res = await FilePicker.pickFiles({ limit: 1, readData: true }) }
  catch { return null }
  const f = res?.files?.[0]
  if (!f) return null
  if (f.data) return { name: f.name, bytes: base64ToBytes(f.data) }
  if (f.path) {
    const read = await Filesystem.readFile({ path: f.path })
    return { name: f.name, bytes: base64ToBytes(read.data) }
  }
  return null
}
