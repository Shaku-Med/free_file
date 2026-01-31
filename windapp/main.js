const { app, BrowserWindow, Menu, shell, ipcMain, nativeTheme } = require('electron');
const path = require('path');

// Single instance lock - prevents multiple windows
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

function getThemeColors() {
  const isDark = nativeTheme.shouldUseDarkColors;
  return {
    background: isDark ? '#0f1419' : '#ffffff',
    symbolColor: isDark ? '#22c55e' : '#16a34a',
  };
}

function createWindow() {
  const colors = getThemeColors();
  
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Memories Brozy',
    icon: path.join(__dirname, 'icons/icons/win/icon.ico'),
    backgroundColor: colors.background,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: colors.background,
      symbolColor: colors.symbolColor,
      height: 32
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    }
  });

  // Remove the menu completely
  Menu.setApplicationMenu(null);

  // Load our custom HTML with titlebar
  mainWindow.loadFile('index.html');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Update theme when system theme changes
  nativeTheme.on('updated', () => {
    const newColors = getThemeColors();
    if (mainWindow) {
      mainWindow.setTitleBarOverlay({
        color: newColors.background,
        symbolColor: newColors.symbolColor,
      });
      mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors);
    }
  });

  // Send initial theme
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors);
  });

  // Get webview contents when ready and handle external links
  mainWindow.webContents.on('did-attach-webview', (event, wc) => {
    // Disable dev tools in webview
    wc.on('devtools-opened', () => wc.closeDevTools());
    
    // Handle external links
    wc.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith('https://memories.brozy.org')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    // Block navigation to external sites
    wc.on('will-navigate', (event, url) => {
      if (!url.startsWith('https://memories.brozy.org')) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });
  });

  // Disable keyboard shortcuts for dev tools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      input.key === 'F12' ||
      (input.control && input.shift && (input.key === 'I' || input.key === 'i')) ||
      (input.control && input.shift && (input.key === 'J' || input.key === 'j')) ||
      (input.control && (input.key === 'U' || input.key === 'u'))
    ) {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handler to get initial theme
ipcMain.handle('get-theme', () => {
  return nativeTheme.shouldUseDarkColors;
});

// App ready
app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS: re-create window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
