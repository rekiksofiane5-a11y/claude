/* Suivi ad ops — processus principal.
   Aucune connexion réseau. Les données vivent dans des fichiers JSON sur le poste. */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const DATA = () => path.join(app.getPath("userData"), "data");
const SETTINGS = () => path.join(app.getPath("userData"), "settings.json");
const file = (k) => path.join(DATA(), k.replace(/[^\w.-]/g, "_") + ".json");

async function ensure() { await fsp.mkdir(DATA(), { recursive: true }); }

/* écriture atomique : fichier temporaire puis renommage, plus une copie .bak du précédent.
   Une coupure en pleine écriture ne peut pas corrompre la donnée. */
async function writeAtomic(p, txt) {
  await ensure();
  const tmp = p + ".tmp";
  await fsp.writeFile(tmp, txt, "utf8");
  try { await fsp.copyFile(p, p + ".bak"); } catch (e) {}
  await fsp.rename(tmp, p);
}
async function readJSON(p, fallback) {
  try { return JSON.parse(await fsp.readFile(p, "utf8")); }
  catch (e) {
    try { return JSON.parse(await fsp.readFile(p + ".bak", "utf8")); } catch (e2) { return fallback; }
  }
}

let settings = { backupDir: null, lastBackupDay: null };

ipcMain.handle("store:get", async (_e, k) => readJSON(file(k), null));
ipcMain.handle("store:set", async (_e, k, v) => { await writeAtomic(file(k), JSON.stringify(v)); return true; });
ipcMain.handle("paths", () => ({ data: DATA(), backup: settings.backupDir }));
ipcMain.handle("reveal", () => shell.openPath(DATA()));

ipcMain.handle("backup:choose", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Dossier de sauvegarde automatique" });
  if (r.canceled || !r.filePaths[0]) return settings.backupDir;
  settings.backupDir = r.filePaths[0];
  await writeAtomic(SETTINGS(), JSON.stringify(settings));
  return settings.backupDir;
});
ipcMain.handle("backup:write", async (_e, payload, force) => {
  if (!settings.backupDir) return null;
  try {
    await fsp.writeFile(path.join(settings.backupDir, "adops-sauvegarde.json"), payload, "utf8");
    const d = new Date().toISOString().slice(0, 10);
    if (force || settings.lastBackupDay !== d) {
      await fsp.writeFile(path.join(settings.backupDir, "adops-sauvegarde-" + d + ".json"), payload, "utf8");
      settings.lastBackupDay = d;
      await writeAtomic(SETTINGS(), JSON.stringify(settings));
    }
    return settings.backupDir;
  } catch (e) { return "ERR:" + e.message; }
});
ipcMain.handle("file:export", async (_e, name, payload) => {
  const r = await dialog.showSaveDialog({ defaultPath: name });
  if (r.canceled || !r.filePath) return false;
  await fsp.writeFile(r.filePath, payload, "utf8");
  return true;
});
ipcMain.handle("file:import", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Sauvegarde", extensions: ["json"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return fsp.readFile(r.filePaths[0], "utf8");
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1320, height: 900, minWidth: 900, backgroundColor: "#F0F1F5",
    title: "Suivi ad ops",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Fichier", submenu: [{ role: "quit", label: "Quitter" }] },
    { label: "Édition", submenu: [{ role: "undo", label: "Annuler" }, { role: "redo", label: "Rétablir" }, { type: "separator" }, { role: "cut", label: "Couper" }, { role: "copy", label: "Copier" }, { role: "paste", label: "Coller" }, { role: "selectAll", label: "Tout sélectionner" }] },
    { label: "Affichage", submenu: [{ role: "reload", label: "Recharger" }, { role: "zoomIn", label: "Agrandir" }, { role: "zoomOut", label: "Réduire" }, { role: "resetZoom", label: "Taille normale" }, { type: "separator" }, { role: "toggleDevTools", label: "Outils de développement" }] },
  ]));
}

app.whenReady().then(async () => {
  settings = await readJSON(SETTINGS(), settings);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
