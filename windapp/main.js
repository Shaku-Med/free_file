const { app, BrowserWindow, Menu, shell, ipcMain, nativeTheme, session } = require('electron');
const path = require('path');
const { lockUserDataPath } = require('./userdata');

// Before anything else reads userData (window-state, cookies, etc.).
lockUserDataPath();

const { getWindowOptions } = require('./window-state');
const { setupThumbar } = require('./thumbar');
const {
  isPipUrl,
  getPipWindowOptions,
  attachPipWindow,
  closePipWindow,
} = require('./pip-window');
const { setupDesktopUpdater, checkForDesktopUpdate } = require('./updater');

// Required on Windows so taskbar / SMTC media controls bind to this app.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.brozy.memories');
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let mainWindow;

/** CSS + flags injected into every Memories BrowserWindow (main + PiP). */
function injectWindappChrome(win) {
  if (!win || win.isDestroyed()) return;
  const platform = JSON.stringify(process.platform);
  win.webContents
    .executeJavaScript(
      `(function(){
        document.documentElement.classList.add('windapp');
        if(${platform}==='darwin') document.documentElement.classList.add('windapp-mac');
        window.__MEMORIES_WINDAPP__=true;
        window.__MEMORIES_WINDAPP_PLATFORM__=${platform};
        try{sessionStorage.setItem('memories_windapp','1')}catch(e){}
        try{sessionStorage.setItem('memories_windapp_platform',${platform})}catch(e){}
        if(!document.getElementById('windapp-drag-css')){
          var s=document.createElement('style');
          s.id='windapp-drag-css';
          s.textContent=[
            'html.windapp .windapp-drag{-webkit-app-region:drag;app-region:drag;}',
            'html.windapp .windapp-no-drag,',
            'html.windapp .windapp-drag a,',
            'html.windapp .windapp-drag button,',
            'html.windapp .windapp-drag input,',
            'html.windapp .windapp-drag textarea,',
            'html.windapp .windapp-drag select,',
            'html.windapp .windapp-drag [role="button"],',
            'html.windapp .windapp-drag [role="combobox"],',
            'html.windapp .windapp-drag [data-radix-collection-item],',
            'html.windapp .windapp-drag [data-sidebar="trigger"]',
            '{-webkit-app-region:no-drag;app-region:no-drag;}',
            'html.windapp a,html.windapp img,html.windapp picture,html.windapp [href]',
            '{-webkit-user-drag:none;user-drag:none;}'
          ].join('');
          document.head.appendChild(s);
        }
        if(!window.__MEMORIES_WINDAPP_NO_LINK_DRAG__){
          window.__MEMORIES_WINDAPP_NO_LINK_DRAG__=true;
          document.addEventListener('dragstart',function(e){
            var t=e.target;
            if(!t||!t.closest)return;
            if(t.closest('a,[href],img,picture')) e.preventDefault();
          },true);
        }
      })();`,
    )
    .catch(() => {});
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

/** Packaged → live site. Dev (`electron .`) → localhost. Override with WINDAPP_URL. */
const APP_URL =
  process.env.WINDAPP_URL ||
  (app.isPackaged
    ? 'https://memories.brozy.org/?windapp=1'
    : 'http://localhost:3000/?windapp=1');

function getThemeColors() {
  const isDark = nativeTheme.shouldUseDarkColors;
  return { background: isDark ? '#0f1419' : '#ffffff' };
}

function isAllowedUrl(url) {
  return (
    url.startsWith('https://memories.brozy.org') ||
    url.startsWith('http://localhost:') ||
    url.startsWith('http://127.0.0.1:')
  );
}

function createWindow() {
  const colors = getThemeColors();
  const windowOpts = getWindowOptions();
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: windowOpts.width,
    height: windowOpts.height,
    ...(typeof windowOpts.x === 'number' && typeof windowOpts.y === 'number'
      ? { x: windowOpts.x, y: windowOpts.y }
      : {}),
    minWidth: 800,
    minHeight: 600,
    title: 'Memories',
    icon: path.join(__dirname, 'icons/icons/win/icon.ico'),
    backgroundColor: colors.background,
    show: false,
    // Windows/Linux: fully frameless (site draws min/max/close).
    // Mac: hidden title bar with native traffic lights (close / minimize / zoom).
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 14, y: 16 },
        }
      : {
          frame: false,
        }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Direct page load (not nested <webview>) so -webkit-app-region: drag works.
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  });

  windowOpts.track(mainWindow);

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(APP_URL);

  mainWindow.once('ready-to-show', () => {
    if (windowOpts.isMaximized) mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    injectWindappChrome(mainWindow);
  });

  // Custom PiP: window.open(/pip/...) → always-on-top child with our /pip UI.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    if (isPipUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: getPipWindowOptions(mainWindow),
      };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('did-create-window', (childWindow, details) => {
    if (isPipUrl(details.url)) {
      attachPipWindow(childWindow, injectWindappChrome);
    }
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  nativeTheme.on('updated', () => {
    if (mainWindow) {
      mainWindow.setBackgroundColor(getThemeColors().background);
      mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors);
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      input.key === 'F12' ||
      (input.control && input.shift && (input.key === 'I' || input.key === 'i')) ||
      (input.control && input.shift && (input.key === 'J' || input.key === 'j')) ||
      (input.control && (input.key === 'U' || input.key === 'u'))
    ) {
      event.preventDefault();
    }

    // Alt+Left / Alt+Right — back / forward (also handled in-page as backup)
    if (input.type === 'keyDown' && input.alt && !input.control && !input.meta) {
      if (input.key === 'ArrowLeft') {
        event.preventDefault();
        if (mainWindow.webContents.canGoBack()) mainWindow.webContents.goBack();
      } else if (input.key === 'ArrowRight') {
        event.preventDefault();
        if (mainWindow.webContents.canGoForward()) mainWindow.webContents.goForward();
      }
    }
  });

  // Tell the page whenever the OS window enters/leaves fullscreen so the
  // player can drive its own chrome (the site uses native window fullscreen
  // in the desktop app instead of the HTML5 Fullscreen API).
  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen-changed', false);
  });

  mainWindow.on('closed', () => {
    closePipWindow();
    mainWindow = null;
  });
}

ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors);

