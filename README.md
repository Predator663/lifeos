# LifeOS

A local-first personal command center for Windows 10: tasks, calendar,
finance, discipline/habit streaks, and notes with photo/file attachments —
one app, one local SQLite database, no server, no account, nothing leaves
your PC.

## What's included

- **Dashboard** — today's tasks, upcoming events, balance, habit streaks at a glance
- **Tasks** — priorities, due date/time, recurring, filters, attachments
- **Calendar** — month view, colored events, reminders
- **Finance** — three tabs:
  - **Overview** — income/expense tracking, accounts, transfers, budgets, recurring, charts, AI insights, PDF export
  - **Savings** — goals with a target, deadline and history; progress, pace ("save X per month to finish on time", projected finish date), milestone celebrations, an emergency-fund preset, and a "free to spend" figure
  - **Debts** — money you owe and money owed to you: partial payments, interest/fees, due dates with reminders, per-person net balances, WhatsApp/copy reminder messages, and optional account tracking
- **Discipline** — habit streaks with a 30-day heatmap
- **Notes** — searchable notes with photo/file attachments
- **Phone notifications** — every reminder LifeOS shows on the PC is also sent to your phone through your Google account (see below)
- **Runs in the background** — closing the window minimizes to the system tray instead of quitting, so reminders keep firing
- **Starts on Windows login** — toggle in Settings (on by default)
- **Live updates everywhere** — every write broadcasts to the whole app, so any open page reflects the true database instantly, no refresh needed

## Requirements

- **Node.js 18+** (LTS recommended) — https://nodejs.org
- Windows 10/11 (the app also runs on macOS/Linux for development, but auto-start-on-login and the packaged installer are configured for Windows)

## Run it in development

```bash
npm install
npm run dev
```

This starts the Vite dev server and opens the Electron window pointed at
it, with hot reload for the UI.

> **Note on `npm install`:** `better-sqlite3` has a native addon. `npm
> install` first builds/downloads it for your system Node.js, then the
> `postinstall` script (`electron-builder install-app-deps`) rebuilds
> it against Electron's own bundled Node — required because Electron
> and system Node are different ABI versions, and skipping this step
> is the most common reason a from-scratch clone fails to launch. This
> normally works out of the box on Windows with a recent Node.js
> version. If the postinstall step fails, install the Visual Studio
> Build Tools ("Desktop development with C++" workload) and re-run
> `npm install`.

## Build a Windows installer

```bash
npm run dist:win
```

