import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled with the app (not fetched from Google Fonts): the page's
// Content-Security-Policy blocks remote fonts, and LifeOS is offline-first.
import '@fontsource/syne/latin-600.css'
import '@fontsource/syne/latin-700.css'
import '@fontsource/syne/latin-800.css'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/dm-sans/latin-700.css'
import './styles/global.css'
import App from './App.jsx'

// On Electron, window.api is already in place: electron/preload.cjs
// installs it before this script ever runs, so nothing below changes and
// the desktop boot path is byte-for-byte what it was.
//
// On Android there is no preload and no main process. The database has to
// be opened, migrated and wrapped in a window.api of its own INSIDE the
// WebView, and that is async — so React is mounted only once it resolves.
// The stores fire their first window.api call during the initial render.
async function start() {
  const root = createRoot(document.getElementById('root'))
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) {
      const { bootstrapNative } = await import('./native/index.js')
      await bootstrapNative()
    }
  } catch (err) {
    // A failure here means no window.api at all, so React would mount
    // into a wall of undefined-property errors. Say what happened
    // instead.
    console.error('LifeOS failed to start:', err)
    document.getElementById('root').innerHTML =
      `<div style="padding:24px;font-family:system-ui;color:#e6e8ee">
         <h2 style="margin:0 0 8px">LifeOS could not start</h2>
         <p style="opacity:.7;font-size:14px">${String(err && err.message || err)}</p>
       </div>`
    return
  }

  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

start()
