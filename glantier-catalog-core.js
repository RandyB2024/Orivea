const fs = require("fs");
const path = require("path");

const ALLOWED_BRANDS = Object.freeze(["Glantier"]);
const normalizeBrand = (value) => String(value || "").trim().toLowerCase();
const isAllowedBrand = (value) => ALLOWED_BRANDS.some((brand) => normalizeBrand(brand) === normalizeBrand(value));

function assertGlantier(record) {
  if (!isAllowedBrand(record?.brand) || record?.source !== "official_glantier") {
    throw new Error("Import geweigerd: alleen geverifieerde officiële Glantier-producten zijn toegestaan.");
  }
  return record;
}

function classify({ official, local, discontinued }) {
  if (!official?.brand || !isAllowedBrand(official.brand)) return "rejected_brand";
  if (!official.reference_number) return "missing_reference";
  if (discontinued) return "found_but_locally_discontinued";
  if (local && official.conflict) return "conflict";
  if (local) return "existing_match";
  return "new_glantier_product";
}

function stagingRecord(official) {
  assertGlantier(official);
  return {
    ...official,
    brand: "Glantier",
    brand_normalized: "glantier",
    source: "official_glantier",
    price: null,
    price_status: "missing",
    sale_enabled: false,
    merchant_enabled: false,
    status: "needs_price",
    imported_at: new Date().toISOString()
  };
}

function activate(record, price) {
  assertGlantier(record);
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) throw new Error("Een geldige ORIVÈA-prijs hoger dan nul is verplicht.");
  return { ...record, price: numericPrice, price_status: "set", sale_enabled: true, merchant_enabled: true, status: "active", activated_at: new Date().toISOString() };
}

function readStaging(root) {
  const file = path.join(root, "data", "glantier-catalog-staging.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

function activeProducts(root) {
  return readStaging(root).filter((item) => item.status === "active" && item.sale_enabled && item.merchant_enabled && Number(item.price) > 0).map((item) => {
    assertGlantier(item);
    return {
      id: item.catalog_id,
      naam: "Glantier " + item.reference_number + " – " + (item.product_type || item.category),
      cardTitle: "Glantier " + item.reference_number,
      merk: "Glantier",
      glantierNummer: item.reference_number,
      categorie: item.gender || item.category,
      doelgroep: item.gender || item.category,
      type: item.product_type,
      inhoud: item.volume ? String(item.volume) : "",
      geurgroep: item.fragrance_family || "Geurprofiel",
      prijs: Number(item.price),
      image: item.image_url,
      availableForSale: true,
      pricePending: false,
      importedFromOfficialCatalog: true
    };
  });
}

module.exports = { ALLOWED_BRANDS, normalizeBrand, isAllowedBrand, assertGlantier, classify, stagingRecord, activate, readStaging, activeProducts };
