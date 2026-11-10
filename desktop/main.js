'use strict'
// YGO Alpha for the PC: Electron starts the app's own production server on this
// computer (a child process with the bundled Node, data in the user's profile)
// and shows it in a window. Nothing leaves the PC except the card catalog and
// card images, which come from YGOPRODeck like in the web app.
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, session, shell } = require('electron')
const { spawn } = require('node:child_process')
const { randomBytes, randomInt } = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const QRCode = require('qrcode')

const APP_NAME = 'YGO Alpha'
const HOST = '127.0.0.1'
const PREFERRED_PORT = 3737
const START_TIMEOUT_MS = 90_000
const SYNC_TIMEOUT_MS = 20 * 60_000

app.setName(APP_NAME)
// YGO_ALPHA_USER_DATA moves the settings, database and logs elsewhere (a second
// profile, or a throwaway folder for tests); by default they live in %APPDATA%.
app.setPath('userData', process.env.YGO_ALPHA_USER_DATA || path.join(app.getPath('appData'), APP_NAME))

const userData = app.getPath('userData')
const dataDir = path.join(userData, 'data')
const logDir = path.join(userData, 'logs')
const configPath = path.join(userData, 'config.json')
const serverDir = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(__dirname, 'build', 'server')
const nodeBinary = path.join(serverDir, process.platform === 'win32' ? 'node.exe' : 'node')

let config
let baseUrl = ''
let serverPort = 0
let serverProcess = null
let mainWindow = null
let phoneWindow = null
let quitting = false
let expectedExit = false
let syncing = false

// --- Settings kept between runs ----------------------------------------------

// No 0/O or 1/I/L, so a code read off a screen is typed without doubt.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function makeInviteCode() {
  const pick = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
  return `${pick()}-${pick()}`
}

/**
 * A secret for the sign-in cookies, a token for the catalog sync and an invite
 * code for the phone (new accounts only), made once per installation, plus
 * whether the phone sharing is on.
 */
function loadConfig() {
  let saved = {}
  try {
    saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  }
  catch {
    // First run, or an unreadable file: start from defaults.
  }
  const loaded = {
    secret: typeof saved.secret === 'string' && saved.secret !== '' ? saved.secret : randomBytes(32).toString('base64url'),
    adminToken: typeof saved.adminToken === 'string' && saved.adminToken !== '' ? saved.adminToken : randomBytes(24).toString('hex'),
    inviteCode: typeof saved.inviteCode === 'string' && saved.inviteCode !== '' ? saved.inviteCode : makeInviteCode(),
    phoneAccess: saved.phoneAccess === true,
    catalogSynced: saved.catalogSynced === true,
  }
  saveConfig(loaded)
  return loaded
}

function saveConfig(value) {
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(value, null, 2))
}

// --- The local server -----------------------------------------------------------

function freePort(preferred) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && preferred !== 0) {
        freePort(0).then(resolve, reject)
      }
      else {
        reject(error)
      }
    })
    probe.listen(preferred, HOST, () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

function startServer(port) {
  if (!fs.existsSync(nodeBinary) || !fs.existsSync(path.join(serverDir, '.output', 'server', 'index.mjs'))) {
    throw new Error(`Der Server fehlt in ${serverDir}. Im Ordner "desktop" zuerst "npm run prepare-server" ausführen.`)
  }

  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(logDir, { recursive: true })
  const log = fs.createWriteStream(path.join(logDir, 'server.log'), { flags: 'w' })

  serverProcess = spawn(nodeBinary, ['.output/server/index.mjs'], {
    cwd: serverDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      // Only this PC, unless the phone sharing is on (then the whole home network).
      NITRO_HOST: config.phoneAccess ? '0.0.0.0' : HOST,
      NITRO_PORT: String(port),
      NUXT_DB_FILE_PATH: path.join(dataDir, 'app.db'),
      NUXT_BETTER_AUTH_SECRET: config.secret,
      NUXT_PUBLIC_BETTER_AUTH_URL: baseUrl,
      NUXT_ADMIN_TOKEN: config.adminToken,
      // Alone on one PC anyone can create the account; on the home network only
      // with the code, so a stranger in the same Wi-Fi can't register.
      NUXT_INVITE_CODE: config.phoneAccess ? config.inviteCode : '',
      NUXT_TRUST_LOCAL_NETWORK: config.phoneAccess ? 'true' : 'false',
      // Fetch the images of the player's own cards in the background, so they are there without internet (ADR 0046).
      NUXT_CARD_IMAGE_WARMUP: '1',
    },
  })
  serverProcess.stdout.pipe(log)
  serverProcess.stderr.pipe(log)
  serverProcess.on('exit', (code) => {
    serverProcess = null
    if (!quitting && !expectedExit) {
      dialog.showErrorBox(APP_NAME, `Der eingebaute Server wurde unerwartet beendet (Code ${code}).\nDas Protokoll liegt in ${path.join(logDir, 'server.log')}.`)
      app.quit()
    }
  })
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill()
  }
}

