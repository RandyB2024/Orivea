const fs = require("fs");
const path = require("path");
const { sanitizeProductNotes } = require("./glantier-notes");

const root = __dirname;
const dataPath = path.join(root, "data", "glantier-approved-data.json");
const reportPath = path.join(root, "data", "glantier-notes-audit.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const report = [];

for (const [reference, source] of Object.entries(data)) {
  const { product, audit, review_required } = sanitizeProductNotes(source);
  if (!audit.length) continue;
  data[reference] = product;
  report.push({ reference_number: reference, fields: audit, review_required });
}

fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
fs.writeFileSync(reportPath, `${JSON.stringify({
  generated_at: new Date().toISOString(),
  suspicious_products: report.length,
  suspicious_fields: report.reduce((sum, item) => sum + item.fields.length, 0),
  automatically_restored: report.filter((item) => !item.review_required).length,
  review_required: report.filter((item) => item.review_required).length,
  products: report
}, null, 2)}\n`, "utf8");

console.log(`Geurnotenaudit: ${report.length} producten, ${report.filter((item) => !item.review_required).length} hersteld, ${report.filter((item) => item.review_required).length} voor review.`);
