// electron/main.cjs — the app's native shell.
// Responsibilities: create the window, keep the app alive in the system
// tray when the window is closed (so background tracking/notifications
// keep working), register for auto-start on Windows login, and expose
// the local SQLite database to the renderer over IPC.
const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, dialog, nativeImage, shell, net, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const AutoLaunch = require('auto-launch')
const db = require('./db.cjs')
const ai = require('./ai.cjs')
const drive = require('./drive.cjs')
const phone = require('./phone.cjs')
const { localISO } = require('./dates.cjs')
const { checkDueItems } = require('./notifications.cjs')
const { buildFinanceReportHtml } = require('./reportTemplate.cjs')

const isDev = !app.isPackaged
let mainWindow = null
let tray = null
let isQuitting = false
let pollTimer = null

const autoLauncher = new AutoLaunch({ name: 'LifeOS', path: app.getPath('exe') })

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0b0e14',
    show: false,
    frame: true,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Minimize-to-tray instead of quitting: this is what makes LifeOS keep
  // tracking events/tasks and firing notifications in the background
  // instead of dying the moment the window is closed.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.ico'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('LifeOS — running in background')
  const menu = Menu.buildFromTemplate([
    { label: 'Open LifeOS', click: () => { mainWindow.show() } },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: false,
      click: async (item) => {
        if (item.checked) await autoLauncher.enable()
        else await autoLauncher.disable()
      },
    },
    { type: 'separator' },
    { label: 'Quit LifeOS completely', click: () => { isQuitting = true; app.quit() } },
  ])
  autoLauncher.isEnabled().then(enabled => { menu.items[2].checked = enabled }).catch(() => {})
  tray.setContextMenu(menu)
  tray.on('click', () => { mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show() })
}