async function waitForServer() {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!serverProcess) {
      throw new Error('Der Server ist beim Start abgebrochen.')
    }
    try {
      const response = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(3000) })
      if (response.ok) {
        return
      }
    }
    catch {
      // Not listening yet.
    }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error('Der Server hat nicht rechtzeitig geantwortet.')
}

/** Restarts the server (same port) after the phone sharing was switched, then reloads the window. */
async function restartServer() {
  expectedExit = true
  const old = serverProcess
  if (old) {
    await new Promise((resolve) => {
      old.once('exit', resolve)
      old.kill()
    })
  }
  expectedExit = false
  await new Promise(resolve => setTimeout(resolve, 400))
  startServer(serverPort)
  await waitForServer()
  mainWindow?.webContents.reload()
}

// --- Phone ----------------------------------------------------------------------------

const PRIVATE_IPV4 = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/
// Adapters a phone on the Wi-Fi can't be on (WSL, Docker, VirtualBox, VPN …) come last.
const VIRTUAL_ADAPTER = /vEthernet|WSL|Docker|VirtualBox|VMware|Hyper-V|VPN|Tailscale|Bluetooth|Loopback/i

/** This PC's addresses in the home network, real Wi-Fi / Ethernet first. */
function lanAddresses() {
  const found = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && PRIVATE_IPV4.test(entry.address)) {
        found.push({ name, address: entry.address })
      }
    }
  }
  return found.sort((a, b) => Number(VIRTUAL_ADAPTER.test(a.name)) - Number(VIRTUAL_ADAPTER.test(b.name)))
}

async function phoneState() {
  const urls = config.phoneAccess ? lanAddresses().map(entry => `http://${entry.address}:${serverPort}`) : []
  return {
    enabled: config.phoneAccess,
    urls,
    inviteCode: config.inviteCode,
    qr: urls[0] ? await QRCode.toDataURL(urls[0], { margin: 1, width: 320, color: { dark: '#0a0a1a', light: '#ffffff' } }) : null,
  }
}

async function setPhoneAccess(enabled) {
  if (config.phoneAccess !== enabled) {
    config.phoneAccess = enabled
    saveConfig(config)
    try {
      await restartServer()
    }
    catch (error) {
      dialog.showErrorBox(APP_NAME, `${error.message}\nProtokoll: ${path.join(logDir, 'server.log')}`)
    }
  }
  return phoneState()
}

function showPhoneWindow() {
  if (phoneWindow) {
    phoneWindow.focus()
    return
  }
  phoneWindow = new BrowserWindow({
    width: 560,
    height: 780,
    parent: mainWindow ?? undefined,
    title: 'Mit dem Handy verbinden',
    backgroundColor: '#0a0a1a',
    icon: path.join(__dirname, 'icon.png'),
    minimizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  phoneWindow.removeMenu()
  phoneWindow.on('closed', () => {
    phoneWindow = null
  })
  phoneWindow.loadFile(path.join(__dirname, 'phone.html'))
}

/**
 * Which permissions a page may ask for: the microphone (dictation, ADR 0040) for
 * the app's own pages on this computer, nothing else. Without a rule Electron
 * would grant every request.
 */
function restrictPermissions() {
  const ownPage = url => url.startsWith(`http://${HOST}:`) || url.startsWith('file://')
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => permission === 'media' && ownPage(requestingOrigin))
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const audioOnly = (details.mediaTypes ?? []).every(type => type === 'audio')
    callback(permission === 'media' && audioOnly && ownPage(details.requestingUrl ?? ''))
  })
}

