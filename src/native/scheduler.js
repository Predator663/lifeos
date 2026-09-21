// src/native/scheduler.js — the Android replacement for the desktop's
// 30-second poll (electron/notifications.cjs + the setInterval in
// main.cjs).
//
// Android will not keep a WebView timer alive in the background, so
// nothing can "check what's due" while the app is closed. Instead every
// reminder is computed AHEAD of time and handed to the OS as a scheduled
// local notification. The whole set is cancelled and recomputed from
// scratch on app start, on resume, and after every database change —
// recomputing is cheap and it is the only way to stay correct when a task
// is edited, a debt is settled, or a goal is archived.
//
// The rules below are the same ones electron/notifications.cjs applies at
// poll time, re-expressed as fire times:
//   tasks      15 min before due_date+due_time; date-only tasks at 08:00
//   events     start_at minus reminder_minutes_before (default 10)
//   debts      open only: 3 days before, on the due day, then weekly
//              while overdue (4 repeats), all at 08:00
//   savings    active with a deadline: 7 days before and on the day, 08:00
// Done / settled / achieved / archived items are skipped, exactly as the
// desktop checks do.
import { LocalNotifications } from '@capacitor/local-notifications'
import { localISO } from '../lib/dates.js'

const CHANNEL_ID = 'lifeos-reminders'
const REMINDER_HOUR = 8
const HORIZON_DAYS = 60
// Android's alarm slots are finite and the plugin docs warn against
// scheduling unbounded numbers of notifications; keep the soonest N.
const MAX_SCHEDULED = 60

const money = (n) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n || 0)

// Stable, collision-resistant numeric id from kind + row id + stage, so a
// recompute reuses the same ids instead of stacking duplicates. Android
// notification ids must fit in a signed 32-bit int.
const KIND_CODE = { task: 1, event: 2, debt: 3, savings: 4 }
export function notificationId(kind, id, stage = 0) {
  const k = KIND_CODE[kind] || 9
  let h = (k * 1000003) ^ (Number(id) * 131) ^ (Number(stage) * 7919)
  h = Math.abs(h) % 2000000000
  return h + 1
}

function at(dateStr, hour = 0, minute = 0) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, hour, minute, 0, 0)
}

function daysBetweenDates(a, b) {
  return Math.round((at(b) - at(a)) / 86400000)
}

// ── permissions and channel ──────────────────────────────────────────

export async function ensurePermissions() {
  const state = { granted: false, exactAlarms: 'unknown' }
  try {
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions()
    state.granted = perm.display === 'granted'
  } catch { state.granted = false }

  // Android 12+ needs a separate user grant for exact alarms; without it
  // the plugin falls back to inexact delivery (the reminder can slip by a
  // few minutes, which is fine for an 08:00 debt nudge but worth telling
  // the user about).
  try {
    if (typeof LocalNotifications.checkExactNotificationSetting === 'function') {
      const r = await LocalNotifications.checkExactNotificationSetting()
      state.exactAlarms = r?.exact_alarm || 'unknown'
    }
  } catch { /* older plugin build — leave as unknown */ }

  if (state.granted) {
    try {
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: 'LifeOS reminders',
        description: 'Tasks, events, debts and savings deadlines',
        importance: 5,               // IMPORTANCE_HIGH — heads-up banner
        visibility: 1,
        vibration: true,
        lights: true,
      })
    } catch { /* channels are Android-only; ignore elsewhere */ }
  }
  return state
}

export async function openExactAlarmSettings() {
  if (typeof LocalNotifications.changeExactNotificationSetting === 'function') {
    await LocalNotifications.changeExactNotificationSetting()
  }
}

// ── building the schedule ────────────────────────────────────────────

