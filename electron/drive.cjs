// electron/drive.cjs — the app's Google connection: OAuth (shared by Drive
// backup AND phone alerts, see phone.cjs) plus the Drive backup REST calls.
//
// LifeOS is local-first by design (see db.cjs), so this deliberately does
// NOT route backups through any server of ours — it's a direct OAuth
// connection from this app, running on this machine, straight to the
// user's own Google Drive. That means the user has to register their own
// (free) OAuth "Desktop app" client in Google Cloud Console and paste the
// Client ID/Secret into Settings — the same "bring your own credentials"
// shape already used for the Anthropic API key in ai.cjs. There is no
// LifeOS server anywhere in this flow to leak a shared secret from.
//
// Scopes are the narrowest that do the job:
//  - drive.file: create/manage only files this app creates itself — LifeOS
//    never gets access to the rest of the user's Drive.
//  - calendar.app.created: create ITS OWN secondary calendar ("LifeOS
//    Alerts") and manage events on that calendar only — LifeOS can't read
//    or touch the user's other calendars.
const http = require('http')
const fs = require('fs')
const { shell } = require('electron')

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
const SCOPE = `${DRIVE_SCOPE} ${CALENDAR_SCOPE}`
const BACKUP_FOLDER_NAME = 'LifeOS Backups'
const KEEP_BACKUPS = 10 // oldest backups beyond this count are pruned after each successful upload

function authHeader(accessToken) {
  return { authorization: `Bearer ${accessToken}` }
}

// ── OAuth: authorization-code flow via a loopback redirect ─────────────
// Google's "Desktop app" OAuth client type allows redirecting to any
// http://127.0.0.1:<port>/... URI without pre-registering the exact port
// (RFC 8252 loopback flow), so a fresh local server on an ephemeral port
// is opened for each connection attempt and torn down as soon as it's
// served the one redirect it's waiting for.
function getAuthCode(clientId) {
  return new Promise((resolve, reject) => {
    let redirectUri = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      try { server.close() } catch (_) { /* already closed */ }
      reject(new Error('Timed out waiting for Google sign-in. Try connecting again.'))
    }, 5 * 60_000)

    const server = http.createServer((req, res) => {
      let code = null, error = null
      try {
        const parsed = new URL(req.url, 'http://127.0.0.1')
        if (parsed.pathname !== '/oauth2callback') { res.writeHead(404); res.end(); return }
        code = parsed.searchParams.get('code')
        error = parsed.searchParams.get('error')
      } catch (_) {
        res.writeHead(400); res.end(); return
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;text-align:center;padding-top:15vh;color:#1a1a1a;background:#f7f7f9">
        <h2>${error ? 'Connection to LifeOS failed' : 'LifeOS is connected to Google'}</h2>
        <p style="color:#666">You can close this tab and go back to LifeOS.</p></body></html>`)

      if (settled) return
      settled = true
      clearTimeout(timeout)
      server.close()
      if (error) reject(new Error(`Google sign-in was cancelled or denied (${error}).`))
      else if (code) resolve({ code, redirectUri })
      else reject(new Error('No authorization code received from Google.'))
    })

    server.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(e)
    })

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      redirectUri = `http://127.0.0.1:${port}/oauth2callback`
      const authUrl = `${AUTH_URL}?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline', // required to get a refresh_token back
        prompt: 'consent', // forces a refresh_token even on a repeat connect
      })}`
      shell.openExternal(authUrl)
    })
  })
}

async function exchangeCodeForTokens({ code, redirectUri, clientId, clientSecret }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error_description || data.error || 'Google rejected the authorization code.')
  return data // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // invalid_grant = the refresh token was revoked, or (for OAuth apps left
    // in "Testing") expired after 7 days. Tagged so callers can prompt the
    // user to reconnect instead of failing silently forever.
    const err = new Error(data.error_description || data.error || 'Could not refresh the Google connection — try reconnecting in Settings.')
    err.code = data.error
    throw err
  }
  return data // { access_token, expires_in, ... } — no new refresh_token on a normal refresh
}

// Runs the full connect flow and returns the tokens for the caller (main.cjs)
// to persist. Throws with a message that's safe to show directly in a toast.
async function connect({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) throw new Error('Enter both a Client ID and Client Secret first.')
  const { code, redirectUri } = await getAuthCode(clientId)
  const tokens = await exchangeCodeForTokens({ code, redirectUri, clientId, clientSecret })
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a long-lived connection. Remove LifeOS from myaccount.google.com/permissions and try connecting again.')
  }
  return tokens
}

