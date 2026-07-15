/**
 * Keep Electron userData on a stable path so upgrades / productName renames
 * do not wipe cookies (signed-in session) or window state.
 *
 * MUST run before app.ready and before anything reads app.getPath('userData').
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const STABLE_DIR_NAME = 'Memories';

const LEGACY_DIR_NAMES = [
  'Memories Brozy',
  'memories-brozy',
  'memories',
];

/** Chromium / Electron profile bits that hold auth cookies & site storage. */
const PROFILE_ENTRIES = [
  'Cookies',
  'Cookies-journal',
  'Local Storage',
  'Session Storage',
  'Network',
  'IndexedDB',
  'WebStorage',
  'Preferences',
  'Code Cache',
  'Cache',
  'GPUCache',
  'Service Worker',
  'blob_storage',
];

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function hasSessionCookies(dir) {
  try {
    return fs.existsSync(path.join(dir, 'Cookies'));
  } catch {
    return false;
  }
}

function migrateFromLegacy(stableDir) {
  const appData = app.getPath('appData');
  const legacyDirs = LEGACY_DIR_NAMES.map((n) => path.join(appData, n)).filter(
    (p) => p !== stableDir && fs.existsSync(p),
  );

  if (!legacyDirs.length) return;

  // Prefer a legacy profile that still has cookies.
  const source =
    legacyDirs.find((d) => hasSessionCookies(d)) || legacyDirs[0];

  try {
    if (!fs.existsSync(stableDir)) {
      fs.renameSync(source, stableDir);
      console.log('[userdata] moved profile', source, '→', stableDir);
      return;
    }

    // Stable folder exists but looks empty of session — copy cookies/storage over.
    if (!hasSessionCookies(stableDir) && hasSessionCookies(source)) {
      for (const entry of PROFILE_ENTRIES) {
        const from = path.join(source, entry);
        const to = path.join(stableDir, entry);
        if (!fs.existsSync(from)) continue;
        try {
          if (fs.existsSync(to)) continue;
          copyRecursive(from, to);
        } catch (e) {
          console.warn('[userdata] copy failed', entry, e?.message || e);
        }
      }
      console.log('[userdata] restored session data from', source);
    }
  } catch (e) {
    console.warn('[userdata] migrate failed', e?.message || e);
  }
}

function lockUserDataPath() {
  const appData = app.getPath('appData');
  const stableDir = path.join(appData, STABLE_DIR_NAME);
  migrateFromLegacy(stableDir);
  app.setPath('userData', stableDir);
}

module.exports = { lockUserDataPath, STABLE_DIR_NAME };
