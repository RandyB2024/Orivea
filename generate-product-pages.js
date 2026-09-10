const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { activeProducts, assertGlantier } = require("./glantier-catalog-core");
const { sanitizeProductNotes } = require("./glantier-notes");

const root = __dirname;
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "products.js"), "utf8"), context);
const products = [...(context.window.ORIVEA_PRODUCTS || []), ...activeProducts(root)];
for (const product of products) assertGlantier({ brand: product.merk || "Glantier", source: product.importedFromOfficialCatalog ? "official_glantier" : "official_glantier" });
const config = context.window.ORIVEA_CONFIG || {};
const outputDir = path.join(root, "product");
const domain = String(config.domain || "https://orivea.nl").replace(/\/$/, "");
const generatedOn = new Date().toISOString().slice(0, 10);
const approvedDataPath = path.join(root, "data", "glantier-approved-data.json");
const approvedData = fs.existsSync(approvedDataPath) ? JSON.parse(fs.readFileSync(approvedDataPath, "utf8")) : {};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function money(value) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number(value));
}

function slug(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function productSlug(product) {
  return product.glantierNummer ? `glantier-${slug(product.glantierNummer)}` : `glantier-${slug(product.id)}`;
}

function productUrl(product) {
  return product.detailUrl || `product/${productSlug(product)}.html`;
}

function absoluteAsset(value) {
  return /^https?:\/\//i.test(String(value || "")) ? String(value) : `${domain}/${String(value || "").replace(/^\/+/, "")}`;
}

function pageAsset(value) {
  return /^https?:\/\//i.test(String(value || "")) ? String(value) : `../${String(value || "").replace(/^\/+/, "")}`;
}

function displayProductType(value) {
  return String(value || "").replace(/\bsignature\s+edp\b/gi, "Eau de Parfum").replace(/\bedp\b/gi, "Eau de Parfum");
}

function readApprovedIngredients() {
  const source = fs.readFileSync(path.join(root, "glantier-top-10-samples.html"), "utf8");
  const ingredients = {};
  for (const match of source.matchAll(/<article><h3>(\d+)<\/h3><p>(Alcohol,[\s\S]*?)<\/p><\/article>/g)) ingredients[match[1]] = match[2];
  return ingredients;
}

const approvedIngredients = readApprovedIngredients();

function variants(product) {
  const fragrance = ["Dames", "Heren", "Unisex"].includes(product.categorie) && product.glantierNummer;
  if (!fragrance) return [{ code: "signature", label: product.inhoud || product.type, price: Number(product.prijs) }];
  const result = [
    { code: "discovery", label: "15 ml", price: Number(config.pricing?.discovery15 || 5.95) },
    { code: "signature", label: "50 ml", price: Number(product.prijs) }
  ];
  if (product.premiumBeschikbaar) result.push({ code: "premium", label: "Premium 50 ml", price: Number(product.premiumPrijs || config.pricing?.premium50 || 16.95) });
  return result;
}

function facts(product) {
  const reference = product.glantierNummer ? `Glantier ${product.glantierNummer}` : product.naam;
  const audience = product.doelgroep ? `voor ${String(product.doelgroep).toLowerCase()}` : "";
  const profile = product.geurgroep ? ` met het geurprofiel ${String(product.geurgroep).replace(/\s*-\s*/g, ", ").toLowerCase()}` : "";
  return {
    intro: `${reference} is een ${displayProductType(product.type || product.categorie).toLowerCase()} ${audience}${profile}.`,
    description: `Bekijk de beschikbare uitvoering${variants(product).length > 1 ? "en" : ""} van ${reference}. Kies op basis van het vermelde geurprofiel, formaat en draagmoment.`,
    profile: product.geurgroep || displayProductType(product.type) || product.categorie,
    moment: product.moment || "Kies op basis van jouw persoonlijke voorkeur en draagmoment."
  };
}

function relatedProducts(product) {
  const tokens = String(product.geurgroep || "").toLowerCase().split(/\s*-\s*/).filter(Boolean);
  return products.filter((item) => item.id !== product.id && !item.pricePending && item.availableForSale !== false)
    .map((item) => ({ item, score: (item.categorie === product.categorie ? 3 : 0) + tokens.filter((token) => String(item.geurgroep || "").toLowerCase().includes(token)).length }))
    .sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id))).slice(0, 4).map(({ item }) => item);
}

function offerSchema(product) {
  return variants(product).map((variant) => ({ "@type": "Offer", priceCurrency: "EUR", price: variant.price.toFixed(2), availability: "https://schema.org/InStock", url: `${domain}/${productUrl(product)}?variant=${variant.code}` }));
}