app.whenReady().then(async () => {
  db.init()
  db.finance.recurring.processDue()
  createWindow()
  createTray()

  // First run: enable auto-start by default, per the "keep tracking my
  // full life" requirement — the tray menu lets the user turn it off.
  try {
    const enabled = await autoLauncher.isEnabled()
    if (!enabled) await autoLauncher.enable()
  } catch (_) { /* non-fatal — Linux/dev environments may not support this */ }

  // Poll for due tasks/events/habit reminders every 30s and fire native
  // Windows notifications. Also pushes a 'db:changed' event to the
  // renderer so any open view refreshes instantly — no manual reload.
  pollTimer = setInterval(() => {
    const due = checkDueItems(db)
    for (const item of due) {
      const n = new Notification({ title: item.title, body: item.body, silent: false })
      n.on('click', () => { mainWindow.show() })
      n.show()
      // Every notification fired on the desktop is also queued for the
      // phone (if phone alerts are on) — see relayToPhone() below.
      relayToPhone(item)
    }
    if (due.length && mainWindow) mainWindow.webContents.send('db:changed', { table: 'all' })

    const financeCreated = db.finance.recurring.processDue()
    if (financeCreated) broadcast('finance')

    maybeRunAutoBackup()
    flushPhoneAlerts() // also retries anything that couldn't go out while offline
  }, 30_000)

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

// A full quit needs to stop everything the background session is doing,
// not just close the window: the 30s notification/recurrence poll, the
// tray icon (which otherwise lingers until Explorer notices it's gone),
// and the SQLite connection (so WAL gets checkpointed cleanly).
app.on('before-quit', () => {
  isQuitting = true
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (tray) { tray.destroy(); tray = null }
  db.close()
})
app.on('window-all-closed', () => { /* keep running in tray on Windows/Linux */ })

// `table` may be one name or a list — e.g. a debt payment recorded against
// an account changes both 'debts' and 'finance'.
function broadcast(table) {
  if (!mainWindow) return
  for (const t of [].concat(table)) mainWindow.webContents.send('db:changed', { table: t })
}

// ── IPC: Tasks ──────────────────────────────────────────────────────────
ipcMain.handle('tasks:getAll', () => db.tasks.getAll())
ipcMain.handle('tasks:create', (_e, data) => { const r = db.tasks.create(data); broadcast('tasks'); return r })
ipcMain.handle('tasks:update', (_e, id, data) => { const r = db.tasks.update(id, data); broadcast('tasks'); return r })
ipcMain.handle('tasks:delete', (_e, id) => { db.tasks.remove(id); broadcast('tasks') })
ipcMain.handle('tasks:toggle', (_e, id) => { const r = db.tasks.toggle(id); broadcast('tasks'); return r })

// ── IPC: Subtasks ───────────────────────────────────────────────────────
ipcMain.handle('subtasks:getFor', (_e, taskId) => db.subtasks.getFor(taskId))
ipcMain.handle('subtasks:create', (_e, taskId, title) => { const r = db.subtasks.create(taskId, title); broadcast('tasks'); return r })
ipcMain.handle('subtasks:toggle', (_e, id) => { const r = db.subtasks.toggle(id); broadcast('tasks'); return r })
ipcMain.handle('subtasks:delete', (_e, id) => { db.subtasks.remove(id); broadcast('tasks') })

// ── IPC: Events / Calendar ─────────────────────────────────────────────
ipcMain.handle('events:getAll', () => db.events.getAll())
ipcMain.handle('events:create', (_e, data) => { const r = db.events.create(data); broadcast('events'); return r })
ipcMain.handle('events:update', (_e, id, data) => { const r = db.events.update(id, data); broadcast('events'); return r })
ipcMain.handle('events:delete', (_e, id) => { db.events.remove(id); broadcast('events') })

// ── IPC: Finance ────────────────────────────────────────────────────────
ipcMain.handle('finance:getAll', () => db.finance.getAll())
ipcMain.handle('finance:create', (_e, data) => { const r = db.finance.create(data); broadcast('finance'); return r })
ipcMain.handle('finance:delete', (_e, id) => { db.finance.remove(id); broadcast('finance') })
ipcMain.handle('finance:summary', () => db.finance.summary())
ipcMain.handle('finance:getCategories', () => db.finance.categories.getAll())
ipcMain.handle('finance:createCategory', (_e, name) => {
  try { const categories = db.finance.categories.create(name); broadcast('finance'); return { ok: true, categories } }
  catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle('finance:renameCategory', (_e, oldName, newName) => {
  try { const categories = db.finance.categories.rename(oldName, newName); broadcast('finance'); return { ok: true, categories } }
  catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle('finance:deleteCategory', (_e, name) => {
  try { const categories = db.finance.categories.remove(name); broadcast('finance'); return { ok: true, categories } }
  catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle('finance:reorderCategories', (_e, names) => { const r = db.finance.categories.reorder(names); broadcast('finance'); return r })
ipcMain.handle('finance:getBudgets', () => db.finance.budgets.getAll())
ipcMain.handle('finance:setBudget', (_e, category, limit) => { const r = db.finance.budgets.set(category, limit); broadcast('finance'); return r })
ipcMain.handle('finance:deleteBudget', (_e, category) => { db.finance.budgets.remove(category); broadcast('finance') })
ipcMain.handle('finance:getRecurring', () => db.finance.recurring.getAll())
ipcMain.handle('finance:createRecurring', (_e, data) => { const r = db.finance.recurring.create(data); broadcast('finance'); return r })
ipcMain.handle('finance:toggleRecurring', (_e, id) => { const r = db.finance.recurring.toggle(id); broadcast('finance'); return r })
ipcMain.handle('finance:deleteRecurring', (_e, id) => { db.finance.recurring.remove(id); broadcast('finance') })
ipcMain.handle('finance:createTransfer', (_e, data) => {
  try { const r = db.finance.transfer(data); broadcast('finance'); return { ok: true, data: r } }
  catch (e) { return { ok: false, error: e.message } }
})

// ── IPC: Accounts (Bank, Cash, Mobile Money, ...) ──────────────────────
ipcMain.handle('accounts:getAll', () => db.accounts.getAll())
ipcMain.handle('accounts:create', (_e, data) => { const r = db.accounts.create(data); broadcast('finance'); return r })
ipcMain.handle('accounts:update', (_e, id, data) => { const r = db.accounts.update(id, data); broadcast('finance'); return r })
ipcMain.handle('accounts:archive', (_e, id) => { db.accounts.archive(id); broadcast('finance') })
ipcMain.handle('accounts:unarchive', (_e, id) => { db.accounts.unarchive(id); broadcast('finance') })
ipcMain.handle('accounts:delete', (_e, id) => {
  try { db.accounts.remove(id); broadcast('finance'); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})

// ── IPC: AI (Finance — Smart Add + Insights) ───────────────────────────
// Categories used to be this hardcoded list; they're now user-editable
// (db.finance.categories, seeded from this same list on first run — see
// seedFinanceCategories in electron/db.cjs) so Smart Add sees whatever
// the user has actually renamed/added/removed.

ipcMain.handle('ai:getSettings', () => {
  const s = db.profile.getAiSettings()
  return { has_key: !!s.ai_api_key, model: s.ai_model }
})
ipcMain.handle('ai:saveSettings', (_e, { apiKey, model } = {}) => {
  const current = db.profile.getAiSettings()
  const r = db.profile.setAiSettings({
    ai_api_key: apiKey ? apiKey : current.ai_api_key,
    ai_model: model || current.ai_model,
  })
  broadcast('profile')
  return { has_key: !!r.ai_api_key, model: r.ai_model }
})
ipcMain.handle('ai:clearKey', () => {
  const current = db.profile.getAiSettings()
  db.profile.setAiSettings({ ai_api_key: '', ai_model: current.ai_model })
  broadcast('profile')
  return { has_key: false, model: current.ai_model }
})
ipcMain.handle('ai:parseTransaction', async (_e, text) => {
  const { ai_api_key, ai_model } = db.profile.getAiSettings()
  const accountNames = db.accounts.getAll().filter(a => !a.archived).map(a => a.name)
  const today = localISO()
  return ai.parseTransaction({ apiKey: ai_api_key, model: ai_model, text, categories: db.finance.categories.getAll(), accountNames, today })
})
ipcMain.handle('ai:generateInsights', async () => {
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
})

// Renders a finance report to PDF using a hidden, throwaway BrowserWindow
// (loading a plain data: URL) and Chromium's native printToPDF — avoids
// pulling in a PDF library and its own native-build risk.
ipcMain.handle('finance:exportPdf', async () => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Financial Report',
    defaultPath: path.join(app.getPath('documents'), `LifeOS Financial Report ${localISO()}.pdf`),
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
  })
  if (res.canceled || !res.filePath) return null

  const profile = db.profile.get()
  const summary = db.finance.summary()
  const budgets = db.finance.budgets.getAll()
  const recurring = db.finance.recurring.getAll()
  const transactions = db.finance.getAll()
  const goals = db.savings.getAll().filter(g => !g.archived)
  const debts = db.debts.getAll().filter(d => d.status === 'open')
  const generatedAt = new Date().toLocaleString()
  const html = buildFinanceReportHtml({ profile, summary, budgets, recurring, transactions, goals, debts, generatedAt })

  const printWin = new BrowserWindow({ show: false })
  try {
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const footerName = esc((profile?.name || '').trim() || 'LifeOS Financial Report')
    const pdfBuffer = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.6, left: 0.5, right: 0.5 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;font-size:8px;color:#999;padding:0 12mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif;">
          <span>${footerName}</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>`,
    })
    fs.writeFileSync(res.filePath, pdfBuffer)
  } finally {
    printWin.destroy()
  }
  shell.showItemInFolder(res.filePath)
  return { path: res.filePath }
})
function esc(s) { return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) }

// ── IPC: Savings goals ────────────────────────────────────────────────
// Handlers that can fail on validation return { ok, error } (like transfers
// and accounts) so the renderer can toast the message instead of an
// un-caught rejection.
const guarded = (fn) => (...args) => { try { return { ok: true, ...fn(...args) } } catch (e) { return { ok: false, error: e.message } } }
ipcMain.handle('savings:getAll', () => db.savings.getAll())
ipcMain.handle('savings:summary', () => db.savings.summary())
ipcMain.handle('savings:getEntries', (_e, goalId) => db.savings.getEntries(goalId))
ipcMain.handle('savings:createGoal', (_e, data) => { const r = guarded(() => ({ goal: db.savings.create(data) }))(); if (r.ok) broadcast('savings'); return r })
ipcMain.handle('savings:updateGoal', (_e, id, data) => { const r = guarded(() => ({ goal: db.savings.update(id, data) }))(); if (r.ok) broadcast('savings'); return r })
ipcMain.handle('savings:archiveGoal', (_e, id) => { db.savings.archive(id); broadcast('savings') })
ipcMain.handle('savings:unarchiveGoal', (_e, id) => { db.savings.unarchive(id); broadcast('savings') })
ipcMain.handle('savings:deleteGoal', (_e, id) => { db.savings.remove(id); broadcast('savings') })
ipcMain.handle('savings:addEntry', (_e, goalId, data) => { const r = guarded(() => db.savings.addEntry(goalId, data))(); if (r.ok) broadcast('savings'); return r })
ipcMain.handle('savings:deleteEntry', (_e, id) => { const goal = db.savings.removeEntry(id); broadcast('savings'); return { ok: true, goal } })

// ── IPC: Debts ──────────────────────────────────────────────────────────
// Debt changes can move account balances (loans/payments recorded against
// an account), so they broadcast 'finance' as well as 'debts'.
ipcMain.handle('debts:getAll', () => db.debts.getAll())
ipcMain.handle('debts:summary', () => db.debts.summary())
ipcMain.handle('debts:getPayments', (_e, debtId) => db.debts.getPayments(debtId))
ipcMain.handle('debts:create', (_e, data) => { const r = guarded(() => ({ debt: db.debts.create(data) }))(); if (r.ok) broadcast(['debts', 'finance']); return r })
ipcMain.handle('debts:update', (_e, id, data) => { const r = guarded(() => ({ debt: db.debts.update(id, data) }))(); if (r.ok) broadcast(['debts', 'finance']); return r })
ipcMain.handle('debts:delete', (_e, id) => { db.debts.remove(id); broadcast(['debts', 'finance']) })
ipcMain.handle('debts:addPayment', (_e, id, data) => { const r = guarded(() => db.debts.addPayment(id, data))(); if (r.ok) broadcast(['debts', 'finance']); return r })
ipcMain.handle('debts:settle', (_e, id, data) => { const r = guarded(() => db.debts.settle(id, data))(); if (r.ok) broadcast(['debts', 'finance']); return r })
ipcMain.handle('debts:deletePayment', (_e, paymentId) => { const debt = db.debts.removePayment(paymentId); broadcast(['debts', 'finance']); return { ok: true, debt } })

// ── Phone alerts ────────────────────────────────────────────────────────
// Queues a notification for the phone (only if the feature is on), then
// tries to send right away; whatever can't go out now (offline, quiet hours)
// waits in the outbox and is retried on every 30s tick.
function relayToPhone(item) {
  try {
    if (!db.phone.getSettings().enabled) return
    db.phone.enqueue(item.title, item.body)
    flushPhoneAlerts()
  } catch (e) { console.error('LifeOS phone relay failed:', e.message) }
}

let phoneFlushing = false
async function flushPhoneAlerts({ force = false } = {}) {
  if (phoneFlushing) return { skipped: 'busy' }
  phoneFlushing = true
  try {
    const before = JSON.stringify(db.phone.getStatus())
    const r = await phone.flushOutbox({ db, getToken: getGoogleAccessToken, isOnline: () => net.isOnline(), force })
    if (JSON.stringify(db.phone.getStatus()) !== before) broadcast('phone')
    return r
  } catch (e) {
    return { sent: 0, error: e.message }
  } finally {
    phoneFlushing = false
  }
}

ipcMain.handle('phone:getStatus', () => db.phone.getStatus())
ipcMain.handle('phone:setEnabled', (_e, on) => {
  const r = db.phone.setEnabled(!!on)
  broadcast('phone')
  if (on) flushPhoneAlerts()
  return r
})
ipcMain.handle('phone:setQuiet', (_e, data) => { const r = db.phone.setQuiet(data || {}); broadcast('phone'); return r })
// Settings → "Send test alert": goes through the same queue + relay as real
// notifications (ignoring the on/off switch and quiet hours) so it proves
// the whole path works, and reports what happened.
ipcMain.handle('phone:sendTest', async () => {
  if (!net.isOnline()) return { ok: false, error: "You're offline — connect to the internet and try again." }
  db.phone.enqueue('LifeOS test alert', 'If you can read this on your phone, phone alerts are working. 🎉')
  const r = await flushPhoneAlerts({ force: true })
  broadcast('phone')
  if (r.error) return { ok: false, error: r.error }
  if (r.offline) return { ok: false, error: "Couldn't reach Google — it will be sent automatically once you're back online." }
  if (r.skipped) return { ok: false, error: r.skipped === 'not-ready' ? 'Connect Google (with Calendar permission) first.' : 'Another send is in progress — try again in a moment.' }
  return { ok: true }
})

ipcMain.handle('app:copyText', (_e, text) => { if (typeof text === 'string') clipboard.writeText(text) })

// ── IPC: Data browser (Settings > Manage your data) ──────────────────────
ipcMain.handle('data:listTables', () => db.data.listTables())
ipcMain.handle('data:getRows', (_e, key, opts) => db.data.getRows(key, opts))
ipcMain.handle('data:deleteRow', (_e, key, id) => {
  db.data.deleteRow(key, id)
  broadcast(db.data.broadcastTableFor(key))
})
ipcMain.handle('data:setArchived', (_e, key, id, archived) => {
  db.data.setArchived(key, id, archived)
  broadcast(db.data.broadcastTableFor(key))
})

// ── IPC: Habits ─────────────────────────────────────────────────────────
ipcMain.handle('habits:getAll', () => db.habits.getAll())
ipcMain.handle('habits:create', (_e, data) => { const r = db.habits.create(data); broadcast('habits'); return r })
ipcMain.handle('habits:update', (_e, id, data) => { const r = db.habits.update(id, data); broadcast('habits'); return r })
ipcMain.handle('habits:delete', (_e, id) => { db.habits.remove(id); broadcast('habits') })
ipcMain.handle('habits:archive', (_e, id) => { db.habits.archive(id); broadcast('habits') })
ipcMain.handle('habits:unarchive', (_e, id) => { db.habits.unarchive(id); broadcast('habits') })
ipcMain.handle('habits:toggleLog', (_e, habitId, date) => { const r = db.habits.toggleLog(habitId, date); broadcast('habits'); return r })
ipcMain.handle('habits:getLogs', (_e, habitId, fromDate, toDate) => db.habits.getLogs(habitId, fromDate, toDate))

// ── IPC: Notes ──────────────────────────────────────────────────────────
ipcMain.handle('notes:getAll', () => db.notes.getAll())
ipcMain.handle('notes:create', (_e, data) => { const r = db.notes.create(data); broadcast('notes'); return r })
ipcMain.handle('notes:update', (_e, id, data) => { const r = db.notes.update(id, data); broadcast('notes'); return r })
ipcMain.handle('notes:delete', (_e, id) => { db.notes.remove(id); broadcast('notes') })

// ── IPC: Attachments (photos/files on tasks, events, notes) ───────────
ipcMain.handle('attachments:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (res.canceled || !res.filePaths.length) return null
  return res.filePaths[0]
})
ipcMain.handle('attachments:add', (_e, parentType, parentId, filePath) => {
  const r = db.attachments.add(parentType, parentId, filePath)
  broadcast(parentType === 'note' ? 'notes' : parentType === 'task' ? 'tasks' : 'events')
  return r
})
ipcMain.handle('attachments:getFor', (_e, parentType, parentId) => db.attachments.getFor(parentType, parentId))
ipcMain.handle('attachments:remove', (_e, id, parentType) => { db.attachments.remove(id); broadcast(parentType === 'note' ? 'notes' : parentType === 'task' ? 'tasks' : 'events') })
ipcMain.handle('attachments:openInFolder', (_e, filePath) => shell.showItemInFolder(filePath))

// ── IPC: Profile ("About Me" + app lock) ─────────────────────────────────
// Unlike attachments (which just reference the original file in place),
// the avatar is copied into userData so it survives the source file being
// moved, renamed, or deleted, and so its path is stable across machines.
ipcMain.handle('profile:get', () => db.profile.get())
ipcMain.handle('profile:update', (_e, data) => { const r = db.profile.update(data); broadcast('profile'); return r })
ipcMain.handle('profile:pickAvatar', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  })
  if (res.canceled || !res.filePaths.length) return null

  const src = res.filePaths[0]
  const ext = path.extname(src) || '.png'
  const dir = path.join(app.getPath('userData'), 'avatar')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `avatar${ext}`)
  fs.copyFileSync(src, dest)

  // Clean up a stale avatar left over from a previous upload with a
  // different extension, so these don't quietly accumulate over time.
  const current = db.profile.get()
  if (current.avatar_path && current.avatar_path !== dest && fs.existsSync(current.avatar_path)) {
    try { fs.unlinkSync(current.avatar_path) } catch { /* non-fatal */ }
  }

  const r = db.profile.setAvatar(dest)
  broadcast('profile')
  return r
})
ipcMain.handle('profile:hasPin', () => db.profile.get().has_pin === 1)
ipcMain.handle('profile:setPin', (_e, pin) => { const r = db.profile.setPin(pin); broadcast('profile'); return r })
ipcMain.handle('profile:clearPin', () => { const r = db.profile.clearPin(); broadcast('profile'); return r })
ipcMain.handle('profile:verifyPin', (_e, pin) => db.profile.verifyPin(pin))

// ── IPC: Settings ───────────────────────────────────────────────────────
ipcMain.handle('settings:getAutoLaunch', () => autoLauncher.isEnabled())
ipcMain.handle('settings:setAutoLaunch', async (_e, enabled) => {
  if (enabled) await autoLauncher.enable()
  else await autoLauncher.disable()
  return autoLauncher.isEnabled()
})

// ── IPC: Google Drive Backup ──────────────────────────────────────────
// Resolves a ready-to-use access token + backup folder id for the current
// Drive connection, refreshing/persisting the access token and caching
// the folder id as needed. Throws (with a toast-safe message) if Drive
// isn't connected — every handler below expects that and reports it back
// as { ok: false, error } rather than letting it reject un-caught.
// One Google connection serves both Drive backup and phone alerts, so
// token handling lives in one place. If Google rejects the refresh token
// (revoked, or expired — apps left in "Testing" mode lose it after 7
// days) the connection is flagged so Settings can ask the user to
// reconnect, instead of backups/alerts failing silently.
async function getGoogleAccessToken({ force = false } = {}) {
  const settings = db.profile.getDriveSettings()
  if (!settings.drive_refresh_token) throw new Error("Google isn't connected. Connect it in Settings first.")
  try {
    const { accessToken, expiresAt, changed } = await drive.ensureAccessToken({
      client_id: settings.drive_client_id,
      client_secret: settings.drive_client_secret,
      refresh_token: settings.drive_refresh_token,
      access_token: force ? '' : settings.drive_access_token,
      token_expires_at: settings.drive_token_expires_at,
    })
    if (changed) db.profile.setDriveTokens({ refresh_token: settings.drive_refresh_token, access_token: accessToken, expires_at: expiresAt })
    return accessToken
  } catch (e) {
    if (e.code === 'invalid_grant' && settings.google_last_error !== 'expired') {
      db.profile.setGoogleError('expired')
      broadcast('profile')
      new Notification({ title: 'LifeOS lost its Google connection', body: 'Reconnect Google in Settings to restore backups and phone alerts.' }).show()
    }
    throw e
  }
}

async function getDriveContext() {
  const settings = db.profile.getDriveSettings()
  const accessToken = await getGoogleAccessToken()
  const folderId = await drive.findOrCreateBackupFolder(accessToken, settings.drive_folder_id)
  if (folderId !== settings.drive_folder_id) db.profile.setDriveFolderId(folderId)

  return { accessToken, folderId }
}

// Snapshots the live database via SQLite's online backup API (WAL-safe —
// see db.backupTo()), uploads it to the app's Drive folder, prunes old
// backups beyond KEEP_BACKUPS, and records when this ran. Used by both
// the manual "Back up now" button and the automatic scheduled backup.
async function runBackup() {
  const tempPath = path.join(app.getPath('userData'), 'drive-backup-staging.db')
  try {
    const { accessToken, folderId } = await getDriveContext()
    await db.backupTo(tempPath)
    const fileName = `lifeos-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
    await drive.uploadBackup(accessToken, folderId, tempPath, fileName)

    const files = await drive.listBackups(accessToken, folderId)
    for (const stale of files.slice(drive.KEEP_BACKUPS)) {
      await drive.deleteBackup(accessToken, stale.id)
    }

    db.profile.setDriveLastBackup(new Date().toISOString())
    broadcast('profile')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath) } catch (_) { /* non-fatal — next backup overwrites it anyway */ }
  }
}

// Checked every 30s alongside the notification/recurrence poll. Cheap when
// nothing is due: just a couple of column reads and a date comparison.
async function maybeRunAutoBackup() {
  const status = db.profile.getDriveStatus()
  if (!status.connected || !status.autoBackup) return
  const last = status.lastBackupAt ? new Date(status.lastBackupAt).getTime() : 0
  const dueAt = last + status.frequencyHours * 60 * 60 * 1000
  if (Date.now() < dueAt) return
  const result = await runBackup()
  if (!result.ok) console.error('LifeOS auto-backup failed:', result.error) // non-fatal — retried on the next 30s tick
}

ipcMain.handle('drive:getStatus', () => db.profile.getDriveStatus())
ipcMain.handle('drive:saveCredentials', (_e, { clientId, clientSecret } = {}) => {
  const r = db.profile.setDriveCredentials({ client_id: clientId, client_secret: clientSecret })
  broadcast('profile')
  return r
})
ipcMain.handle('drive:connect', async () => {
  try {
    const settings = db.profile.getDriveSettings()
    const tokens = await drive.connect({ clientId: settings.drive_client_id, clientSecret: settings.drive_client_secret })
    db.profile.setDriveTokens({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
      scope: tokens.scope || '', // what Google actually granted — the user may untick Drive or Calendar
    })
    broadcast('profile')
    flushPhoneAlerts()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
ipcMain.handle('drive:disconnect', () => { const r = db.profile.clearDriveTokens(); broadcast('profile'); return r })
ipcMain.handle('drive:setAutoBackup', (_e, { enabled, frequencyHours } = {}) => {
  const r = db.profile.setDriveAuto({ enabled, frequencyHours })
  broadcast('profile')
  return r
})
ipcMain.handle('drive:backupNow', () => runBackup())
ipcMain.handle('drive:listBackups', async () => {
  try {
    const { accessToken, folderId } = await getDriveContext()
    const files = await drive.listBackups(accessToken, folderId)
    return { ok: true, files }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
// Downloads the chosen backup, replaces the live database file with it,
// and relaunches — closing the db connection first so nothing is mid-write
// while the file underneath it is swapped, and dropping the old -wal/-shm
// sidecar files so the restored copy starts from a clean, consistent state.
ipcMain.handle('drive:restore', async (_e, fileId) => {
  const dir = app.getPath('userData')
  const dbPath = path.join(dir, 'lifeos.db')
  const tempPath = path.join(dir, 'drive-restore-staging.db')
  try {
    const { accessToken } = await getDriveContext()
    await drive.downloadBackup(accessToken, fileId, tempPath)

    // Close the live connection before touching the file on disk — on
    // Windows especially, a file still held open by better-sqlite3 can't
    // be overwritten out from under it. The rest of the shutdown (timer,
    // tray, isQuitting) is left to the normal app.quit() lifecycle below,
    // same as the app:quit handler, instead of duplicating that cleanup here.
    db.close()
    fs.copyFileSync(tempPath, dbPath)
    for (const ext of ['-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + ext) } catch (_) { /* fine if they don't exist */ }
    }
    app.relaunch()
    isQuitting = true
    app.quit()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath) } catch (_) { /* non-fatal */ }
  }
})

// Opens a URL in the OS default browser — used for the "how to get Drive
// credentials" link in Settings. Restricted to https to keep the renderer
// from ever using this to launch arbitrary local schemes/paths.
ipcMain.handle('app:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url)
})

// Fully quits — not the minimize-to-tray behavior the window's close button
// triggers. isQuitting lets the 'close' handler know not to intercept this.
ipcMain.handle('app:quit', () => { isQuitting = true; app.quit() })