ipcMain.handle('window:minimize', (event) => {
  windowFromEvent(event)?.minimize();
});

ipcMain.handle('window:maximize', (event) => {
  const win = windowFromEvent(event);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle('window:close', (event) => {
  windowFromEvent(event)?.close();
});

ipcMain.handle('window:isMaximized', (event) => windowFromEvent(event)?.isMaximized() ?? false);

ipcMain.handle('window:setFullScreen', (event, on) => {
  const win = windowFromEvent(event);
  if (!win) return false;
  win.setFullScreen(Boolean(on));
  return win.isFullScreen();
});

ipcMain.handle('window:isFullScreen', (event) => windowFromEvent(event)?.isFullScreen() ?? false);

ipcMain.handle('desktop:getVersion', () => app.getVersion());

ipcMain.handle('desktop:installUpdate', async () => {
  try {
    return await checkForDesktopUpdate({
      getMainWindow: () => mainWindow,
      appUrl: APP_URL,
      skipPrompt: true,
    });
  } catch (e) {
    console.warn('[updater] installUpdate', e?.message || e);
    return { updateAvailable: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('pip:close', () => {
  closePipWindow();
});

ipcMain.handle('nav:goBack', () => {
  if (mainWindow?.webContents.canGoBack()) {
    mainWindow.webContents.goBack();
    return true;
  }
  return false;
});

ipcMain.handle('nav:goForward', () => {
  if (mainWindow?.webContents.canGoForward()) {
    mainWindow.webContents.goForward();
    return true;
  }
  return false;
});

ipcMain.handle('nav:reload', () => {
  mainWindow?.webContents.reload();
});

ipcMain.handle('nav:canGoBack', () => mainWindow?.webContents.canGoBack() ?? false);
ipcMain.handle('nav:canGoForward', () => mainWindow?.webContents.canGoForward() ?? false);

app.whenReady().then(() => {
  // Allow in-app Notification API prompts; Web Push still isn't supported in Electron.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'notifications') callback(true);
    else callback(false);
  });
  setupThumbar(() => mainWindow);
  setupDesktopUpdater({ getMainWindow: () => mainWindow, appUrl: APP_URL });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
