const fs = require("fs");
const path = require("path");

const root = __dirname;
const preview = JSON.parse(fs.readFileSync(path.join(root, "data", "glantier-import-preview.json"), "utf8"));
const outputPath = path.join(root, "data", "glantier-approved-data.json");
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const applyAllSafe = process.argv.includes("--all-safe");
if (!applyAllSafe && !requested.length) throw new Error("Gebruik --all-safe of geef referentienummers op.");

const existing = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, "utf8")) : {};
const allowedFields = ["reference_number", "product_name", "gender", "product_type", "volume_ml", "fragrance_concentration", "fragrance_family", "fragrance_notes", "top_notes", "heart_notes", "base_notes", "description_source", "ingredients_source_text", "ingredients", "ingredients_status", "official_product_url", "source", "source_url", "source_retrieved_at", "source_last_checked", "source_status", "http_status", "crawler_version"];
let applied = 0;
const selectedByReference = new Map();

for (const item of preview) {
  const current = selectedByReference.get(item.reference_number);
  if (!current || (current.official?.premium && !item.official?.premium)) selectedByReference.set(item.reference_number, item);
}

for (const item of selectedByReference.values()) {
  const approved = item.official?.source_status === "matched" && item.local_status === "active" && !item.comparison?.review_required;
  if (!approved || (!applyAllSafe && !requested.includes(item.reference_number))) continue;
  existing[item.reference_number] = Object.fromEntries(allowedFields.map((field) => [field, item.official[field]]).filter(([, value]) => value != null));
  existing[item.reference_number].quality_status = "approved";
  existing[item.reference_number].approved_at = new Date().toISOString();
  applied += 1;
}

fs.writeFileSync(outputPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
console.log(`Applied ${applied} safe official record(s). Prices, activation and ORIVÉA images were not changed.`);