// Pure function, exported so the Node test script can assert the rules
// without a device. `now` is injectable for the same reason.
export function buildSchedule(db, now = new Date()) {
  const out = []
  const today = localISO(now)
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86400000)

  const push = (kind, id, stage, when, title, body) => {
    if (!(when instanceof Date) || isNaN(when)) return
    if (when <= now || when > horizon) return
    out.push({ id: notificationId(kind, id, stage), at: when, title, body, kind, rowId: id, stage })
  }

  // Tasks — 15 minutes before the deadline, or 08:00 on the day when the
  // task carries a date but no time.
  for (const t of db.tasks.getAll()) {
    if (t.status !== 'pending' || !t.due_date) continue
    if (t.due_time) {
      const [hh, mm] = String(t.due_time).split(':').map(Number)
      const due = at(t.due_date, hh || 0, mm || 0)
      push('task', t.id, 0, new Date(due.getTime() - 15 * 60000), `Task due: ${t.title}`, 'Due in 15 min')
    } else {
      push('task', t.id, 1, at(t.due_date, REMINDER_HOUR), `Task due today: ${t.title}`, 'Due today')
    }
  }

  // Events — the configured reminder window before the start.
  for (const e of db.events.getAll()) {
    if (!e.start_at) continue
    const start = new Date(e.start_at)
    if (isNaN(start)) continue
    const mins = e.reminder_minutes_before ?? 10
    push('event', e.id, 0, new Date(start.getTime() - mins * 60000),
      `Upcoming: ${e.title}`,
      e.location ? `${e.location} · starting soon` : 'Starting soon')
  }

  // Debts — open ones with a due date only.
  for (const d of db.debts.getAll()) {
    if (d.status !== 'open' || !d.due_date) continue
    const who = d.direction === 'owed_to_me'
      ? `${d.person} owes you ${money(d.remaining)}`
      : `You owe ${d.person} ${money(d.remaining)}`
    const days = daysBetweenDates(today, d.due_date)

    const dueAt = at(d.due_date, REMINDER_HOUR)
    push('debt', d.id, 1, new Date(dueAt.getTime() - 3 * 86400000),
      'Debt due soon', `${who} — due in 3 days`)
    push('debt', d.id, 2, dueAt, 'Debt due today', who)

    // Weekly overdue nudges, four of them. They are anchored to the first
    // weekly slot that is still in the future, so a debt that has been
    // overdue for months still gets chased instead of having all its
    // reminder dates sit in the past.
    let week = 1
    while (new Date(dueAt.getTime() + week * 7 * 86400000) <= now && week < 520) week++
    for (let w = 0; w < 4; w++) {
      const weeks = week + w
      const when = new Date(dueAt.getTime() + weeks * 7 * 86400000)
      const overdueBy = weeks * 7 - Math.max(0, days)
      push('debt', d.id, 2 + ((weeks - 1) % 4) + 1,
        when,
        d.direction === 'owed_to_me' ? 'Debt overdue' : 'You have an overdue debt',
        `${who} — overdue by ${overdueBy} day${overdueBy === 1 ? '' : 's'}`)
    }
  }

  // Savings goals — active, not archived, with a deadline.
  for (const g of db.savings.getAll()) {
    if (g.archived || g.status !== 'active' || !g.target_date) continue
    const pct = g.target_amount > 0 ? Math.floor((g.saved / g.target_amount) * 100) : 0
    const togo = Math.max(0, g.target_amount - g.saved)
    push('savings', g.id, 1,
      new Date(at(g.target_date, REMINDER_HOUR).getTime() - 7 * 86400000),
      `Savings goal: ${g.name}`, `7 days left — ${pct}% saved, ${money(togo)} to go`)
    push('savings', g.id, 2, at(g.target_date, REMINDER_HOUR),
      `Savings deadline: ${g.name}`, `Deadline reached — ${pct}% saved, ${money(togo)} to go`)
  }

  out.sort((a, b) => a.at - b.at)
  return out.slice(0, MAX_SCHEDULED)
}

// ── applying it ──────────────────────────────────────────────────────

let rescheduleTimer = null
let permissionState = { granted: false, exactAlarms: 'unknown' }

export function getPermissionState() { return permissionState }

export async function reschedule(db) {
  if (!permissionState.granted) return { scheduled: 0, skipped: 'permission' }

  // Cancel everything we previously scheduled, then re-add. Recomputing
  // the full set is what keeps edits, completions and deletions honest.
  try {
    const pending = await LocalNotifications.getPending()
    if (pending?.notifications?.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) })
    }
  } catch { /* nothing pending */ }

  const items = buildSchedule(db)
  if (!items.length) return { scheduled: 0 }

  await LocalNotifications.schedule({
    notifications: items.map(i => ({
      id: i.id,
      title: i.title,
      body: i.body,
      channelId: CHANNEL_ID,
      schedule: { at: i.at, allowWhileIdle: true },
      smallIcon: 'ic_stat_lifeos',
      extra: { kind: i.kind, rowId: i.rowId },
    })),
  })
  return { scheduled: items.length }
}

// Debounced so a burst of writes (a transaction that touches three
// tables) only triggers one recompute.
export function scheduleSoon(db, ms = 1200) {
  clearTimeout(rescheduleTimer)
  rescheduleTimer = setTimeout(() => { reschedule(db).catch(() => {}) }, ms)
}

export async function initScheduler(db) {
  permissionState = await ensurePermissions()
  // Tapping a notification brings the app up; the plugin handles the
  // launch itself, this listener is here so a tap while running still
  // refreshes what the user sees.
  try {
    await LocalNotifications.addListener('localNotificationActionPerformed', () => {
      scheduleSoon(db, 200)
    })
  } catch { /* listener unsupported — non-fatal */ }
  await reschedule(db)
  return permissionState
}
