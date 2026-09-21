import { fmt, fmtDate } from './format'

// wa.me wants digits only, with the country code and no leading 0 / +.
// Numbers typed the local way ("0712 345 678") are assumed to be Tanzanian
// (+255); anything starting with + or 00 is treated as already international.
export function whatsappNumber(phone, defaultCountryCode = '255') {
  let d = String(phone || '').replace(/[^\d+]/g, '')
  if (!d) return ''
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = defaultCountryCode + d.slice(1)
  return d.replace(/\D/g, '')
}

export function whatsappLink(phone, text) {
  const n = whatsappNumber(phone)
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : ''
}

// A polite, editable nudge for money someone owes me.
export function reminderMessage(debt) {
  const what = debt.note ? ` (${debt.note})` : ''
  const amount = fmt(debt.remaining)
  let when = ''
  if (debt.due_date) when = debt.overdue ? `, which was due on ${fmtDate(debt.due_date)}` : `, which is due on ${fmtDate(debt.due_date)}`
  const partial = debt.paid > 0 ? ` Thank you for the ${fmt(debt.paid)} already paid.` : ''
  return `Hi ${debt.person}, a friendly reminder about the ${amount} you owe me${what}${when}.${partial} Please let me know when you can settle it. Thank you!`
}
