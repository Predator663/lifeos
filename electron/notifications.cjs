// electron/notifications.cjs — decides what's due "right now" and hands
// back a list of {title, body} notifications to fire. Runs every 30s
// from main.cjs. Each item is marked notified so it only fires once
// (main.cjs shows each on the desktop and relays it to the phone).
const { localISO, daysBetween } = require('./dates.cjs')

const money = (n) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n || 0)

// Debt/savings reminders are day-level, so hold them until the morning
// instead of buzzing a phone at 00:01.
const REMINDER_HOUR = 8

// `now` is injectable so this can be tested without waiting for the clock.
function checkDueItems(db, now = new Date()) {
  const out = []

  // Tasks due within the next 15 minutes (or already overdue and pending).
  const tasks = db.tasks.getAll().filter(t => t.status === 'pending' && t.due_date && !t.notified)
  for (const t of tasks) {
    const due = new Date(`${t.due_date}T${t.due_time || '23:59'}`)
    const diffMin = (due - now) / 60000
    if (diffMin <= 15) {
      out.push({ title: `Task due: ${t.title}`, body: diffMin < 0 ? 'Overdue' : `Due in ${Math.max(0, Math.round(diffMin))} min` })
      db.tasks.markNotified(t.id)
    }
  }

  // Events starting within their configured reminder window.
  const events = db.events.getAll().filter(e => !e.notified)
  for (const e of events) {
    const start = new Date(e.start_at)
    const diffMin = (start - now) / 60000
    if (diffMin <= (e.reminder_minutes_before ?? 10) && diffMin > -5) {
      out.push({ title: `Upcoming: ${e.title}`, body: e.location ? `${e.location} · starting soon` : 'Starting soon' })
      db.events.markNotified(e.id)
    }
  }

  if (now.getHours() >= REMINDER_HOUR) {
    const today = localISO(now)

    // Debts: heads-up within 3 days of the due date, again on the day, then
    // an overdue notice — repeated weekly while the debt stays unpaid.
    for (const d of db.debts.getAll()) {
      if (d.status !== 'open' || !d.due_date) continue
      const days = daysBetween(today, d.due_date)
      const who = d.direction === 'owed_to_me' ? `${d.person} owes you ${money(d.remaining)}` : `You owe ${d.person} ${money(d.remaining)}`
      const stage = d.notify_stage || 0

      if (days < 0) {
        const last = d.last_overdue_notified
        if (stage < 3 || !last || daysBetween(last, today) >= 7) {
          out.push({ title: d.direction === 'owed_to_me' ? 'Debt overdue' : 'You have an overdue debt', body: `${who} — overdue by ${-days} day${-days === 1 ? '' : 's'}` })
          db.debts.setNotify(d.id, 3, today)
        }
      } else if (days === 0) {
        if (stage < 2) {
          out.push({ title: 'Debt due today', body: who })
          db.debts.setNotify(d.id, 2)
        }
      } else if (days <= 3) {
        if (stage < 1) {
          out.push({ title: 'Debt due soon', body: `${who} — due in ${days} day${days === 1 ? '' : 's'}` })
          db.debts.setNotify(d.id, 1)
        }
      }
    }

    // Savings goals with a deadline: a week before, then on the day.
    for (const g of db.savings.getAll()) {
      if (g.archived || g.status !== 'active' || !g.target_date) continue
      const days = daysBetween(today, g.target_date)
      const stage = g.notify_stage || 0
      const pct = g.target_amount > 0 ? Math.floor((g.saved / g.target_amount) * 100) : 0
      const togo = Math.max(0, g.target_amount - g.saved)
      if (days <= 0) {
        if (stage < 2) {
          out.push({ title: `Savings deadline: ${g.name}`, body: `Deadline reached — ${pct}% saved, ${money(togo)} to go` })
          db.savings.setNotifyStage(g.id, 2)
        }
      } else if (days <= 7) {
        if (stage < 1) {
          out.push({ title: `Savings goal: ${g.name}`, body: `${days} day${days === 1 ? '' : 's'} left — ${pct}% saved, ${money(togo)} to go` })
          db.savings.setNotifyStage(g.id, 1)
        }
      }
    }
  }

  return out
}

module.exports = { checkDueItems }
