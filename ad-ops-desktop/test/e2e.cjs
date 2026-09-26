/* Test de bout en bout : lance la vraie application Electron et vérifie que tout est enregistré
   sur disque, même quand on ferme une fiche ou l'application sans cliquer « Enregistrer ».
   Usage : xvfb-run -a node test/e2e.cjs (Linux) ou node test/e2e.cjs */
const { _electron: electron } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");

const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "adops-"));
const env = Object.assign({}, process.env, { XDG_CONFIG_HOME: cfg, APPDATA: cfg });
const dataDir = path.join(cfg, "Suivi ad ops", "data");
const read = (k) => JSON.parse(fs.readFileSync(path.join(dataDir, k + ".json"), "utf8"));
const launch = () => electron.launch({ args: [path.join(__dirname, ".."), "--no-sandbox"], env });

async function openNew(page, name) {
  await page.click('[data-act="newc"]');
  await page.fill('[data-c="c"]', name);
}
async function quit(app) {
  const done = new Promise((r) => app.process().once("exit", r));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await done;
}

(async () => {
  let app = await launch(), page = await app.firstWindow();
  await page.waitForSelector('[data-act="newc"]');

  // 1. « Fermer » sans « Enregistrer » : la fiche est enregistrée
  await openNew(page, "Client Fermer");
  await page.click('.dh [data-close="1"]');
  await page.waitForFunction(() => !document.querySelector("#drawer aside"));
  await page.waitForTimeout(300);
  assert.deepStrictEqual(read("campaigns").map((c) => c.c), ["Client Fermer"]);
  console.log("ok  fermer une fiche l'enregistre");

  // 2. « Annuler » abandonne vraiment
  page.once("dialog", (d) => d.accept());
  await openNew(page, "Client Annulé");
  await page.click('[data-close="cancel"]');
  await page.waitForTimeout(300);
  assert.deepStrictEqual(read("campaigns").map((c) => c.c), ["Client Fermer"]);
  console.log("ok  annuler abandonne la fiche");

  // 3. fermer l'application en pleine saisie : la fiche est enregistrée avant la sortie
  await openNew(page, "Client Quitter");
  await quit(app);
  assert.deepStrictEqual(read("campaigns").map((c) => c.c).sort(), ["Client Fermer", "Client Quitter"]);
  console.log("ok  quitter en pleine saisie enregistre la fiche");

  // 4. plantage en pleine saisie : le brouillon est rouvert au lancement suivant
  app = await launch(); page = await app.firstWindow();
  await page.waitForSelector('[data-act="newc"]');
  await openNew(page, "Client Plantage");
  await page.waitForTimeout(800); // laisse passer l'enregistrement différé du brouillon
  app.process().kill("SIGKILL");
  app = await launch(); page = await app.firstWindow();
  await page.waitForSelector('#drawer aside');
  assert.strictEqual(await page.inputValue('[data-c="c"]'), "Client Plantage");
  console.log("ok  brouillon récupéré après plantage");

  // 5. code d'accès : les fichiers sont chiffrés et l'application se verrouille au relancement
  await page.click('.dh [data-close="1"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="secpanel"]');
  await page.click('[data-act="setpass"]');
  await page.fill("#pass1", "secret1234");
  await page.fill("#pass2", "secret1234");
  page.once("dialog", (d) => d.accept());
  await page.click('[data-act="dopass"]');
  await page.waitForTimeout(500);
  assert.ok(read("campaigns").e, "campaigns.json doit être chiffré");
  assert.ok(read("meta").enc, "meta.json doit indiquer le chiffrement");
  await quit(app);
  app = await launch(); page = await app.firstWindow();
  await page.waitForSelector("#passIn");
  await page.fill("#passIn", "secret1234");
  await page.click('[data-act="unlock"]');
  await page.waitForSelector("#main");
  const names = await page.textContent("#main");
  for (const n of ["Client Fermer", "Client Quitter", "Client Plantage"]) assert.ok(names.includes(n), n + " absent : " + names);
  console.log("ok  code d'accès : chiffré sur disque, déverrouillage au relancement");

  // 6. aucune requête réseau ne sort de la session, même hors du contrôle de la page (CSP)
  const net = await app.evaluate(({ session }) => session.defaultSession.fetch("https://example.com/").then(() => "sortie", (e) => "bloquée : " + e.message));
  assert.ok(net.includes("ERR_BLOCKED_BY_CLIENT"), "doit être bloquée par l'application : " + net);
  console.log("ok  requête réseau bloquée");
  await quit(app);

  fs.rmSync(cfg, { recursive: true, force: true });
  await viewsAndExport();
  console.log("tous les tests passent");
})().catch((e) => { console.error(e); process.exit(1); });

