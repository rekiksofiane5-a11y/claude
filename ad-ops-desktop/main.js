/* Suivi ad ops — processus principal.
   Aucune connexion réseau. Les données vivent dans des fichiers JSON sur le poste. */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const DATA = () => path.join(app.getPath("userData"), "data");
const SETTINGS = () => path.join(app.getPath("userData"), "settings.json");
const file = (k) => path.join(DATA(), k.replace(/[^\w.-]/g, "_") + ".json");

async function ensure(dir) { await fsp.mkdir(dir, { recursive: true }); }

/* Windows peut refuser un renommage quelques millisecondes (antivirus, indexation) : on réessaie. */
async function renameRetry(a, b) {
  for (let i = 0; ; i++) {
    try { return await fsp.rename(a, b); }
    catch (e) { if (i >= 8 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e; await new Promise((r) => setTimeout(r, 50 * (i + 1))); }
  }
}

/* écriture atomique : fichier temporaire puis renommage, plus une copie .bak du précédent.
   Une coupure en pleine écriture ne peut pas corrompre la donnée. */
async function writeAtomicNow(p, txt) {
  await ensure(path.dirname(p));
  const tmp = p + ".tmp";
  const fh = await fsp.open(tmp, "w");
  try { await fh.writeFile(txt, "utf8"); await fh.sync(); } finally { await fh.close(); }
  try { await fsp.copyFile(p, p + ".bak"); } catch (e) {}
  await renameRetry(tmp, p);
}

/* Les écritures d'un même fichier passent en file d'attente : deux enregistrements rapprochés
   ne se marchent jamais dessus, et la fermeture attend que tout soit sur le disque. */
const queues = new Map();
function writeAtomic(p, txt) {
  const prev = queues.get(p) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => writeAtomicNow(p, txt));
  queues.set(p, next);
  next.finally(() => { if (queues.get(p) === next) queues.delete(p); }).catch(() => {});
  return next;
}
const drainWrites = () => Promise.allSettled(Array.from(queues.values()));

async function readJSON(p, fallback) {
  try { return JSON.parse(await fsp.readFile(p, "utf8")); }
  catch (e) {
    try { return JSON.parse(await fsp.readFile(p + ".bak", "utf8")); } catch (e2) { return fallback; }
  }
}

let settings = { backupDir: null, lastBackupDay: null, bounds: null, maximized: false };
const saveSettings = () => writeAtomic(SETTINGS(), JSON.stringify(settings));

ipcMain.handle("store:get", async (_e, k) => readJSON(file(k), null));
ipcMain.handle("store:set", async (_e, k, v) => { await writeAtomic(file(k), JSON.stringify(v)); return true; });
ipcMain.handle("paths", () => ({ data: DATA(), backup: settings.backupDir }));
ipcMain.handle("reveal", async () => { await ensure(DATA()); return shell.openPath(DATA()); });

ipcMain.handle("backup:choose", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], title: "Dossier de sauvegarde automatique" });
  if (r.canceled || !r.filePaths[0]) return settings.backupDir;
  settings.backupDir = r.filePaths[0];
  await saveSettings();
  return settings.backupDir;
});
ipcMain.handle("backup:write", async (_e, payload, force) => {
  if (!settings.backupDir) return null;
  try {
    await writeAtomic(path.join(settings.backupDir, "adops-sauvegarde.json"), payload);
    const d = new Date().toISOString().slice(0, 10);
    if (force || settings.lastBackupDay !== d) {
      await writeAtomic(path.join(settings.backupDir, "adops-sauvegarde-" + d + ".json"), payload);
      settings.lastBackupDay = d;
      await saveSettings();
    }
    return settings.backupDir;
  } catch (e) { return "ERR:" + e.message; }
});
ipcMain.handle("file:export", async (_e, name, payload) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name });
  if (r.canceled || !r.filePath) return false;
  await fsp.writeFile(r.filePath, payload, "utf8");
  return true;
});
ipcMain.handle("file:import", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Sauvegarde", extensions: ["json"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return fsp.readFile(r.filePaths[0], "utf8");
});

/* ---------- fenêtre ---------- */
let win = null;
let closing = false;

function rememberBounds() {
  if (!win || win.isMinimized()) return;
  settings.maximized = win.isMaximized();
  if (!settings.maximized) settings.bounds = win.getBounds();
}

function buildMenu() {
  const canAutostart = process.platform === "win32" || process.platform === "darwin";
  const autostart = canAutostart && app.getLoginItemSettings().openAtLogin;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Fichier", submenu: [
      { label: "Ouvrir le dossier des données", click: () => ensure(DATA()).then(() => shell.openPath(DATA())) },
      ...(canAutostart ? [{ label: "Lancer au démarrage de Windows", type: "checkbox", checked: autostart, click: (it) => app.setLoginItemSettings({ openAtLogin: it.checked }) }] : []),
      { type: "separator" },
      { role: "quit", label: "Quitter" },
    ] },
    { label: "Édition", submenu: [{ role: "undo", label: "Annuler" }, { role: "redo", label: "Rétablir" }, { type: "separator" }, { role: "cut", label: "Couper" }, { role: "copy", label: "Copier" }, { role: "paste", label: "Coller" }, { role: "selectAll", label: "Tout sélectionner" }] },
    { label: "Affichage", submenu: [{ role: "reload", label: "Recharger" }, { role: "zoomIn", label: "Agrandir" }, { role: "zoomOut", label: "Réduire" }, { role: "resetZoom", label: "Taille normale" }, { type: "separator" }, { role: "togglefullscreen", label: "Plein écran" }, { role: "toggleDevTools", label: "Outils de développement" }] },
  ]));
}

function createWindow() {
  const b = settings.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1320, height: b.height || 900, x: b.x, y: b.y, minWidth: 900, minHeight: 600,
    backgroundColor: "#F0F1F5", title: "Suivi ad ops", show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (settings.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  ["resize", "move"].forEach((ev) => win.on(ev, rememberBounds));

  /* Fermeture : le rendu enregistre la fiche ouverte, puis on attend que chaque fichier soit écrit. */
  win.on("close", (e) => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    rememberBounds();
    const w = win;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      drainWrites().then(saveSettings).then(drainWrites).finally(() => { if (!w.isDestroyed()) w.destroy(); });
    };
    const timer = setTimeout(done, 5000);
    ipcMain.once("app:flushed", () => { clearTimeout(timer); done(); });
    win.webContents.send("app:flush");
  });
  win.on("closed", () => { win = null; });
}

/* Une seule instance, comme Teams : relancer l'application ramène la fenêtre existante. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  });
  app.setAppUserModelId("fr.adops.suivi");
  app.whenReady().then(async () => {
    settings = Object.assign(settings, await readJSON(SETTINGS(), {}));
    buildMenu();
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) { closing = false; createWindow(); } });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