function page(product) {
  const info = facts(product);
  const number = product.glantierNummer || product.cardTitle || product.naam;
  const title = product.glantierNummer ? `Glantier ${product.glantierNummer} ${String(product.doelgroep || product.categorie).toLowerCase()} parfum | ORIVÈA` : `${product.naam} | ORIVÈA`;
  const meta = `${info.intro} Bekijk formaten en prijzen bij ORIVÈA.`.slice(0, 158);
  const approved = approvedData[String(product.glantierNummer || "")] || null;
  const official = approved ? sanitizeProductNotes(approved).product : null;
  const ingredientText = official?.ingredients_source_text || approvedIngredients[String(product.glantierNummer || "")];
  const related = relatedProducts(product);
  const schema = { "@context": "https://schema.org", "@type": "Product", name: product.naam, image: absoluteAsset(product.image), brand: { "@type": "Brand", name: "Glantier" }, sku: String(product.glantierNummer || product.id), description: info.intro, offers: offerSchema(product) };
  const variantHtml = variants(product).map((variant, index) => `<button class="detail-variant${index === 1 || variants(product).length === 1 ? " selected" : ""}" type="button" data-detail-variant="${variant.code}" data-detail-price="${variant.price}"><span>${escapeHtml(variant.label)}</span><strong>${money(variant.price)}</strong></button>`).join("");
  const notesHtml = official?.top_notes || official?.heart_notes || official?.base_notes ? `<section class="generated-product-section"><p class="eyebrow">Officiële geurdata</p><h2>Geurnoten</h2><div class="product-information-grid">${official.top_notes ? `<article><h3>Topnoten</h3><p>${escapeHtml(official.top_notes)}</p></article>` : ""}${official.heart_notes ? `<article><h3>Hartnoten</h3><p>${escapeHtml(official.heart_notes)}</p></article>` : ""}${official.base_notes ? `<article><h3>Basisnoten</h3><p>${escapeHtml(official.base_notes)}</p></article>` : ""}</div></section>` : "";
  const relatedHtml = related.map((item) => `<a class="related-product" href="../${productUrl(item)}"><img src="../${escapeHtml(item.image)}" alt="${escapeHtml(item.naam)}" loading="lazy"><span>${escapeHtml(item.glantierNummer ? `Glantier ${item.glantierNummer}` : item.cardTitle || item.naam)}</span><small>${escapeHtml(item.geurgroep || displayProductType(item.type))}</small></a>`).join("");
  return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(meta)}"><meta name="robots" content="index, follow"><link rel="canonical" href="${domain}/${productUrl(product)}"><link rel="icon" href="../favicon.svg" type="image/svg+xml"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(meta)}"><meta property="og:type" content="product"><meta property="og:url" content="${domain}/${productUrl(product)}"><meta property="og:image" content="${domain}/${product.image}"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script><link rel="stylesheet" href="../style.css"><link rel="stylesheet" href="../lightroom.css"></head>
