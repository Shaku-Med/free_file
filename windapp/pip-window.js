const path = require('path');

const PIP_WIDTH = 390;
const PIP_HEIGHT = 700;
const PIP_MIN_WIDTH = 280;
const PIP_MIN_HEIGHT = 420;
/** Keep PiP phone-sized; not a second full app window. */
const PIP_MAX_WIDTH = 480;
const PIP_MAX_HEIGHT = 860;

/** @type {import('electron').BrowserWindow | null} */
let pipWindow = null;

function isPipUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname === '/pip' || u.pathname.startsWith('/pip/');
  } catch {
    return false;
  }
}

/**
 * BrowserWindow options for Memories custom PiP (our /pip UI, not OS video PiP).
 * @param {import('electron').BrowserWindow | null} [_mainWindow]
 */
function getPipWindowOptions(_mainWindow) {
  return {
    width: PIP_WIDTH,
    height: PIP_HEIGHT,
    minWidth: PIP_MIN_WIDTH,
    minHeight: PIP_MIN_HEIGHT,
    maxWidth: PIP_MAX_WIDTH,
    maxHeight: PIP_MAX_HEIGHT,
    maximizable: false,
    alwaysOnTop: true,
    // Frameless like the main app; site provides drag + close.
    frame: false,
    title: 'Memories',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    skipTaskbar: false,
    // No `parent` — stay visible when the main window is minimized (true PiP).
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  };
}

/**
 * @param {import('electron').BrowserWindow} child
 * @param {(win: import('electron').BrowserWindow) => void} injectWindapp
 */
function attachPipWindow(child, injectWindapp) {
  if (pipWindow && !pipWindow.isDestroyed() && pipWindow !== child) {
    try {
      pipWindow.close();
    } catch {
      /* ignore */
    }
  }
  pipWindow = child;

  try {
    child.setMinimumSize(PIP_MIN_WIDTH, PIP_MIN_HEIGHT);
    child.setMaximumSize(PIP_MAX_WIDTH, PIP_MAX_HEIGHT);
  } catch {
    /* ignore */
  }

  try {
    child.setAlwaysOnTop(true, 'floating');
  } catch {
    child.setAlwaysOnTop(true);
  }

  child.once('ready-to-show', () => {
    if (!child.isDestroyed()) {
      child.show();
      child.focus();
    }
  });

  child.webContents.on('did-finish-load', () => {
    injectWindapp(child);
  });

  child.on('closed', () => {
    if (pipWindow === child) pipWindow = null;
  });
}

function getPipWindow() {
  return pipWindow && !pipWindow.isDestroyed() ? pipWindow : null;
}

function closePipWindow() {
  const win = getPipWindow();
  if (win) win.close();
  pipWindow = null;
}

module.exports = {
  PIP_WIDTH,
  PIP_HEIGHT,
  PIP_MAX_WIDTH,
  PIP_MAX_HEIGHT,
  isPipUrl,
  getPipWindowOptions,
  attachPipWindow,
  getPipWindow,
  closePipWindow,
};
