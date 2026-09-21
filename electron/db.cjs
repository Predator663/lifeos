// electron/db.cjs — local-first storage. One SQLite file living in the
// user's OS app-data folder, so data survives updates/reinstalls and
// there is no server, no network call, and no "loading" state for any
// read — everything is synchronous and effectively instant.
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const Database = require('better-sqlite3')
const { app } = require('electron')
const { localISO, parseISO, addDaysISO, daysBetween, monthStartISO } = require('./dates.cjs')

let db = null

// Google OAuth scopes (mirrors electron/drive.cjs) — used to read back what
// the user actually granted from the stored `google_scope` string.
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive']
const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar']
function hasScope(granted, wanted) {
  const have = String(granted || '').split(/\s+/)
  return wanted.some(w => have.includes(w))
}

function init() {
  const dir = app.getPath('userData')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const dbPath = path.join(dir, 'lifeos.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      due_date TEXT,
      due_time TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'pending',
      tags TEXT DEFAULT '[]',
      recurring TEXT DEFAULT 'none',
      notified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      start_at TEXT NOT NULL,
      end_at TEXT,
      location TEXT DEFAULT '',
      color TEXT DEFAULT '#e8500a',
      reminder_minutes_before INTEGER DEFAULT 10,
      notified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,          -- 'income' | 'expense' | 'transfer'
      amount REAL NOT NULL,
      category TEXT DEFAULT 'General',
      note TEXT DEFAULT '',
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'bank',        -- 'bank' | 'cash' | 'mobile_money' | 'other'
      institution TEXT DEFAULT '',     -- e.g. 'NMB', 'M-Pesa', 'Tigo Pesa'
      color TEXT DEFAULT '#3b82f6',
      opening_balance REAL DEFAULT 0,
      archived INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '✅',
      color TEXT DEFAULT '#22c55e',
      frequency TEXT DEFAULT 'daily',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS habit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      done INTEGER DEFAULT 1,
      UNIQUE(habit_id, date),
      FOREIGN KEY(habit_id) REFERENCES habits(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_type TEXT NOT NULL,   -- 'task' | 'event' | 'note'
      parent_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS budgets (
      category TEXT PRIMARY KEY,
      monthly_limit REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Transaction categories used to be a hardcoded list in the renderer;
    -- this table is what Settings/Finance's category manager edits. The
    -- name IS the identifier (case-insensitively unique) because that's
    -- exactly what transactions.category, budgets.category and
    -- recurring_transactions.category already store — no join needed.
    CREATE TABLE IF NOT EXISTS finance_categories (
      name TEXT PRIMARY KEY COLLATE NOCASE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,          -- 'income' | 'expense'
      amount REAL NOT NULL,
      category TEXT DEFAULT 'General',
      note TEXT DEFAULT '',
      frequency TEXT DEFAULT 'monthly',   -- 'weekly' | 'monthly'
      next_date TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      position INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    -- Savings goals. Money in a goal is EARMARKED, not moved: it stays in
    -- whatever account holds it, and the goal just tracks how much of your
    -- balance is set aside for it. entries.amount is signed (+deposit / -withdrawal).
    CREATE TABLE IF NOT EXISTS savings_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '🎯',
      color TEXT DEFAULT '#22c55e',
      target_amount REAL NOT NULL,
      target_date TEXT,
      account_id INTEGER,              -- optional: the account this money physically sits in
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'active',    -- 'active' | 'achieved'
      archived INTEGER DEFAULT 0,
      last_milestone INTEGER DEFAULT 0, -- highest of 25/50/75/100 already celebrated
      notify_stage INTEGER DEFAULT 0,   -- deadline reminders: 1 = week-before sent, 2 = deadline sent
      achieved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS savings_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(goal_id) REFERENCES savings_goals(id) ON DELETE CASCADE
    );

    -- Debts, both directions. amount = principal; interest = optional flat
    -- extra owed on top. Payments are partial-payment rows.
    CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,          -- 'owed_to_me' | 'i_owe'
      person TEXT NOT NULL,
      phone TEXT DEFAULT '',
      amount REAL NOT NULL,
      interest REAL DEFAULT 0,
      note TEXT DEFAULT '',
      start_date TEXT NOT NULL,
      due_date TEXT,
      status TEXT DEFAULT 'open',       -- 'open' | 'settled'
      settled_at TEXT,
      account_id INTEGER,               -- account the original loan touched (if recorded)
      notify_stage INTEGER DEFAULT 0,   -- 1 = due-soon sent, 2 = due-today sent, 3 = overdue sent
      last_overdue_notified TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS debt_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      debt_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      note TEXT DEFAULT '',
      account_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(debt_id) REFERENCES debts(id) ON DELETE CASCADE
    );

    -- Notifications waiting to be relayed to the phone via Google Calendar
    -- (see electron/phone.cjs). Kept in the DB so nothing is lost while the
    -- PC is offline: they're sent as soon as the internet is back.
    CREATE TABLE IF NOT EXISTS phone_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      created_at TEXT NOT NULL,         -- ISO, UTC
      sent_at TEXT,
      event_id TEXT,
      cleaned INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      dropped INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      avatar_path TEXT,
      pin_hash TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `)
  // Single-row table — make sure that row exists from the very first launch,
  // so the rest of the app can always assume db.profile.get() returns something.
  db.prepare('INSERT OR IGNORE INTO profile (id) VALUES (1)').run()

  // ── Migrations ──────────────────────────────────────────────────────
  // Columns added after initial release. CREATE TABLE IF NOT EXISTS above
  // leaves existing installs' tables untouched, so new columns are added
  // here individually and only if missing — safe to run on every launch.
  ensureColumn('transactions', 'account_id', 'account_id INTEGER')
  ensureColumn('transactions', 'to_account_id', 'to_account_id INTEGER')
  ensureColumn('transactions', 'merchant', "merchant TEXT DEFAULT ''")
  ensureColumn('recurring_transactions', 'account_id', 'account_id INTEGER')
  ensureColumn('profile', 'ai_api_key', "ai_api_key TEXT DEFAULT ''")
  ensureColumn('profile', 'ai_model', "ai_model TEXT DEFAULT 'claude-sonnet-5'")

  // Google Drive backup. client_id/client_secret are the user's own OAuth
  // credentials (see electron/drive.cjs) — refresh_token is the long-lived
  // grant, access_token/token_expires_at are the short-lived token cached
  // between backups so every backup doesn't need a fresh round trip.
  ensureColumn('profile', 'drive_client_id', "drive_client_id TEXT DEFAULT ''")
  ensureColumn('profile', 'drive_client_secret', "drive_client_secret TEXT DEFAULT ''")
  ensureColumn('profile', 'drive_refresh_token', "drive_refresh_token TEXT DEFAULT ''")
  ensureColumn('profile', 'drive_access_token', "drive_access_token TEXT DEFAULT ''")
  ensureColumn('profile', 'drive_token_expires_at', 'drive_token_expires_at INTEGER DEFAULT 0')
  ensureColumn('profile', 'drive_folder_id', "drive_folder_id TEXT DEFAULT ''")
  ensureColumn('profile', 'drive_auto_backup', 'drive_auto_backup INTEGER DEFAULT 0')
  ensureColumn('profile', 'drive_frequency_hours', 'drive_frequency_hours INTEGER DEFAULT 24')
  ensureColumn('profile', 'drive_last_backup_at', 'drive_last_backup_at TEXT')

  // Habits: an optional weekly goal (habits don't all need to be daily —
  // e.g. "gym" might be 3x/week) and an archive flag so a retired habit's
  // history isn't lost, mirroring how Accounts are archived rather than
  // deleted.
  ensureColumn('habits', 'target_per_week', 'target_per_week INTEGER DEFAULT 7')
  ensureColumn('habits', 'archived', 'archived INTEGER DEFAULT 0')
  // 'build' habits (default) are things you're trying to do; 'quit'
  // habits are things you're trying to stop — same table, same log
  // rows, but the rows mean "slipped" instead of "did it" and the
  // streak math below reads them the opposite way.
  ensureColumn('habits', 'kind', "kind TEXT DEFAULT 'build'")

  // Debts can move real money: a loan/repayment recorded against an account
  // is stored as a 'debt_in' / 'debt_out' transaction (never income/expense,
  // so it can't distort spending analytics) and linked back to its debt.
  ensureColumn('transactions', 'debt_id', 'debt_id INTEGER')
  ensureColumn('transactions', 'debt_payment_id', 'debt_payment_id INTEGER')

  // Google connection details shared by Drive backup and phone alerts.
  // google_scope = what Google actually granted (users can untick scopes);
  // google_last_error = 'expired' when Google rejects the refresh token.
  ensureColumn('profile', 'google_scope', "google_scope TEXT DEFAULT ''")
  ensureColumn('profile', 'google_last_error', "google_last_error TEXT DEFAULT ''")
  ensureColumn('profile', 'gcal_calendar_id', "gcal_calendar_id TEXT DEFAULT ''")
  ensureColumn('profile', 'phone_alerts_enabled', 'phone_alerts_enabled INTEGER DEFAULT 0')
  ensureColumn('profile', 'phone_quiet_enabled', 'phone_quiet_enabled INTEGER DEFAULT 0')
  ensureColumn('profile', 'phone_quiet_start', "phone_quiet_start TEXT DEFAULT '22:00'")
  ensureColumn('profile', 'phone_quiet_end', "phone_quiet_end TEXT DEFAULT '07:00'")
  ensureColumn('profile', 'phone_last_sent_at', 'phone_last_sent_at TEXT')
  ensureColumn('profile', 'phone_last_error', "phone_last_error TEXT DEFAULT ''")

  seedFinanceCategories()
}

// finance_categories didn't exist before this feature, so on an existing
// install CREATE TABLE IF NOT EXISTS above leaves it empty — seed it once
// from the list that used to be hardcoded in electron/main.cjs and
// src/pages/Finance.jsx, so nothing already budgeted or spent under those
// names goes missing from the picker. Also picks up any category already
// sitting in transactions/budgets/recurring that isn't in that default
// list (hand-edited data, or a database imported from elsewhere).
function seedFinanceCategories() {
  const count = db.prepare('SELECT COUNT(*) as c FROM finance_categories').get().c
  if (count > 0) return
  const defaults = ['General', 'Food', 'Transport', 'Rent', 'Utilities', 'School', 'Health', 'Entertainment', 'Savings', 'Other']
  const insert = db.prepare('INSERT OR IGNORE INTO finance_categories (name, position) VALUES (?, ?)')
  const seed = db.transaction((names) => { names.forEach((name, i) => insert.run(name, i)) })
  seed(defaults)

  const used = db.prepare(`
    SELECT category FROM transactions WHERE category IS NOT NULL AND category <> '' AND category <> 'Transfer'
    UNION SELECT category FROM budgets
    UNION SELECT category FROM recurring_transactions WHERE category IS NOT NULL AND category <> ''
  `).all().map(r => r.category)
  let pos = defaults.length
  const seedUsed = db.transaction((names) => { for (const name of names) insert.run(name, pos++) })
  seedUsed(used)
}

function ensureColumn(table, column, columnDdl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDdl}`)
}

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex')
}