function registerIpc() {
  ipcMain.handle('phone:get', () => phoneState())
  ipcMain.handle('phone:set', (_event, enabled) => setPhoneAccess(enabled === true))
  ipcMain.handle('phone:copy', (_event, text) => {
    clipboard.writeText(String(text))
  })
}

// --- Card catalog -----------------------------------------------------------------

/** Loads or refreshes the card catalog (YGOPRODeck and the German card data) through the app's admin route. */
async function syncCatalog() {
  if (syncing || !mainWindow) {
    return
  }
  syncing = true
  mainWindow.setProgressBar(2)
  try {
    const response = await fetch(`${baseUrl}/api/admin/catalog/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.adminToken}` },
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`Der Server antwortete mit ${response.status}.`)
    }
    const result = await response.json()
    config.catalogSynced = true
    saveConfig(config)
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: APP_NAME,
      message: 'Der Kartenkatalog ist geladen.',
      detail: `${result.cardCount ?? 'Alle'} Karten. Lade die Seite neu (Strg+R), falls sie leer aussieht.`,
    })
    mainWindow.webContents.reload()
  }
  catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: APP_NAME,
      message: 'Der Kartenkatalog konnte nicht geladen werden.',
      detail: `${error.message}\nDazu ist eine Internetverbindung nötig. Du kannst es im Menü unter Datei erneut versuchen.`,
    })
  }
  finally {
    syncing = false
    mainWindow?.setProgressBar(-1)
  }
}

async function offerFirstCatalogSync() {
  if (config.catalogSynced || !mainWindow) {
    return
  }
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: APP_NAME,
    message: 'Kartenkatalog laden?',
    detail: 'Die App braucht die Kartendatenbank, um Karten zu finden (rund 14.000 Karten, ein bis zwei Minuten, Internet nötig). Du kannst es auch später im Menü unter Datei tun.',
    buttons: ['Jetzt laden', 'Später'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) {
    await syncCatalog()
  }
}

// --- Window and menu ------------------------------------------------------------

const SPLASH = `<!doctype html><meta charset="utf-8"><title>${APP_NAME}</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0a0a1a;color:#e5e7eb;font:16px system-ui,sans-serif">
<div style="text-align:center"><div style="font-size:28px;font-weight:600;letter-spacing:.04em">YGO Alpha</div>
<p style="color:#9ca3af">Startet …</p></div></body>`

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 480,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#0a0a1a',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })

  // Same-origin links (an opened PDF, say) get their own window; everything else opens in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (baseUrl !== '' && url.startsWith(baseUrl)) {
      return { action: 'allow' }
    }
    if (/^https?:/i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (baseUrl !== '' && !url.startsWith(baseUrl) && !url.startsWith('data:') && /^https?:/i.test(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH)}`)
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Datei',
      submenu: [
        { label: 'Mit Handy verbinden …', click: () => { showPhoneWindow() } },
        { label: 'Kartenkatalog laden / aktualisieren …', click: () => { syncCatalog() } },
        { label: 'Datenordner öffnen', click: () => { shell.openPath(userData) } },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'forceReload', label: 'Neu laden (ohne Cache)' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Originalgröße' },
        { role: 'zoomIn', label: 'Vergrößern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
      ],
    },
  ]))
}

// --- Start ----------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
}
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })

  app.on('before-quit', () => {
    quitting = true
    stopServer()
  })
  app.on('window-all-closed', () => app.quit())

  app.whenReady().then(async () => {
    buildMenu()
    registerIpc()
    restrictPermissions()
    createWindow()
    try {
      config = loadConfig()
      serverPort = await freePort(PREFERRED_PORT)
      baseUrl = `http://${HOST}:${serverPort}`
      startServer(serverPort)
      await waitForServer()
    }
    catch (error) {
      dialog.showErrorBox(APP_NAME, `${error.message}\nProtokoll: ${path.join(logDir, 'server.log')}`)
      quitting = true
      stopServer()
      app.quit()
      return
    }

    await mainWindow?.loadURL(baseUrl)
    await offerFirstCatalogSync()
  })
}
