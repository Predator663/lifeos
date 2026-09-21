// electron/dates.cjs — local-calendar date helpers.
//
// Everywhere LifeOS stores a plain 'YYYY-MM-DD' date it means the date on
// the USER'S wall calendar. `new Date().toISOString().slice(0, 10)` gives
// the UTC date instead, which is off by a day for part of every day (and
// shifts by a day on every step when used to advance a date) for anyone
// east of UTC — e.g. Tanzania, UTC+3. Use these helpers instead.
const pad = (n) => String(n).padStart(2, '0')

function localISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
// 'YYYY-MM-DD' -> Date at local midnight
function parseISO(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDaysISO(iso, n) {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return localISO(d)
}
// Whole calendar days from a to b (negative if b is earlier). Math.round
// keeps it correct across DST changes.
function daysBetween(aIso, bIso) {
  return Math.round((parseISO(bIso) - parseISO(aIso)) / 86400000)
}
function monthStartISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}

module.exports = { localISO, parseISO, addDaysISO, daysBetween, monthStartISO }