This produces a `.exe` installer under `release/`. Run it once to install
LifeOS like any normal Windows app — it'll create Desktop and Start Menu
shortcuts and register itself to start with Windows (you can turn this
off any time from **Settings → Start with Windows** inside the app, or
from the tray icon's right-click menu).

## Where your data lives

A single SQLite file at:

```
%APPDATA%\LifeOS\lifeos.db
```

You can always back up your data yourself by copying that file — there's
no cloud sync required, it's yours, on your machine, always. Optionally,
you can also turn on automatic **Google Drive backups** (see below) for
an extra off-machine copy.

## Google Drive backup (optional)

Settings → Google Drive Backup lets LifeOS back up `lifeos.db` straight
to a private "LifeOS Backups" folder in your own Google Drive, on a
schedule you set — with no server of ours involved anywhere in the flow.
That does mean a one-time setup step, since LifeOS can't ship a shared
Google API credential of its own and have that be meaningfully private
per-user:

1. Go to the [Google Cloud Console credentials page](https://console.cloud.google.com/apis/credentials)
   (create a project first if you don't have one — it's free).
2. Enable the **Google Drive API** for that project (APIs & Services → Enable APIs → search "Google Drive API").
3. Configure the **OAuth consent screen** — "External" user type is fine; you can leave it in "Testing" mode
   and just add your own Google account under "Test users". This avoids Google's app-verification review,
   which isn't needed for a single-user personal app.
4. Create an **OAuth client ID** → Application type: **Desktop app**. Copy the Client ID and Client Secret it gives you.
5. Paste both into LifeOS's Settings → Google Drive Backup, then click **Connect Google Drive**.
   Google will show an "unverified app" warning during sign-in — that's expected for your own
   personal client; choose **Advanced → Go to LifeOS (unsafe)** to continue.

Once connected, use **Back up now** anytime, or turn on **Auto-backup**
(daily or weekly) and LifeOS will back up in the background on its own,
keeping the 10 most recent backups and pruning older ones. Restoring
downloads the chosen backup, replaces `lifeos.db`, and restarts the app.

Only the database is backed up — attachment files (which live wherever
you originally picked them from on disk) and your profile photo aren't
included, since they aren't part of the database itself.

## Savings goals

A goal *earmarks* money you already hold — it doesn't move it out of any account. Your accounts and total
balance stay exactly as they are; the Savings tab (and the Balance card) show how much is **set aside**
and how much is **free to spend**. To physically move cash into a savings account, use **Transfer**.
Optionally tag a goal with the account it's kept in and LifeOS warns you if your goals in that account add up
to more than the account holds. Archiving or deleting a goal frees its money again.

## Debts

- **They owe me / I owe them**, with an optional phone number, due date, and flat interest/fee on top.
- **Record payment** for partial payments; the debt settles itself when nothing is left. Deleting a payment reopens it.
- **Accounts (optional).** Tick *"the money just left / arrived in one of my accounts"* when adding a debt, and/or pick an
  account when recording a payment, and that account's balance moves accordingly. These are stored as separate
  `debt_in` / `debt_out` transactions — never income or expenses — so lending 50,000 doesn't wreck your
  spending stats or savings rate. Leave it unticked for older debts.
- **Reminders:** a heads-up 3 days before, on the due day, then weekly while overdue (sent from 08:00, never overnight).
- **Remind** on money owed to you builds a polite message you can copy or open in WhatsApp
  (numbers starting with `0` are assumed Tanzanian, +255).

## Phone notifications (via your Google account)

A desktop app can't push straight to a phone, but a phone signed in to your Google account already syncs Google
Calendar and rings its reminders. So LifeOS writes each notification it fires as a tiny event in a private
**LifeOS Alerts** calendar that it creates and owns, with a pop-up reminder — and the Google Calendar app on
your phone shows it as a normal notification, about a minute later.

- **Offline-safe.** Alerts wait in a queue (`phone_outbox` in the database) and go out as soon as there's internet.
  Anything older than 24 hours is dropped instead of arriving stale, and a backlog goes out as one summary
  instead of a burst of buzzes.
- **Quiet hours** (optional): alerts during the window are held and sent afterwards.
- **Least access:** the connection asks for `calendar.app.created` — LifeOS can create *its own* calendar and manage events
  on that calendar only. It can't read your other calendars.
- The PC has to be on with LifeOS running (same as desktop notifications).

**One-time setup** (Settings → Google account / Phone notifications):

1. In [Google Cloud Console](https://console.cloud.google.com/apis/library), enable the **Google Calendar API** for the same
   project you used for Drive (or create one and enable both Drive and Calendar).
2. On the OAuth consent screen, set the publishing status to **In production**. (Apps left in *Testing* have their sign-in
   expire every 7 days — LifeOS will tell you when that happens and ask you to reconnect.)
3. In LifeOS: Settings → Google account → **Reconnect** (existing Drive connections don't have Calendar permission yet).
   Leave every box ticked on Google's screen.
4. Turn on **Send notifications to my phone**, then press **Send test alert**.
5. On your phone, sign in to the same Google account, open Google Calendar once, and make sure **LifeOS Alerts** is
   switched on (Settings → LifeOS Alerts → Sync) and notifications are allowed.

## Project structure

```
electron/
  main.cjs          — window, tray, auto-start, notification scheduler, IPC handlers
  preload.cjs        — safe bridge exposing window.api to the React app
  db.cjs             — SQLite schema + all CRUD operations
  notifications.cjs  — decides what's due right now (tasks, events, debts, savings deadlines)
  drive.cjs           — Google OAuth (shared by Drive + phone alerts) + Drive backup/restore REST calls
  phone.cjs           — relays notifications to the phone via a Google Calendar "LifeOS Alerts" calendar
  dates.cjs           — local-calendar date helpers (see "Dates" below)
src/
  App.jsx            — routing + live DB-change syncing
  store/              — one Zustand store per domain (tasks, events, finance, savings, debts, habits, notes, drive, phone)
  pages/              — one page per domain (Finance's Savings and Debts tabs live in pages/finance/)
  lib/                — dates, formatting, savings pace maths, debt reminder helpers
  components/         — Sidebar, Modal, Toast, ProgressRing, AttachmentBar
  styles/global.css   — the whole design system
```

## Dates

Plain `YYYY-MM-DD` dates mean the date on *your wall calendar*. Always use `localISO()` (`electron/dates.cjs`,
`src/lib/dates.js`) — never `new Date().toISOString().slice(0, 10)`, which is the UTC date and is wrong for part of
every day (and shifts recurring dates backward) for anyone east of UTC, e.g. Tanzania.

## Fonts

Syne and DM Sans ship inside the app (via `@fontsource`), so they load offline and no request to Google Fonts is made —
the page's Content-Security-Policy would block one anyway.

## Extending it

Everything is intentionally simple and file-per-domain, so adding a new
field or a new domain (e.g. "Goals") means: add a table in `db.cjs`, add
IPC handlers in `main.cjs` + `preload.cjs`, add a Zustand store, add a
page, add it to the sidebar nav list in `Sidebar.jsx`.
