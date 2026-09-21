// scripts/test-native-db.mjs — exercises the ported Android database
// (src/native/db.js + src/native/sqlite.js) under Node.
//
// sql.js is the same WASM build in Node and in the WebView, so everything
// the app's business logic does can be tested here without an emulator.
// Run with:  npm run test:db        (or: node scripts/test-native-db.mjs)
//
// TZ matters. LifeOS stores wall-calendar dates ('YYYY-MM-DD') and the
// original bug these tests guard against was recurrence dates walking
// backwards one day per step east of UTC, because toISOString() converts
// to UTC first. The suite forces Africa/Dar_es_Salaam (UTC+3) so that
// class of bug fails here instead of on the user's phone.
process.env.TZ = process.env.TZ || 'Africa/Dar_es_Salaam'

import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const WASM = join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')

const SQL = await initSqlJs({ locateFile: () => WASM })
const db = await import('../src/native/db.js')
const { localISO, addDaysISO } = await import('../src/lib/dates.js')

// ── Tiny test harness ───────────────────────────────────────────────
let passed = 0, failed = 0
const failures = []
function check(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}`) }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}`) }
}
function eq(actual, expected, what = '') {
  const a = JSON.stringify(actual), b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${what} expected ${b}, got ${a}`)
}
function near(actual, expected, what = '') {
  if (Math.abs(actual - expected) > 0.005) throw new Error(`${what} expected ~${expected}, got ${actual}`)
}
function truthy(v, what = '') { if (!v) throw new Error(`${what} expected truthy, got ${JSON.stringify(v)}`) }
function throws(fn, what = '') {
  try { fn() } catch (_) { return }
  throw new Error(`${what} expected to throw, but did not`)
}

// ── An in-memory storage adapter standing in for Capacitor Filesystem ──
// Same contract as src/native/storage.js: load/attach/markDirty/saveNow/flush.
function memoryStorage(initialBytes = null) {
  let exporter = null
  const store = { bytes: initialBytes, saves: 0 }
  return {
    SQL,
    store,
    attach(fn) { exporter = fn },
    async load() { return store.bytes },
    markDirty() { store.bytes = exporter(); store.saves++ },
    async saveNow(bytes) { store.bytes = bytes; store.saves++ },
    async flush(getBytes) { store.bytes = getBytes(); store.saves++ },
  }
}

console.log(`\nLifeOS Android database tests  (TZ=${process.env.TZ}, today=${localISO()})\n`)

const storage = memoryStorage()
await db.init(storage)

// ── 1. Recurring transactions: dates must not drift ────────────────
console.log('Recurring transactions')

await checkAsync('monthly recurrence advances by calendar month with no UTC drift', async () => {
  // Start six months back so processDue() has to catch up several periods
  // in one go — the exact path where a toISOString() slice lost a day per
  // iteration east of UTC.
  const start = '2025-01-31'
  const rec = db.finance.recurring.create({
    type: 'expense', amount: 1000, category: 'Rent', note: 'Rent',
    frequency: 'monthly', next_date: start,
  })
  db.finance.recurring.processDue()
  const rows = db.finance.getAll().filter(t => t.category === 'Rent')
  truthy(rows.length >= 6, 'expected several caught-up rent rows,')

  // Every generated date must be a real calendar date, and month-end
  // rollovers clamp (Jan 31 -> Feb 28) rather than spilling into March.
  const dates = rows.map(r => r.date).sort()
  eq(dates[0], '2025-01-31', 'first generated date')
  eq(dates[1], '2025-02-28', 'Jan 31 + 1 month clamps to Feb 28,')
  eq(dates[2], '2025-03-28', 'and then keeps the clamped day,')
  for (const d of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`malformed date ${d}`)
  }
  // next_date must now be in the future, not today or earlier.
  const after = db.finance.recurring.getAll().find(r => r.id === rec.id)
  truthy(after.next_date > localISO(), `next_date ${after.next_date} should be after ${localISO()},`)
})

await checkAsync('weekly recurrence lands exactly 7 days apart', async () => {
  const start = addDaysISO(localISO(), -21)
  const rec = db.finance.recurring.create({
    type: 'income', amount: 500, category: 'Other', note: 'Weekly stipend',
    frequency: 'weekly', next_date: start,
  })
  db.finance.recurring.processDue()
  const dates = db.finance.getAll()
    .filter(t => (t.note || '').startsWith('Weekly stipend')).map(t => t.date).sort()
  truthy(dates.length >= 4, 'expected at least 4 weekly rows,')
  for (let i = 1; i < dates.length; i++) {
    const gap = Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000)
    eq(gap, 7, `gap between ${dates[i - 1]} and ${dates[i]}`)
  }
  db.finance.recurring.remove(rec.id)
})

await checkAsync('processDue is idempotent — a second run creates nothing', async () => {
  const before = db.finance.getAll().length
  db.finance.recurring.processDue()
  eq(db.finance.getAll().length, before, 'transaction count after a repeat run')
})

// ── 2. Accounts and debt_in / debt_out ──────────────────────────────
console.log('\nAccounts and balances')

let acct
check('opening balance plus income/expense/transfer', () => {
  acct = db.accounts.create({ name: 'NMB', type: 'bank', opening_balance: 100000 })
  const cash = db.accounts.create({ name: 'Cash', type: 'cash', opening_balance: 0 })
  db.finance.create({ type: 'income', amount: 50000, category: 'General', date: localISO(), account_id: acct.id })
  db.finance.create({ type: 'expense', amount: 20000, category: 'Food', date: localISO(), account_id: acct.id })
  db.finance.transfer({ from_account_id: acct.id, to_account_id: cash.id, amount: 10000, date: localISO() })

  const all = db.accounts.getAll()
  near(all.find(a => a.id === acct.id).balance, 120000, 'NMB balance')
  near(all.find(a => a.id === cash.id).balance, 10000, 'Cash balance')
})

check('a transfer does not touch income or expense totals', () => {
  const before = db.finance.summary()
  truthy(before.income > 0, 'there is some income to move')
  db.finance.transfer({
    from_account_id: acct.id, to_account_id: db.accounts.getAll().find(a => a.name === 'Cash').id,
    amount: 5000, date: localISO(),
  })
  const after = db.finance.summary()
  near(after.income, before.income, 'income total after a transfer')
  near(after.expense, before.expense, 'expense total after a transfer')
  near(after.balance, before.balance, 'net balance after a transfer')
  // put it back so the balances the later tests assert on are untouched
  db.finance.transfer({
    from_account_id: db.accounts.getAll().find(a => a.name === 'Cash').id,
    to_account_id: acct.id, amount: 5000, date: localISO(),
  })
  near(db.accounts.getAll().find(a => a.id === acct.id).balance, 120000, 'NMB balance restored')
})

check('debt_out lowers the balance, debt_in raises it — neither is spending', () => {
  const before = db.finance.summary()
  const lent = db.debts.create({
    direction: 'owed_to_me', person: 'Asha', amount: 30000,
    start_date: localISO(), record_account_id: acct.id,
  })
  const afterLend = db.accounts.getAll().find(a => a.id === acct.id)
  near(afterLend.balance, 90000, 'balance after lending 30000')

  const after = db.finance.summary()
  near(after.expense, before.expense, 'lending must not count as an expense')
  near(after.income, before.income, 'lending must not count as income')

  db.debts.addPayment(lent.id, { amount: 30000, date: localISO(), account_id: acct.id })
  near(db.accounts.getAll().find(a => a.id === acct.id).balance, 120000, 'balance after full repayment')
  const final = db.finance.summary()
  near(final.expense, before.expense, 'repayment must not count as an expense')
  db.debts.remove(lent.id)
})

check('an account with transactions refuses hard delete', () => {
  throws(() => db.accounts.remove(acct.id), 'deleting an account that has transactions')
})

// ── 3. Savings goals: earmarking and milestones ─────────────────────
console.log('\nSavings goals')

let goal
check('deposits earmark money without moving it out of any account', () => {
  const balanceBefore = db.accounts.getAll().find(a => a.id === acct.id).balance
  const r = db.savings.createGoal ? null : null
  goal = db.savings.create({ name: 'Laptop', target_amount: 100000, account_id: acct.id })
  db.savings.addEntry(goal.id, { amount: 20000, date: localISO() })
  const balanceAfter = db.accounts.getAll().find(a => a.id === acct.id).balance
  near(balanceAfter, balanceBefore, 'account balance must be unchanged by a savings deposit')
  near(db.savings.getAll().find(g => g.id === goal.id).saved, 20000, 'goal saved')
})

check('crossing 25/50/75 reports the milestone exactly once', () => {
  // Already at 20% from the deposit above. Crossing to 30% fires 25.
  const a = db.savings.addEntry(goal.id, { amount: 10000, date: localISO() })
  eq(a.milestone, 25, 'milestone at 30%')
  const b = db.savings.addEntry(goal.id, { amount: 5000, date: localISO() })
  eq(b.milestone, null, 'no new milestone at 35%')
  const c = db.savings.addEntry(goal.id, { amount: 20000, date: localISO() })
  eq(c.milestone, 50, 'milestone at 55%')
})

check('reaching the target marks the goal achieved and fires 100', () => {
  const g = db.savings.getAll().find(x => x.id === goal.id)
  const r = db.savings.addEntry(goal.id, { amount: 100000 - g.saved, date: localISO() })
  eq(r.milestone, 100, 'milestone at target')
  eq(db.savings.getAll().find(x => x.id === goal.id).status, 'achieved', 'status')
})

check('withdrawing below the target reopens the goal', () => {
  db.savings.addEntry(goal.id, { amount: -30000, date: localISO() })
  const g = db.savings.getAll().find(x => x.id === goal.id)
  eq(g.status, 'active', 'status after withdrawal')
  near(g.saved, 70000, 'saved after withdrawal')
})

check('you cannot withdraw more than the goal holds', () => {
  throws(() => db.savings.addEntry(goal.id, { amount: -999999, date: localISO() }), 'over-withdrawal')
})

check('archiving a goal releases it from the totals', () => {
  const before = db.savings.summary().totalSaved
  db.savings.archive(goal.id)
  const after = db.savings.summary().totalSaved
  truthy(after < before, `archived goal should leave totals (${before} -> ${after}),`)
  db.savings.unarchive(goal.id)
})

// ── 4. Debts: payments, settle, reopen, removal ─────────────────────
console.log('\nDebts')

let debt
check('partial payments accumulate and leave the debt open', () => {
  debt = db.debts.create({
    direction: 'i_owe', person: 'Juma', amount: 50000, interest: 5000,
    start_date: localISO(), due_date: addDaysISO(localISO(), 10), record_account_id: acct.id,
  })
  near(debt.total, 55000, 'total with interest')
  db.debts.addPayment(debt.id, { amount: 20000, date: localISO(), account_id: acct.id })
  const d = db.debts.getAll().find(x => x.id === debt.id)
  near(d.paid, 20000, 'paid')
  near(d.remaining, 35000, 'remaining')
  eq(d.status, 'open', 'status')
})

check('overpaying is rejected', () => {
  throws(() => db.debts.addPayment(debt.id, { amount: 999999, date: localISO() }), 'overpayment')
})

let settlePaymentId
check('settle clears the remainder and marks the debt settled', () => {
  const r = db.debts.settle(debt.id, { account_id: acct.id })
  truthy(r.settled, 'settle should report settled,')
  const d = db.debts.getAll().find(x => x.id === debt.id)
  eq(d.status, 'settled', 'status')
  near(d.remaining, 0, 'remaining')
  settlePaymentId = r.payment_id
})

check('deleting a payment reopens the debt', () => {
  db.debts.deletePayment ? null : null
  db.debts.removePayment(settlePaymentId)
  const d = db.debts.getAll().find(x => x.id === debt.id)
  eq(d.status, 'open', 'status after deleting the settling payment')
  near(d.remaining, 35000, 'remaining after reopen')
  eq(d.notify_stage, 0, 'reminder state must reset on reopen')
})

check('removing a debt keeps its account transactions', () => {
  const linked = db.finance.getAll().filter(t => t.debt_id === debt.id)
  truthy(linked.length > 0, 'expected linked transactions before removal,')
  const balanceBefore = db.accounts.getAll().find(a => a.id === acct.id).balance
  db.debts.remove(debt.id)
  const balanceAfter = db.accounts.getAll().find(a => a.id === acct.id).balance
  near(balanceAfter, balanceBefore, 'balance must not move when a debt is deleted')
  eq(db.finance.getAll().filter(t => t.debt_id === debt.id).length, 0, 'transactions should be unlinked')
})

check('debt summary nets positions per person', () => {
  const a = db.debts.create({ direction: 'owed_to_me', person: 'Neema', amount: 40000, start_date: localISO() })
  const b = db.debts.create({ direction: 'i_owe', person: 'Neema', amount: 15000, start_date: localISO() })
  const s = db.debts.summary()
  const neema = s.people.find(p => p.person === 'Neema')
  near(neema.net, 25000, 'net position with Neema')
  db.debts.remove(a.id); db.debts.remove(b.id)
})

// ── 5. Habit streaks ────────────────────────────────────────────────
console.log('\nHabits')

check('an unlogged today does not break a streak — it counts from yesterday', () => {
  const h = db.habits.create({ name: 'Read', kind: 'build' })
  const today = localISO()
  // Log yesterday and the two days before. Today deliberately left unlogged:
  // the day is not over, so the streak must still read 3, not 0.
  for (let i = 1; i <= 3; i++) db.habits.toggleLog(h.id, addDaysISO(today, -i))
  eq(db.habits.getAll().find(x => x.id === h.id).streak, 3, 'streak with today unlogged')

  // Logging today extends it to 4 rather than restarting it.
  db.habits.toggleLog(h.id, today)
  eq(db.habits.getAll().find(x => x.id === h.id).streak, 4, 'streak with today logged')

  // A gap two days back ends the streak there.
  db.habits.toggleLog(h.id, addDaysISO(today, -2))  // un-log it
  eq(db.habits.getAll().find(x => x.id === h.id).streak, 2, 'streak after a gap')
  db.habits.remove(h.id)
})

check('a quit habit counts days clean since the last slip', () => {
  const h = db.habits.create({ name: 'No soda', kind: 'quit' })
  db.habits.toggleLog(h.id, addDaysISO(localISO(), -5))   // slipped 5 days ago
  eq(db.habits.getAll().find(x => x.id === h.id).streak, 5, 'days clean')
  db.habits.remove(h.id)
})

check('toggleLog is a true toggle', () => {
  const h = db.habits.create({ name: 'Gym' })
  const today = localISO()
  eq(db.habits.toggleLog(h.id, today), { done: true }, 'first toggle')
  eq(db.habits.toggleLog(h.id, today), { done: false }, 'second toggle')
  eq(db.habits.getLogs(h.id, addDaysISO(today, -7), today).length, 0, 'logs after un-toggling')
  db.habits.remove(h.id)
})

// ── 6. PIN hashing compatibility ────────────────────────────────────
console.log('\nApp lock')

await checkAsync('Web Crypto SHA-256 matches the desktop node:crypto hex digest', async () => {
  const { createHash } = await import('node:crypto')
  await db.profile.setPin('4321')
  const stored = db.profile.get()
  eq(stored.has_pin, 1, 'has_pin')
  // The desktop app stores sha256(pin) as lowercase hex. If these ever
  // diverge, a PIN set on the PC would stop unlocking an imported database.
  const expected = createHash('sha256').update('4321').digest('hex')
  const rawRow = db.raw().prepare('SELECT pin_hash FROM profile WHERE id=1').get()
  eq(rawRow.pin_hash, expected, 'stored hash')
  eq(await db.profile.verifyPin('4321'), true, 'correct PIN')
  eq(await db.profile.verifyPin('0000'), false, 'wrong PIN')
  await db.profile.clearPin()
  eq(await db.profile.verifyPin('anything'), true, 'no PIN set means always unlocked')
})

// ── 7. Persistence and migration idempotency ───────────────────────
console.log('\nPersistence and migrations')

let snapshot
await checkAsync('the exported bytes are a real SQLite file', async () => {
  await db.flush()
  snapshot = storage.store.bytes
  truthy(snapshot && snapshot.length > 0, 'exported bytes')
  const header = Buffer.from(snapshot.slice(0, 15)).toString('latin1')
  eq(header, 'SQLite format 3', 'file header')
})

await checkAsync('reopening the saved bytes preserves every row', async () => {
  const tasksBefore = db.tasks.getAll().length
  const txBefore = db.finance.getAll().length
  const goalsBefore = db.savings.getAll().length

  await db.close()
  await db.init(memoryStorage(snapshot))

  eq(db.tasks.getAll().length, tasksBefore, 'tasks after reopen')
  eq(db.finance.getAll().length, txBefore, 'transactions after reopen')
  eq(db.savings.getAll().length, goalsBefore, 'savings goals after reopen')
})

await checkAsync('migrations are idempotent on an existing database', async () => {
  // init() runs the schema + every ensureColumn on each launch. Re-running
  // it repeatedly must neither throw (duplicate column) nor change data.
  const before = {
    tasks: db.tasks.getAll().length,
    tx: db.finance.getAll().length,
    cols: db.raw().prepare('PRAGMA table_info(profile)').all().length,
  }
  for (let i = 0; i < 3; i++) {
    await db.flush()
    const bytes = db.exportBytes()
    await db.close()
    await db.init(memoryStorage(bytes))
  }
  eq(db.tasks.getAll().length, before.tasks, 'tasks after repeated migrations')
  eq(db.finance.getAll().length, before.tx, 'transactions after repeated migrations')
  eq(db.raw().prepare('PRAGMA table_info(profile)').all().length, before.cols, 'profile column count')
})

await checkAsync('a database created by an OLDER schema is migrated on open', async () => {
  // Simulates importing a lifeos.db from an early desktop build: the core
  // tables exist but none of the later ensureColumn() additions do.
  const legacy = new SQL.Database()
  legacy.run(`
    CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
      description TEXT DEFAULT '', due_date TEXT, due_time TEXT, priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'pending', tags TEXT DEFAULT '[]', recurring TEXT DEFAULT 'none',
      notified INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), completed_at TEXT);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL,
      amount REAL NOT NULL, category TEXT DEFAULT 'General', note TEXT DEFAULT '',
      date TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE profile (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT DEFAULT '',
      bio TEXT DEFAULT '', avatar_path TEXT, pin_hash TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    INSERT INTO profile (id, name) VALUES (1, 'Bert');
    INSERT INTO tasks (title) VALUES ('Legacy task');
    INSERT INTO transactions (type, amount, date) VALUES ('income', 1234, '2025-01-01');
  `)
  const bytes = legacy.export()
  legacy.close()

  await db.close()
  await db.init(memoryStorage(bytes))

  eq(db.tasks.getAll().length, 1, 'legacy task survived')
  eq(db.profile.get().name, 'Bert', 'legacy profile survived')
  // Columns added by later migrations must now exist and be usable.
  const cols = db.raw().prepare('PRAGMA table_info(transactions)').all().map(c => c.name)
  truthy(cols.includes('account_id'), 'account_id added,')
  truthy(cols.includes('debt_id'), 'debt_id added,')
  truthy(cols.includes('merchant'), 'merchant added,')
  // And the tables that did not exist at all are created.
  eq(db.savings.getAll().length, 0, 'savings_goals table created')
  eq(db.debts.getAll().length, 0, 'debts table created')
  near(db.finance.summary().income, 1234, 'legacy transaction still counted')
})

// ── 8. Finance categories ────────────────────────────────────────────
console.log('\nFinance categories')

check('categories are seeded from the old hardcoded list', () => {
  const cats = db.finance.categories.getAll()
  truthy(cats.includes('General'), 'General present')
  truthy(cats.includes('Food'), 'Food present')
  truthy(cats.length >= 10, 'at least the ten defaults')
})

check('create adds a category at the end and rejects a duplicate (case-insensitive)', () => {
  const before = db.finance.categories.getAll()
  const after = db.finance.categories.create('Gifts')
  eq(after.length, before.length + 1, 'one category added')
  eq(after[after.length - 1], 'Gifts', 'new category appended')
  throws(() => db.finance.categories.create('gifts'), 'duplicate name, different case')
  throws(() => db.finance.categories.create('   '), 'blank name')
})

check('rename updates the category and every transaction/budget/recurring row using it', () => {
  db.finance.categories.create('Pets')
  db.finance.budgets.set('Pets', 20000)
  db.finance.create({ type: 'expense', amount: 5000, category: 'Pets', date: localISO() })
  db.finance.recurring.create({ type: 'expense', amount: 3000, category: 'Pets', frequency: 'monthly', next_date: localISO() })

  db.finance.categories.rename('Pets', 'Pet care')

  const cats = db.finance.categories.getAll()
  truthy(cats.includes('Pet care'), 'renamed category present')
  truthy(!cats.includes('Pets'), 'old name gone')
  truthy(db.finance.budgets.getAll().some(b => b.category === 'Pet care'), 'budget followed the rename')
  truthy(db.finance.getAll().some(t => t.category === 'Pet care'), 'transaction followed the rename')
  truthy(db.finance.recurring.getAll().some(r => r.category === 'Pet care'), 'recurring followed the rename')

  throws(() => db.finance.categories.rename('Pet care', 'Food'), 'renaming onto an existing category')
})

check('a category in use cannot be deleted, but an unused one can', () => {
  throws(() => db.finance.categories.remove('Pet care'), 'still has a transaction')

  db.finance.categories.create('Temp')
  const after = db.finance.categories.remove('Temp')
  truthy(!after.includes('Temp'), 'unused category removed')
})

check('deleting a category clears its now-orphaned budget', () => {
  db.finance.categories.create('ShortLived')
  db.finance.budgets.set('ShortLived', 1000)
  db.finance.categories.remove('ShortLived')
  truthy(!db.finance.budgets.getAll().some(b => b.category === 'ShortLived'), 'budget removed with the category')
})

check('the last remaining category cannot be deleted', () => {
  // Every earlier section in this suite has left several categories
  // genuinely in use (Food, Rent, General, ...), so remove() can't reach
  // count 1 through its own API without hitting the "in use" guard
  // first — which is correct, but means the "keep at least one" branch
  // needs its own isolated setup: force the table down to a single row
  // with raw SQL, exercise the guard, then put everything back so later
  // assertions (and, if this section ever moves, earlier ones) still see
  // the categories they created.
  const all = db.finance.categories.getAll()
  const sole = all[0]
  const raw = db.raw()
  const saved = raw.prepare('SELECT name, position FROM finance_categories').all()
  raw.prepare('DELETE FROM finance_categories WHERE name <> ?').run(sole)
  eq(db.finance.categories.getAll().length, 1, 'forced down to one category')
  throws(() => db.finance.categories.remove(sole), 'cannot delete the last category')

  const restore = raw.transaction((rows) => {
    for (const r of rows) raw.prepare('INSERT OR IGNORE INTO finance_categories (name, position) VALUES (?,?)').run(r.name, r.position)
  })
  restore(saved)
  eq(db.finance.categories.getAll().length, all.length, 'every category restored')
})

check('reorder persists the given order', () => {
  db.finance.categories.create('Alpha')
  db.finance.categories.create('Beta')
  db.finance.categories.create('Gamma')
  const current = db.finance.categories.getAll()
  const reversed = [...current].reverse()
  const after = db.finance.categories.reorder(reversed)
  eq(after.join(','), reversed.join(','), 'order matches what was requested')
})

// ── 9. Transaction rollback ─────────────────────────────────────────
console.log('\nTransactions')

check('a failed write inside a transaction leaves no partial rows', () => {
  const a = db.accounts.create({ name: 'Rollback test', opening_balance: 0 })
  const before = db.finance.getAll().length
  throws(() => db.debts.create({ direction: 'i_owe', person: '', amount: 500, record_account_id: a.id }), 'debt with no person')
  eq(db.finance.getAll().length, before, 'no stray transaction row')
  eq(db.debts.getAll().length, 0, 'no stray debt row')
})

// ── Result ──────────────────────────────────────────────────────────
await db.close()
console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed) {
  console.log('Failures:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
