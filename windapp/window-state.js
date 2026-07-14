const fs = require('fs');
const path = require('path');
const { screen, app } = require('electron');

const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

const DEFAULTS = {
  width: 1280,
  height: 800,
  x: undefined,
  y: undefined,
  isMaximized: false,
};

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
    return {
      width: Number(parsed.width) || DEFAULTS.width,
      height: Number(parsed.height) || DEFAULTS.height,
      x: typeof parsed.x === 'number' ? parsed.x : undefined,
      y: typeof parsed.y === 'number' ? parsed.y : undefined,
      isMaximized: Boolean(parsed.isMaximized),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify(state), 'utf8');
  } catch {
    /* ignore disk errors */
  }
}

/** Keep window fully visible if the saved display went away / resolution changed. */
function ensureOnScreen(bounds) {
  const width = Math.max(800, bounds.width || DEFAULTS.width);
  const height = Math.max(600, bounds.height || DEFAULTS.height);

  if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') {
    return { width, height };
  }

  const area = screen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width,
    height,
  }).workArea;

  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - 100);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - 100);

  return {
    x,
    y,
    width: Math.min(width, area.width),
    height: Math.min(height, area.height),
  };
}

/**
 * Restore size/position on create; persist on move/resize/close.
 * @param {import('electron').BrowserWindow} win
 * @param {ReturnType<typeof loadState>} state
 */
function trackWindowState(win, state) {
  let saveTimer = null;
  let current = { ...state };

  const persist = () => {
    if (!win || win.isDestroyed()) return;
    // Don't overwrite size while maximized/minimized/fullscreen — keep last normal bounds.
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
      const b = win.getBounds();
      current = {
        ...current,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      };
    }
    current.isMaximized = win.isMaximized();
    saveState(current);
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 300);
  };

  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', persist);
  win.on('unmaximize', persist);
  win.on('close', persist);
}

function getWindowOptions() {
  const saved = loadState();
  const bounds = ensureOnScreen(saved);
  return {
    ...bounds,
    isMaximized: saved.isMaximized,
    track: (win) => trackWindowState(win, { ...saved, ...bounds }),
  };
}

module.exports = { getWindowOptions, loadState };
