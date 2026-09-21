// src/native/bridge.js — the Android stand-in for electron/preload.cjs +
// the ipcMain handlers in electron/main.cjs.
//
// Every channel from preload.cjs exists here with the same name, the same
// arguments and the same return shape — including the { ok, error }
// wrappers that Savings, Debts, transfers and account deletion rely on —
// so not one line of the React app needs to know which platform it is
// running on. Where a channel has no meaning on a phone (auto-launch,
// Google Drive, the phone-notification relay, quitting to a desktop) it
// still exists and returns a neutral value; Settings hides those cards
// anyway, but a stray call must not throw.
//
// The desktop broadcasts 'db:changed' over IPC; here the same payloads go
// through a tiny in-app emitter, with the identical table names and the
// identical broadcast rules (debt writes fan out to both 'debts' and
// 'finance', because a debt can move an account balance).
import * as db from './db.js'
import * as ai from './ai.js'
import * as files from './files.js'
import * as backup from './backup.js'
import { buildFinanceReportHtml } from './reportTemplate.js'
import { scheduleSoon, getPermissionState, ensurePermissions, openExactAlarmSettings } from './scheduler.js'
import { localISO } from '../lib/dates.js'

// ── db:changed emitter ───────────────────────────────────────────────
const listeners = new Set()

function broadcast(table) {
  for (const t of [].concat(table)) {
    for (const cb of listeners) {
      try { cb({ table: t }) } catch { /* a bad listener must not stop the rest */ }
    }
  }
  // Any write can change what is due, so recompute the Android alarm set.
  scheduleSoon(db)
}

// Exported so the app-resume handler in index.js can announce rows that
// were created outside a user action (recurring transactions catching
// up while the app was backgrounded).
export function broadcastTables(tables) { broadcast(tables) }

