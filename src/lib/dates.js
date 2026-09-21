// Renderer-side twin of electron/dates.cjs — local-calendar date helpers.
// (`new Date().toISOString().slice(0, 10)` is the UTC date, which is wrong
// for part of every day for anyone east of UTC, e.g. Tanzania at UTC+3.)
const pad = (n) => String(n).padStart(2, '0')

export function localISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export function parseISO(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
export function addDaysISO(iso, n) {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return localISO(d)
}
export function daysBetween(aIso, bIso) {
  return Math.round((parseISO(bIso) - parseISO(aIso)) / 86400000)
}
export function monthStartISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}
