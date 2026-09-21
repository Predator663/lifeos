// src/native/sqlite.js — a small, synchronous better-sqlite3-compatible
// facade over sql.js (SQLite compiled to WebAssembly).
//
// Why this exists: electron/db.cjs is ~1200 lines of synchronous
// better-sqlite3 code that is the single source of truth for every
// business rule in LifeOS. Rewriting it against an async mobile SQLite
// plugin would mean re-deriving all of that logic and re-introducing
// every bug it has already had fixed. Instead the Android port keeps the
// logic byte-for-byte and swaps the driver underneath it: sql.js is
// synchronous once its WASM module is loaded, so `db.prepare(sql).get(id)`
// behaves exactly as it does on the desktop.
//
// What is deliberately NOT emulated: better-sqlite3's BigInt handling
// (LifeOS never stores values beyond Number.MAX_SAFE_INTEGER), its
// user-defined functions, and WAL mode (sql.js holds the whole database
// in memory and has no journal files at all — see pragma() below).

// better-sqlite3 rejects `undefined` and booleans as bound values; sql.js
// simply misbehaves. Normalising here means the ported logic can keep
// passing `d.due_date || null` and `x ? 1 : 0` exactly as it does today.
function coerce(v) {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'bigint') return Number(v)
  return v
}

// Accepts every shape better-sqlite3 does: varargs (`run(a, b, c)`), a
// single array, or a named-parameter object. sql.js requires named keys
// to carry their sigil, so `{ title: 'x' }` becomes `{ '@title': 'x' }` —
// matching the `@name` placeholders used throughout db.js.
function normalizeParams(args) {
  if (args.length === 0) return null
  if (args.length === 1) {
    const a = args[0]
    if (Array.isArray(a)) return a.map(coerce)
    if (a !== null && typeof a === 'object' && !(a instanceof Uint8Array)) {
      const out = {}
      for (const key of Object.keys(a)) out['@' + key] = coerce(a[key])
      return out
    }
  }
  return args.map(coerce)
}

class Statement {
  constructor(db, sql) {
    this._db = db
    this._sql = sql
  }

  // sql.js prepared statements are reusable but are invalidated by schema
  // changes, so the owning Database drops its cache whenever DDL runs.
  _stmt() {
    let s = this._db._cache.get(this._sql)
    if (!s) {
      s = this._db._raw.prepare(this._sql)
      this._db._cache.set(this._sql, s)
    }
    s.reset()
    return s
  }

  // Order matters: both counters are read BEFORE the write hook fires.
  // The hook can trigger a save, and sql.js's export() closes and reopens
  // the connection underneath us — which resets last_insert_rowid() to 0.
  run(...args) {
    const s = this._stmt()
    const params = normalizeParams(args)
    if (params) s.bind(params)
    s.step()
    s.reset()
    const result = {
      changes: this._db._raw.getRowsModified(),
      lastInsertRowid: this._db._lastInsertRowid(),
    }
    this._db._touch()
    return result
  }

  get(...args) {
    const s = this._stmt()
    const params = normalizeParams(args)
    if (params) s.bind(params)
    const row = s.step() ? s.getAsObject() : undefined
    s.reset()
    return row
  }

  all(...args) {
    const s = this._stmt()
    const params = normalizeParams(args)
    if (params) s.bind(params)
    const rows = []
    while (s.step()) rows.push(s.getAsObject())
    s.reset()
    return rows
  }
}

export class Database {
  constructor(rawDb, { onWrite } = {}) {
    this._raw = rawDb
    this._cache = new Map()
    this._onWrite = onWrite || (() => {})
    this._txDepth = 0
    this._dirty = false
    this._pragmas = []   // re-applied after export(), which reopens the handle
  }

  // Writes inside a transaction are only reported once, on commit —
  // persisting a half-applied transaction would defeat the point of it.
  _touch() {
    if (this._txDepth > 0) { this._dirty = true; return }
    this._onWrite()
  }

