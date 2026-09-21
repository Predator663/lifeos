// src/native/ai.js — Android port of electron/ai.cjs. Byte-for-byte the
// same prompts, schema validation and error strings; the only difference
// is that it runs inside the WebView instead of the Electron main
// process. CapacitorHttp is enabled in capacitor.config.json so this
// fetch to api.anthropic.com is made natively and is not subject to the
// WebView's CORS rules. The API key still never leaves the device except
// in this request's headers.
//
// The finance category list lives in electron/main.cjs on desktop; it is
// repeated here so the native bridge can pass the identical list.
const API_URL = 'https://api.anthropic.com/v1/messages'

function stripFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

async function callClaude({ apiKey, model, system, user, maxTokens = 700 }) {
  if (!apiKey) return { ok: false, error: 'No Anthropic API key set. Add one in Settings → AI Assistant.' }

  let res
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-5',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
  } catch (e) {
    return { ok: false, error: 'Could not reach the Anthropic API — check your internet connection.' }
  }

  if (!res.ok) {
    let msg = `Anthropic API error (${res.status})`
    try {
      const body = await res.json()
      if (body?.error?.message) msg = body.error.message
    } catch { /* non-JSON error body, keep generic message */ }
    return { ok: false, error: msg }
  }

  const data = await res.json()
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  return { ok: true, text }
}

// Turns a short, informal description ("paid 15000 for lunch at Steers,
// cash") into a structured transaction the renderer can drop straight
// into the Add Transaction form for the user to review and confirm.
async function parseTransaction({ apiKey, model, text, categories, accountNames, today }) {
  const system = `You convert one short, informal description of a personal financial transaction into structured JSON.
Respond with ONLY a single JSON object — no markdown fences, no commentary. Schema:
{"type":"income"|"expense","amount":number,"category":string,"account":string|null,"merchant":string,"note":string,"date":"YYYY-MM-DD"}
Rules:
- "category" must be exactly one of: ${categories.join(', ')}. Pick the closest match; use "General" if unsure.
- "account" must be exactly one of these account names if one is clearly implied, otherwise null: ${accountNames.join(', ') || '(no accounts yet)'}
- "date" defaults to ${today} if no date is mentioned. Resolve relative dates ("yesterday", "last Monday") against ${today}.
- "merchant" is the payee/business/person if mentioned, else "".
- "note" is a short, cleaned-up description — do not just repeat the merchant name.
- "amount" is a plain positive number, no currency symbols or thousands separators.`

  const result = await callClaude({ apiKey, model, system, user: text, maxTokens: 400 })
  if (!result.ok) return result

  try {
    const parsed = JSON.parse(stripFences(result.text))
    if (!parsed.type || !['income', 'expense'].includes(parsed.type)) throw new Error('bad type')
    if (typeof parsed.amount !== 'number' || !(parsed.amount > 0)) throw new Error('bad amount')
    return {
      ok: true,
      data: {
        type: parsed.type,
        amount: parsed.amount,
        category: categories.includes(parsed.category) ? parsed.category : 'General',
        account: accountNames.includes(parsed.account) ? parsed.account : null,
        merchant: typeof parsed.merchant === 'string' ? parsed.merchant : '',
        note: typeof parsed.note === 'string' ? parsed.note : '',
        date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : today,
      },
    }
  } catch (e) {
    return { ok: false, error: 'Couldn\'t understand that transaction. Try rephrasing, e.g. "Paid 15000 for lunch at Steers, cash".' }
  }
}

// Reviews the current spending picture and returns a short list of
// specific, numbers-grounded observations and suggestions.
async function generateInsights({ apiKey, model, payload }) {
  const system = `You are a concise personal-finance analyst. Given JSON data summarizing someone's income, expenses,
category breakdown, budgets, recent trend — and, when present, savings goals (target/saved/deadline) and debts (owed_to_me / i_owe, overdue amounts) — respond with ONLY a JSON object — no markdown fences:
{"insights":[{"type":"positive"|"warning"|"tip","text":string}]}
Rules:
- 3 to 6 insights, each under 160 characters, each specific to the numbers given (cite real figures, percentages, or category names from the data — never generic advice like "track your spending").
- Mention savings goals or debts only when the numbers say something useful (a goal falling behind its deadline, a large overdue debt, savings well ahead) — never pad.
- "positive" for things going well, "warning" for concerning patterns (overspending, a budget exceeded, a low or negative savings rate), "tip" for one concrete, actionable suggestion.
- No markdown, no currency symbols — plain numbers only.`

  const result = await callClaude({ apiKey, model, system, user: JSON.stringify(payload), maxTokens: 700 })
  if (!result.ok) return result

  try {
    const parsed = JSON.parse(stripFences(result.text))
    if (!Array.isArray(parsed.insights)) throw new Error('bad shape')
    const insights = parsed.insights
      .filter(i => i && typeof i.text === 'string' && i.text.trim())
      .map(i => ({ type: ['positive', 'warning', 'tip'].includes(i.type) ? i.type : 'tip', text: i.text.slice(0, 220) }))
      .slice(0, 6)
    if (!insights.length) throw new Error('empty')
    return { ok: true, insights }
  } catch (e) {
    return { ok: false, error: 'Couldn\'t generate insights from the response. Try again.' }
  }
}

export const FINANCE_CATEGORIES = ['General', 'Food', 'Transport', 'Rent', 'Utilities', 'School', 'Health', 'Entertainment', 'Savings', 'Other']

export { parseTransaction, generateInsights }
