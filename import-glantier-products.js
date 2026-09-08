const fs = require("fs");
const path = require("path");
const vm = require("vm");
const cheerio = require("cheerio");

const ROOT = __dirname;
const BASE_URL = "https://www.glantier.com";
const CACHE_DIR = path.join(ROOT, "data", "glantier-cache");
const PREVIEW_PATH = path.join(ROOT, "data", "glantier-import-preview.json");
const NEW_PATH = path.join(ROOT, "data", "glantier-new-products.json");
const REPORT_PATH = path.join(ROOT, "data", "glantier-import-report.json");
const TTL_MS = Number(process.env.GLANTIER_CACHE_TTL_DAYS || 14) * 86400000;
const DELAY_MS = Math.max(900, Number(process.env.GLANTIER_REQUEST_DELAY_MS || 1200));
const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const fullCatalog = args.includes("--catalog");
const refsArg = args.find((arg) => arg.startsWith("--refs="));
const testReferences = refsArg ? refsArg.split("=")[1].split(",").map((item) => item.trim()).filter(Boolean) : ["477", "500", "548", "553", "585", "717", "724", "759", "771"];
const categorySources = [
  { url: `${BASE_URL}/nl/91-standaard-collectie-dames`, category: "Dames", premium: false },
  { url: `${BASE_URL}/nl/92-standaard-collectie-heren`, category: "Heren", premium: false },
  { url: `${BASE_URL}/nl/30-premium-parfums`, category: "Premium", premium: true },
  { url: `${BASE_URL}/nl/170-premium-heren-parfums`, category: "Premium Heren", premium: true }
];

fs.mkdirSync(CACHE_DIR, { recursive: true });
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "products.js"), "utf8"), context);
const localProducts = context.window.ORIVEA_PRODUCTS || [];
const discontinued = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "discontinued-products.json"), "utf8")));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;

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
  if (!url.startsWith(`${BASE_URL}/nl/`)) throw new Error(`Niet-officiële bron geweigerd: ${url}`);
  const file = cachePath(url);
  if (!refresh && fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - new Date(cached.retrieved_at).getTime() < TTL_MS) return { ...cached, cache_status: "hit" };
  }
  const wait = Math.max(0, DELAY_MS - (Date.now() - lastRequestAt));
  if (wait) await sleep(wait);
  let error;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      lastRequestAt = Date.now();
      const response = await fetch(url, { headers: { "user-agent": "ORIVEA-ProductImporter/1.0 (+https://orivea.nl; low-rate official product check)", accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = { url: response.url, retrieved_at: new Date().toISOString(), html: await response.text() };
      fs.writeFileSync(file, JSON.stringify(payload), "utf8");
      return { ...payload, cache_status: "miss" };
    } catch (caught) {
      error = caught;
      if (attempt < 3) await sleep(1000 * attempt);
    }
  }
  throw error;
}

function referenceFromText(value) {
  const match = clean(value).match(/(?:Glantier|Premium|Referentie)\s+(?:Parfum\s+)?(\d{3})\b/i);
  return match?.[1] || null;
}

