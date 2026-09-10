const assert = require("node:assert/strict");
const approvedProducts = require("./data/glantier-approved-data.json");
const { classify, stagingRecord, activate, assertGlantier } = require("./glantier-catalog-core");
const { extractIngredients } = require("./glantier-ingredients");
const { inspectNote, sanitizeProductNotes } = require("./glantier-notes");
const official = { catalog_id: "parfum-999", brand: "Glantier", source: "official_glantier", reference_number: "999" };
assert.equal(classify({ official }), "new_glantier_product");
assert.equal(classify({ official: { ...official, brand: "Dior" } }), "rejected_brand");
assert.equal(classify({ official, local: { id: "999" } }), "existing_match");
assert.equal(classify({ official, discontinued: true }), "found_but_locally_discontinued");
const staged = stagingRecord(official);
assert.equal(staged.status, "needs_price");
assert.equal(staged.sale_enabled, false);
assert.equal(staged.merchant_enabled, false);
assert.throws(() => activate(staged, 0));
assert.throws(() => activate(staged, -1));
const active = activate(staged, 12.95);
assert.equal(active.status, "active");
assert.equal(active.sale_enabled, true);
assert.equal(active.merchant_enabled, true);
assert.throws(() => assertGlantier({ ...official, brand: "Gucci" }));
const inci = "Alcohol, Parfum, Aqua, Limonene, Linalool, Citral";
for (const html of [
  `<details><summary>Ingrediënten</summary><p>${inci}</p></details>`,
  `<button aria-controls="inci-panel">INCI</button><div id="inci-panel" hidden>${inci}</div>`,
  `<dl><dt>Samenstelling</dt><dd>${inci}</dd></dl>`,
  `<table><tr><th>Ingredients / INCI</th><td>${inci}</td></tr></table>`,
  `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", ingredients: inci })}</script>`,
  `<h3>Składniki</h3><div>${inci}</div>`
]) assert.equal(extractIngredients(html).ingredients_status, "approved_official");
assert.equal(extractIngredients("<h3>Ingrediënten</h3><p>Een heerlijke luxe geur voor iedere dag.</p>").ingredients_status, "parse_failed");
assert.equal(extractIngredients("<p>Geen productsamenstelling aanwezig.</p>").ingredients_status, "not_found");
assert.equal(extractIngredients(`<h3>Ingrediënten</h3><p>${inci} Referentie 999 Specifieke referenties ean13 123</p>`).ingredients_source_text, inci);
assert.equal(extractIngredients(`<section><h3>Ingrediënten</h3><p>Geproduceerd met parfumolie, alcohol en water. INCI: ${inci}</p></section>`).ingredients_source_text, inci);
assert.deepEqual(inspectNote("Amber, Tonkaboon, Vanille"), { value: "Amber, Tonkaboon, Vanille", status: "valid", suspicious: false });
assert.equal(inspectNote("Amber, Tonkaboon, Vanille Geurfamilie Glantier Parfum 402 behoort tot een geurfamilie.").value, "Amber, Tonkaboon, Vanille");
assert.equal(inspectNote("Deze parfum is ontwikkeld voor dagelijks gebruik en bijzondere gelegenheden.").status, "review_required");
assert.equal(sanitizeProductNotes({ top_notes: "Bergamot", heart_notes: "Jasmijn", base_notes: "Musk Voor wie? Voor iedereen." }).product.base_notes, "Musk");
const approvedProductList = Object.values(approvedProducts);
const product402 = approvedProducts["402"];
assert.ok(product402, "Glantier 402 ontbreekt in de goedgekeurde productdata");
assert.equal(product402.top_notes, "Zwarte bes, Sinaasappel, Mandarijn, Blad van zwarte bes, Grapefruit, Bergamot");
assert.equal(product402.heart_notes, "Abrikoos, Lelie, Jasmijn, Lelietje-van-dalen, Roos");
assert.equal(product402.base_notes, "Amber, Tonkaboon, Vanille, Virginia cederhout, Musk");
for (const product of approvedProductList) {
  assert.equal(sanitizeProductNotes(product).audit.length, 0, `Onveilige geurnoten bij ${product.reference_number || product.ref}`);
}
console.log("Glantier catalog import tests passed.");
