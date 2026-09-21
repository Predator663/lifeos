import { addDaysISO, daysBetween, localISO } from './dates'

const DAYS_PER_MONTH = 30.4375

// Works out where a savings goal stands. `goal` is a row from
// savings.getAll() (saved, target_amount, target_date, recent_net,
// first_entry_date, entries_count).
//
// state:
//   'achieved' — target reached
//   'new'      — nothing saved yet, so no pace to judge
//   'overdue'  — deadline passed and still short
//   'on_track' — has a deadline and the recent pace finishes in time
//   'behind'   — has a deadline and the recent pace would miss it
//   'active'   — no deadline; just show the projection
export function analyzeGoal(goal, today = localISO()) {
  const target = goal.target_amount || 0
  const saved = goal.saved || 0
  const remaining = Math.max(0, Math.round((target - saved) * 100) / 100)
  const achieved = remaining <= 0.005
  const percent = target > 0 ? (achieved ? 100 : Math.min(99, Math.floor((saved / target) * 100))) : 0

  const daysLeft = goal.target_date ? daysBetween(today, goal.target_date) : null

  // Recent pace: net saved over the last <=90 days, spread over however
  // long the goal has really been running (min 30 days so one early
  // deposit doesn't project absurdly fast).
  let monthlyPace = null
  if (goal.entries_count > 0 && goal.first_entry_date) {
    const running = daysBetween(goal.first_entry_date, today) + 1
    const window = Math.min(90, Math.max(30, running))
    monthlyPace = ((goal.recent_net || 0) / window) * DAYS_PER_MONTH
  }
  const projectedDate = !achieved && monthlyPace > 0
    ? addDaysISO(today, Math.ceil((remaining / monthlyPace) * DAYS_PER_MONTH))
    : null

  // What you'd need to save to hit the deadline, in the friendliest unit.
  let need = null
  if (!achieved && daysLeft != null && daysLeft > 0) {
    const perDay = remaining / daysLeft
    if (daysLeft >= 45) need = { amount: perDay * DAYS_PER_MONTH, per: 'month' }
    else if (daysLeft >= 10) need = { amount: perDay * 7, per: 'week' }
    else need = { amount: perDay, per: 'day' }
  }

  let state
  if (achieved) state = 'achieved'
  else if (daysLeft != null && daysLeft < 0) state = 'overdue'
  else if (!goal.entries_count) state = 'new'
  else if (daysLeft == null) state = 'active'
  else if (projectedDate && daysBetween(projectedDate, goal.target_date) >= 0) state = 'on_track'
  else state = 'behind'

  return { saved, target, remaining, percent, achieved, daysLeft, monthlyPace, projectedDate, need, state }
}

export const STATE_META = {
  achieved: { label: 'Achieved', color: 'var(--green)' },
  on_track: { label: 'On track', color: 'var(--green)' },
  behind: { label: 'Behind pace', color: 'var(--yellow)' },
  overdue: { label: 'Past deadline', color: 'var(--red)' },
  new: { label: 'Not started', color: 'var(--text3)' },
  active: { label: 'Saving', color: 'var(--blue)' },
}

// Average monthly expense over the months we have data for (current,
// partial month excluded when there's older data) — used to suggest an
// emergency-fund target of 3 months of spending.
export function avgMonthlyExpense(monthlyPivot) {
  const rows = (monthlyPivot || []).filter(r => r.expense > 0)
  if (!rows.length) return 0
  const use = rows.length > 1 ? rows.slice(0, -1) : rows
  return use.reduce((s, r) => s + r.expense, 0) / use.length
}
