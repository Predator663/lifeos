// src/native/reportTemplate.js — ESM copy of electron/reportTemplate.cjs,
// unchanged apart from the module syntax, so the Android report looks
// exactly like the desktop one. On Android there is no printToPDF, so
// this HTML is saved to a file and shared (open in Chrome -> Print ->
// Save as PDF).
//
// Originally: builds the printable HTML for the finance PDF export. Deliberately plain HTML/CSS/inline-SVG, no React: it's
// rendered once in a hidden, throwaway BrowserWindow and converted
// straight to PDF via webContents.printToPDF, so there's no interactivity
// to justify a framework here — just print-safe markup.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function money(n) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)
}
function monthLabel(m) {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: 'short' }) + " '" + y.slice(2)
}

// Small self-contained grouped-bar SVG for the 6-month income vs expense
// trend — no charting library needed for a one-off static render.
function monthlyTrendSvg(monthlyRows) {
  const months = {}
  for (const r of monthlyRows) {
    months[r.month] = months[r.month] || { income: 0, expense: 0 }
    months[r.month][r.type] = r.total
  }
  const keys = Object.keys(months).sort()
  if (!keys.length) return `<div style="color:#999;font-size:11px;padding:20px 0">No transactions yet to chart.</div>`

  const max = Math.max(1, ...keys.map(k => Math.max(months[k].income, months[k].expense)))
  const w = 640, h = 200, padL = 42, padB = 26, padT = 10
  const groupW = (w - padL - 20) / keys.length
  const barW = Math.min(26, groupW / 3)

  let bars = ''
  keys.forEach((k, i) => {
    const gx = padL + i * groupW + groupW / 2
    const incH = ((h - padB - padT) * months[k].income) / max
    const expH = ((h - padB - padT) * months[k].expense) / max
    bars += `<rect x="${gx - barW - 3}" y="${h - padB - incH}" width="${barW}" height="${incH}" rx="2" fill="#22c55e" />`
    bars += `<rect x="${gx + 3}" y="${h - padB - expH}" width="${barW}" height="${expH}" rx="2" fill="#ef4444" />`
    bars += `<text x="${gx}" y="${h - padB + 16}" font-size="10" text-anchor="middle" fill="#666">${esc(monthLabel(k))}</text>`
  })

  const gridLines = [0, .25, .5, .75, 1].map(f => {
    const y = padT + (h - padB - padT) * (1 - f)
    return `<line x1="${padL}" y1="${y}" x2="${w - 10}" y2="${y}" stroke="#e5e7eb" stroke-width="1" />
      <text x="${padL - 6}" y="${y + 3}" font-size="9" text-anchor="end" fill="#999">${Math.round(max * f)}</text>`
  }).join('')

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:640px;display:block">${gridLines}${bars}</svg>`
}

function categoryBars(byCategory) {
  if (!byCategory.length) return `<div style="color:#999;font-size:11px;padding:14px 0">No expenses yet.</div>`
  const max = Math.max(1, ...byCategory.map(c => c.total))
  return byCategory.map(c => `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
        <span>${esc(c.category)}</span><span>${money(c.total)}</span>
      </div>
      <div style="height:7px;border-radius:4px;background:#f1f1f4;overflow:hidden">
        <div style="height:100%;border-radius:4px;background:#e8500a;width:${(c.total / max) * 100}%"></div>
      </div>
    </div>`).join('')
}

function budgetRows(budgets) {
  if (!budgets.length) return `<tr><td colspan="5" style="color:#999;text-align:center;padding:14px">No budgets set.</td></tr>`
  return budgets.map(b => {
    const color = b.percent >= 100 ? '#ef4444' : b.percent >= 75 ? '#eab308' : '#22c55e'
    return `<tr>
      <td>${esc(b.category)}</td>
      <td style="text-align:right">${money(b.monthly_limit)}</td>
      <td style="text-align:right">${money(b.spent)}</td>
      <td style="text-align:right">${money(b.remaining)}</td>
      <td style="width:110px">
        <div style="height:7px;border-radius:4px;background:#f1f1f4;overflow:hidden">
          <div style="height:100%;border-radius:4px;background:${color};width:${Math.min(100, b.percent)}%"></div>
        </div>
      </td>
    </tr>`
  }).join('')
}