export function onDbChanged(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

// Same helper as main.cjs: turns a throwing call into { ok, error }.
const guarded = (fn) => (...args) => {
  try { return { ok: true, ...fn(...args) } }
  catch (e) { return { ok: false, error: e.message } }
}

// ai.FINANCE_CATEGORIES was the old hardcoded fallback list; categories
// are now user-editable (db.finance.categories), so parseTransaction
// below passes the live list instead.

// ── the API ──────────────────────────────────────────────────────────

export function createNativeApi({ SQL } = {}) {
  return {
    tasks: {
      getAll: async () => db.tasks.getAll(),
      create: async (data) => { const r = db.tasks.create(data); broadcast('tasks'); return r },
      update: async (id, data) => { const r = db.tasks.update(id, data); broadcast('tasks'); return r },
      delete: async (id) => { db.tasks.remove(id); broadcast('tasks') },
      toggle: async (id) => { const r = db.tasks.toggle(id); broadcast('tasks'); return r },
    },
    subtasks: {
      getFor: async (taskId) => db.subtasks.getFor(taskId),
      create: async (taskId, title) => { const r = db.subtasks.create(taskId, title); broadcast('tasks'); return r },
      toggle: async (id) => { const r = db.subtasks.toggle(id); broadcast('tasks'); return r },
      delete: async (id) => { db.subtasks.remove(id); broadcast('tasks') },
    },
    events: {
      getAll: async () => db.events.getAll(),
      create: async (data) => { const r = db.events.create(data); broadcast('events'); return r },
      update: async (id, data) => { const r = db.events.update(id, data); broadcast('events'); return r },
      delete: async (id) => { db.events.remove(id); broadcast('events') },
    },
    finance: {
      getAll: async () => db.finance.getAll(),
      create: async (data) => { const r = db.finance.create(data); broadcast('finance'); return r },
      delete: async (id) => { db.finance.remove(id); broadcast('finance') },
      summary: async () => db.finance.summary(),
      getCategories: async () => db.finance.categories.getAll(),
      createCategory: async (name) => {
        try { const categories = db.finance.categories.create(name); broadcast('finance'); return { ok: true, categories } }
        catch (e) { return { ok: false, error: e.message } }
      },
      renameCategory: async (oldName, newName) => {
        try { const categories = db.finance.categories.rename(oldName, newName); broadcast('finance'); return { ok: true, categories } }
        catch (e) { return { ok: false, error: e.message } }
      },
      deleteCategory: async (name) => {
        try { const categories = db.finance.categories.remove(name); broadcast('finance'); return { ok: true, categories } }
        catch (e) { return { ok: false, error: e.message } }
      },
      reorderCategories: async (names) => { const r = db.finance.categories.reorder(names); broadcast('finance'); return r },
      getBudgets: async () => db.finance.budgets.getAll(),
      setBudget: async (category, limit) => { const r = db.finance.budgets.set(category, limit); broadcast('finance'); return r },
      deleteBudget: async (category) => { db.finance.budgets.remove(category); broadcast('finance') },
      getRecurring: async () => db.finance.recurring.getAll(),
      createRecurring: async (data) => { const r = db.finance.recurring.create(data); broadcast('finance'); return r },
      toggleRecurring: async (id) => { const r = db.finance.recurring.toggle(id); broadcast('finance'); return r },
      deleteRecurring: async (id) => { db.finance.recurring.remove(id); broadcast('finance') },
      createTransfer: async (data) => {
        try { const r = db.finance.transfer(data); broadcast('finance'); return { ok: true, data: r } }
        catch (e) { return { ok: false, error: e.message } }
      },
      // Desktop renders this HTML in a hidden window and calls
      // printToPDF. Android has no printToPDF, so the same HTML is saved
      // and shared — Chrome's Print -> Save as PDF produces the same
      // document. Return shape stays { path } / null so Finance.jsx is
      // unchanged.
      exportPdf: async () => {
        const profile = db.profile.get()
        const summary = db.finance.summary()
        const budgets = db.finance.budgets.getAll()
        const recurring = db.finance.recurring.getAll()
        const transactions = db.finance.getAll()
        const goals = db.savings.getAll().filter(g => !g.archived)
        const debts = db.debts.getAll().filter(d => d.status === 'open')
        const generatedAt = new Date().toLocaleString()
        const html = buildFinanceReportHtml({ profile, summary, budgets, recurring, transactions, goals, debts, generatedAt })
        try {
          const rel = `exports/LifeOS Financial Report ${localISO()}.html`
          const r = await files.shareText(rel, html, { title: 'LifeOS Financial Report' })
          return { path: r.path, html: true }
        } catch (e) {
          if (/cancel/i.test(e?.message || '')) return null
          throw e
        }
      },
    },
    accounts: {
      getAll: async () => db.accounts.getAll(),
      create: async (data) => { const r = db.accounts.create(data); broadcast('finance'); return r },
      update: async (id, data) => { const r = db.accounts.update(id, data); broadcast('finance'); return r },
      archive: async (id) => { db.accounts.archive(id); broadcast('finance') },
      unarchive: async (id) => { db.accounts.unarchive(id); broadcast('finance') },
      delete: async (id) => {
        try { db.accounts.remove(id); broadcast('finance'); return { ok: true } }
        catch (e) { return { ok: false, error: e.message } }
      },
    },
    savings: {
      getAll: async () => db.savings.getAll(),
      summary: async () => db.savings.summary(),
      getEntries: async (goalId) => db.savings.getEntries(goalId),
      createGoal: async (data) => { const r = guarded(() => ({ goal: db.savings.create(data) }))(); if (r.ok) broadcast('savings'); return r },
      updateGoal: async (id, data) => { const r = guarded(() => ({ goal: db.savings.update(id, data) }))(); if (r.ok) broadcast('savings'); return r },
      archiveGoal: async (id) => { db.savings.archive(id); broadcast('savings') },
      unarchiveGoal: async (id) => { db.savings.unarchive(id); broadcast('savings') },
      deleteGoal: async (id) => { db.savings.remove(id); broadcast('savings') },
      addEntry: async (goalId, data) => { const r = guarded(() => db.savings.addEntry(goalId, data))(); if (r.ok) broadcast('savings'); return r },
      deleteEntry: async (id) => { const goal = db.savings.removeEntry(id); broadcast('savings'); return { ok: true, goal } },
    },
    debts: {
      getAll: async () => db.debts.getAll(),
      summary: async () => db.debts.summary(),
      getPayments: async (debtId) => db.debts.getPayments(debtId),
      create: async (data) => { const r = guarded(() => ({ debt: db.debts.create(data) }))(); if (r.ok) broadcast(['debts', 'finance']); return r },
      update: async (id, data) => { const r = guarded(() => ({ debt: db.debts.update(id, data) }))(); if (r.ok) broadcast(['debts', 'finance']); return r },
      delete: async (id) => { db.debts.remove(id); broadcast(['debts', 'finance']) },
      addPayment: async (id, data) => { const r = guarded(() => db.debts.addPayment(id, data))(); if (r.ok) broadcast(['debts', 'finance']); return r },
      settle: async (id, data) => { const r = guarded(() => db.debts.settle(id, data))(); if (r.ok) broadcast(['debts', 'finance']); return r },
      deletePayment: async (paymentId) => { const debt = db.debts.removePayment(paymentId); broadcast(['debts', 'finance']); return { ok: true, debt } },
    },
    // The phone relay pushes desktop alerts to an Android phone over
    // Google Calendar. On the phone itself it is meaningless — this IS
    // the phone — so the channel reports "not supported" and Settings
    // hides the card.
    phone: {
      getStatus: async () => ({ ...db.phone.getStatus(), supported: false }),
      setEnabled: async () => ({ ...db.phone.getStatus(), supported: false }),
      setQuiet: async (data) => { const r = db.phone.setQuiet(data || {}); broadcast('phone'); return r },
      sendTest: async () => ({ ok: false, error: 'Phone alerts are a desktop-only feature.' }),
    },
    ai: {
      getSettings: async () => {
        const s = db.profile.getAiSettings()
        return { has_key: !!s.ai_api_key, model: s.ai_model }
      },
      saveSettings: async ({ apiKey, model } = {}) => {
        const current = db.profile.getAiSettings()
        const r = db.profile.setAiSettings({
          ai_api_key: apiKey ? apiKey : current.ai_api_key,
          ai_model: model || current.ai_model,
        })
        broadcast('profile')
        return { has_key: !!r.ai_api_key, model: r.ai_model }
      },
      clearKey: async () => {
        const current = db.profile.getAiSettings()
        db.profile.setAiSettings({ ai_api_key: '', ai_model: current.ai_model })
        broadcast('profile')
        return { has_key: false, model: current.ai_model }
      },
      parseTransaction: async (text) => {
        const { ai_api_key, ai_model } = db.profile.getAiSettings()
        const accountNames = db.accounts.getAll().filter(a => !a.archived).map(a => a.name)
        return ai.parseTransaction({ apiKey: ai_api_key, model: ai_model, text, categories: db.finance.categories.getAll(), accountNames, today: localISO() })
      },
      generateInsights: async () => {
        const { ai_api_key, ai_model } = db.profile.getAiSettings()
        const summary = db.finance.summary()
        const budgets = db.finance.budgets.getAll()
        const goals = db.savings.getAll().filter(g => !g.archived)
        const debtSummary = db.debts.summary()
        const payload = {
          income: summary.income, expense: summary.expense, balance: summary.balance,
          byCategory: summary.byCategory, monthly: summary.monthly,
          budgets: budgets.map(b => ({ category: b.category, monthly_limit: b.monthly_limit, spent: b.spent, percent: b.percent })),
          savingsGoals: goals.map(g => ({ name: g.name, target: g.target_amount, saved: g.saved, status: g.status, deadline: g.target_date })),
          debts: {
            owed_to_me: debtSummary.owedToMe, i_owe: debtSummary.iOwe,
            overdue_owed_to_me: debtSummary.overdueOwedToMe, overdue_i_owe: debtSummary.overdueIOwe,
          },
        }
        return ai.generateInsights({ apiKey: ai_api_key, model: ai_model, payload })
      },
    },
    habits: {
      getAll: async () => db.habits.getAll(),
      create: async (data) => { const r = db.habits.create(data); broadcast('habits'); return r },
      update: async (id, data) => { const r = db.habits.update(id, data); broadcast('habits'); return r },
      delete: async (id) => { db.habits.remove(id); broadcast('habits') },
      archive: async (id) => { db.habits.archive(id); broadcast('habits') },
      unarchive: async (id) => { db.habits.unarchive(id); broadcast('habits') },
      toggleLog: async (habitId, date) => { const r = db.habits.toggleLog(habitId, date); broadcast('habits'); return r },
      getLogs: async (habitId, from, to) => db.habits.getLogs(habitId, from, to),
    },
    notes: {
      getAll: async () => db.notes.getAll(),
      create: async (data) => { const r = db.notes.create(data); broadcast('notes'); return r },
      update: async (id, data) => { const r = db.notes.update(id, data); broadcast('notes'); return r },
      delete: async (id) => { db.notes.remove(id); broadcast('notes') },
    },
    attachments: {
      // Desktop returns the path of the file the user chose and leaves it
      // where it is; Android copies it into app storage first and returns
      // that relative path, because the picker's own path stops
      // resolving as soon as the app restarts.
      pick: async () => files.pickAttachment(),
      add: async (parentType, parentId, filePath) => {
        const r = db.attachments.add(parentType, parentId, filePath)
        broadcast(parentType === 'note' ? 'notes' : parentType === 'task' ? 'tasks' : 'events')
        return r
      },
      getFor: async (parentType, parentId) => db.attachments.getFor(parentType, parentId),
      remove: async (id, parentType) => {
        // The desktop leaves the original file alone because it never
        // owned it. Android's copy lives in app storage, so deleting the
        // row without deleting the file would leak space forever.
        let path = null
        try { path = db.raw().prepare('SELECT file_path FROM attachments WHERE id = ?').get(id)?.file_path } catch { /* gone */ }
        db.attachments.remove(id)
        if (path) await files.removeFile(path)
        broadcast(parentType === 'note' ? 'notes' : parentType === 'task' ? 'tasks' : 'events')
      },
      // "Show in folder" has no Android equivalent — share the file so it
      // can be opened in a gallery or viewer.
      openInFolder: async (filePath) => {
        try { await files.shareFile(filePath, 'Attachment') }
        catch (e) { return { ok: false, error: e.message } }
      },
    },
    profile: {
      get: async () => db.profile.get(),
      update: async (data) => { const r = db.profile.update(data); broadcast('profile'); return r },
      pickAvatar: async () => {
        const rel = await files.pickAvatarFile()
        if (!rel) return null
        const current = db.profile.get()
        if (current.avatar_path && current.avatar_path !== rel) await files.removeFile(current.avatar_path)
        const r = db.profile.setAvatar(rel)
        broadcast('profile')
        return r
      },
      hasPin: async () => db.profile.get().has_pin === 1,
      setPin: async (pin) => { const r = await db.profile.setPin(pin); broadcast('profile'); return r },
      clearPin: async () => { const r = db.profile.clearPin(); broadcast('profile'); return r },
      verifyPin: async (pin) => db.profile.verifyPin(pin),
    },
    // No "start with Windows" on Android; the card is hidden and this
    // always reports off.
    settings: {
      getAutoLaunch: async () => false,
      setAutoLaunch: async () => false,
    },
    // Google Drive OAuth is not implemented on Android (a loopback
    // redirect needs a desktop browser). Every call reports it as
    // unavailable rather than throwing.
    drive: {
      getStatus: async () => ({ connected: false, supported: false, auto_backup: 0, last_backup_at: null }),
      saveCredentials: async () => ({ ok: false, error: 'Google Drive backup is desktop-only. Use Backup & transfer instead.' }),
      connect: async () => ({ ok: false, error: 'Google Drive backup is desktop-only. Use Backup & transfer instead.' }),
      disconnect: async () => ({ ok: true }),
      setAutoBackup: async () => ({ ok: false, error: 'Google Drive backup is desktop-only.' }),
      backupNow: async () => ({ ok: false, error: 'Google Drive backup is desktop-only. Use Backup & transfer instead.' }),
      listBackups: async () => ({ ok: false, error: 'Google Drive backup is desktop-only.', files: [] }),
      restore: async () => ({ ok: false, error: 'Google Drive backup is desktop-only.' }),
    },
    app: {
      quit: async () => {
        const { App } = await import('@capacitor/app')
        await db.flush()
        await App.exitApp()
      },
      openExternal: async (url) => { window.open(url, '_blank') },
      copyText: async (text) => {
        if (typeof text !== 'string') return
        try { await navigator.clipboard.writeText(text) } catch { /* no clipboard permission */ }
      },
    },

    // ── Android-only additions ───────────────────────────────────────
    // Not in preload.cjs — Settings only calls these when
    // window.api.android exists, so the desktop build is untouched.
    android: {
      isNative: true,
      exportDatabase: async () => {
        try {
          await db.flush()
          const r = await backup.exportDatabase(db.exportBytes())
          return { ok: true, ...r }
        } catch (e) {
          if (/cancel/i.test(e?.message || '')) return { ok: false, cancelled: true }
          return { ok: false, error: e.message }
        }
      },
      // Two-step on purpose: pick + validate returns a summary the UI can
      // show in a confirmation dialog, and only confirmImport() replaces
      // anything.
      pickImport: async () => {
        try {
          const picked = await backup.pickDatabaseFile()
          if (!picked) return { ok: false, cancelled: true }
          const check = backup.validateDatabase(SQL, picked.bytes)
          if (!check.ok) return check
          pendingImport = picked.bytes
          return { ok: true, name: picked.name, counts: check.counts, size: picked.bytes.length }
        } catch (e) { return { ok: false, error: e.message } }
      },
      confirmImport: async () => {
        if (!pendingImport) return { ok: false, error: 'Nothing to import — pick a file first.' }
        try {
          await db.replaceWith(pendingImport)
          pendingImport = null
          broadcast('all')
          return { ok: true }
        } catch (e) { return { ok: false, error: e.message } }
      },
      cancelImport: async () => { pendingImport = null; return { ok: true } },
      notificationStatus: async () => getPermissionState(),
      requestNotifications: async () => ensurePermissions(),
      openExactAlarmSettings: async () => { await openExactAlarmSettings(); return { ok: true } },
      fileMissing: async (path) => !(await files.exists(path)),
    },

    // ── Data browser (Settings > Manage your data) ───────────────────
    data: {
      listTables: async () => db.data.listTables(),
      getRows: async (key, opts) => db.data.getRows(key, opts),
      deleteRow: async (key, id) => {
        db.data.deleteRow(key, id)
        broadcast(db.data.broadcastTableFor(key))
      },
      setArchived: async (key, id, archived) => {
        db.data.setArchived(key, id, archived)
        broadcast(db.data.broadcastTableFor(key))
      },
    },

    onDbChanged,
  }
}

let pendingImport = null
