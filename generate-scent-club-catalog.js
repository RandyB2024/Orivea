const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("products.js", "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);

const sql = [
  "-- Generated from products.js. Do not edit manually.",
  "BEGIN TRANSACTION;",
  "DELETE FROM scent_club_products;"
];

const quote = (value) => "'" + String(value ?? "").replaceAll("'", "''") + "'";
const products = (context.window.ORIVEA_PRODUCTS || [])
  .filter((product) => product.glantierNummer && ["Dames", "Heren", "Unisex"].includes(product.categorie))
  .filter((product) => product.availableForSale !== false)
  .sort((a, b) => String(a.glantierNummer).localeCompare(String(b.glantierNummer), "nl", { numeric: true }));

for (const product of products) {
  sql.push("INSERT INTO scent_club_products(reference,gender,image,profile,description,active,discontinued) VALUES(" +
    [product.glantierNummer, product.categorie, product.premiumImage || product.image || "", product.geurgroep || "Geurprofiel", product.korteOmschrijving || "", 1, 0].map(quote).join(",") +
    ");");
}
sql.push("COMMIT;", "");
fs.writeFileSync("data/scent-club-products.sql", sql.join("\n"));
console.log("Scent Club catalog generated:", products.length, "active fragrances");
