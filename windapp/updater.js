const { app, dialog } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { URL } = require('url');

/**
 * Check /api/desktop/version on startup; if remote version is greater,
 * download /api/desktop/win/download (cached on server) and run the installer.
 */

function originFromAppUrl(appUrl) {
  try {
    return new URL(appUrl).origin;
  } catch {
    return 'https://memories.brozy.org';
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Memories-Desktop',
          'X-Memories-Desktop': '1',
        },
      },
      (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode || 0, json: JSON.parse(text) });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('version check timeout'));
    });
  });
}

function downloadToFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = lib.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        downloadToFile(res.headers.location, dest, onProgress).then(resolve, reject);
        return;
      }
      if (!res.statusCode || res.statusCode >= 400) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`download failed (${res.statusCode})`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress && total > 0) onProgress(received / total);
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(dest));
      });
    });
    req.on('error', (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function runInstaller(installerPath) {
  if (process.platform === 'win32') {
    // Launch NSIS / Setup EXE then quit so the installer can replace files.
    spawn(installerPath, [], {
      detached: true,
      stdio: 'ignore',
      shell: true,
    }).unref();
    return;
  }
  spawn('open', [installerPath], { detached: true, stdio: 'ignore' }).unref();
}

/**
 * @param {{ getMainWindow: () => import('electron').BrowserWindow | null, appUrl: string }} opts
 */
function setupDesktopUpdater({ getMainWindow, appUrl }) {
  app.whenReady().then(() => {
    // Delay so the window can show first.
    setTimeout(() => {
      void checkForDesktopUpdate({ getMainWindow, appUrl }).catch((e) => {
        console.warn('[updater]', e?.message || e);
      });
    }, 4000);
  });
}

async function checkForDesktopUpdate({ getMainWindow, appUrl }) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;

  const origin = originFromAppUrl(appUrl);
  const current = app.getVersion();
  const platform = process.platform; // win32 | darwin
  const checkUrl = `${origin}/api/desktop/version?platform=${encodeURIComponent(platform)}&current=${encodeURIComponent(current)}`;

  const { status, json } = await fetchJson(checkUrl);
  if (status !== 200 || !json?.success || !json.updateAvailable || !json.latest) {
    return;
  }

  const latest = json.latest.version;
  const downloadPath = json.latest.downloadPath || '/api/desktop/win/download';
  const win = getMainWindow();

  const result = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: 'info',
    buttons: ['Update now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update available',
    message: `Memories ${latest} is ready`,
    detail: `You are on ${current}. Download and install the update?`,
  });

  if (result.response !== 0) return;

  const dir = path.join(app.getPath('temp'), 'memories-desktop-update');
  await fsp.mkdir(dir, { recursive: true });
  const filename = json.latest.filename || `Memories-Setup-${latest}.exe`;
  const dest = path.join(dir, filename);
  const downloadUrl = `${origin}${downloadPath}`;

  // Optional progress via BrowserWindow title while downloading.
  const target = getMainWindow();
  const setProgress = (ratio) => {
    if (target && !target.isDestroyed()) {
      try {
        target.setProgressBar(ratio);
        target.setTitle(`Downloading update… ${Math.round(ratio * 100)}%`);
      } catch {
        /* ignore */
      }
    }
  };

  await downloadToFile(downloadUrl, dest, setProgress);
  if (target && !target.isDestroyed()) {
    try {
      target.setProgressBar(-1);
      target.setTitle('Memories');
    } catch {
      /* ignore */
    }
  }

  const confirm = await dialog.showMessageBox(target && !target.isDestroyed() ? target : undefined, {
    type: 'question',
    buttons: ['Install and restart', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Install update',
    message: 'Installer downloaded',
    detail: 'Memories will quit so the installer can finish.',
  });

  if (confirm.response !== 0) return;

  runInstaller(dest);
  app.quit();
}

module.exports = { setupDesktopUpdater, checkForDesktopUpdate };
