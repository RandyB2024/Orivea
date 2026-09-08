const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { activeProducts, assertGlantier } = require("./glantier-catalog-core");

const root = __dirname;
const sourcePath = path.join(root, "products.js");
const outputPath = path.join(root, "merchant-feed.xml");
const context = { window: {} };

vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), context, { filename: sourcePath });

const config = context.window.ORIVEA_CONFIG || {};
const products = [...(context.window.ORIVEA_PRODUCTS || []), ...activeProducts(root)];
for (const product of products) assertGlantier({ brand: product.merk || "Glantier", source: "official_glantier" });
const domain = String(config.domain || "https://orivea.nl").replace(/\/$/, "");
const currency = config.currency || "EUR";
const salesAvailable = config.paymentEnabled !== false && config.salesPaused === false;

function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function absoluteUrl(relativePath) {
  if (/^https?:\/\//i.test(String(relativePath || ""))) return String(relativePath);
  return `${domain}/${String(relativePath || "").replace(/^\/+/, "")}`;
}

function productLink(product, variant) {
  const value = slug(product.glantierNummer || product.id);
  const detail = product.detailUrl || `product/glantier-${value}.html`;
  return `${absoluteUrl(detail)}?variant=${encodeURIComponent(variant)}`;
}

function productType(product) {
  if (["Dames", "Heren", "Unisex"].includes(product.categorie)) return `Parfum > ${product.categorie}`;
  return `${product.categorie}${product.type && product.type !== product.categorie ? ` > ${product.type}` : ""}`;
}

function fragranceDescription(product) {
  const audience = String(product.doelgroep || product.categorie || "").toLowerCase();
  const profile = String(product.geurgroep || "").replace(/\s*-\s*/g, ", ").toLowerCase();
  return `Glantier ${product.glantierNummer} ${audience}parfum${profile ? ` met een ${profile} geurprofiel` : ""}. Verkrijgbaar bij ORIVÈA.`;
}

function makeOffer(product, variant) {
  const groupId = `glantier-${slug(product.id)}`;
  const base = {
    groupId,
    productType: productType(product),
    availability: salesAvailable ? "in_stock" : "out_of_stock",
    brand: "Glantier",
    condition: "new"
  };

  if (variant.kind === "fragrance") {
    const audience = String(product.doelgroep || product.categorie).toLowerCase();
    const premium = variant.code === "premium" ? " Premium" : "";
    return {
      ...base,
      id: `${groupId}-${variant.idSuffix}`,
      title: `Glantier ${product.glantierNummer}${premium} ${audience}parfum ${variant.size}`,
      description: fragranceDescription(product),
      link: productLink(product, variant.code),
      image: absoluteUrl(variant.image || product.image),
      price: variant.price,
      size: variant.size
    };
  }

  if (variant.choice) {
    return {
      ...base,
      id: `${groupId}-${slug(variant.choice.nummer)}`,
      title: `${product.naam} ${variant.choice.nummer} ${product.inhoud}`,
      description: product.omschrijving || `${product.naam} in geur ${variant.choice.nummer} (${variant.choice.geurgroep}).`,
      link: productLink(product, `geur-${variant.choice.nummer}`),
      image: absoluteUrl(product.image),
      price: product.prijs,
      size: product.inhoud
    };
  }

  return {
    ...base,
    id: groupId,
    title: product.naam,
    description: product.omschrijving || [product.type, product.geurgroep, product.inhoud].filter(Boolean).join(". "),
    link: product.detailUrl ? absoluteUrl(product.detailUrl) : productLink(product, "signature"),
    image: absoluteUrl(product.image),
    price: product.prijs,
    size: product.inhoud
  };
}

const offers = products
  .filter((product) => (product.merk || "Glantier") === "Glantier" && !product.pricePending && product.availableForSale !== false && Number.isFinite(Number(product.prijs)) && Number(product.prijs) > 0)
  .flatMap((product) => {
    const isFragrance = ["Dames", "Heren", "Unisex"].includes(product.categorie) && product.glantierNummer;
    if (isFragrance) {
      const variants = [
        { kind: "fragrance", code: "discovery", idSuffix: "15ml", size: "15 ml", price: config.pricing.discovery15, image: product.image },
        { kind: "fragrance", code: "signature", idSuffix: "50ml", size: "50 ml", price: product.prijs, image: product.image }
      ];
      if (product.premiumBeschikbaar) {
        variants.push({ kind: "fragrance", code: "premium", idSuffix: "premium-50ml", size: "Premium 50 ml", price: product.premiumPrijs || config.pricing.premium50, image: product.premiumImage || product.image });
      }
      return variants.map((variant) => makeOffer(product, variant));
    }
    if (product.geurKeuzes?.length) return product.geurKeuzes.map((choice) => makeOffer(product, { choice }));
    return [makeOffer(product, {})];
  });

function itemXml(offer) {
  return [
    "    <item>",
    `      <g:id>${xml(offer.id)}</g:id>`,
    `      <g:item_group_id>${xml(offer.groupId)}</g:item_group_id>`,
    `      <g:title>${xml(offer.title)}</g:title>`,
    `      <g:description>${xml(offer.description)}</g:description>`,
    `      <g:link>${xml(offer.link)}</g:link>`,
    `      <g:image_link>${xml(offer.image)}</g:image_link>`,
    `      <g:availability>${offer.availability}</g:availability>`,
    `      <g:price>${Number(offer.price).toFixed(2)} ${xml(currency)}</g:price>`,
    `      <g:condition>${offer.condition}</g:condition>`,
    `      <g:brand>${offer.brand}</g:brand>`,
    `      <g:product_type>${xml(offer.productType)}</g:product_type>`,
    offer.size ? `      <g:size>${xml(offer.size)}</g:size>` : "",
    "    </item>"
  ].filter(Boolean).join("\n");
}

const feed = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
  "  <channel>",
  "    <title>ORIVÉA Productfeed</title>",
  `    <link>${domain}/</link>`,
  "    <description>Glantier parfums verkrijgbaar via ORIVÉA</description>",
  offers.map(itemXml).join("\n"),
  "  </channel>",
  "</rss>",
  ""
].join("\n");

fs.writeFileSync(outputPath, feed, "utf8");
console.log(`Merchant feed generated: ${offers.length} items -> ${outputPath}`);
