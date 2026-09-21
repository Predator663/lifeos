# LifeOS on Android

LifeOS is wrapped with Capacitor: the same Vite/React renderer that the
Electron app loads is packaged into an APK, and a native implementation
of `window.api` runs inside the WebView in place of Electron's preload +
main process. Same UI, same SQLite schema, fully offline.

The desktop build is untouched. `npm run dev` and `npm run dist:win`
behave exactly as before, and nothing in `electron/` was modified during
the port (`git diff <baseline> HEAD -- electron/` is empty).

---

## 1. Prerequisites (Windows)

| Tool | Version | Why |
|---|---|---|
| Node.js | 20 or 22 LTS | already required by the desktop build |
| JDK | **21** | Capacitor 8 / Android Gradle Plugin 8.7+ requires JDK 21 |
| Android Studio | Ladybug (2024.2) or newer | ships the SDK, platform-tools and an emulator |
| Android SDK | Platform **35**, Build-Tools 35.x | `compileSdk`/`targetSdk` 35 |

Android Studio bundles a JDK 21 (JetBrains Runtime). Point Gradle at it
rather than installing a second JDK:

```powershell
setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx PATH "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools"
```

Close and reopen PowerShell so the variables take effect. Verify:

```powershell
java -version        # should say 21
adb version
```

The first Gradle run downloads the Gradle distribution, the Android
Gradle Plugin and the AndroidX dependencies (roughly 1–1.5 GB). It needs
a working internet connection once; after that it builds offline.

---

## 2. Build a debug APK

```powershell
cd C:\path\to\lifeos
npm install
npm run android:apk
```

That runs `vite build`, then `cap sync android`, then
`gradlew.bat assembleDebug`. The APK lands at:

```
android\app\build\outputs\apk\debug\app-debug.apk
```

To build the pieces separately:

```powershell
npm run build:android          # vite build + cap sync android
cd android
.\gradlew.bat assembleDebug
```

Open the project in Android Studio instead if you prefer a GUI:
`File > Open > <repo>\android`.

---

## 3. Install it on the phone

**Over USB (recommended).** On the phone: Settings > About phone > tap
"Build number" seven times to unlock Developer options, then Developer
options > **USB debugging** on. Plug it in and accept the "Allow USB
debugging?" prompt.

```powershell
adb devices                                                        # confirm it is listed
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

`-r` reinstalls over an existing copy and keeps its data. Note that a
debug APK and a release APK are signed with different keys, so you cannot
upgrade one to the other in place — uninstall first (which **deletes the
database**, so export it from Settings > Backup & transfer beforehand).

**Without a cable.** Copy `app-debug.apk` to the phone (USB storage,
Drive, WhatsApp to yourself), open it in Files, and allow
"Install unknown apps" for whichever app is opening it.

---

## 4. Release signing

Generate a keystore once and keep it somewhere safe — losing it means you
can never update an installed release build:

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v `
  -keystore "$env:USERPROFILE\keys\lifeos-release.jks" `
  -alias lifeos `
  -keyalg RSA -keysize 2048 -validity 10000