function discoverLinks(html, source) {
  const $ = cheerio.load(html);
  const found = new Map();
  $("a[href]").each((_, element) => {
    const anchor = $(element);
    const text = clean(anchor.text() || anchor.attr("title"));
    const href = absoluteUrl(anchor.attr("href"), source.url);
    if (!href?.startsWith(`${BASE_URL}/nl/`)) return;
    const reference = referenceFromText(text) || href.match(/glantier-(?:premium-)?(\d{3})(?:\D|$)/i)?.[1];
    if (!reference || !/glantier/i.test(`${text} ${href}`)) return;
    const key = `${reference}:${source.premium ? "premium" : "standard"}`;
    if (!found.has(key)) found.set(key, { reference_number: reference, official_product_name: text || `Glantier ${reference}`, category: source.category, premium: source.premium, official_product_url: href, source: "official_glantier" });
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
  $("script,style,noscript,svg,form,nav,footer,header").remove();
  const title = clean($("h1").first().text() || $("title").text());
  const body = clean($("body").text());
  const notesMarker = body.lastIndexOf("Geurnoten:");
  const notesBody = notesMarker >= 0 ? body.slice(notesMarker) : body;
  const reference = referenceFromText(`${title} ${body}`) || hint.reference_number;
  const concentrationMatch = body.match(/(\d{1,2})%\s*-?\s*(Eau de Parfum|Pure Parfum)/i);
  const familyFromTitle = title.match(/\s[-–]\s(.+?)$/)?.[1];
  const familyMatch = body.match(/Geurgroep\s*:\s*([^.!?€]{2,80})/i);
  const volumeMatch = body.match(/\b(\d+(?:[.,]\d+)?)\s*ml\b/i);
  const ingredientsMatch = body.match(/Ingrediënten\s*:\s*(.*?)(?=Referentie|ean13|Grade|Specifieke referenties|$)/i);
  const image = $("meta[property='og:image']").attr("content") || $("img[itemprop='image']").first().attr("src") || $(".product-cover img").first().attr("src");
  const description = $("meta[name='description']").attr("content") || sectionText($, /^Glantier Parfum \d+/i);
  return {
    reference_number: reference,
    product_name: title,
    category: hint.category,
    gender: /heren|voor hem/i.test(`${hint.category} ${title}`) ? "Heren" : /dames|voor haar/i.test(`${hint.category} ${title}`) ? "Dames" : null,
    product_type: concentrationMatch?.[2] || (/parfum/i.test(title) ? "Parfum" : null),
    volume_ml: volumeMatch ? Number(volumeMatch[1].replace(",", ".")) : null,
    fragrance_concentration: concentrationMatch ? `${concentrationMatch[1]}%` : null,
    fragrance_family: clean(familyFromTitle || familyMatch?.[1]) || null,
    fragrance_notes: [note(notesBody, "Topnoten"), note(notesBody, "Hartnoten"), note(notesBody, "Basisnoten")].filter(Boolean),
    top_notes: note(notesBody, "Topnoten"),
    heart_notes: note(notesBody, "Hartnoten"),
    base_notes: note(notesBody, "Basisnoten"),
    short_description_source: description ? clean(description).slice(0, 1000) : null,
    ingredients_source_text: ingredientsMatch ? clean(ingredientsMatch[1]).slice(0, 4000) : null,
    ingredients_status: ingredientsMatch ? "found" : "not_found",
    premium: hint.premium,
    image_url: absoluteUrl(image, payload.url),
    official_product_url: payload.url,
    source: "official_glantier",
    source_url: payload.url,
    source_retrieved_at: payload.retrieved_at,
    source_last_checked: payload.retrieved_at,
    source_status: "matched",
    cache_status: payload.cache_status
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
  const unique = [...new Map(discovered.map((item) => [`${item.reference_number}:${item.premium}`, item])).values()];
  const selected = fullCatalog ? unique : unique.filter((item) => testReferences.includes(item.reference_number) && !item.premium);
  const preview = [];
  for (const hint of selected) {
    const local = localProducts.find((product) => String(product.glantierNummer || product.id) === hint.reference_number);
    if (!local && !fullCatalog) continue;
    try {
      const official = parseProductPage(await fetchOfficial(hint.official_product_url), hint);
      preview.push({ reference_number: hint.reference_number, local_status: discontinued.has(hint.reference_number) ? "discontinued" : local ? "active" : "not_in_orivea", orivea: local || null, official, comparison: local ? compare(local, official) : null, publication_status: local ? "review_required" : "needs_price" });
    } catch (error) {
      preview.push({ reference_number: hint.reference_number, local_status: local ? "active" : "not_in_orivea", official: { ...hint, source_status: "fetch_failed", error: error.message }, comparison: null, publication_status: "review_required" });
    }
  }
  const existingRefs = new Set(localProducts.map((product) => String(product.glantierNummer || product.id)));
  const newProducts = unique.filter((item) => !existingRefs.has(item.reference_number)).map((item) => ({ ...item, price: null, price_status: "missing", sale_enabled: false, add_to_cart_enabled: false, merchant_feed_enabled: false, active: false, status: discontinued.has(item.reference_number) ? "discontinued" : "needs_price", discovered_at: new Date().toISOString() }));
  fs.writeFileSync(PREVIEW_PATH, `${JSON.stringify(preview, null, 2)}\n`, "utf8");
  fs.writeFileSync(NEW_PATH, `${JSON.stringify(newProducts, null, 2)}\n`, "utf8");
  const report = {
    generated_at: new Date().toISOString(), source: `${BASE_URL}/nl/`, mode: fullCatalog ? "catalog" : "test", request_delay_ms: DELAY_MS, cache_ttl_days: TTL_MS / 86400000,
    active_orivea_products: localProducts.length, official_products_discovered: unique.length, checked: preview.length, matched: preview.filter((item) => item.official.source_status === "matched").length,
    ingredients_found: preview.filter((item) => item.official.ingredients_status === "found").length, review_required: preview.filter((item) => item.comparison?.review_required || item.official.source_status !== "matched").length,
    official_page_not_found: testReferences.filter((reference) => !preview.some((item) => item.reference_number === reference)), new_products_found: newProducts.length,
    discontinued_conflicts: newProducts.filter((item) => item.status === "discontinued").map((item) => item.reference_number), official_urls_used: preview.map((item) => item.official.official_product_url).filter(Boolean)
  };
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
