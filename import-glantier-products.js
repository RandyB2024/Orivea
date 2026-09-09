const fs = require("fs");
const path = require("path");
const vm = require("vm");
const cheerio = require("cheerio");
const { isAllowedBrand, classify } = require("./glantier-catalog-core");
const { extractIngredients } = require("./glantier-ingredients");

const ROOT = __dirname;
const sourceConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "sources", "glantier.json"), "utf8"));
const BASE_URL = sourceConfig.baseUrl;
const ALLOWED_PREFIX = new URL(sourceConfig.allowedPathPrefix, BASE_URL).href;
const CRAWLER_VERSION = sourceConfig.crawlerVersion;
const CATEGORY_MAPPING = sourceConfig.categoryMapping || {};
const CACHE_DIR = path.join(ROOT, "data", "crawler-cache");
const PREVIEW_PATH = path.join(ROOT, "data", "glantier-import-preview.json");
const NEW_PATH = path.join(ROOT, "data", "glantier-new-products.json");
const REPORT_PATH = path.join(ROOT, "data", "glantier-import-report.json");
const TTL_MS = Number(process.env.GLANTIER_CACHE_TTL_DAYS || 14) * 86400000;
const DELAY_MS = Math.max(900, Number(process.env.GLANTIER_REQUEST_DELAY_MS || 1200));
const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const fullCatalog = args.includes("--catalog");
const refsArg = args.find((arg) => arg.startsWith("--refs="));
const testReferences = refsArg ? refsArg.split("=")[1].split(",").map((item) => item.trim()).filter(Boolean) : ["401", "500", "548", "717", "724"];
const categorySources = sourceConfig.categoryPages.map((source) => ({ ...source, url: new URL(source.path, BASE_URL).href }));

fs.mkdirSync(CACHE_DIR, { recursive: true });
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "products.js"), "utf8"), context);
const localProducts = context.window.ORIVEA_PRODUCTS || [];
const discontinued = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "discontinued-products.json"), "utf8")));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;
let robotsRules;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

function absoluteUrl(value, base = BASE_URL) {
  try { return new URL(value, base).href; } catch { return null; }
}

function cachePath(url) {
  return path.join(CACHE_DIR, `${Buffer.from(url).toString("base64url")}.json`);
}

async function fetchOfficial(url) {
  if (!url.startsWith(ALLOWED_PREFIX)) throw new Error(`Niet-officiële bron geweigerd: ${url}`);
  if (!(await isAllowedByRobots(url))) throw new Error(`robots.txt staat crawlen niet toe: ${url}`);
  const file = cachePath(url);
  if (!refresh && fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - new Date(cached.retrieved_at).getTime() < TTL_MS) return { ...cached, cache_status: "hit" };
  }
  const wait = Math.max(0, DELAY_MS - (Date.now() - lastRequestAt));
  if (wait) await sleep(wait);
  let error;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      lastRequestAt = Date.now();
      const response = await fetch(url, { headers: { "user-agent": "ORIVEA-ProductImporter/1.0 (+https://orivea.nl; low-rate official product check)", accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = { url: response.url, retrieved_at: new Date().toISOString(), http_status: response.status, html: await response.text() };
      fs.writeFileSync(file, JSON.stringify(payload), "utf8");
      return { ...payload, cache_status: "miss" };
    } catch (caught) {
      error = caught;
      if (attempt < 2) await sleep(1000 * attempt);
    }
  }
  throw error;
}

