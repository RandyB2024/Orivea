const fs = require("fs");
const path = require("path");
const { activate, assertGlantier, stagingRecord } = require("./glantier-catalog-core");

const root = __dirname;
const previewFile = path.join(root, "data", "glantier-import-preview.json");
const stagingFile = path.join(root, "data", "glantier-catalog-staging.json");
const staging = fs.existsSync(stagingFile) ? JSON.parse(fs.readFileSync(stagingFile, "utf8")) : [];
const byId = new Map(staging.map((item) => [item.catalog_id, item]));

if (process.argv.includes("--import-all")) {
  const preview = JSON.parse(fs.readFileSync(previewFile, "utf8"));
  let imported = 0;
  for (const item of preview.filter((entry) => entry.classification === "new_glantier_product")) {
    assertGlantier(item.official);
    if (byId.has(item.official.catalog_id)) continue;
    byId.set(item.official.catalog_id, stagingRecord(item.official));
    imported += 1;
  }
  fs.writeFileSync(stagingFile, JSON.stringify([...byId.values()], null, 2) + "\n");
  console.log("Nieuwe geldige Glantier-producten in staging:", imported);
} else {
  const pricesArg = process.argv.find((arg) => arg.startsWith("--prices="));
  if (!pricesArg) throw new Error("Gebruik --import-all of --prices=pad/naar/prijzen.json");
  const prices = JSON.parse(fs.readFileSync(path.resolve(root, pricesArg.slice(9)), "utf8"));
  let activated = 0;
  for (const [catalogId, price] of Object.entries(prices)) {
    const record = byId.get(catalogId);
    if (!record) throw new Error("Onbekend staging-product: " + catalogId);
    byId.set(catalogId, activate(record, price));
    activated += 1;
  }
  fs.writeFileSync(stagingFile, JSON.stringify([...byId.values()], null, 2) + "\n");
  console.log("Glantier-producten geprijsd en geactiveerd:", activated);
}