```

Then create `android\keystore.properties` (gitignored — never commit it).
`android\keystore.properties.example` is a template:

```properties
storeFile=C:\\Users\\Bert\\keys\\lifeos-release.jks
storePassword=...
keyAlias=lifeos
keyPassword=...
```

Backslashes must be doubled. Build:

```powershell
npm run android:release        # -> android\app\build\outputs\apk\release\app-release.apk
npm run android:bundle         # -> android\app\build\outputs\bundle\release\app-release.aab  (Play Store)
```

`android/app/build.gradle` applies the release `signingConfig` only when
`keystore.properties` exists, so a clone without it still builds debug.

---

## 5. Decisions made during the port

**Capacitor over React Native / a rewrite.** The renderer is 100%
reusable; only the `window.api` layer is platform-specific.

**sql.js (WASM) over a native SQLite plugin.** `electron/db.cjs` is
synchronous better-sqlite3 code from top to bottom. `src/native/sqlite.js`
is a small better-sqlite3-compatible shim over sql.js, which let
`src/native/db.js` stay a near-line-for-line copy of the desktop logic
instead of an async rewrite — far less room for behaviour to drift.
Cost: the whole database is held in memory and re-serialised on write.
At LifeOS's data volumes (a personal database, a few MB at most) that is
not a concern; it would be at hundreds of MB.

**Persistence.** After every write the database is exported and saved,
debounced ~300 ms, to a temp file which is then renamed over
`lifeos.db` in `Directory.Data` — the rename is what makes the swap
atomic. It is flushed immediately on `appStateChange(inactive)`,
`visibilitychange` and `pagehide`, because Android can kill a
backgrounded process without warning.

**PIN hashing.** `node:crypto` SHA-256 replaced with Web Crypto SHA-256
producing the identical lowercase hex, so existing PINs survive a
database import from the PC. There is a test asserting the two digests
match.

**Notifications are scheduled, not polled.** Android will not run a
30-second WebView timer in the background. `src/native/scheduler.js`
cancels and recomputes the whole notification set on app start, on
resume, and after every database write, scheduling everything due in the
next 60 days (capped at 60 notifications, soonest first). Ids are derived
from kind + row id + stage so a recompute replaces rather than
duplicates. Reboot is handled by the plugin itself — it registers a
`LocalNotificationRestoreReceiver` for `BOOT_COMPLETED` and declares
`RECEIVE_BOOT_COMPLETED`, verified in
`node_modules/@capacitor/local-notifications/android/src/main/AndroidManifest.xml`,
so nothing extra was needed.

**Attachments are copied, not referenced.** Windows paths mean nothing on
a phone, and the file picker's own paths stop resolving after a restart.
Chosen files are copied into `Directory.Data/attachments` and stored as
a *relative* path (`attachments/1735…-receipt.jpg`), resolved at render
time by `src/lib/fileSrc.js`. Relative rather than absolute because the
absolute path contains the Android user id, which can change between
installs.

**Mobile layout via one CSS block.** All phone styling lives in a single
`@media (max-width: 768px)` block in `src/styles/global.css`, so above
768px not one rule applies and the desktop render is unchanged. The pages
set their grids with inline `gridTemplateColumns`, and rather than edit
dozens of call sites (and risk the desktop look) the block collapses any
inline grid to one column with `!important` — which is the one thing that
can override an inline style. Opt out with `.keep-cols` / `.keep-min`;
the calendar month grid does exactly that to stay 7 columns.

**No Google Drive on Android.** Drive/Calendar OAuth uses a loopback
redirect that needs a desktop browser. The Drive, Google-account, phone-relay,
auto-launch and quit cards are hidden on Android and their channels return
a neutral "desktop-only" value rather than throwing. PC↔phone data movement
is manual: Settings > Backup & transfer.

**Data browser.** Settings > Manage your data opens a generic table
viewer/deleter (`src/pages/Database.jsx`, backed by `data.*` in both
`electron/db.cjs` and `src/native/db.js`) covering every table a user
would recognise as their own — tasks, events, transactions, accounts,
habits, notes, budgets, categories, recurring transactions, savings goals
and debts. Rows can be deleted (cascading to their children via the
existing `ON DELETE CASCADE` foreign keys) or archived/restored where the
table has an `archived` column. Internal tables (`profile`, `phone_outbox`)
are intentionally excluded — they already have dedicated UI.

**Report export.** `printToPDF` does not exist here. The identical
`reportTemplate` HTML is written to a file and handed to the share sheet;
open it in Chrome and use Print > Save as PDF for the same document.

---

## 6. Moving your data from the PC

1. On Windows, close LifeOS and copy `%APPDATA%\LifeOS\lifeos.db`
   to the phone (or pick any Drive backup file).
2. On the phone: Settings > Backup & transfer > **Import database**.
3. Pick the file. It is opened and checked for the LifeOS tables before
   anything is touched, then you get a confirmation naming the file and
   how many tasks/transactions/debts/notes it holds.
4. Confirm. The phone's current database is **replaced**, migrations run
   against the incoming file, and every store reloads.

Going the other way: **Export database** writes a
`LifeOS-backup-YYYY-MM-DD.db` and opens the share sheet. Copy it to the
PC over `%APPDATA%\LifeOS\lifeos.db` with LifeOS closed.

This is a copy, not sync. Whichever database you import wins outright;
anything done on the other device since is lost. The UI says so.

---

## 7. Known limitations

- **Attachments do not travel with the database.** An imported PC
  database carries attachment *rows* whose files are still on the PC.
  Those show "Not on this device" instead of a broken image or a crash.
- **No Google Drive backup, no Google Calendar phone relay** on Android.
- **No live sync** between PC and phone — see above.
- **Report export produces HTML, not PDF.** One extra step (Chrome >
  Print > Save as PDF) gets you the PDF.
- **Reminders need permission.** Android 13+ requires POST_NOTIFICATIONS;
  Android 12+ wants a separate exact-alarm grant. Settings shows a banner
  when either is missing. Without exact alarms a reminder can slip a few
  minutes while Android batches wake-ups.
- **Only the next ~60 days of reminders are scheduled**, recomputed on
  every launch and resume. Open the app at least once every couple of
  months and nothing is ever missed.
- **Aggressive battery optimisation** (Xiaomi, Oppo, Samsung "Deep
  sleep") can suppress scheduled notifications. Exempt LifeOS in
  Settings > Battery if reminders stop arriving.
- **A debug APK cannot be upgraded to a release APK in place** — the
  signatures differ. Export first, uninstall, install, import.
- **The whole database lives in memory** while the app runs (sql.js).
  Fine at personal scale; it would not be at hundreds of MB.
- **The mobile grid collapse is a blunt instrument.** Any inline grid
  becomes one column under 768px. If a specific grid should keep its
  columns on a phone, add `className="keep-cols"`.

## 8. Fixed in this pass

- **Settings was missing its Android-only cards.** A JSX conditional was
  accidentally nested as `{!isNative && (<>{isNative && (<>...` — the outer
  `!isNative` check meant the inner Android-only branch (notification
  permission banners, Backup & transfer) never rendered on a real Android
  build. Fixed by giving the Android block and the desktop-only Google
  account block separate, correctly-gated conditionals.
- **Native feel.** Added `src/lib/haptics.js` (wraps `@capacitor/haptics`,
  no-ops on desktop) and wired it into bottom-nav taps and the data
  browser's delete/archive actions. `touch-action: manipulation` removes
  the ~300ms tap delay and double-tap-zoom; `overscroll-behavior-y: contain`
  stops the page rubber-banding past its edges, which is what made the
  WebView feel like a website rather than an installed app.
  `windowSoftInputMode="adjustResize"` was added to the activity so the
  keyboard resizes the layout instead of covering focused inputs.
- **Data browser.** New Settings > Manage your data page — see above.