// Advances a 'YYYY-MM-DD' date string by one period, clamping monthly
// rollovers to the last valid day of the target month (e.g. Jan 31 -> Feb 28).
// Shared by recurring transactions and recurring tasks.
function advanceDate(dateStr, frequency) {
  const d = parseISO(dateStr)
  if (frequency === 'daily') {
    d.setDate(d.getDate() + 1)
  } else if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7)
  } else {
    const day = d.getDate()
    d.setMonth(d.getMonth() + 1)
    if (d.getDate() !== day) d.setDate(0)
  }
  // localISO, NOT toISOString(): the latter converts to UTC and, east of
  // UTC, moved every recurrence one day earlier than the last.
  return localISO(d)
}

// ── Tasks ───────────────────────────────────────────────────────────────
const tasks = {
  getAll: () => db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) as subtask_total,
      (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id AND done = 1) as subtask_done
    FROM tasks t
    ORDER BY (t.status = 'done'), t.due_date IS NULL, t.due_date, t.due_time
  `).all(),
  create: (d) => {
    const stmt = db.prepare(`INSERT INTO tasks (title, description, due_date, due_time, priority, tags, recurring)
      VALUES (@title, @description, @due_date, @due_time, @priority, @tags, @recurring)`)
    const info = stmt.run({
      title: d.title, description: d.description || '', due_date: d.due_date || null,
      due_time: d.due_time || null, priority: d.priority || 'medium',
      tags: JSON.stringify(d.tags || []), recurring: d.recurring || 'none',
    })
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid)
  },
  update: (id, d) => {
    db.prepare(`UPDATE tasks SET title=@title, description=@description, due_date=@due_date, due_time=@due_time,
      priority=@priority, tags=@tags, recurring=@recurring, notified=0 WHERE id=@id`).run({
      id, title: d.title, description: d.description || '', due_date: d.due_date || null,
      due_time: d.due_time || null, priority: d.priority || 'medium',
      tags: JSON.stringify(d.tags || []), recurring: d.recurring || 'none',
    })
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  },
  // Flips status. If completing a recurring task, also spawns the next
  // occurrence (same title/description/priority/tags/recurring), with
  // due_date advanced one period from whichever date the completed task
  // was due on (or from today, if it had no due date). Returns both rows
  // so the caller can surface "rescheduled for <date>" feedback.
  toggle: (id) => {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
    const status = t.status === 'done' ? 'pending' : 'done'
    db.prepare('UPDATE tasks SET status=?, completed_at=? WHERE id=?')
      .run(status, status === 'done' ? new Date().toISOString() : null, id)
    const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)

    let nextTask = null
    if (status === 'done' && updated.recurring && updated.recurring !== 'none') {
      const baseDate = updated.due_date || localISO()
      const nextDueDate = advanceDate(baseDate, updated.recurring)
      const info = db.prepare(`INSERT INTO tasks (title, description, due_date, due_time, priority, tags, recurring)
        VALUES (?,?,?,?,?,?,?)`).run(updated.title, updated.description, nextDueDate, updated.due_time, updated.priority, updated.tags, updated.recurring)
      nextTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid)
    }
    return { task: updated, nextTask }
  },
  remove: (id) => db.prepare('DELETE FROM tasks WHERE id = ?').run(id),
  markNotified: (id) => db.prepare('UPDATE tasks SET notified=1 WHERE id=?').run(id),
}

// ── Subtasks (checklist items within a task) ──────────────────────────
const subtasks = {
  getFor: (taskId) => db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position, id').all(taskId),
  create: (taskId, title) => {
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 as p FROM subtasks WHERE task_id = ?').get(taskId).p
    const info = db.prepare('INSERT INTO subtasks (task_id, title, position) VALUES (?,?,?)').run(taskId, title, pos)
    return db.prepare('SELECT * FROM subtasks WHERE id = ?').get(info.lastInsertRowid)
  },
  toggle: (id) => {
    const s = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id)
    db.prepare('UPDATE subtasks SET done=? WHERE id=?').run(s.done ? 0 : 1, id)
    return db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id)
  },
  remove: (id) => db.prepare('DELETE FROM subtasks WHERE id = ?').run(id),
}

// ── Events ──────────────────────────────────────────────────────────────
const events = {
  getAll: () => db.prepare('SELECT * FROM events ORDER BY start_at').all(),
  create: (d) => {
    const info = db.prepare(`INSERT INTO events (title, description, start_at, end_at, location, color, reminder_minutes_before)
      VALUES (@title, @description, @start_at, @end_at, @location, @color, @reminder_minutes_before)`).run({
      title: d.title, description: d.description || '', start_at: d.start_at, end_at: d.end_at || null,
      location: d.location || '', color: d.color || '#e8500a', reminder_minutes_before: d.reminder_minutes_before ?? 10,
    })
    return db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid)
  },
  update: (id, d) => {
    db.prepare(`UPDATE events SET title=@title, description=@description, start_at=@start_at, end_at=@end_at,
      location=@location, color=@color, reminder_minutes_before=@reminder_minutes_before, notified=0 WHERE id=@id`).run({
      id, title: d.title, description: d.description || '', start_at: d.start_at, end_at: d.end_at || null,
      location: d.location || '', color: d.color || '#e8500a', reminder_minutes_before: d.reminder_minutes_before ?? 10,
    })
    return db.prepare('SELECT * FROM events WHERE id = ?').get(id)
  },
  remove: (id) => db.prepare('DELETE FROM events WHERE id = ?').run(id),
  markNotified: (id) => db.prepare('UPDATE events SET notified=1 WHERE id=?').run(id),
}

// ── Accounts (Bank, Cash, Mobile Money, ...) ──────────────────────────────
const accounts = {
  getAll: () => db.prepare('SELECT * FROM accounts ORDER BY archived, created_at').all()
    .map(a => ({ ...a, balance: accounts.balanceFor(a.id, a.opening_balance) })),
  // Running balance = opening balance, plus income/expense posted directly
  // to this account, plus/minus the two sides of any transfer.
  balanceFor: (id, opening) => {
    const r = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type='income' AND account_id=? THEN amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='expense' AND account_id=? THEN amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='transfer' AND account_id=? THEN amount ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN type='transfer' AND to_account_id=? THEN amount ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN type='debt_in' AND account_id=? THEN amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='debt_out' AND account_id=? THEN amount ELSE 0 END), 0) as delta
      FROM transactions
    `).get(id, id, id, id, id, id)
    return (opening || 0) + (r.delta || 0)
  },
  create: (d) => {
    const info = db.prepare(`INSERT INTO accounts (name, type, institution, color, opening_balance)
      VALUES (@name, @type, @institution, @color, @opening_balance)`).run({
      name: d.name, type: d.type || 'bank', institution: d.institution || '',
      color: d.color || '#3b82f6', opening_balance: Number(d.opening_balance) || 0,
    })
    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid)
  },
  update: (id, d) => {
    db.prepare(`UPDATE accounts SET name=@name, type=@type, institution=@institution, color=@color WHERE id=@id`)
      .run({ id, name: d.name, type: d.type || 'bank', institution: d.institution || '', color: d.color || '#3b82f6' })
    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  },
  archive: (id) => db.prepare('UPDATE accounts SET archived=1 WHERE id=?').run(id),
  unarchive: (id) => db.prepare('UPDATE accounts SET archived=0 WHERE id=?').run(id),
  // Hard delete only when nothing references it, to avoid orphaning
  // transaction history — archiving is the normal way to retire an account.
  remove: (id) => {
    const count = db.prepare('SELECT COUNT(*) as c FROM transactions WHERE account_id=? OR to_account_id=?').get(id, id).c
    if (count > 0) throw new Error('Account has transactions and cannot be deleted — archive it instead.')
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  },
}

