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
  /* à la fermeture de la fenêtre : le rendu enregistre ce qui est ouvert, puis confirme */
  onFlush: (fn) => ipcRenderer.on("app:flush", async () => { try { await fn(); } finally { ipcRenderer.send("app:flushed"); } }),
});