<body data-page="product-detail" data-product-id="${escapeHtml(product.id)}"><header class="site-header"><a class="brand" href="../index.html"><span>ORIVÈA</span><small>Glantier webshop</small></a><button class="menu-toggle" type="button" aria-label="Menu openen">Menu</button><nav class="main-nav"><a href="../index.html">Home</a><a href="../index.html#geurwijzer">Geurwijzer</a><a href="../catalogus.html">Collectie</a><a href="../glantier-dames-parfum.html">Dames</a><a href="../glantier-heren-parfum.html">Heren</a><a href="../glantier-premium-parfum.html">Premium</a><a href="../contact.html">Contact</a></nav><button class="cart-button" type="button" data-cart-open>Winkelwagen <span data-cart-count>0</span></button></header>
<main class="page-main generated-product-page"><section class="generated-product-hero"><div class="generated-product-media"><img src="../${escapeHtml(product.premiumImage || product.image)}" alt="${escapeHtml(product.naam)}"><button class="product-image-info" type="button" data-product-info-open aria-label="Ingrediënten en productinformatie">i</button></div><div class="generated-product-copy"><p class="eyebrow">${escapeHtml(product.categorie)}</p><h1>${escapeHtml(product.glantierNummer ? `Glantier ${number}` : product.cardTitle || product.naam)}</h1><p class="generated-lead">${escapeHtml(info.intro)}</p><div class="detail-facts"><span>${escapeHtml(product.geurgroep || displayProductType(product.type))}</span><span>${escapeHtml(product.doelgroep || product.categorie)}</span>${official?.fragrance_concentration ? `<span>${escapeHtml(official.fragrance_concentration)} ${escapeHtml(official.product_type || "")}</span>` : ""}<span>${escapeHtml(product.moment || "Persoonlijke keuze")}</span></div><div class="detail-variants" data-detail-variants>${variantHtml}</div><button class="button primary detail-add" type="button" data-add-to-cart="${escapeHtml(product.id)}" data-variant="${variants(product)[1]?.code || variants(product)[0].code}">Toevoegen aan winkelwagen</button><button class="ingredients-link" type="button" data-product-info-open><span aria-hidden="true">i</span> Ingrediënten</button></div></section>
<section class="generated-product-section"><p class="eyebrow">Geurprofiel</p><h2>${escapeHtml(info.profile)}</h2><p>${escapeHtml(info.description)}</p><div class="product-information-grid"><article><h3>Over dit product</h3><p>${escapeHtml(info.intro)}</p></article><article><h3>Draagmoment</h3><p>${escapeHtml(info.moment)}</p></article><article><h3>Beschikbare formaten</h3><p>${variants(product).map((item) => `${escapeHtml(item.label)} voor ${money(item.price)}`).join(" · ")}</p></article></div></section>
${notesHtml}<section class="sample-cta-band"><div><p class="eyebrow">Keuzehulp</p><h2>Niet zeker of deze geur bij je past?</h2><p>Gebruik de ORIVÈA Geurwijzer om op geurprofiel en karakter te vergelijken.</p></div><a class="button ghost" href="../index.html#geurwijzer">Vind jouw geur</a></section>
<section class="generated-product-section"><p class="eyebrow">Selectie</p><h2>Misschien past dit ook bij jou</h2><div class="related-product-grid">${relatedHtml}</div></section></main>
<dialog class="ingredients-dialog" data-product-info-dialog><div class="ingredients-dialog-head"><div><p class="eyebrow">Productinformatie</p><h2>Ingrediënten</h2></div><button type="button" data-product-info-close aria-label="Ingrediënten sluiten">×</button></div><div class="ingredients-content">${ingredientText ? `<p>${ingredientText}</p><small>Bron: ${official ? `officiële Glantier-productpagina, gecontroleerd ${escapeHtml(official.source_last_checked?.slice(0, 10))}` : "goedgekeurde Glantier-productinformatie in de ORIVÈA Knowledge Base"}.</small>` : `<p>Ingrediënteninformatie wordt nog aangevuld.</p><small>Status: missing_data. Er worden geen ingrediënten automatisch ingevuld.</small>`}</div></dialog>
<aside class="cart-drawer" aria-hidden="true" data-cart-drawer><div class="drawer-panel"><button class="drawer-close" type="button" data-cart-close>Sluiten</button><h2>Winkelwagen</h2><div data-mini-cart></div><a class="button primary full" href="../checkout.html">Naar de kassa</a></div></aside><footer class="site-footer"><div class="footer-brand"><strong>ORIVÈA</strong><p>More Than Perfume</p><span>Premium Glantier webshop voor zorgvuldig geselecteerde geurprofielen.</span><a href="mailto:shop@orivea.nl">shop@orivea.nl</a></div><div class="footer-column"><h3>Shop</h3><a href="../catalogus.html">Collectie</a><a href="../index.html#geurwijzer">Geurwijzer</a><a href="../glantier-dames-parfum.html">Dames</a><a href="../glantier-heren-parfum.html">Heren</a><a href="../glantier-premium-parfum.html">Premium</a></div><div class="footer-column"><h3>Service</h3><a href="../checkout.html">Checkout</a><a href="../contact.html">Contact</a></div><div class="footer-column footer-payments"><h3>ORIVÈA Veilig Afrekenen</h3><div class="payment-badges"><span>PayPal</span><span>Achteraf betalen</span></div></div><div class="footer-bottom"><p>ORIVÈA is een onafhankelijke Glantier Consultant. Glantier is een geregistreerd handelsmerk.</p></div></footer><script src="../products.js"></script><script src="../script.js"></script><script src="../lightroom.js"></script><script src="../product-detail.js?v=20260908a"></script></body></html>`;
}

fs.mkdirSync(outputDir, { recursive: true });
for (const file of fs.readdirSync(outputDir)) if (/^glantier-.*\.html$/.test(file)) fs.unlinkSync(path.join(outputDir, file));
const generatedProducts = products.filter((product) => !product.detailUrl && !product.pricePending && product.availableForSale !== false);
for (const product of generatedProducts) fs.writeFileSync(path.join(outputDir, `${productSlug(product)}.html`), page(product), "utf8");

const report = products.filter((product) => !product.pricePending && product.availableForSale !== false).map((product) => ({
  id: product.id,
  reference: product.glantierNummer || null,
  url: productUrl(product),
  ingredients_status: approvedData[String(product.glantierNummer || "")]?.ingredients_source_text || approvedIngredients[String(product.glantierNummer || "")] ? "approved" : "missing_data",
  knowledge_sources: approvedData[String(product.glantierNummer || "")] ? [approvedData[String(product.glantierNummer)].official_product_url] : approvedIngredients[String(product.glantierNummer || "")] ? ["glantier-top-10-samples.html"] : [],
  quality_status: "approved",
  last_updated: generatedOn
}));
fs.writeFileSync(path.join(root, "product-content-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

const sitemapPath = path.join(root, "sitemap.xml");
let sitemap = fs.readFileSync(sitemapPath, "utf8").replace(/\s*<url><loc>https:\/\/orivea\.nl\/product\/[^<]+<\/loc>[\s\S]*?<\/url>/g, "");
const urls = generatedProducts.map((product) => `  <url><loc>${domain}/${productUrl(product)}</loc><lastmod>${generatedOn}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`).join("\n");
sitemap = sitemap.replace("</urlset>", `${urls ? `\n${urls}\n` : ""}</urlset>`);
fs.writeFileSync(sitemapPath, sitemap, "utf8");
console.log(`Generated ${generatedProducts.length} product pages; ${report.filter((item) => item.ingredients_status === "approved").length} products have approved ingredients.`);
