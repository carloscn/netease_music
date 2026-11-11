const { app, BrowserWindow, shell, session, screen, Tray, Menu, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const HOME_URL = 'https://music.163.com/st/webplayer';
const APP_NAME = 'NetEase Music Player';
const WINDOW_TITLE = `${APP_NAME} v${app.getVersion()}`;
// Hosts the web player always talks to on startup; opening their TCP+TLS
// connections while the window is still being created saves ~0.8s each.
const PRECONNECT_ORIGINS = [
  'https://music.163.com',
  'https://interface.music.163.com',
  'https://st.music.163.com',
  'https://s5.music.126.net',
  'https://s6.music.126.net',
  'https://p1.music.126.net',
];
// The web player asks for Arial/Helvetica, which Ubuntu renders with
// Liberation Sans plus a mismatched CJK fallback. Use the desktop's own UI
// fonts instead: Ubuntu Sans for Latin text, Noto Sans CJK SC for Chinese.
// <i> and *icon* elements are left alone in case they use an icon font.
const UI_FONT_STACK = '"Ubuntu Sans", "Ubuntu", "Noto Sans CJK SC", "Noto Sans CJK", sans-serif';
const FONT_CSS = `
html, body, input, button, textarea, select,
body *:not(i):not([class*="icon"]):not([class*="Icon"]):not([class*="iconfont"]) {
  font-family: ${UI_FONT_STACK} !important;
}`;
// Third-party analytics beacons on the page; they only cost bandwidth.
const BLOCKED_HOSTS = ['sp0.baidu.com', 'hm.baidu.com', 's.360.cn', 's.union.360.cn'];

let mainWindow = null;
let tray = null;
let isQuitting = false;
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
    title: WINDOW_TITLE,
    // Window/alt-tab icon. GNOME's dock still prefers the icon of the
    // installed .desktop entry whose StartupWMClass matches this window.
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow = win;
  win.setMenuBarVisibility(false);
  if (state.isMaximized) win.maximize();
  win.on('close', (event) => {
    saveWindowState(win);
    // With a tray icon, closing only hides the window: the web player keeps
    // running (and playing), and reopening is instant instead of reloading it.
    if (!isQuitting && tray) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('show', refreshTrayMenu);
  win.on('hide', refreshTrayMenu);

  // Re-apply the font override on every document the window loads.
  win.webContents.on('dom-ready', () => {
    win.webContents.insertCSS(FONT_CSS).catch(() => {});
  });

  // Keep the installed version in the title bar, like the WhatsApp app. The
  // page's own title (usually the playing song) goes to the tray tooltip.
  win.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    win.setTitle(WINDOW_TITLE);
    if (tray) tray.setToolTip(title && title !== APP_NAME ? `${APP_NAME} · ${title}` : APP_NAME);
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt || !(input.control || input.meta)) return;
    const key = input.key.toLowerCase();
    if (key === 'q') {
      event.preventDefault();
      quitApp();
    } else if (key === 'w') {
      event.preventDefault();
      if (tray) win.hide();
      else win.close();
    } else if (key === '=' || key === '+' || key === '-' || key === '_' || key === '0') {
      // The default menu's zoom-in accelerator is Ctrl+Plus (needs Shift), so
      // plain Ctrl+= does nothing; handle all zoom keys ourselves.
      event.preventDefault();
      const wc = win.webContents;
      if (key === '0') wc.setZoomLevel(0);
      else wc.setZoomLevel(Math.max(-5, Math.min(5, wc.getZoomLevel() + (key === '-' || key === '_' ? -0.5 : 0.5))));
    }
  });

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
  win.on('closed', () => {
    clearTimeout(retryTimer);
    if (mainWindow === win) mainWindow = null;
    refreshTrayMenu();
  });

  win.loadURL(HOME_URL);
}

function showMainWindow() {
  // The window can still be destroyed (e.g. the page calls window.close()),
  // while the tray keeps the app alive; recreate it rather than doing nothing.
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) mainWindow.hide();
  else showMainWindow();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function buildTrayMenu() {
  const visible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  return Menu.buildFromTemplate([
    {
      label: visible ? '隐藏窗口' : '显示窗口',
      click: visible ? () => mainWindow.hide() : showMainWindow,
    },
    {
      label: '重新加载',
      click: () => mainWindow && !mainWindow.isDestroyed() && mainWindow.loadURL(HOME_URL),
    },
    { type: 'separator' },
    { label: '退出', click: quitApp },
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  try {
    // A small 8-bit icon: the 512px 16-bit app icon never registered with the
    // desktop's StatusNotifier tray.
    const iconPath = path.join(__dirname, 'build', 'tray.png');
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      console.error('tray unavailable: cannot load icon', iconPath);
      return;
    }
    tray = new Tray(image.resize({ width: 22, height: 22 }));
    tray.setToolTip('NetEase Music Player');
    refreshTrayMenu();
    tray.on('click', toggleWindow);
    tray.on('double-click', showMainWindow);
    console.log('tray created');
  } catch (error) {
    // No tray on this desktop: fall back to quitting when the window closes.
    console.error('tray unavailable:', error.message);
    tray = null;
  }
}

function prepareSession() {
  const ses = session.defaultSession;
  for (const url of PRECONNECT_ORIGINS) ses.preconnect({ url, numSockets: 2 });
  ses.webRequest.onBeforeRequest(
    { urls: BLOCKED_HOSTS.map((h) => `*://${h}/*`) },
    (_details, callback) => callback({ cancel: true })
  );
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Launching the app again (menu entry, terminal) just shows the running one.
  app.on('second-instance', showMainWindow);

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
      callback(ALLOWED_PERMISSIONS.has(permission) && isAllowedUrl(wc.getURL())));

    prepareSession();
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showMainWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    if (!tray && process.platform !== 'darwin') app.quit();
  });
}