function recurringRows(recurring) {
  if (!recurring.length) return `<tr><td colspan="6" style="color:#999;text-align:center;padding:14px">No recurring transactions.</td></tr>`
  return recurring.map(r => `
    <tr>
      <td style="text-transform:capitalize">${esc(r.type)}</td>
      <td>${esc(r.category)}${r.note ? ' · ' + esc(r.note) : ''}</td>
      <td style="text-align:right;color:${r.type === 'income' ? '#16a34a' : '#dc2626'}">${r.type === 'income' ? '+' : '-'}${money(r.amount)}</td>
      <td style="text-transform:capitalize">${esc(r.frequency)}</td>
      <td>${esc(r.next_date)}</td>
      <td>${r.active ? 'Active' : 'Paused'}</td>
    </tr>`).join('')
}

function transactionRows(transactions) {
  if (!transactions.length) return `<tr><td colspan="4" style="color:#999;text-align:center;padding:14px">No transactions yet.</td></tr>`
  return transactions.map(t => {
    const isTransfer = t.type === 'transfer'
    const isDebt = t.type === 'debt_in' || t.type === 'debt_out'
    const desc = isTransfer
      ? `${esc(t.account_name || '—')} → ${esc(t.to_account_name || '—')}`
      : isDebt
        ? `${esc(t.note || 'Debt')}${t.account_name ? ' · ' + esc(t.account_name) : ''}`
        : `${esc(t.category)}${t.merchant ? ' · ' + esc(t.merchant) : ''}${t.note ? ' · ' + esc(t.note) : ''}${t.account_name ? ' · ' + esc(t.account_name) : ''}`
    const inflow = t.type === 'income' || t.type === 'debt_in'
    const color = isTransfer ? '#2563eb' : isDebt ? '#7c3aed' : (inflow ? '#16a34a' : '#dc2626')
    const sign = isTransfer ? '' : (inflow ? '+' : '-')
    const typeLabel = isDebt ? 'debt' : t.type
    return `
    <tr>
      <td>${esc(t.date)}</td>
      <td>${desc}</td>
      <td style="text-transform:capitalize">${esc(typeLabel)}</td>
      <td style="text-align:right;color:${color}">${sign}${money(t.amount)}</td>
    </tr>`
  }).join('')
}

function goalRows(goals) {
  if (!goals.length) return `<tr><td colspan="5" style="color:#999;text-align:center;padding:14px">No savings goals.</td></tr>`
  return goals.map(g => {
    const pct = g.target_amount > 0 ? Math.min(100, Math.floor((g.saved / g.target_amount) * 100)) : 0
    return `<tr>
      <td>${esc(g.icon || '')} ${esc(g.name)}${g.status === 'achieved' ? ' <span style="color:#16a34a">✓ achieved</span>' : ''}</td>
      <td style="text-align:right">${money(g.saved)}</td>
      <td style="text-align:right">${money(g.target_amount)}</td>
      <td>${esc(g.target_date || '—')}</td>
      <td style="width:110px">
        <div style="height:7px;border-radius:4px;background:#f1f1f4;overflow:hidden">
          <div style="height:100%;border-radius:4px;background:#22c55e;width:${pct}%"></div>
        </div>
      </td>
    </tr>`
  }).join('')
}

