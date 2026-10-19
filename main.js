const { app, BrowserWindow, shell, session, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const HOME_URL = 'https://music.163.com/st/webplayer';
// NetEase account login (reg.163.com, etc.) lives on sibling 163.com hosts.
const ALLOWED_DOMAIN = '163.com';
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);
const RETRY_DELAY_MS = 5000;

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function isAllowedUrl(urlString) {
  try {
    const { hostname, protocol } = new URL(urlString);
    return protocol === 'https:' && (hostname === ALLOWED_DOMAIN || hostname.endsWith('.' + ALLOWED_DOMAIN));
  } catch {
    return false;
  }
}

function openExternal(urlString) {
  try {
    if (EXTERNAL_PROTOCOLS.has(new URL(urlString).protocol)) shell.openExternal(urlString);
  } catch {
    // ignore malformed URLs
  }
}

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const { x, y, width, height } = state;
    if (![x, y, width, height].every(Number.isFinite)) return {};
    // Drop the saved position if it is no longer on any connected display.
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y);
    return visible ? state : { width, height, isMaximized: state.isMaximized };
  } catch {
    return {};
  }
}

function saveWindowState(win) {
  try {
    const state = { ...win.getNormalBounds(), isMaximized: win.isMaximized() };
    fs.writeFileSync(stateFile(), JSON.stringify(state));
  } catch {
    // best effort
  }
}

function offlinePage(description) {
  const html = `<!doctype html><meta charset="utf-8"><title>NetEase Music Player</title>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
background:#1e1e1e;color:#ccc;font:15px system-ui,sans-serif;text-align:center">
<div><p>无法连接网易云音乐 / Cannot reach music.163.com</p>
<p style="color:#888;font-size:13px">${description.replace(/[<>&]/g, '')}</p>
<p style="color:#888;font-size:13px">${RETRY_DELAY_MS / 1000} 秒后重试… / Retrying…</p></div>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width || 1280,
    height: state.height || 800,
    minWidth: 960,
    minHeight: 600,
    title: 'NetEase Music Player',
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.setMenuBarVisibility(false);
  if (state.isMaximized) win.maximize();
  win.on('close', () => saveWindowState(win));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) return { action: 'allow' };
    openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  let retryTimer;
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    // -3 is ERR_ABORTED: a navigation superseded by another one, not a real failure.
    if (!isMainFrame || errorCode === -3) return;
    win.loadURL(offlinePage(errorDescription));
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => !win.isDestroyed() && win.loadURL(HOME_URL), RETRY_DELAY_MS);
  });
  win.on('closed', () => clearTimeout(retryTimer));

  win.loadURL(HOME_URL);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
      callback(ALLOWED_PERMISSIONS.has(permission) && isAllowedUrl(wc.getURL())));

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
