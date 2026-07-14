const { nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function loadIcon(name) {
  const file = path.join(__dirname, 'icons', 'thumbar', `${name}.png`);
  try {
    if (fs.existsSync(file)) return nativeImage.createFromPath(file);
  } catch {
    /* fall through */
  }
  return nativeImage.createEmpty();
}

/**
 * Windows taskbar thumbnail toolbar (prev / play-pause / next).
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 */
function setupThumbar(getMainWindow) {
  /** @type {{ playing: boolean, canNext: boolean, canPrevious: boolean }} */
  let state = { playing: false, canNext: false, canPrevious: false };

  const iconPrev = loadIcon('prev');
  const iconPlay = loadIcon('play');
  const iconPause = loadIcon('pause');
  const iconNext = loadIcon('next');

  function sendAction(action) {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('media:action', action);
  }

  function apply() {
    const win = getMainWindow();
    if (!win || win.isDestroyed() || process.platform !== 'win32') return;

    try {
      win.setThumbarButtons([
        {
          tooltip: 'Previous',
          icon: iconPrev,
          flags: state.canPrevious ? [] : ['disabled'],
          click: () => sendAction('previoustrack'),
        },
        {
          tooltip: state.playing ? 'Pause' : 'Play',
          icon: state.playing ? iconPause : iconPlay,
          click: () => sendAction(state.playing ? 'pause' : 'play'),
        },
        {
          tooltip: 'Next',
          icon: iconNext,
          flags: state.canNext ? [] : ['disabled'],
          click: () => sendAction('nexttrack'),
        },
      ]);
    } catch {
      /* unsupported */
    }
  }

  ipcMain.handle('media:setState', (_event, next) => {
    if (!next || typeof next !== 'object') return false;
    state = {
      playing: Boolean(next.playing),
      canNext: Boolean(next.canNext),
      canPrevious: Boolean(next.canPrevious),
    };
    apply();
    const win = getMainWindow();
    if (win && !win.isDestroyed() && typeof next.progress === 'number') {
      try {
        if (next.playing) {
          win.setProgressBar(Math.min(1, Math.max(0, next.progress)), { mode: 'normal' });
        } else {
          win.setProgressBar(-1);
        }
      } catch {
        /* noop */
      }
    }
    return true;
  });

  ipcMain.handle('media:clear', () => {
    state = { playing: false, canNext: false, canPrevious: false };
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      try {
        win.setThumbarButtons([]);
        win.setProgressBar(-1);
      } catch {
        /* noop */
      }
    }
    return true;
  });

  return { refresh: apply };
}

module.exports = { setupThumbar };