/* Vues, couleurs, menu d'actions et export Excel, sur un jeu de campagnes préparé à l'avance */
async function viewsAndExport() {
  const cfg2 = fs.mkdtempSync(path.join(os.tmpdir(), "adops-"));
  const env2 = Object.assign({}, process.env, { XDG_CONFIG_HOME: cfg2, APPDATA: cfg2 });
  const dir = path.join(cfg2, "Suivi ad ops", "data");
  const ok = (keys) => Object.fromEntries(keys.map((k) => [k, { ok: true, at: "2026-09-01", note: k === "pm" ? "PM validé par Julie" : "" }]));
  const base = { a: "", id: "", d1: "2026-09-01", d2: "2026-12-31", t: "", tagOn: false, lps: [], utmOn: false, n: "", rg: "", p: "" };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "campaigns.json"), JSON.stringify([
    Object.assign({}, base, { uid: "live", c: "Client Live", t: "FR-T1", p: "Attention au capping", tasks: ok(["pm", "frais", "specs", "creas", "regie", "mel"]) }),
    Object.assign({}, base, { uid: "done", c: "Client Fini", tasks: ok(["pm", "frais", "specs", "creas", "regie", "mel", "pause", "bdd", "reco", "fi"]) }),
    Object.assign({}, base, { uid: "wip", c: "Client Encours", tasks: ok(["pm"]) }),
    Object.assign({}, base, { uid: "old", c: "Client Archive", arch: true, tasks: {} }),
  ]));
  const readC = () => JSON.parse(fs.readFileSync(path.join(dir, "campaigns.json"), "utf8"));
  const app = await electron.launch({ args: [path.join(__dirname, ".."), "--no-sandbox"], env: env2 });
  const page = await app.firstWindow();
  await page.waitForSelector(".row");
  const bg = (sel) => page.$eval(sel, (e) => getComputedStyle(e).backgroundColor);
  const fg = (sel) => page.$eval(sel, (e) => getComputedStyle(e).color);

  // Ticket par défaut, archivées masquées, couleurs des lignes
  assert.strictEqual((await page.textContent('.seg button.on')).trim(), "Ticket");
  assert.strictEqual(await page.$('[data-open="old"]'), null, "une campagne archivée ne doit pas apparaître dans Ticket");
  await page.mouse.move(2, 300); await page.waitForTimeout(400); // pas de survol pendant la mesure des couleurs
  assert.strictEqual(await bg('.row[data-open="live"]'), "rgb(227, 244, 234)");
  assert.strictEqual(await bg('.row[data-open="done"]'), "rgb(59, 65, 80)");
  assert.strictEqual(await fg('.row[data-open="done"] .ttl'), "rgb(255, 255, 255)");
  assert.ok((await page.textContent('.row[data-open="live"]')).includes("Attention au capping"), "la vue Ticket montre la particularité");
  console.log("ok  vue Ticket : toutes les infos, vert si en ligne, gris sombre si terminée");

  // recherche de la barre de titre : filtre la vue sans perdre le focus
  await page.click("#gsearch");
  await page.keyboard.type("encours");
  await page.waitForTimeout(200);
  assert.deepStrictEqual(await page.$$eval(".row[data-open]", (r) => r.map((e) => e.dataset.open)), ["wip"]);
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), "gsearch", "le curseur reste dans la recherche");
  await page.fill("#gsearch", "");
  await page.waitForTimeout(200);
  console.log("ok  recherche dans la barre de titre");

  // bouton sélectionné lisible, au repos comme au survol
  for (const v of ["pipeline", "liste", "ticket"]) {
    await page.click(`[data-view="${v}"]`);
    const sel = `[data-view="${v}"]`;
    assert.strictEqual(await fg(sel), "rgb(255, 255, 255)");
    assert.notStrictEqual(await bg(sel), "rgba(0, 0, 0, 0)", v + " : fond transparent");
    await page.hover(sel);
    assert.strictEqual(await fg(sel), "rgb(255, 255, 255)", v + " : texte illisible au survol");
    assert.notStrictEqual(await bg(sel), "rgb(255, 255, 255)");
  }
  console.log("ok  bouton sélectionné lisible (plus de blanc sur blanc)");

  // menu ⋯ : dupliquer, archiver, supprimer
  await page.click('.row[data-open="wip"] [data-menu]');
  await page.click('[data-cact="dup"]');
  await page.waitForSelector("#drawer aside");
  await page.click('.dh [data-close="1"]');
  await page.waitForTimeout(400);
  let cs = readC();
  const copy = cs.find((c) => c.n === "(copie)");
  assert.ok(copy && copy.c === "Client Encours" && Object.keys(copy.tasks).length === 0, "copie avec encours remis à zéro");
  await page.click('.row[data-open="wip"] [data-menu]');
  await page.click('[data-cact="archive"]');
  await page.waitForTimeout(400);
  assert.ok(readC().find((c) => c.uid === "wip").arch, "campagne archivée");
  await page.click('[data-view="archives"]');
  assert.ok((await page.textContent("#main")).includes("Client Encours"));
  page.once("dialog", (d) => d.accept());
  await page.click(`tr[data-open="${copy.uid}"] [data-menu]`).catch(() => {}); // la copie n'est pas archivée : absente ici
  await page.click('[data-view="ticket"]');
  await page.click(`.row[data-open="${copy.uid}"] [data-menu]`);
  await page.click('[data-cact="del"]');
  await page.waitForTimeout(400);
  assert.ok(!readC().some((c) => c.uid === copy.uid), "copie supprimée");
  console.log("ok  menu ⋯ : dupliquer, archiver, supprimer ; vue Archivées");

  // onglet Backup : export Excel des campagnes en cours seulement
  await page.click('[data-tab="backup"]');
  const bk = await page.textContent("table.bk");
  assert.ok(bk.includes("Client Live") && !bk.includes("Client Fini") && !bk.includes("Client Archive") && !bk.includes("Client Encours"), "seules les campagnes en cours non archivées");
  const xlsx = path.join(cfg2, "export.xlsx");
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, xlsx);
  await page.click('[data-act="xlsx"]');
  await page.waitForTimeout(500);
  const buf = fs.readFileSync(xlsx);
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, "le fichier doit être un classeur (zip)");
  const txt = buf.toString("utf8");
  for (const s of ["xl/worksheets/sheet1.xml", "Déjà effectué", "Reste à effectuer", "Client Live", "PM validé par Julie", "Attention au capping"]) assert.ok(txt.includes(s), s + " absent du classeur");
  assert.ok(!txt.includes("Client Fini") && !txt.includes("Client Archive"), "terminées et archivées exclues");
  console.log("ok  onglet Backup : export Excel des campagnes en cours");
  if (process.env.KEEP_XLSX) fs.copyFileSync(xlsx, process.env.KEEP_XLSX);

  await quit(app);
  fs.rmSync(cfg2, { recursive: true, force: true });
}
