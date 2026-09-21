// electron/phone.cjs — relays LifeOS notifications to the user's phone
// through their own Google account.
//
// How it works: there's no way for a desktop app to push straight to a
// phone, but a phone signed in to the same Google account already syncs
// Google Calendar and rings its reminders. So each notification LifeOS
// fires is also written as a tiny event into a private "LifeOS Alerts"
// calendar (created and owned by this app — see calendar.app.created in
// drive.cjs), starting a minute from now with a pop-up reminder at 0 min.
// The Google Calendar app on the phone syncs it and shows it as a normal
// notification.
//
// Offline-safe: alerts are queued in the `phone_outbox` table first and
// sent whenever there's internet and Google is reachable, so nothing is
// lost while the PC is offline. An alert that has waited over 24h is
// dropped rather than delivered stale, and if a backlog builds up (e.g.
// after being offline, or after quiet hours) it goes out as ONE digest
// instead of a burst of buzzes. Sent alert events are deleted from the
// calendar a few hours later so it stays tidy.
const CAL_API = 'https://www.googleapis.com/calendar/v3'
const CALENDAR_NAME = 'LifeOS Alerts'
const LEAD_MS = 60_000                 // the alert event "starts" this far ahead so the phone has time to sync it
const CLEAN_AFTER_MS = 6 * 3600_000    // delete sent alert events after this long
const DIGEST_THRESHOLD = 3             // more than this many waiting -> one combined alert
const MAX_ATTEMPTS = 3                 // non-network failures before an alert is dropped
const PURGE_AFTER_MS = 3 * 24 * 3600_000

class GoogleApiError extends Error {
  constructor(message, { status = 0, network = false, fatal = false, reason = '' } = {}) {
    super(message)
    this.status = status; this.network = network; this.fatal = fatal; this.reason = reason
  }
}

// Turns a Google error response into a message the user can act on.
function explain(status, data) {
  const e = data && data.error
  const raw = (e && e.message) || ''
  const reason = (e && e.errors && e.errors[0] && e.errors[0].reason) || (e && e.status) || ''
  if (status === 403 && (/accessNotConfigured/i.test(reason) || /has not been used|is disabled|not been enabled/i.test(raw))) {
    return { fatal: true, reason: 'api_disabled', message: "The Google Calendar API isn't enabled for your Google Cloud project. Enable it (APIs & Services → Library → Google Calendar API) and try again." }
  }
  if (status === 403 && /insufficient|scope/i.test(`${reason} ${raw}`)) {
    return { fatal: true, reason: 'scope', message: "LifeOS doesn't have Calendar permission yet. Reconnect Google in Settings and leave the Calendar box ticked." }
  }
  if (status === 401) return { fatal: false, reason: 'auth', message: 'Google rejected the login — reconnect in Settings if this keeps happening.' }
  return { fatal: false, reason, message: raw || `Google Calendar error (${status})` }
}

function makeClient(fetchImpl, baseUrl = CAL_API) {
  return async function api(token, method, path, body) {
    let res
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (_) {
      throw new GoogleApiError('No internet connection', { network: true })
    }
    if (res.status === 204) return null
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const x = explain(res.status, data)
      throw new GoogleApiError(x.message, { status: res.status, fatal: x.fatal, reason: x.reason })
    }
    return data
  }
}

// start/end are 'HH:MM'. Handles windows that wrap past midnight (22:00–07:00).
function inQuietHours(now, start, end) {
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m }
  const cur = now.getHours() * 60 + now.getMinutes()
  const s = toMin(start), e = toMin(end)
  if (s === e) return false
  return s < e ? (cur >= s && cur < e) : (cur >= s || cur < e)
}

const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function digestOf(rows) {
  return {
    title: `LifeOS — ${rows.length} alerts`,
    body: rows.map(r => `• ${clock(r.created_at)}  ${r.title}${r.body ? ' — ' + r.body : ''}`).join('\n'),
  }
}

function buildEvent({ title, body, footer, now }) {
  const start = new Date(now.getTime() + LEAD_MS)
  const end = new Date(start.getTime() + 15 * 60_000)
  return {
    summary: String(title).slice(0, 200),
    description: [body, footer].filter(Boolean).join('\n\n'),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    transparency: 'transparent',            // an alert shouldn't mark you "busy"
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    extendedProperties: { private: { lifeos_alert: '1' } },
  }
}