async function isAllowedByRobots(url) {
  if (!robotsRules) {
    const response = await fetch(new URL("/robots.txt", BASE_URL), { headers: { "user-agent": "ORIVEA-ProductImporter/1.1" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`robots.txt kon niet worden gecontroleerd: HTTP ${response.status}`);
    const lines = (await response.text()).split(/\r?\n/).map((line) => line.replace(/#.*/, "").trim()).filter(Boolean);
    let applies = false;
    robotsRules = [];
    for (const line of lines) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (/^user-agent$/i.test(key)) applies = value === "*" || /ORIVEA-ProductImporter/i.test(value);
      if (applies && /^disallow$/i.test(key) && value) robotsRules.push(value);
    }
  }
  const pathname = new URL(url).pathname;
  return !robotsRules.some((rule) => pathname.startsWith(rule));
}

function referenceFromText(value) {
  const match = clean(value).match(/(?:Glantier|Premium|Referentie|Doucheolie|Baardolie|Handcrème|Handcreme)\s+(?:Parfum\s+)?(\d{3})\b/i);
  return match?.[1] || null;
}

function discoverLinks(html, source) {
  const $ = cheerio.load(html);
  const found = new Map();
  $(sourceConfig.productLinkSelector).each((_, element) => {
    const anchor = $(element);
    const text = clean(anchor.text() || anchor.attr("title"));
    const href = absoluteUrl(anchor.attr("href"), source.url);
    if (!href?.startsWith(`${BASE_URL}/nl/`) || !/\/\d+-[^/]+\.html(?:$|[?#])/i.test(href)) return;
    const reference = referenceFromText(text + " " + href.replace(/[-_/]/g, " "));
    const key = href.split(/[?#]/)[0];
    if (!found.has(key)) found.set(key, { reference_number: reference, official_product_name: text || null, category: CATEGORY_MAPPING[source.category] || source.category, source_category: source.category, premium: source.premium, official_product_url: href, source: "official_glantier" });
  });
  return [...found.values()];
}

function sectionText($, headingPattern) {
  const heading = $("h2,h3,h4,strong").filter((_, element) => headingPattern.test(clean($(element).text()))).first();
  if (!heading.length) return null;
  const parts = [];
  let current = heading.next();
  while (current.length && parts.join(" ").length < 2500 && !/H[234]/.test(current[0]?.tagName?.toUpperCase() || "")) {
    const value = clean(current.text());
    if (value) parts.push(value);
    current = current.next();
  }
  return clean(parts.join(" ")) || null;
}

function note(text, label) {
  const nextLabels = label === "Topnoten" ? "Hartnoten|Basisnoten|Ingrediënten" : label === "Hartnoten" ? "Basisnoten|Ingrediënten" : "Past deze parfum|Ingrediënten|Referentie";
  const match = text.match(new RegExp(`${label}\\s*:?\\s*(.*?)(?=${nextLabels}\\s*:|$)`, "i"));
  return match ? clean(match[1]) : null;
}

function parseProductPage(payload, hint) {
  const $ = cheerio.load(payload.html);
  const jsonLdProducts = $("script[type='application/ld+json']").map((_, element) => {
    try { return JSON.parse($(element).text()); } catch { return null; }
  }).get().flatMap((entry) => entry?.["@graph"] || entry || []).filter((entry) => entry?.["@type"] === "Product");
  const jsonLd = jsonLdProducts[0] || {};
  const jsonBrand = typeof jsonLd.brand === "string" ? jsonLd.brand : jsonLd.brand?.name;
  $("script,style,noscript,svg,form,nav,footer,header").remove();
  const title = clean($(sourceConfig.titleSelector).first().text() || jsonLd.name || $("title").text());
  const body = clean($("body").text());
  const officialBrandEvidence = clean(jsonBrand);
  const explicitGlantierBrand = /^glantier(?:\s+parfum\s+sp\.\s*z\s*o\.?o\.?)?$/i.test(officialBrandEvidence);
  const pageClearlyGlantier = /\bglantier\b/i.test(title + " " + body.slice(0, 1200));
  const officialHost = new URL(payload.url).hostname === new URL(BASE_URL).hostname;
  const brandVerified = officialHost && (explicitGlantierBrand || (!officialBrandEvidence && pageClearlyGlantier));
  const brand = brandVerified ? "Glantier" : officialBrandEvidence || null;
  const notesMarker = body.lastIndexOf("Geurnoten:");
  const notesBody = notesMarker >= 0 ? body.slice(notesMarker) : body;
  const reference = referenceFromText(`${title} ${body}`) || hint.reference_number;
  const concentrationMatch = body.match(/(\d{1,2})%\s*-?\s*(Eau de Parfum|Pure Parfum)/i);
  const familyFromTitle = title.match(/\s[-–]\s(.+?)$/)?.[1];
  const familyMatch = body.match(/Geurgroep\s*:\s*([^.!?€]{2,80})/i);
  const volumeMatch = body.match(/\b(\d+(?:[.,]\d+)?)\s*ml\b/i);
  const ingredientResult = extractIngredients(payload.html);
  const imageNode = $(sourceConfig.imageSelector).first();
  const image = jsonLd.image?.[0] || jsonLd.image || imageNode.attr("content") || imageNode.attr("src");
  const description = $(sourceConfig.descriptionSelector).attr("content") || jsonLd.description || sectionText($, /^Glantier Parfum \d+/i);
  const ingredientsSourceText = ingredientResult.ingredients_source_text;
  return {
    catalog_id: clean(hint.category).toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + (new URL(payload.url).pathname.match(/\/(\d+)-/)?.[1] || Buffer.from(payload.url).toString("base64url").slice(-12)),
    brand: brandVerified ? "Glantier" : brand || null,
    brand_normalized: brandVerified ? "glantier" : clean(brand).toLowerCase(),
    brand_evidence: jsonBrand ? "structured_data" : brandVerified ? "official_domain_and_page_content" : "unverified",
    reference_number: reference,
    product_name: title,
    category: hint.category,
    gender: /heren|voor hem/i.test(`${hint.category} ${title}`) ? "Heren" : /dames|voor haar/i.test(`${hint.category} ${title}`) ? "Dames" : null,
    product_type: /doucheolie/i.test(title) ? "Doucheolie" : /baardolie|beard oil/i.test(title) ? "Baardolie" : /gift box|cadeau/i.test(title) ? "Cadeauset" : concentrationMatch?.[2] || (/parfum/i.test(title) ? "Parfum" : null),
    volume: volumeMatch ? volumeMatch[1].replace(",", ".") + " ml" : null,
    volume_ml: volumeMatch ? Number(volumeMatch[1].replace(",", ".")) : null,
    concentration: concentrationMatch ? concentrationMatch[1] + "% " + concentrationMatch[2] : null,
    fragrance_concentration: concentrationMatch ? `${concentrationMatch[1]}%` : null,
    fragrance_family: clean(familyFromTitle || familyMatch?.[1]) || null,
    fragrance_notes: [note(notesBody, "Topnoten"), note(notesBody, "Hartnoten"), note(notesBody, "Basisnoten")].filter(Boolean),
    top_notes: note(notesBody, "Topnoten"),
    heart_notes: note(notesBody, "Hartnoten"),
    base_notes: note(notesBody, "Basisnoten"),
    short_description_source: description ? clean(description).slice(0, 1000) : null,
    description_source: description ? clean(description).slice(0, 1000) : null,
    ingredients_source_text: ingredientsSourceText,
    ingredients: ingredientResult.ingredients,
    ingredients_status: ingredientResult.ingredients_status,
    ingredients_extraction_source: ingredientResult.extraction_source,
    premium: hint.premium,
    image_url: absoluteUrl(image, payload.url),
    official_product_url: payload.url,
    source: "official_glantier",
    source_url: payload.url,
    source_retrieved_at: payload.retrieved_at,
    source_last_checked: payload.retrieved_at,
    source_status: brandVerified ? "verified_official" : "rejected_brand",
    image_status: image ? "official_source" : "not_found",
    cache_status: payload.cache_status,
    http_status: payload.http_status || 200,
    crawler_version: CRAWLER_VERSION
  };
}

function compare(local, official) {
  const differences = [];
  const additions = [];
  const checks = [
    ["category", local.categorie, official.gender],
    ["fragrance_family", clean(local.geurgroep).replace(/\s*-\s*/g, " en ").toLowerCase(), clean(official.fragrance_family).toLowerCase()],
    ["volume_ml", Number.parseFloat(local.inhoud), official.volume_ml]
  ];
  for (const [field, localValue, officialValue] of checks) {
    if (officialValue == null || officialValue === "") continue;
    if (localValue == null || localValue === "") additions.push({ field, official: officialValue });
    else if (String(localValue) !== String(officialValue)) differences.push({ field, orivea: localValue, official: officialValue });
  }
  for (const field of ["fragrance_concentration", "top_notes", "heart_notes", "base_notes", "ingredients_source_text", "official_product_url", "image_url"]) if (official[field]) additions.push({ field, official: official[field] });
  return { differences, additions, review_required: differences.length > 0, safe_update_available: additions.length > 0 };
}

(async () => {
  const categoryPayloads = [];
  const discovered = [];
  for (const source of categorySources) {
    const payload = await fetchOfficial(source.url);
    categoryPayloads.push({ source, payload });
    discovered.push(...discoverLinks(payload.html, source));
  }
  const unique = [...new Map(discovered.map((item) => [item.official_product_url, item])).values()];
  const selected = fullCatalog ? unique : unique.filter((item) => testReferences.includes(item.reference_number) && !item.premium);
  const preview = [];
  for (const hint of selected) {
    try {
      const official = parseProductPage(await fetchOfficial(hint.official_product_url), hint);
      const reference = official.reference_number;
      const fragranceSource = ["Dames", "Heren", "Premium", "Premium Heren"].includes(hint.source_category);
      const local = reference ? localProducts.find((product) => String(product.glantierNummer || product.id) === reference && (fragranceSource ? ["Dames", "Heren", "Unisex"].includes(product.categorie) : String(product.type || product.categorie).toLowerCase().includes(String(hint.category).toLowerCase()))) : null;
      if (!local && !fullCatalog) continue;
      const comparison = local ? compare(local, official) : null;
      official.conflict = Boolean(comparison?.review_required);
      const classification = classify({ official, local, discontinued: discontinued.has(reference) });
      preview.push({ reference_number: reference, classification, local_status: discontinued.has(reference) ? "discontinued" : local ? "active" : "not_in_orivea", orivea: local || null, official, comparison, publication_status: classification === "new_glantier_product" ? "needs_price" : classification });
    } catch (error) {
      preview.push({ reference_number: hint.reference_number, classification: "conflict", local_status: "unknown", official: { ...hint, source_status: "fetch_failed", error: error.message }, comparison: null, publication_status: "review_required" });
    }
  }
  const newProducts = preview.filter((item) => item.classification === "new_glantier_product").map((item) => ({ ...item.official, price: null, price_status: "missing", sale_enabled: false, add_to_cart_enabled: false, merchant_enabled: false, active: false, status: "needs_price", discovered_at: new Date().toISOString() }));
  fs.writeFileSync(PREVIEW_PATH, `${JSON.stringify(preview, null, 2)}\n`, "utf8");
  fs.writeFileSync(NEW_PATH, `${JSON.stringify(newProducts, null, 2)}\n`, "utf8");
  const report = {
    generated_at: new Date().toISOString(), source: ALLOWED_PREFIX, mode: fullCatalog ? "catalog" : "test", request_delay_ms: DELAY_MS, cache_ttl_days: TTL_MS / 86400000, crawler_version: CRAWLER_VERSION, robots_txt_respected: true,
    active_orivea_products: localProducts.length, official_products_discovered: unique.length, glantier_products: preview.filter((item) => isAllowedBrand(item.official.brand)).length,
    rejected_brand: preview.filter((item) => item.classification === "rejected_brand").length, existing_matches: preview.filter((item) => item.classification === "existing_match").length,
    checked: preview.length, matched: preview.filter((item) => item.official.source_status === "verified_official").length,
    ingredients_found: preview.filter((item) => item.official.ingredients_status === "approved_official").length, review_required: preview.filter((item) => ["conflict", "rejected_brand", "missing_reference"].includes(item.classification)).length,
    official_page_not_found: testReferences.filter((reference) => !preview.some((item) => item.reference_number === reference)), new_products_found: newProducts.length,
    locally_discontinued: preview.filter((item) => item.classification === "found_but_locally_discontinued").map((item) => item.reference_number),
    missing_reference: preview.filter((item) => item.classification === "missing_reference").length,
    conflicts_count: preview.filter((item) => item.classification === "conflict").length,
    price_needed: newProducts.length,
    discontinued_conflicts: preview.filter((item) => item.classification === "found_but_locally_discontinued").map((item) => item.reference_number), official_urls_used: preview.map((item) => item.official.official_product_url).filter(Boolean),
    fields_found: Object.fromEntries(["product_name", "image_url", "description_source", "fragrance_family", "ingredients_source_text"].map((field) => [field, preview.filter((item) => item.official?.[field]).length])),
    fields_missing: Object.fromEntries(["product_name", "image_url", "description_source", "fragrance_family", "ingredients_source_text"].map((field) => [field, preview.filter((item) => !item.official?.[field]).length])),
    conflicts: preview.flatMap((item) => (item.comparison?.differences || []).map((difference) => ({ reference_number: item.reference_number, ...difference }))),
    playwright_fallback_used: false,
    selectors_used: {
      product_link: sourceConfig.productLinkSelector,
      title: sourceConfig.titleSelector,
      reference: sourceConfig.referenceSelector,
      description: sourceConfig.descriptionSelector,
      image: sourceConfig.imageSelector,
      ingredients_labels: sourceConfig.ingredientsLabels
    },
    category_pages: categorySources.map((item) => item.url)
  };
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