// Returns a valid access token, refreshing first if the cached one is
// missing or within 60s of expiring. `changed` tells the caller whether
// the refreshed token needs to be persisted back to the database.
async function ensureAccessToken(settings) {
  const now = Date.now()
  if (settings.access_token && settings.token_expires_at && now < settings.token_expires_at - 60_000) {
    return { accessToken: settings.access_token, expiresAt: settings.token_expires_at, changed: false }
  }
  const refreshed = await refreshAccessToken({
    clientId: settings.client_id, clientSecret: settings.client_secret, refreshToken: settings.refresh_token,
  })
  return {
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000,
    changed: true,
  }
}

// ── Drive REST calls ────────────────────────────────────────────────────
// Finds the app's backup folder, verifying a cached id still exists (the
// user may have deleted it in Drive) before falling back to a search,
// and creates it on first use. Named plainly and left in the user's
// normal Drive tree (not the hidden appDataFolder) so they can see,
// download, or manage backups themselves from drive.google.com.
async function findOrCreateBackupFolder(accessToken, cachedFolderId) {
  if (cachedFolderId) {
    const check = await fetch(`${DRIVE_FILES_URL}/${cachedFolderId}?fields=id,trashed`, { headers: authHeader(accessToken) })
    if (check.ok) {
      const data = await check.json()
      if (!data.trashed) return cachedFolderId
    }
  }

  const q = encodeURIComponent(`name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
  const search = await fetch(`${DRIVE_FILES_URL}?q=${q}&fields=files(id,name)`, { headers: authHeader(accessToken) })
  const searchData = await search.json().catch(() => ({}))
  if (!search.ok) throw new Error(searchData?.error?.message || 'Could not look up the Drive backup folder.')
  if (searchData.files?.length) return searchData.files[0].id

  const create = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: { ...authHeader(accessToken), 'content-type': 'application/json' },
    body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })
  const created = await create.json().catch(() => ({}))
  if (!create.ok) throw new Error(created?.error?.message || 'Could not create the Drive backup folder.')
  return created.id
}

// Resumable upload — handles the database file at any size (unlike
// Drive's simple multipart upload, which is capped around 5MB), and
// survives a flaky connection better since the session can in principle
// be resumed. filePath should be a fresh db.backupTo() snapshot, not the
// live lifeos.db file — see the comment on backupTo() in db.cjs.
async function uploadBackup(accessToken, folderId, filePath, fileName) {
  const stat = fs.statSync(filePath)

  const initRes = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=resumable`, {
    method: 'POST',
    headers: {
      ...authHeader(accessToken),
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': 'application/x-sqlite3',
      'x-upload-content-length': String(stat.size),
    },
    body: JSON.stringify({ name: fileName, parents: [folderId] }),
  })
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}))
    throw new Error(err?.error?.message || 'Could not start the Drive upload.')
  }
  const sessionUrl = initRes.headers.get('location')
  if (!sessionUrl) throw new Error('Google did not return an upload session — try again.')

  const fileBuffer = fs.readFileSync(filePath)
  const uploadRes = await fetch(sessionUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/x-sqlite3', 'content-length': String(stat.size) },
    body: fileBuffer,
  })
  const uploaded = await uploadRes.json().catch(() => ({}))
  if (!uploadRes.ok) throw new Error(uploaded?.error?.message || 'The Drive upload failed partway through.')
  return uploaded // { id, name, ... }
}

async function listBackups(accessToken, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
  const res = await fetch(`${DRIVE_FILES_URL}?q=${q}&orderBy=createdTime desc&fields=files(id,name,createdTime,size)&pageSize=50`, {
    headers: authHeader(accessToken),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || 'Could not list backups from Drive.')
  return data.files || []
}

async function deleteBackup(accessToken, fileId) {
  await fetch(`${DRIVE_FILES_URL}/${fileId}`, { method: 'DELETE', headers: authHeader(accessToken) })
}

async function downloadBackup(accessToken, fileId, destPath) {
  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, { headers: authHeader(accessToken) })
  if (!res.ok) throw new Error('Could not download that backup from Drive.')
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(destPath, buf)
}

module.exports = {
  DRIVE_SCOPE, CALENDAR_SCOPE,
  connect, ensureAccessToken, findOrCreateBackupFolder, uploadBackup, listBackups, deleteBackup, downloadBackup,
  KEEP_BACKUPS, BACKUP_FOLDER_NAME,
}