// Sends the queued alerts (and tidies old ones). Safe to call every tick:
// it returns immediately when there's nothing to do, the feature is off,
// or there's no internet. `force` is for the Settings "Send test" button —
// it ignores the on/off switch and quiet hours.
//
// Returns { sent, held, offline, error } — all optional.
async function flushOutbox({
  db, getToken, isOnline = () => true, fetch: fetchImpl = globalThis.fetch, baseUrl, now = new Date(), force = false, timeZone,
}) {
  const status = db.phone.getStatus()
  if (!force && !status.enabled) return { skipped: 'disabled' }
  if (!status.connected || !status.calendarGranted) return { skipped: 'not-ready' }
  const settings = db.phone.getSettings()

  // Drop alerts that have waited too long to still be useful.
  const cutoff = now.getTime() - db.PHONE_ALERT_MAX_AGE_MS
  const all = db.phone.pending()
  const stale = all.filter(r => Date.parse(r.created_at) < cutoff)
  if (stale.length) db.phone.drop(stale.map(r => r.id))
  const pending = all.filter(r => Date.parse(r.created_at) >= cutoff)

  const cleanable = db.phone.toClean(new Date(now.getTime() - CLEAN_AFTER_MS).toISOString())
  const quiet = !force && !!settings.quiet_enabled && inQuietHours(now, settings.quiet_start, settings.quiet_end)
  const toSend = quiet ? [] : pending
  if (!toSend.length && !cleanable.length) return { sent: 0, held: pending.length }
  if (!isOnline()) return { sent: 0, offline: true }

  const api = makeClient(fetchImpl, baseUrl)
  const fail = (message) => { db.phone.setLastError(message); return { sent: 0, error: message } }

  // One call wrapper: gets a token, and if Google answers 401 refreshes
  // the token once and retries.
  async function authed(fn) {
    try {
      return await fn(await getToken())
    } catch (e) {
      if (e && e.status === 401) return await fn(await getToken({ force: true }))
      throw e
    }
  }
  const isNetworkish = (e) => e && (e.network || e.name === 'TypeError' || /fetch failed/i.test(e.message || ''))

  let calendarId = db.phone.getCalendarId()
  async function createCalendar(token) {
    const cal = await api(token, 'POST', '/calendars', {
      summary: CALENDAR_NAME,
      description: 'Phone alerts from the LifeOS desktop app. Safe to leave alone — LifeOS manages it.',
      timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    calendarId = cal.id
    db.phone.setCalendarId(calendarId)
    return calendarId
  }
  async function insertAlert(token, alert) {
    if (!calendarId) await createCalendar(token)
    const path = () => `/calendars/${encodeURIComponent(calendarId)}/events`
    try {
      return await api(token, 'POST', path(), buildEvent({ ...alert, now }))
    } catch (e) {
      // The calendar was deleted on Google's side: make a new one and retry once.
      if (e.status === 404 || e.status === 410) {
        await createCalendar(token)
        return await api(token, 'POST', path(), buildEvent({ ...alert, now }))
      }
      throw e
    }
  }

  let sent = 0
  const groups = toSend.length > DIGEST_THRESHOLD ? [toSend] : toSend.map(r => [r])
  for (const group of groups) {
    const shown = group.length > 1 ? digestOf(group) : { title: group[0].title, body: group[0].body }
    const footer = group.length > 1 ? '' : `Sent by LifeOS · ${clock(group[0].created_at)}`
    try {
      const ev = await authed(token => insertAlert(token, { ...shown, footer }))
      db.phone.markSent(group.map(r => r.id), ev.id)
      db.phone.setLastSent(now.toISOString())
      sent += group.length
    } catch (e) {
      if (isNetworkish(e)) return { sent, offline: true }            // stay queued, retry next tick
      if (e.code === 'invalid_grant') return { ...fail('Your Google connection expired — reconnect in Settings.'), sent }
      if (e.fatal) return { ...fail(e.message), sent }               // needs the user to act; keep queued
      for (const r of group) if (db.phone.bumpAttempts(r.id) >= MAX_ATTEMPTS) db.phone.drop([r.id])
      db.phone.setLastError(e.message)
      if (e.status >= 500 || e.status === 429) return { sent, error: e.message }
    }
  }

  // Tidy: delete alert events that were sent more than a few hours ago.
  if (cleanable.length && calendarId) {
    const byEvent = new Map()
    for (const r of cleanable) byEvent.set(r.event_id, [...(byEvent.get(r.event_id) || []), r.id])
    for (const [eventId, ids] of byEvent) {
      try {
        await authed(token => api(token, 'DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`))
        db.phone.markCleaned(ids)
      } catch (e) {
        if (e.status === 404 || e.status === 410) db.phone.markCleaned(ids)   // already gone
        else if (isNetworkish(e)) break
        // anything else: leave it, try again next time — cleanup is best-effort
      }
    }
  }
  db.phone.purge(new Date(now.getTime() - PURGE_AFTER_MS).toISOString())
  return { sent }
}

module.exports = { flushOutbox, inQuietHours, explain, CALENDAR_NAME }
