const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposed to the Memories page (loaded directly in the BrowserWindow).
 * Enables navbar window controls, drag region, in-app nav, and OS media controls.
 */
contextBridge.exposeInMainWorld('memoriesWindapp', {
  isDesktop: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('desktop:getVersion'),
  installUpdate: () => ipcRenderer.invoke('desktop:installUpdate'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  setFullScreen: (on) => ipcRenderer.invoke('window:setFullScreen', on),
  isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
  onFullscreenChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, on) => callback(Boolean(on));
    ipcRenderer.on('window:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler);
  },
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