function debtRows(debts) {
  if (!debts.length) return `<tr><td colspan="6" style="color:#999;text-align:center;padding:14px">No open debts.</td></tr>`
  return debts.map(d => `<tr>
      <td>${d.direction === 'owed_to_me' ? 'Owed to me' : 'I owe'}</td>
      <td>${esc(d.person)}${d.note ? ' · ' + esc(d.note) : ''}</td>
      <td style="text-align:right">${money(d.total)}</td>
      <td style="text-align:right">${money(d.paid)}</td>
      <td style="text-align:right;color:${d.direction === 'owed_to_me' ? '#16a34a' : '#dc2626'}">${money(d.remaining)}</td>
      <td style="${d.overdue ? 'color:#dc2626;font-weight:600' : ''}">${esc(d.due_date || '—')}${d.overdue ? ' (overdue)' : ''}</td>
    </tr>`).join('')
}

function buildFinanceReportHtml({ profile, summary, budgets, recurring, transactions, goals = [], debts = [], generatedAt }) {
  const recent = transactions.slice(0, 30)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #1a1a1a; font-size: 12px; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #e8500a; }
  .muted { color: #888; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 7px 8px; text-align: left; font-size: 11px; border-bottom: 1px solid #eee; }
  th { color: #888; font-weight: 600; text-transform: uppercase; font-size: 9.5px; letter-spacing: .03em; }
  .kpis { display: flex; gap: 12px; margin-top: 18px; }
  .kpi { flex: 1; border: 1px solid #eee; border-radius: 8px; padding: 14px 16px; }
  .kpi .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: .03em; }
  .kpi .value { font-size: 20px; font-weight: 700; margin-top: 4px; }
  .legend span { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; margin-right: 16px; }
  .swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
</style>
</head>
<body>
  <div>
    <h1>Financial Report</h1>
    <div class="muted">Generated ${esc(generatedAt)} · LifeOS</div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="label">Total Income</div><div class="value" style="color:#16a34a">${money(summary.income)}</div></div>
    <div class="kpi"><div class="label">Total Expenses</div><div class="value" style="color:#dc2626">${money(summary.expense)}</div></div>
    <div class="kpi"><div class="label">Net Balance</div><div class="value" style="color:${summary.balance >= 0 ? '#16a34a' : '#dc2626'}">${money(summary.balance)}</div></div>
  </div>

  <h2>Income vs. Expenses — last 6 months</h2>
  ${monthlyTrendSvg(summary.monthly)}
  <div class="legend"><span><span class="swatch" style="background:#22c55e"></span>Income</span><span><span class="swatch" style="background:#ef4444"></span>Expense</span></div>

  <h2>Spending by Category</h2>
  ${categoryBars(summary.byCategory)}

  <h2>Budgets</h2>
  <table>
    <thead><tr><th>Category</th><th style="text-align:right">Limit</th><th style="text-align:right">Spent</th><th style="text-align:right">Remaining</th><th>Progress</th></tr></thead>
    <tbody>${budgetRows(budgets)}</tbody>
  </table>

  <h2>Savings Goals</h2>
  <table>
    <thead><tr><th>Goal</th><th style="text-align:right">Saved</th><th style="text-align:right">Target</th><th>Deadline</th><th>Progress</th></tr></thead>
    <tbody>${goalRows(goals)}</tbody>
  </table>

  <h2>Open Debts</h2>
  <table>
    <thead><tr><th>Direction</th><th>Person</th><th style="text-align:right">Total</th><th style="text-align:right">Paid</th><th style="text-align:right">Remaining</th><th>Due</th></tr></thead>
    <tbody>${debtRows(debts)}</tbody>
  </table>

  <h2>Recurring Transactions</h2>
  <table>
    <thead><tr><th>Type</th><th>Category</th><th style="text-align:right">Amount</th><th>Frequency</th><th>Next Date</th><th>Status</th></tr></thead>
    <tbody>${recurringRows(recurring)}</tbody>
  </table>

  <h2>Recent Transactions${transactions.length > 30 ? ` <span class="muted" style="font-weight:400">(most recent 30 of ${transactions.length})</span>` : ''}</h2>
  <table>
    <thead><tr><th>Date</th><th>Category</th><th>Type</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${transactionRows(recent)}</tbody>
  </table>
</body>
</html>`
}

export { buildFinanceReportHtml }
