// src/native/index.js — everything that has to happen before the React
// app renders on Android, in the order it has to happen.
//
// On the desktop this work is done by the Electron main process before
// the window is created: open the database, run migrations, catch up on
// recurring transactions, start the notification poll. Here it all runs
// inside the WebView, so main.jsx awaits it and only then mounts React —
// the stores call window.api on their very first render and it must
// already be there.
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

import * as db from './db.js'
import { createCapacitorStorage } from './storage.js'
import { createNativeApi, onDbChanged, broadcastTables } from './bridge.js'
import { initFiles } from './files.js'
import { initScheduler, scheduleSoon } from './scheduler.js'

export function isNativePlatform() {
  return Capacitor.isNativePlatform()
}

export async function bootstrapNative() {
  // Flag read by src/lib/fileSrc.js, which is shared with the desktop
  // build and must not import Capacitor.
  window.__lifeosNative = true

  // sql.js fetches its .wasm at runtime; the ?url import makes Vite emit
  // it as an asset and hand back the hashed path, so it is bundled into
  // the APK instead of being pulled off the network.
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })

  const storage = createCapacitorStorage(SQL)
  await db.init(storage)
  await initFiles()

  window.api = createNativeApi({ SQL })

  // The desktop runs this on startup and on every poll tick; the phone
  // runs it on startup and on every resume (below), which is the closest
  // equivalent to "the app has been running all along".
  try { db.finance.recurring.processDue() } catch { /* never block boot on this */ }

  // ── lifecycle ──────────────────────────────────────────────────────
  // Android can kill a backgrounded process without warning, so the
  // debounced save is flushed the moment the app stops being visible.
  CapApp.addListener('appStateChange', async ({ isActive }) => {
    if (!isActive) {
      await db.flush()
      return
    }
    // Coming back to the foreground is the phone's version of "the app
    // has been running": catch up any recurring transactions that fell
    // due while it was closed, and tell the stores if anything appeared.
    try {
      const before = db.finance.getAll().length
      db.finance.recurring.processDue()
      if (db.finance.getAll().length !== before) broadcastTables(['finance', 'all'])
    } catch { /* ignore */ }
    scheduleSoon(db, 300)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') db.flush().catch(() => {})
  })
  window.addEventListener('pagehide', () => { db.flush().catch(() => {}) })

  try {
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setBackgroundColor({ color: '#0b0e14' })
  } catch { /* not fatal if the status bar plugin is unavailable */ }

  // Alarms need the runtime permission on Android 13+; the Settings page
  // shows a banner when this comes back denied.
  await initScheduler(db)

  try { await SplashScreen.hide() } catch { /* ignore */ }

  return { db, onDbChanged }
}

export { db }
