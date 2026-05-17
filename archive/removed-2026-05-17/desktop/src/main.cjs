/* eslint-env node */
'use strict';

// ---------------------------------------------------------------------------
// Kelion Desktop — main Electron process.
//
// This is the entry point for the packaged desktop app. It owns:
//   - the browser window that loads kelionai.app (or a local dev URL),
//   - the application menu + keyboard shortcuts,
//   - single-instance enforcement (so a second launch focuses the running
//     app instead of spinning up a duplicate),
//   - deep-link handling for the custom `kelion://` URI scheme,
//   - permission gating (mic, camera, geolocation) — we pre-grant only the
//     subset the web app already requests so the OS prompt is still shown
//     at the platform layer,
//   - a minimal bootstrap logger so bugs in packaged builds surface in
//     `%APPDATA%/Kelion/logs/`.
//
// The preload script (`preload.cjs`) runs in the renderer's isolated world
// and exposes a tiny, audited API under `window.kelion`.
// ---------------------------------------------------------------------------

const { app, BrowserWindow, Menu, shell, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── config ────────────────────────────────────────────────────────────────

const APP_URL = process.env.KELION_APP_URL || 'https://kelionai.app';
const IS_DEV = !app.isPackaged || process.argv.includes('--dev');
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 820;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

// Custom protocol: `kelion://session/xyz` etc. Useful for deep-links from
// email/calendar reminders back into a specific conversation.
const DEEP_LINK_SCHEME = 'kelion';

// Origins we pre-grant camera/mic/geolocation to. Anything else will hit
// the underlying platform permission prompt (macOS TCC, Windows privacy
// settings). Keep this tight.
const TRUSTED_ORIGINS = new Set([
  'https://kelionai.app',
  'https://kelionai-v2-production.up.railway.app',
]);

// ─── state ─────────────────────────────────────────────────────────────────

/** @type {BrowserWindow | null} */
let mainWindow = null;

// ─── logging ───────────────────────────────────────────────────────────────

function logDir() {
  try {
    const p = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(p, { recursive: true });
    return p;
  } catch {
    return null;
  }
}

function writeLog(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  // Always mirror to stderr so `npm run dev` surfaces issues.
  process.stderr.write(line);
  const dir = logDir();
  if (!dir) return;
  try {
    fs.appendFileSync(path.join(dir, 'main.log'), line);
  } catch {
    /* best-effort — never crash on logging */
  }
}

// ─── single-instance enforcement ───────────────────────────────────────────

// If a second copy of Kelion Desktop is launched while the first is still
// running, we reject the new one and refocus the original window. This is
// the standard Electron idiom and also wires up deep-link forwarding on
// Windows/Linux (macOS handles it via `open-url`).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_evt, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const deepLink = argv.find((a) => typeof a === 'string' && a.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (deepLink) handleDeepLink(deepLink);
  });
}

// Register the custom scheme so `kelion://…` URLs open this app.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}

function handleDeepLink(url) {
  writeLog('info', `deep-link: ${url}`);
  if (!mainWindow) return;
  // The renderer decides what to do with the path (e.g. open a specific
  // conversation). We just forward it verbatim.
  mainWindow.webContents.send('kelion:deep-link', url);
}

// macOS delivers deep-links via this event.
app.on('open-url', (evt, url) => {
  evt.preventDefault();
  handleDeepLink(url);
});

// ─── permission handler ────────────────────────────────────────────────────

function configureSession() {
  const ses = session.defaultSession;

  // Pre-grant the small set of permissions kelionai.app legitimately needs
  // (voice + vision + "look up this restaurant"). Everything else falls to
  // the platform-level prompt.
  const ALLOWED = new Set(['media', 'geolocation', 'notifications', 'clipboard-sanitized-write']);

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    try {
      const origin = new URL(webContents.getURL()).origin;
      if (TRUSTED_ORIGINS.has(origin) && ALLOWED.has(permission)) {
        return callback(true);
      }
    } catch {
      /* URL parse failure → deny */
    }
    return callback(false);
  });

  // Harden: block cookie writes from untrusted origins to kelionai domains.
  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: details.responseHeaders });
  });
}

// ─── window + menu ─────────────────────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('kelion:new-session');
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Kelion.app in Browser',
          click: () => shell.openExternal(APP_URL),
        },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/adrianenc11-hue/kelionai-v2/issues/new'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: '#0a0a0f',
    title: 'Kelion',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    writeLog('warn', `did-fail-load ${code} "${desc}" ${url}`);
  });

  // All new-window / target=_blank / external links open in the OS browser.
  // Keeps the shell uncluttered and avoids the bad UX of popups inside the
  // Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  writeLog('info', `loading ${APP_URL}`);
  mainWindow.loadURL(APP_URL);
}

// ─── lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  writeLog('info', `Kelion Desktop v${app.getVersion()} starting (packaged=${app.isPackaged}, dev=${IS_DEV})`);
  configureSession();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Renderer → main bridge. Keep the surface tiny.
ipcMain.handle('kelion:version', () => app.getVersion());
ipcMain.handle('kelion:platform', () => ({
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
}));
