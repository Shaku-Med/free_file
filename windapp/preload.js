const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposed to the Memories page (loaded directly in the BrowserWindow).
 * Enables navbar window controls, drag region, in-app nav, and OS media controls.
 */
contextBridge.exposeInMainWorld('memoriesWindapp', {
  isDesktop: true,
  platform: process.platform,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  goBack: () => ipcRenderer.invoke('nav:goBack'),
  goForward: () => ipcRenderer.invoke('nav:goForward'),
  reload: () => ipcRenderer.invoke('nav:reload'),
  canGoBack: () => ipcRenderer.invoke('nav:canGoBack'),
  canGoForward: () => ipcRenderer.invoke('nav:canGoForward'),
  setMediaState: (state) => ipcRenderer.invoke('media:setState', state),
  clearMediaState: () => ipcRenderer.invoke('media:clear'),
  closePip: () => ipcRenderer.invoke('pip:close'),
  onMediaAction: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('media:action', handler);
    return () => ipcRenderer.removeListener('media:action', handler);
  },
});
