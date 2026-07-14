import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("memoriesDesktop", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized") as Promise<boolean>,
});
