import { daysBetween, localISO, parseISO } from './dates'

export function fmt(n) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n || 0)
}
export function fmtDate(iso) {
  if (!iso) return ''
  return parseISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
export function fmtShort(iso) {
  if (!iso) return ''
  return parseISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
// "Due in 3 days" / "Overdue by 2 days" / "Due today"
export function dueLabel(iso, today = localISO()) {
  if (!iso) return null
  const d = daysBetween(today, iso)
  if (d === 0) return { text: 'Due today', tone: 'warn', days: 0 }
  if (d === 1) return { text: 'Due tomorrow', tone: 'warn', days: 1 }
  if (d > 1) return { text: `Due in ${d} days`, tone: d <= 7 ? 'warn' : 'muted', days: d }
  return { text: `Overdue by ${-d} day${-d === 1 ? '' : 's'}`, tone: 'bad', days: d }
}