  _lastInsertRowid() {
    const s = this._raw.prepare('SELECT last_insert_rowid() AS id')
    try {
      s.step()
      return s.getAsObject().id
    } finally {
      s.free()
    }
  }

  prepare(sql) {
    return new Statement(this, sql)
  }

  // Schema statements go through here. Cached prepared statements can
  // still reference the old table shape after an ALTER TABLE, so the
  // cache is dropped rather than risk serving stale columns.
  exec(sql) {
    this._freeCache()
    this._raw.run(sql)
    this._touch()
    return this
  }

  // journal_mode is meaningless for sql.js — the database is an in-memory
  // buffer that gets serialised to one file, with no -wal/-shm sidecars —
  // so it is accepted and ignored. foreign_keys is applied for real,
  // because ON DELETE CASCADE is load-bearing (subtasks, habit_logs,
  // savings_entries, debt_payments).
  pragma(statement) {
    const text = String(statement).trim()
    if (/^journal_mode/i.test(text)) return null
    this._raw.run(`PRAGMA ${text}`)
    if (!this._pragmas.includes(text)) this._pragmas.push(text)
    return null
  }

  // Mirrors better-sqlite3's db.transaction(fn): returns a callable that
  // runs fn inside BEGIN/COMMIT and rolls back if it throws, forwarding
  // arguments and the return value. Nested calls use SAVEPOINTs so an
  // inner transaction can't commit an outer one early.
  transaction(fn) {
    const self = this
    return function (...args) {
      const depth = self._txDepth
      const name = `lifeos_sp_${depth}`
      self._raw.run(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`)
      self._txDepth++
      try {
        const result = fn.apply(this, args)
        self._txDepth--
        self._raw.run(depth === 0 ? 'COMMIT' : `RELEASE ${name}`)
        if (self._txDepth === 0 && self._dirty) { self._dirty = false; self._onWrite() }
        return result
      } catch (e) {
        self._txDepth--
        try {
          self._raw.run(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}`)
          if (depth !== 0) self._raw.run(`RELEASE ${name}`)
        } catch (_) { /* the outer handler reports the original failure */ }
        if (self._txDepth === 0) self._dirty = false
        throw e
      }
    }
  }

  // The full database as bytes — the exact contents of a lifeos.db file,
  // so an export can be opened by the desktop app and vice versa.
  //
  // sql.js implements export() by freeing every live statement, CLOSING
  // the database handle, reading the file out of its virtual filesystem
  // and reopening. Two consequences have to be handled here or the app
  // breaks quietly the first time it saves:
  //   - every cached prepared statement is now dangling ("Statement
  //     closed" on next use), so the cache is dropped;
  //   - connection-scoped PRAGMAs are back at their defaults, so
  //     foreign_keys reverts to OFF and ON DELETE CASCADE silently stops
  //     working. They are re-applied against the fresh handle.
  export() {
    this._freeCache()
    const bytes = this._raw.export()
    for (const p of this._pragmas) this._raw.run(`PRAGMA ${p}`)
    return bytes
  }

  _freeCache() {
    for (const s of this._cache.values()) {
      try { s.free() } catch (_) { /* already freed */ }
    }
    this._cache.clear()
  }

  close() {
    this._freeCache()
    this._raw.close()
  }
}

// Opens a database from existing bytes, or creates an empty one.
// `SQL` is an initialised sql.js module (see loadSqlJs below).
export function openDatabase(SQL, bytes, options) {
  const raw = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database()
  return new Database(raw, options)
}

// Loads and initialises the sql.js WASM module. The browser build resolves
// sql-wasm.wasm from the app's own bundle (emitted by Vite from the
// ?url import in src/native/index.js), never from a CDN —
// LifeOS is offline-first and the page CSP blocks remote script anyway.
let sqlPromise = null
export function loadSqlJs(initSqlJs, locateFile) {
  if (!sqlPromise) sqlPromise = initSqlJs(locateFile ? { locateFile } : undefined)
  return sqlPromise
}
