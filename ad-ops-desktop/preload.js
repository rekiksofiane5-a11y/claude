const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  get: (k) => ipcRenderer.invoke("store:get", k),
  set: (k, v) => ipcRenderer.invoke("store:set", k, v),
  paths: () => ipcRenderer.invoke("paths"),
  reveal: () => ipcRenderer.invoke("reveal"),
  chooseBackup: () => ipcRenderer.invoke("backup:choose"),
  writeBackup: (payload, force) => ipcRenderer.invoke("backup:write", payload, force),
  exportFile: (name, payload) => ipcRenderer.invoke("file:export", name, payload),
  importFile: () => ipcRenderer.invoke("file:import"),
});