// ── Finance ─────────────────────────────────────────────────────────────
const finance = {
  getAll: () => db.prepare(`
    SELECT t.*, a1.name as account_name, a1.color as account_color, a2.name as to_account_name
    FROM transactions t
    LEFT JOIN accounts a1 ON a1.id = t.account_id
    LEFT JOIN accounts a2 ON a2.id = t.to_account_id
    ORDER BY t.date DESC, t.id DESC
  `).all(),
  create: (d) => {
    const info = db.prepare(`INSERT INTO transactions (type, amount, category, note, date, account_id, to_account_id, merchant)
      VALUES (@type, @amount, @category, @note, @date, @account_id, @to_account_id, @merchant)`).run({
      type: d.type, amount: d.amount, category: d.category || 'General', note: d.note || '', date: d.date,
      account_id: d.account_id || null, to_account_id: d.to_account_id || null, merchant: d.merchant || '',
    })
    return db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid)
  },
  // A transfer is stored as one 'transfer' row moving money from
  // account_id -> to_account_id, so it never touches income/expense totals
  // but still moves both account balances.
  transfer: (d) => {
    if (!d.from_account_id || !d.to_account_id) throw new Error('Both accounts are required for a transfer.')
    if (d.from_account_id === d.to_account_id) throw new Error('Choose two different accounts.')
    return finance.create({
      type: 'transfer', amount: d.amount, category: 'Transfer', note: d.note || '', date: d.date,
      account_id: d.from_account_id, to_account_id: d.to_account_id, merchant: '',
    })
  },
  remove: (id) => db.prepare('DELETE FROM transactions WHERE id = ?').run(id),
  summary: () => {
    const income = db.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='income'`).get().v
    const expense = db.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='expense'`).get().v
    const byCategory = db.prepare(`SELECT category, SUM(amount) as total FROM transactions WHERE type='expense' GROUP BY category ORDER BY total DESC`).all()
    const last30 = db.prepare(`SELECT date, type, SUM(amount) as total FROM transactions WHERE type IN ('income','expense') AND date >= date('now','localtime','-30 days') GROUP BY date, type ORDER BY date`).all()
    // Last 6 calendar months of income/expense, oldest first — powers the
    // monthly trend chart and the month-over-month comparison KPI.
    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', date) as month, type, SUM(amount) as total
      FROM transactions
      WHERE type IN ('income','expense') AND date >= date('now', 'localtime', 'start of month', '-5 months')
      GROUP BY month, type
      ORDER BY month
    `).all()
    // The headline "balance" mirrors real money rather than a naive
    // income-minus-expense total: it's the sum of every account's actual
    // balance (opening balance + its own postings + transfer deltas) plus
    // any income/expense that was never assigned to an account. This keeps
    // Balance, Accounts, and every transaction in sync with each other.
    const allAccounts = accounts.getAll()
    const accountsTotal = allAccounts.reduce((sum, a) => sum + a.balance, 0)
    const unassigned = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as v
      FROM transactions WHERE account_id IS NULL
    `).get().v
    const balance = allAccounts.length > 0 ? (accountsTotal + unassigned) : (income - expense)
    const accountsBreakdown = allAccounts
      .filter(a => !a.archived)
      .map(a => ({ id: a.id, name: a.name, color: a.color, type: a.type, balance: a.balance }))
      .sort((a, b) => b.balance - a.balance)
    return { income, expense, balance, byCategory, last30, monthly, accountsBreakdown, unassigned }
  },

  // Renaming/deleting cascades into whichever tables still hold the old
  // text, since category is a free-text column everywhere, not a foreign
  // key — nothing here is a join, it's just keeping the same string in
  // sync across transactions/budgets/recurring_transactions.
  categories: {
    getAll: () => db.prepare('SELECT name FROM finance_categories ORDER BY position, name').all().map(r => r.name),
    create: (nameRaw) => {
      const name = String(nameRaw || '').trim()
      if (!name) throw new Error('Category name cannot be empty.')
      const exists = db.prepare('SELECT 1 FROM finance_categories WHERE name = ?').get(name)
      if (exists) throw new Error(`"${name}" already exists.`)
      const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as m FROM finance_categories').get().m
      db.prepare('INSERT INTO finance_categories (name, position) VALUES (?, ?)').run(name, maxPos + 1)
      return finance.categories.getAll()
    },
    // Category names are typed in a few places (transactions, budgets,
    // recurring transactions) so a rename has to update all of them
    // together or a transaction from before the rename would silently
    // stop matching its own budget.
    rename: (oldName, newNameRaw) => {
      const newName = String(newNameRaw || '').trim()
      if (!newName) throw new Error('Category name cannot be empty.')
      if (newName.toLowerCase() === String(oldName).toLowerCase()) return finance.categories.getAll()
      const clash = db.prepare('SELECT 1 FROM finance_categories WHERE name = ? AND name <> ?').get(newName, oldName)
      if (clash) throw new Error(`"${newName}" already exists.`)
      const run = db.transaction(() => {
        db.prepare('UPDATE finance_categories SET name = ? WHERE name = ?').run(newName, oldName)
        db.prepare('UPDATE transactions SET category = ? WHERE category = ?').run(newName, oldName)
        db.prepare('UPDATE budgets SET category = ? WHERE category = ?').run(newName, oldName)
        db.prepare('UPDATE recurring_transactions SET category = ? WHERE category = ?').run(newName, oldName)
      })
      run()
      return finance.categories.getAll()
    },
    // Hard delete only when nothing references it, same rule accounts.remove
    // uses — rename it instead, or move those transactions to another
    // category first. A leftover budget for the now-gone category is
    // cleared along with it; a budget with nothing to spend against is
    // just clutter, unlike a transaction's own history.
    remove: (name) => {
      const count = db.prepare('SELECT COUNT(*) as c FROM finance_categories').get().c
      if (count <= 1) throw new Error('Keep at least one category.')
      const used = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM transactions WHERE category = ?) +
          (SELECT COUNT(*) FROM recurring_transactions WHERE category = ?) as c
      `).get(name, name).c
      if (used > 0) {
        throw new Error(`"${name}" is used by ${used} transaction${used === 1 ? '' : 's'} and can't be deleted — rename it instead, or move those to another category first.`)
      }
      const run = db.transaction(() => {
        db.prepare('DELETE FROM budgets WHERE category = ?').run(name)
        db.prepare('DELETE FROM finance_categories WHERE name = ?').run(name)
      })
      run()
      return finance.categories.getAll()
    },
    // Persists the exact order the Settings list was dragged into.
    reorder: (names) => {
      const run = db.transaction((list) => {
        list.forEach((name, i) => db.prepare('UPDATE finance_categories SET position = ? WHERE name = ?').run(i, name))
      })
      run(names)
      return finance.categories.getAll()
    },
  },

  budgets: {
    getAll: () => {
      const rows = db.prepare('SELECT * FROM budgets ORDER BY category').all()
      const monthStartStr = monthStartISO()
      return rows.map(b => {
        const spent = db.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='expense' AND category=? AND date >= ?`).get(b.category, monthStartStr).v
        const percent = b.monthly_limit > 0 ? Math.round((spent / b.monthly_limit) * 100) : 0
        return { ...b, spent, remaining: b.monthly_limit - spent, percent }
      })
    },
    set: (category, monthly_limit) => {
      db.prepare(`INSERT INTO budgets (category, monthly_limit) VALUES (?,?)
        ON CONFLICT(category) DO UPDATE SET monthly_limit=excluded.monthly_limit`).run(category, monthly_limit)
      return finance.budgets.getAll().find(b => b.category === category)
    },
    remove: (category) => db.prepare('DELETE FROM budgets WHERE category = ?').run(category),
  },

  recurring: {
    getAll: () => db.prepare(`
      SELECT r.*, a.name as account_name
      FROM recurring_transactions r
      LEFT JOIN accounts a ON a.id = r.account_id
      ORDER BY r.active DESC, r.next_date
    `).all(),
    create: (d) => {
      const info = db.prepare(`INSERT INTO recurring_transactions (type, amount, category, note, frequency, next_date, account_id)
        VALUES (@type, @amount, @category, @note, @frequency, @next_date, @account_id)`).run({
        type: d.type, amount: d.amount, category: d.category || 'General', note: d.note || '',
        frequency: d.frequency || 'monthly', next_date: d.next_date, account_id: d.account_id || null,
      })
      return db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(info.lastInsertRowid)
    },
    toggle: (id) => {
      const r = db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(id)
      db.prepare('UPDATE recurring_transactions SET active=? WHERE id=?').run(r.active ? 0 : 1, id)
      return db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(id)
    },
    remove: (id) => db.prepare('DELETE FROM recurring_transactions WHERE id = ?').run(id),
    // Called on startup and on the notification poll. Generates a real
    // transaction for every elapsed period (catches up if the app was
    // closed for a while) and advances next_date past today. Returns
    // true if anything was created, so the caller knows to refresh the UI.
    processDue: () => {
      const today = localISO()
      const due = db.prepare('SELECT * FROM recurring_transactions WHERE active=1 AND next_date <= ?').all(today)
      let created = false
      for (const r of due) {
        let next = r.next_date
        while (next <= today) {
          db.prepare(`INSERT INTO transactions (type, amount, category, note, date, account_id) VALUES (?,?,?,?,?,?)`)
            .run(r.type, r.amount, r.category, r.note ? `${r.note} (auto)` : 'Recurring', next, r.account_id || null)
          created = true
          next = advanceDate(next, r.frequency)
        }
        db.prepare('UPDATE recurring_transactions SET next_date=? WHERE id=?').run(next, r.id)
      }
      return created
    },
  },
}

// ── Savings goals ───────────────────────────────────────────────────────
// A goal EARMARKS money you already hold — it doesn't move it out of any
// account. `saved` is the net of the goal's signed entries. Each goal row
// also carries recent_net / first_entry_date / entries_count so the UI can
// work out pace ("on track", projected finish) without extra round trips.
const MILESTONES = [25, 50, 75, 100]
function milestoneBand(saved, target) {
  if (target > 0 && saved >= target - 0.005) return 100
  const pct = target > 0 ? Math.floor((saved / target) * 100) : 0
  let band = 0
  for (const m of MILESTONES) if (pct >= m) band = m
  return band
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const GOALS_SELECT = `
  SELECT g.*, a.name AS account_name,
    COALESCE((SELECT SUM(amount) FROM savings_entries e WHERE e.goal_id = g.id), 0) AS saved,
    COALESCE((SELECT SUM(amount) FROM savings_entries e WHERE e.goal_id = g.id AND e.date > @since), 0) AS recent_net,
    (SELECT MIN(date) FROM savings_entries e WHERE e.goal_id = g.id) AS first_entry_date,
    (SELECT COUNT(*) FROM savings_entries e WHERE e.goal_id = g.id) AS entries_count
  FROM savings_goals g
  LEFT JOIN accounts a ON a.id = g.account_id`

const savings = {
  getAll: () => db.prepare(`${GOALS_SELECT}
    ORDER BY g.archived, (g.status = 'achieved'), g.target_date IS NULL, g.target_date, g.id`)
    .all({ since: addDaysISO(localISO(), -90) }),
  _one: (id) => db.prepare(`${GOALS_SELECT} WHERE g.id = @id`).get({ id, since: addDaysISO(localISO(), -90) }),
  getEntries: (goalId) => db.prepare('SELECT * FROM savings_entries WHERE goal_id = ? ORDER BY date DESC, id DESC').all(goalId),

  create: (d) => {
    const name = String(d.name || '').trim()
    const target = Number(d.target_amount)
    if (!name) throw new Error('Give the goal a name.')
    if (!(target > 0)) throw new Error('Enter a target amount above zero.')
    const info = db.prepare(`INSERT INTO savings_goals (name, icon, color, target_amount, target_date, account_id, note)
      VALUES (@name, @icon, @color, @target_amount, @target_date, @account_id, @note)`).run({
      name, icon: d.icon || '🎯', color: d.color || '#22c55e', target_amount: target,
      target_date: d.target_date || null, account_id: d.account_id || null, note: d.note || '',
    })
    const id = info.lastInsertRowid
    // Optional starting balance — recorded as a normal first deposit so it
    // shows up in history and in the pace maths.
    const opening = Number(d.opening_amount)
    if (opening > 0) {
      db.prepare('INSERT INTO savings_entries (goal_id, amount, date, note) VALUES (?,?,?,?)')
        .run(id, opening, localISO(), 'Starting balance')
      savings._sync(id)
    }
    return savings._one(id)
  },
  update: (id, d) => {
    const cur = savings._one(id)
    if (!cur) throw new Error('Goal not found.')
    const name = String(d.name || '').trim()
    const target = Number(d.target_amount)
    if (!name) throw new Error('Give the goal a name.')
    if (!(target > 0)) throw new Error('Enter a target amount above zero.')
    const newDate = d.target_date || null
    db.prepare(`UPDATE savings_goals SET name=@name, icon=@icon, color=@color, target_amount=@target_amount,
      target_date=@target_date, account_id=@account_id, note=@note,
      notify_stage = CASE WHEN COALESCE(target_date,'') <> COALESCE(@target_date,'') THEN 0 ELSE notify_stage END
      WHERE id=@id`).run({
      id, name, icon: d.icon || '🎯', color: d.color || '#22c55e', target_amount: target,
      target_date: newDate, account_id: d.account_id || null, note: d.note || '',
    })
    savings._sync(id)
    return savings._one(id)
  },
  archive: (id) => db.prepare('UPDATE savings_goals SET archived=1 WHERE id=?').run(id),
  unarchive: (id) => db.prepare('UPDATE savings_goals SET archived=0 WHERE id=?').run(id),
  remove: (id) => db.prepare('DELETE FROM savings_goals WHERE id = ?').run(id),

  // Keeps status / achieved_at / last_milestone truthful after any change
  // to entries or the target. Returns the milestone band that was just
  // CROSSED (25/50/75/100) so the UI can celebrate it — or null. Because
  // last_milestone follows the balance back down after a withdrawal,
  // re-crossing a band later celebrates again.
  _sync: (id) => {
    const g = savings._one(id)
    if (!g) return { milestone: null }
    const band = milestoneBand(g.saved, g.target_amount)
    const crossed = band > (g.last_milestone || 0) ? band : null
    const status = band === 100 ? 'achieved' : 'active'
    const achievedAt = status === 'achieved' ? (g.achieved_at || new Date().toISOString()) : null
    db.prepare('UPDATE savings_goals SET last_milestone=?, status=?, achieved_at=? WHERE id=?').run(band, status, achievedAt, id)
    return { milestone: crossed }
  },

  // amount is signed: positive = deposit, negative = withdrawal.
  addEntry: (goalId, d) => {
    const goal = savings._one(goalId)
    if (!goal) throw new Error('Goal not found.')
    const amount = round2(d.amount)
    if (!amount || !isFinite(amount)) throw new Error('Enter an amount.')
    if (amount < 0 && -amount > goal.saved + 0.005) throw new Error("You can't withdraw more than what's saved in this goal.")
    const info = db.prepare('INSERT INTO savings_entries (goal_id, amount, date, note) VALUES (?,?,?,?)')
      .run(goalId, amount, d.date || localISO(), d.note || '')
    const { milestone } = savings._sync(goalId)
    return {
      entry: db.prepare('SELECT * FROM savings_entries WHERE id = ?').get(info.lastInsertRowid),
      goal: savings._one(goalId), milestone,
    }
  },
  removeEntry: (id) => {
    const e = db.prepare('SELECT * FROM savings_entries WHERE id = ?').get(id)
    if (!e) return null
    db.prepare('DELETE FROM savings_entries WHERE id = ?').run(id)
    savings._sync(e.goal_id)
    return savings._one(e.goal_id)
  },
  setNotifyStage: (id, stage) => db.prepare('UPDATE savings_goals SET notify_stage=? WHERE id=?').run(stage, id),

  // Totals count only non-archived goals: archiving a goal releases its
  // earmarked money back into "free to spend".
  summary: () => {
    const goals = savings.getAll().filter(g => !g.archived)
    const active = goals.filter(g => g.status === 'active')
    const monthStart = monthStartISO()
    const savedThisMonth = db.prepare(`
      SELECT COALESCE(SUM(e.amount), 0) AS v FROM savings_entries e
      JOIN savings_goals g ON g.id = e.goal_id WHERE g.archived = 0 AND e.date >= ?`).get(monthStart).v
    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', e.date) AS month, SUM(e.amount) AS total
      FROM savings_entries e JOIN savings_goals g ON g.id = e.goal_id
      WHERE g.archived = 0 AND e.date >= date('now', 'localtime', 'start of month', '-5 months')
      GROUP BY month ORDER BY month`).all()
    return {
      totalSaved: goals.reduce((s, g) => s + g.saved, 0),
      activeCount: active.length,
      achievedCount: goals.filter(g => g.status === 'achieved').length,
      activeTarget: active.reduce((s, g) => s + g.target_amount, 0),
      activeSaved: active.reduce((s, g) => s + Math.min(g.saved, g.target_amount), 0),
      savedThisMonth, monthly,
    }
  },
}

// ── Debts (money I owe / money owed to me) ─────────────────────────────
// A debt can optionally touch an account: the original loan and every
// payment may be recorded as a 'debt_out' (cash leaves the account: I lent
// money, or I repaid what I owe) or 'debt_in' (cash arrives: I borrowed, or
// I was repaid). These are deliberately NOT 'income'/'expense' — lending
// 50,000 isn't spending it — so they move balances without skewing the
// income/expense/savings-rate analytics.
const DEBTS_SELECT = `
  SELECT d.*, a.name AS account_name,
    COALESCE((SELECT SUM(amount) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS paid,
    (SELECT COUNT(*) FROM debt_payments p WHERE p.debt_id = d.id) AS payments_count
  FROM debts d LEFT JOIN accounts a ON a.id = d.account_id`

function decorateDebt(d, today) {
  const total = round2(d.amount + (d.interest || 0))
  const remaining = Math.max(0, round2(total - d.paid))
  const open = d.status === 'open'
  return {
    ...d, total, paid: round2(d.paid), remaining,
    percent: total > 0 ? Math.min(100, Math.round((d.paid / total) * 100)) : 0,
    overdue: !!(open && d.due_date && d.due_date < today),
    days_until_due: d.due_date ? daysBetween(today, d.due_date) : null,
  }
}

function insertTxn(t) {
  return db.prepare(`INSERT INTO transactions (type, amount, category, note, date, account_id, merchant, debt_id, debt_payment_id)
    VALUES (@type, @amount, 'Debt', @note, @date, @account_id, @merchant, @debt_id, @debt_payment_id)`).run({
    type: t.type, amount: t.amount, note: t.note || '', date: t.date, account_id: t.account_id,
    merchant: t.merchant || '', debt_id: t.debt_id || null, debt_payment_id: t.debt_payment_id || null,
  })
}

const debts = {
  getAll: () => {
    const today = localISO()
    return db.prepare(`${DEBTS_SELECT}
      ORDER BY (d.status = 'settled'), d.due_date IS NULL, d.due_date, d.id DESC`).all().map(d => decorateDebt(d, today))
  },
  _one: (id) => {
    const row = db.prepare(`${DEBTS_SELECT} WHERE d.id = ?`).get(id)
    return row ? decorateDebt(row, localISO()) : null
  },
  getPayments: (debtId) => db.prepare(`
    SELECT p.*, a.name AS account_name FROM debt_payments p LEFT JOIN accounts a ON a.id = p.account_id
    WHERE p.debt_id = ? ORDER BY p.date DESC, p.id DESC`).all(debtId),

  create: (d) => {
    const person = String(d.person || '').trim()
    const amount = round2(d.amount)
    const interest = Math.max(0, round2(d.interest))
    if (!person) throw new Error('Who is this debt with?')
    if (!(amount > 0)) throw new Error('Enter an amount above zero.')
    if (!['owed_to_me', 'i_owe'].includes(d.direction)) throw new Error('Choose who owes whom.')
    const startDate = d.start_date || localISO()
    const accountId = d.record_account_id ? Number(d.record_account_id) : null
    const run = db.transaction(() => {
      const info = db.prepare(`INSERT INTO debts (direction, person, phone, amount, interest, note, start_date, due_date, account_id)
        VALUES (@direction, @person, @phone, @amount, @interest, @note, @start_date, @due_date, @account_id)`).run({
        direction: d.direction, person, phone: String(d.phone || '').trim(), amount, interest,
        note: d.note || '', start_date: startDate, due_date: d.due_date || null, account_id: accountId,
      })
      const id = info.lastInsertRowid
      if (accountId) {
        insertTxn({
          type: d.direction === 'owed_to_me' ? 'debt_out' : 'debt_in', amount, date: startDate, account_id: accountId,
          merchant: person, debt_id: id,
          note: d.direction === 'owed_to_me' ? `Lent to ${person}` : `Borrowed from ${person}`,
        })
      }
      return id
    })
    return debts._one(run())
  },
  // Direction is fixed after creation (account transactions already
  // reflect it). Editing the principal/start date keeps the linked
  // "loan" transaction in step.
  update: (id, d) => {
    const cur = debts._one(id)
    if (!cur) throw new Error('Debt not found.')
    const person = String(d.person || '').trim()
    const amount = round2(d.amount)
    const interest = Math.max(0, round2(d.interest))
    if (!person) throw new Error('Who is this debt with?')
    if (!(amount > 0)) throw new Error('Enter an amount above zero.')
    if (amount + interest < cur.paid - 0.005) throw new Error('The total can\'t be lower than what has already been paid.')
    const startDate = d.start_date || cur.start_date
    const newDue = d.due_date || null
    const run = db.transaction(() => {
      db.prepare(`UPDATE debts SET person=@person, phone=@phone, amount=@amount, interest=@interest, note=@note,
        start_date=@start_date, due_date=@due_date,
        notify_stage = CASE WHEN COALESCE(due_date,'') <> COALESCE(@due_date,'') THEN 0 ELSE notify_stage END,
        last_overdue_notified = CASE WHEN COALESCE(due_date,'') <> COALESCE(@due_date,'') THEN NULL ELSE last_overdue_notified END
        WHERE id=@id`).run({ id, person, phone: String(d.phone || '').trim(), amount, interest, note: d.note || '', start_date: startDate, due_date: newDue })
      db.prepare('UPDATE transactions SET amount=?, date=?, merchant=? WHERE debt_id=? AND debt_payment_id IS NULL').run(amount, startDate, person, id)
      debts._sync(id)
    })
    run()
    return debts._one(id)
  },
  // Removing a debt keeps any account transactions it created (so balances
  // don't silently change) — they're just unlinked and can be deleted
  // individually from Recent transactions.
  remove: (id) => {
    db.transaction(() => {
      db.prepare('UPDATE transactions SET debt_id=NULL, debt_payment_id=NULL WHERE debt_id=?').run(id)
      db.prepare('DELETE FROM debts WHERE id = ?').run(id)
    })()
  },

  // Flips open <-> settled to match the paid amount, and resets reminder
  // state whenever the debt reopens.
  _sync: (id) => {
    const d = debts._one(id)
    if (!d) return
    if (d.status === 'open' && d.remaining <= 0.005) {
      db.prepare(`UPDATE debts SET status='settled', settled_at=datetime('now'), notify_stage=0 WHERE id=?`).run(id)
    } else if (d.status === 'settled' && d.remaining > 0.005) {
      db.prepare(`UPDATE debts SET status='open', settled_at=NULL, notify_stage=0, last_overdue_notified=NULL WHERE id=?`).run(id)
    }
  },

  addPayment: (id, d) => {
    const debt = debts._one(id)
    if (!debt) throw new Error('Debt not found.')
    if (debt.status === 'settled') throw new Error('This debt is already settled.')
    const amount = round2(d.amount)
    if (!(amount > 0)) throw new Error('Enter an amount above zero.')
    if (amount > debt.remaining + 0.005) throw new Error('That is more than the remaining balance.')
    const date = d.date || localISO()
    const accountId = d.account_id ? Number(d.account_id) : null
    const run = db.transaction(() => {
      const info = db.prepare('INSERT INTO debt_payments (debt_id, amount, date, note, account_id) VALUES (?,?,?,?,?)')
        .run(id, amount, date, d.note || '', accountId)
      const paymentId = info.lastInsertRowid
      if (accountId) {
        insertTxn({
          type: debt.direction === 'owed_to_me' ? 'debt_in' : 'debt_out', amount, date, account_id: accountId,
          merchant: debt.person, debt_id: id, debt_payment_id: paymentId,
          note: debt.direction === 'owed_to_me' ? `Repayment from ${debt.person}` : `Repaid to ${debt.person}`,
        })
      }
      debts._sync(id)
      return paymentId
    })
    const paymentId = run()
    const after = debts._one(id)
    return { debt: after, payment_id: paymentId, settled: after.status === 'settled' }
  },
  settle: (id, d = {}) => {
    const debt = debts._one(id)
    if (!debt) throw new Error('Debt not found.')
    return debts.addPayment(id, { amount: debt.remaining, date: d.date, note: d.note || 'Settled in full', account_id: d.account_id })
  },
  removePayment: (paymentId) => {
    const p = db.prepare('SELECT * FROM debt_payments WHERE id = ?').get(paymentId)
    if (!p) return null
    db.transaction(() => {
      db.prepare('DELETE FROM transactions WHERE debt_payment_id = ?').run(paymentId)
      db.prepare('DELETE FROM debt_payments WHERE id = ?').run(paymentId)
      debts._sync(p.debt_id)
    })()
    return debts._one(p.debt_id)
  },
  setNotify: (id, stage, lastOverdue) =>
    db.prepare('UPDATE debts SET notify_stage=?, last_overdue_notified=COALESCE(?, last_overdue_notified) WHERE id=?').run(stage, lastOverdue || null, id),

  summary: () => {
    const all = debts.getAll()
    const open = all.filter(d => d.status === 'open')
    const sum = (rows) => rows.reduce((s, d) => s + d.remaining, 0)
    const owedToMe = open.filter(d => d.direction === 'owed_to_me')
    const iOwe = open.filter(d => d.direction === 'i_owe')
    const overdue = open.filter(d => d.overdue)
    const dueSoon = open.filter(d => !d.overdue && d.days_until_due != null && d.days_until_due <= 7)
    // Net position per person (positive = they owe me), largest first.
    const byPerson = new Map()
    for (const d of open) {
      const key = d.person.trim().toLowerCase()
      const row = byPerson.get(key) || { person: d.person.trim(), net: 0, count: 0 }
      row.net += d.direction === 'owed_to_me' ? d.remaining : -d.remaining
      row.count += 1
      byPerson.set(key, row)
    }
    return {
      owedToMe: sum(owedToMe), owedToMeCount: owedToMe.length,
      iOwe: sum(iOwe), iOweCount: iOwe.length,
      net: sum(owedToMe) - sum(iOwe),
      overdueCount: overdue.length, overdueOwedToMe: sum(overdue.filter(d => d.direction === 'owed_to_me')),
      overdueIOwe: sum(overdue.filter(d => d.direction === 'i_owe')),
      dueSoonCount: dueSoon.length,
      people: [...byPerson.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
    }
  },
}

// ── Habits ──────────────────────────────────────────────────────────────
const habits = {
  // Includes the current streak per habit, computed from the FULL log
  // history — see currentStreak()/daysSinceLastSlip() below, so it stays
  // accurate indefinitely instead of capping out after a fixed window.
  // For a 'build' habit a log row means "did it"; for a 'quit' habit a
  // log row means "slipped", so streak/bestStreak/last7/last30 are read
  // the opposite way round for each kind (see the per-kind helpers).
  getAll: () => db.prepare('SELECT * FROM habits ORDER BY archived, created_at').all()
    .map(h => {
      const logs7 = db.prepare(`SELECT COUNT(*) c FROM habit_logs WHERE habit_id=? AND date >= date('now','localtime','-6 days')`).get(h.id).c
      const logs30 = db.prepare(`SELECT COUNT(*) c FROM habit_logs WHERE habit_id=? AND date >= date('now','localtime','-29 days')`).get(h.id).c
      if (h.kind === 'quit') {
        return {
          ...h,
          streak: habits.daysSinceLastSlip(h.id, h.created_at),
          bestStreak: habits.longestCleanGap(h.id, h.created_at),
          last7: Math.max(0, 7 - logs7),
          last30: Math.max(0, 30 - logs30),
        }
      }
      return { ...h, streak: habits.currentStreak(h.id), bestStreak: habits.longestStreak(h.id), last7: logs7, last30: logs30 }
    }),
  // Walks backward day-by-day from today (or yesterday, if today isn't
  // logged yet) counting consecutive logged days, stopping at the first gap. Reads the habit's entire log
  // history, so it stays correct no matter how long a streak runs —
  // unlike computing it client-side from a capped recent-days fetch.
  currentStreak: (id) => {
    const rows = db.prepare('SELECT date FROM habit_logs WHERE habit_id = ?').all(id)
    const done = new Set(rows.map(r => r.date))
    let streak = 0
    const d = new Date()
    // Today not logged yet? The day isn't over, so don't break the streak:
    // count back from yesterday (it resets only once a whole day is missed).
    if (!done.has(localISO(d))) d.setDate(d.getDate() - 1)
    for (;;) {
      const iso = localISO(d)
      if (!done.has(iso)) break
      streak++
      d.setDate(d.getDate() - 1)
    }
    return streak
  },
  // Longest run of consecutive logged days the habit has ever had —
  // a "personal best" that stays visible even after a streak breaks.
  longestStreak: (id) => {
    const rows = db.prepare('SELECT date FROM habit_logs WHERE habit_id = ? ORDER BY date').all(id)
    if (rows.length === 0) return 0
    let best = 1, run = 1
    for (let i = 1; i < rows.length; i++) {
      const diffDays = Math.round((new Date(rows[i].date) - new Date(rows[i - 1].date)) / 86400000)
      run = diffDays === 1 ? run + 1 : 1
      if (run > best) best = run
    }
    return best
  },
  // 'quit' habits: days clean since the most recent slip, or since the
  // habit was created if it has never slipped at all.
  daysSinceLastSlip: (id, createdAt) => {
    const last = db.prepare('SELECT date FROM habit_logs WHERE habit_id=? ORDER BY date DESC LIMIT 1').get(id)
    const from = last ? last.date : String(createdAt).slice(0, 10)
    const diff = Math.floor((Date.now() - new Date(from + 'T00:00:00').getTime()) / 86400000)
    return Math.max(0, diff)
  },
  // 'quit' habits: the longest clean gap the habit has ever had — between
  // creation and the first slip, between two slips, or between the last
  // slip and today — whichever run is longest. This is what keeps a
  // personal best visible even right after a fresh slip resets the streak.
  longestCleanGap: (id, createdAt) => {
    const rows = db.prepare('SELECT date FROM habit_logs WHERE habit_id = ? ORDER BY date').all(id)
    const bounds = [String(createdAt).slice(0, 10), ...rows.map(r => r.date), localISO()]
    let best = 0
    for (let i = 1; i < bounds.length; i++) {
      const gap = Math.floor((new Date(bounds[i]) - new Date(bounds[i - 1])) / 86400000)
      if (gap > best) best = gap
    }
    return best
  },
  create: (d) => {
    const info = db.prepare('INSERT INTO habits (name, icon, color, kind, target_per_week) VALUES (?,?,?,?,?)')
      .run(d.name, d.icon || '✅', d.color || '#22c55e', d.kind === 'quit' ? 'quit' : 'build', Number(d.target_per_week) || 7)
    return db.prepare('SELECT * FROM habits WHERE id = ?').get(info.lastInsertRowid)
  },
  update: (id, d) => {
    db.prepare('UPDATE habits SET name=@name, icon=@icon, color=@color, kind=@kind, target_per_week=@target_per_week WHERE id=@id')
      .run({ id, name: d.name, icon: d.icon || '✅', color: d.color || '#22c55e', kind: d.kind === 'quit' ? 'quit' : 'build', target_per_week: Number(d.target_per_week) || 7 })
    return db.prepare('SELECT * FROM habits WHERE id = ?').get(id)
  },
  archive: (id) => db.prepare('UPDATE habits SET archived=1 WHERE id=?').run(id),
  unarchive: (id) => db.prepare('UPDATE habits SET archived=0 WHERE id=?').run(id),
  remove: (id) => db.prepare('DELETE FROM habits WHERE id = ?').run(id),
  // Shared by both kinds: toggles whether today (or any date) has a log
  // row at all. What that row *means* — "did it" vs "slipped" — is
  // entirely down to the habit's kind, decided by the caller.
  toggleLog: (habitId, date) => {
    const existing = db.prepare('SELECT * FROM habit_logs WHERE habit_id=? AND date=?').get(habitId, date)
    if (existing) {
      db.prepare('DELETE FROM habit_logs WHERE id=?').run(existing.id)
      return { done: false }
    }
    db.prepare('INSERT INTO habit_logs (habit_id, date, done) VALUES (?,?,1)').run(habitId, date)
    return { done: true }
  },
  getLogs: (habitId, fromDate, toDate) =>
    db.prepare('SELECT date FROM habit_logs WHERE habit_id=? AND date BETWEEN ? AND ?').all(habitId, fromDate, toDate),
}

// ── Notes ───────────────────────────────────────────────────────────────
const notes = {
  getAll: () => db.prepare('SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC').all(),
  create: (d) => {
    const info = db.prepare('INSERT INTO notes (title, content) VALUES (?,?)').run(d.title || 'Untitled', d.content || '')
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid)
  },
  update: (id, d) => {
    db.prepare(`UPDATE notes SET title=@title, content=@content, pinned=@pinned, updated_at=datetime('now') WHERE id=@id`)
      .run({ id, title: d.title, content: d.content, pinned: d.pinned ? 1 : 0 })
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
  },
  remove: (id) => db.prepare('DELETE FROM notes WHERE id = ?').run(id),
}

// ── Attachments ─────────────────────────────────────────────────────────
const attachments = {
  add: (parentType, parentId, filePath) => {
    const fileName = filePath.split(/[\\/]/).pop()
    const info = db.prepare('INSERT INTO attachments (parent_type, parent_id, file_path, file_name) VALUES (?,?,?,?)')
      .run(parentType, parentId, filePath, fileName)
    return db.prepare('SELECT * FROM attachments WHERE id = ?').get(info.lastInsertRowid)
  },
  getFor: (parentType, parentId) =>
    db.prepare('SELECT * FROM attachments WHERE parent_type=? AND parent_id=? ORDER BY created_at').all(parentType, parentId),
  remove: (id) => db.prepare('DELETE FROM attachments WHERE id = ?').run(id),
}

// ── Profile ("About Me") ────────────────────────────────────────────────
// Single-row table (id is always 1). pin_hash is never exposed to the
// renderer directly — has_pin is a derived boolean, and verifyPin/setPin
// are the only ways to touch it, both handled here in the main process.
const profile = {
  get: () => db.prepare(`
    SELECT id, name, bio, avatar_path, created_at, updated_at, (pin_hash IS NOT NULL) as has_pin
    FROM profile WHERE id = 1
  `).get(),
  update: (d) => {
    db.prepare(`UPDATE profile SET name=@name, bio=@bio, updated_at=datetime('now') WHERE id=1`)
      .run({ name: d.name || '', bio: d.bio || '' })
    return profile.get()
  },
  setAvatar: (avatarPath) => {
    db.prepare(`UPDATE profile SET avatar_path=?, updated_at=datetime('now') WHERE id=1`).run(avatarPath)
    return profile.get()
  },
  setPin: (pin) => { db.prepare('UPDATE profile SET pin_hash=? WHERE id=1').run(hashPin(pin)); return true },
  clearPin: () => { db.prepare('UPDATE profile SET pin_hash=NULL WHERE id=1').run(); return true },
  // No PIN set at all means the app has never been locked — treat that as
  // an automatic pass rather than an unlockable dead end.
  verifyPin: (pin) => {
    const row = db.prepare('SELECT pin_hash FROM profile WHERE id=1').get()
    if (!row.pin_hash) return true
    return row.pin_hash === hashPin(pin)
  },
  // AI (Anthropic) settings for Finance's Smart Add / Insights features.
  // The raw key is only ever read here, in the main process — see ai.cjs
  // and the ai:* IPC handlers, which never echo it back to the renderer.
  getAiSettings: () => db.prepare('SELECT ai_api_key, ai_model FROM profile WHERE id=1').get(),
  setAiSettings: (d) => {
    db.prepare(`UPDATE profile SET ai_api_key=@ai_api_key, ai_model=@ai_model, updated_at=datetime('now') WHERE id=1`)
      .run({ ai_api_key: d.ai_api_key || '', ai_model: d.ai_model || 'claude-sonnet-5' })
    return profile.getAiSettings()
  },

  // Google Drive backup — same never-expose-the-secret-to-the-renderer
  // discipline as pin_hash/ai_api_key above. getDriveSettings() (with the
  // raw client secret + tokens) is for main-process/drive.cjs use only;
  // getDriveStatus() is the sanitized shape the renderer actually sees.
  getDriveSettings: () => db.prepare(`
    SELECT drive_client_id, drive_client_secret, drive_refresh_token, drive_access_token,
           drive_token_expires_at, drive_folder_id, drive_auto_backup, drive_frequency_hours, drive_last_backup_at,
           google_scope, google_last_error, gcal_calendar_id
    FROM profile WHERE id=1
  `).get(),
  // The single Google connection (drive_* columns predate phone alerts and
  // were kept as-is) powers both Drive backup and phone alerts. `scopes`
  // says which of the two Google actually granted — users can untick either
  // on the consent screen, and connections made before phone alerts existed
  // have Drive only.
  getDriveStatus: () => {
    const s = profile.getDriveSettings()
    const connected = !!s.drive_refresh_token
    return {
      hasCredentials: !!(s.drive_client_id && s.drive_client_secret),
      connected,
      scopes: {
        drive: connected && (!s.google_scope || hasScope(s.google_scope, DRIVE_SCOPES)),
        calendar: connected && hasScope(s.google_scope, CALENDAR_SCOPES),
      },
      needsReconnect: connected && s.google_last_error === 'expired',
      autoBackup: !!s.drive_auto_backup,
      frequencyHours: s.drive_frequency_hours || 24,
      lastBackupAt: s.drive_last_backup_at || null,
    }
  },
  setGoogleError: (code) => db.prepare('UPDATE profile SET google_last_error=? WHERE id=1').run(code || ''),
  setDriveCredentials: (d) => {
    db.prepare(`UPDATE profile SET drive_client_id=@id, drive_client_secret=@secret, updated_at=datetime('now') WHERE id=1`)
      .run({ id: d.client_id || '', secret: d.client_secret || '' })
    return profile.getDriveStatus()
  },
  // `scope` is only passed on a fresh connect (a plain token refresh
  // doesn't report it), so it's left untouched when omitted. Any successful
  // token write also clears a stale "expired" flag.
  setDriveTokens: (d) => {
    db.prepare(`UPDATE profile SET drive_refresh_token=@refresh, drive_access_token=@access,
      drive_token_expires_at=@expires, google_scope=COALESCE(@scope, google_scope),
      google_last_error='', updated_at=datetime('now') WHERE id=1`)
      .run({ refresh: d.refresh_token || '', access: d.access_token || '', expires: d.expires_at || 0, scope: d.scope ?? null })
    return profile.getDriveStatus()
  },
  setDriveFolderId: (id) => db.prepare('UPDATE profile SET drive_folder_id=? WHERE id=1').run(id),
  setDriveAuto: (d) => {
    db.prepare(`UPDATE profile SET drive_auto_backup=@enabled, drive_frequency_hours=@freq, updated_at=datetime('now') WHERE id=1`)
      .run({ enabled: d.enabled ? 1 : 0, freq: d.frequencyHours || 24 })
    return profile.getDriveStatus()
  },
  setDriveLastBackup: (iso) => db.prepare(`UPDATE profile SET drive_last_backup_at=?, updated_at=datetime('now') WHERE id=1`).run(iso),
  // Disconnects without forcing the user to re-type their Client ID/Secret —
  // those are the app registration, not the per-account grant, so they're
  // left alone. Auto-backup is turned off since there's nothing to run it.
  clearDriveTokens: () => {
    db.prepare(`UPDATE profile SET drive_refresh_token='', drive_access_token='', drive_token_expires_at=0,
      drive_folder_id='', drive_auto_backup=0, google_scope='', google_last_error='',
      gcal_calendar_id='', phone_alerts_enabled=0, updated_at=datetime('now') WHERE id=1`).run()
    return profile.getDriveStatus()
  },
}

// ── Phone alerts (Google Calendar relay) ───────────────────────────────
// Settings + an outbox of notifications waiting to be relayed. See
// electron/phone.cjs for the sending side.
const PHONE_ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000 // alerts older than this are dropped, not sent late
const phone = {
  getSettings: () => db.prepare(`
    SELECT phone_alerts_enabled AS enabled, phone_quiet_enabled AS quiet_enabled, phone_quiet_start AS quiet_start,
           phone_quiet_end AS quiet_end, phone_last_sent_at AS last_sent_at, phone_last_error AS last_error
    FROM profile WHERE id=1`).get(),
  getStatus: () => {
    const s = phone.getSettings()
    const g = profile.getDriveStatus()
    return {
      enabled: !!s.enabled,
      connected: g.connected,
      calendarGranted: g.scopes.calendar,
      needsReconnect: g.needsReconnect,
      pending: phone.pending().length,
      lastSentAt: s.last_sent_at || null,
      lastError: s.last_error || '',
      quietEnabled: !!s.quiet_enabled,
      quietStart: s.quiet_start || '22:00',
      quietEnd: s.quiet_end || '07:00',
    }
  },
  setEnabled: (on) => { db.prepare('UPDATE profile SET phone_alerts_enabled=? WHERE id=1').run(on ? 1 : 0); return phone.getStatus() },
  setQuiet: ({ enabled, start, end }) => {
    const ok = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
    db.prepare('UPDATE profile SET phone_quiet_enabled=?, phone_quiet_start=?, phone_quiet_end=? WHERE id=1')
      .run(enabled ? 1 : 0, ok(start) ? start : '22:00', ok(end) ? end : '07:00')
    return phone.getStatus()
  },
  setCalendarId: (id) => db.prepare('UPDATE profile SET gcal_calendar_id=? WHERE id=1').run(id || ''),
  getCalendarId: () => db.prepare('SELECT gcal_calendar_id AS id FROM profile WHERE id=1').get().id || '',
  setLastSent: (iso) => db.prepare("UPDATE profile SET phone_last_sent_at=?, phone_last_error='' WHERE id=1").run(iso),
  setLastError: (msg) => db.prepare('UPDATE profile SET phone_last_error=? WHERE id=1').run(msg || ''),

  enqueue: (title, body) => db.prepare('INSERT INTO phone_outbox (title, body, created_at) VALUES (?,?,?)')
    .run(title, body || '', new Date().toISOString()).lastInsertRowid,
  pending: () => db.prepare('SELECT * FROM phone_outbox WHERE sent_at IS NULL AND dropped = 0 ORDER BY id').all(),
  markSent: (ids, eventId) => {
    const stmt = db.prepare('UPDATE phone_outbox SET sent_at=?, event_id=? WHERE id=?')
    const now = new Date().toISOString()
    for (const id of ids) stmt.run(now, eventId, id)
  },
  bumpAttempts: (id) => {
    db.prepare('UPDATE phone_outbox SET attempts = attempts + 1 WHERE id=?').run(id)
    return db.prepare('SELECT attempts FROM phone_outbox WHERE id=?').get(id).attempts
  },
  drop: (ids) => { const s = db.prepare('UPDATE phone_outbox SET dropped=1 WHERE id=?'); for (const id of ids) s.run(id) },
  // Sent alert events are deleted from the calendar a few hours later so
  // the "LifeOS Alerts" calendar doesn't fill up with stale pings.
  toClean: (beforeIso) => db.prepare(`SELECT id, event_id FROM phone_outbox
    WHERE sent_at IS NOT NULL AND cleaned = 0 AND event_id IS NOT NULL AND sent_at < ?`).all(beforeIso),
  markCleaned: (ids) => { const s = db.prepare('UPDATE phone_outbox SET cleaned=1 WHERE id=?'); for (const id of ids) s.run(id) },
  purge: (beforeIso) => db.prepare('DELETE FROM phone_outbox WHERE created_at < ? AND (sent_at IS NOT NULL OR dropped = 1)').run(beforeIso),
}

// Takes a point-in-time, WAL-safe snapshot of the live database using
// SQLite's own online backup API, and writes it to destPath. This is
// deliberately NOT a plain file copy of lifeos.db: in WAL mode, recent
// writes can sit in the -wal sidecar file rather than the main .db file,
// so copying just the .db file can silently drop the last few writes.
// db.backup() reads a consistent view across both, so nothing gets missed
// and it's safe to run while the app keeps using the database.
function backupTo(destPath) {
  return db.backup(destPath)
}

// Flushes WAL and releases the file handle cleanly. Called on full quit —
// abandoning the connection instead (just letting the process die) risks
// leaving the WAL file un-checkpointed.
function close() {
  if (db) { db.close(); db = null }
}

// ── Data browser (Settings > Manage your data) ──────────────────────
// A generic, whitelisted read/delete/archive surface over the tables a
// user would actually recognise as "their data". Internal/system tables
// (profile, phone_outbox) are deliberately left out — they already have
// their own UI, and exposing them here would just invite an accidental
// self-lockout or a broken notification queue. Child rows (subtasks,
// habit_logs, savings_entries, debt_payments, attachments) aren't listed
// either: they're reached through their parent and clean up on their own
// via ON DELETE CASCADE when the parent row is deleted.
const DATA_TABLES = {
  tasks: { table: 'tasks', label: 'Tasks', columns: ['title', 'status', 'priority', 'due_date'], order: 'id DESC' },
  events: { table: 'events', label: 'Calendar events', columns: ['title', 'start_at', 'location'], order: 'start_at DESC' },
  transactions: { table: 'transactions', label: 'Transactions', columns: ['type', 'amount', 'category', 'date'], order: 'date DESC, id DESC' },
  accounts: { table: 'accounts', label: 'Accounts', columns: ['name', 'type', 'institution'], order: 'id DESC', archivedCol: 'archived' },
  habits: { table: 'habits', label: 'Habits', columns: ['name', 'frequency'], order: 'id DESC', archivedCol: 'archived' },
  notes: { table: 'notes', label: 'Notes', columns: ['title', 'updated_at'], order: 'updated_at DESC' },
  budgets: { table: 'budgets', label: 'Budgets', columns: ['category', 'monthly_limit'], order: 'category ASC', idCol: 'category' },
  finance_categories: { table: 'finance_categories', label: 'Categories', columns: ['name', 'position'], order: 'position ASC', idCol: 'name' },
  recurring_transactions: { table: 'recurring_transactions', label: 'Recurring transactions', columns: ['type', 'amount', 'category', 'next_date'], order: 'next_date ASC' },
  savings_goals: { table: 'savings_goals', label: 'Savings goals', columns: ['name', 'target_amount', 'status'], order: 'id DESC', archivedCol: 'archived' },
  debts: { table: 'debts', label: 'Debts', columns: ['person', 'direction', 'amount', 'status'], order: 'id DESC' },
}

const data = {
  // Table metadata used to build the picker screen — row counts so a
  // user can see at a glance what actually has data worth looking at.
  listTables: () => Object.entries(DATA_TABLES).map(([key, cfg]) => {
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ${cfg.table}`).get().n
    const archived = cfg.archivedCol
      ? db.prepare(`SELECT COUNT(*) AS n FROM ${cfg.table} WHERE ${cfg.archivedCol} = 1`).get().n
      : 0
    return { key, label: cfg.label, count: total, archivedCount: archived, hasArchive: !!cfg.archivedCol }
  }),

  getRows: (key, { limit = 50, offset = 0 } = {}) => {
    const cfg = DATA_TABLES[key]
    if (!cfg) throw new Error('Unknown table')
    const idCol = cfg.idCol || 'id'
    const cols = [idCol, ...cfg.columns.filter(c => c !== idCol)]
    if (cfg.archivedCol && !cols.includes(cfg.archivedCol)) cols.push(cfg.archivedCol)
    const rows = db.prepare(`SELECT ${cols.join(', ')} FROM ${cfg.table} ORDER BY ${cfg.order} LIMIT ? OFFSET ?`).all(limit, offset)
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ${cfg.table}`).get().n
    return { rows, total, idCol, columns: cfg.columns, archivedCol: cfg.archivedCol || null, label: cfg.label }
  },

  deleteRow: (key, id) => {
    const cfg = DATA_TABLES[key]
    if (!cfg) throw new Error('Unknown table')
    db.prepare(`DELETE FROM ${cfg.table} WHERE ${cfg.idCol || 'id'} = ?`).run(id)
  },

  setArchived: (key, id, archived) => {
    const cfg = DATA_TABLES[key]
    if (!cfg || !cfg.archivedCol) throw new Error('This table has no archive')
    db.prepare(`UPDATE ${cfg.table} SET ${cfg.archivedCol} = ? WHERE ${cfg.idCol || 'id'} = ?`).run(archived ? 1 : 0, id)
  },

  // Which store-broadcast bucket a table key belongs to, so the caller
  // can fire the same 'db:changed' event every other mutation already
  // relies on to keep every open page in sync.
  broadcastTableFor: (key) => ({
    tasks: 'tasks', events: 'events',
    transactions: 'finance', accounts: 'finance', budgets: 'finance',
    finance_categories: 'finance', recurring_transactions: 'finance',
    habits: 'habits', notes: 'notes', savings_goals: 'savings', debts: 'debts',
  }[key] || 'all'),
}

module.exports = { init, close, backupTo, tasks, subtasks, events, finance, accounts, savings, debts, habits, notes, attachments, profile, phone, data, PHONE_ALERT_MAX_AGE_MS, get raw() { return db } }
