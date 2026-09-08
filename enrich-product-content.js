const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "products.js"), "utf8"), context);
const products = context.window.ORIVEA_PRODUCTS || [];
const args = process.argv.slice(2);
const all = args.includes("--all");
const requested = args.filter((arg) => !arg.startsWith("--"));
const selected = all ? products : products.filter((product) => requested.includes(String(product.id)) || requested.includes(String(product.glantierNummer)));
const model = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const endpoint = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/generate";
const forbiddenClaims = [/blijft de hele dag/i, /duurzaam/i, /hypoallergeen/i, /klinisch bewezen/i, /beste parfum/i];

function sourceFacts(product) {
  return {
    id: product.id,
    reference: product.glantierNummer || null,
    name: product.naam,
    category: product.categorie,
    audience: product.doelgroep,
    type: String(product.type || "").replace(/\bsignature\s+edp\b/gi, "Eau de Parfum").replace(/\bedp\b/gi, "Eau de Parfum"),
    scent_profile: product.geurgroep || null,
    moment: product.moment || null,
    size: product.inhoud || null,
    price_eur: product.prijs,
    premium_available: Boolean(product.premiumBeschikbaar),
    premium_price_eur: product.premiumBeschikbaar ? product.premiumPrijs || context.window.ORIVEA_CONFIG?.pricing?.premium50 : null
  };
}

function validate(text, facts) {
  const errors = [];
  const allowedNumbers = new Set([String(facts.reference || ""), String(facts.price_eur), String(facts.premium_price_eur || ""), ...(String(facts.size || "").match(/\d+(?:[.,]\d+)?/g) || [])]);
  for (const value of text.match(/\b\d{3}\b/g) || []) if (!allowedNumbers.has(value)) errors.push(`Onbekend referentienummer: ${value}`);
  for (const claim of forbiddenClaims) if (claim.test(text)) errors.push(`Niet-onderbouwde claim: ${claim.source}`);
  if (facts.reference && !text.includes(String(facts.reference))) errors.push("Productnummer ontbreekt");
  return [...new Set(errors)];
}

async function enrich(product) {
  const facts = sourceFacts(product);
  const prompt = `Je schrijft Nederlandse productcontent voor ORIVÈA. Gebruik uitsluitend de JSON-feiten hieronder. Voeg geen ingrediënten, losse geurnoten, designermerken, prestaties, reviews of claims toe. Geef uitsluitend geldige JSON met de velden short_intro, long_description, profile_explanation, choice_help, meta_description en faq (array van objecten met question en answer). Feiten: ${JSON.stringify(facts)}`;
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, prompt, stream: false, format: "json", options: { temperature: 0.1 } }) });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const payload = await response.json();
  const content = JSON.parse(payload.response);
  const serialized = JSON.stringify(content);
  const validationErrors = validate(serialized, facts);
  return { id: product.id, reference: product.glantierNummer || null, model, facts, content, validation_errors: validationErrors, quality_status: validationErrors.length ? "review_required" : "review_required", publish_automatically: false, generated_at: new Date().toISOString() };
}

(async () => {
  if (!selected.length) throw new Error("Geef product-ID's op of gebruik --all.");
  const results = [];
  for (const product of selected) {
    try { results.push(await enrich(product)); }
    catch (error) { results.push({ id: product.id, reference: product.glantierNummer || null, quality_status: "missing_data", publish_automatically: false, error: error.message }); }
    console.log(`Processed ${product.id}`);
  }
  fs.writeFileSync(path.join(__dirname, "product-enrichment-review.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(`Saved ${results.length} review item(s). Nothing was published automatically.`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
