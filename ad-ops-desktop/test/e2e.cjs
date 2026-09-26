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
  await quit(app);

  fs.rmSync(cfg, { recursive: true, force: true });
  console.log("tous les tests passent");
})().catch((e) => { console.error(e); process.exit(1); });
