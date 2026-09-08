const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("products.js", "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const products = (sandbox.window.ORIVEA_PRODUCTS || []).map((product) => ({
  id: String(product.id),
  name: product.naam,
  category: product.categorie,
  reference: product.glantierNummer || null,
  active: product.availableForSale !== false && !product.pricePending,
  prices: {
    signature: Number(product.prijs),
    discovery: Number(product.discoveryPrijs || sandbox.window.ORIVEA_CONFIG?.pricing?.discovery15 || product.prijs),
    premium: product.premiumBeschikbaar ? Number(product.premiumPrijs || sandbox.window.ORIVEA_CONFIG?.pricing?.premium50) : null
  },
  labels: {
    signature: product.inhoud || "50 ml",
    discovery: "15 ml",
    premium: "Premium 50 ml"
  }
}));

const output = `// Generated from products.js. Run npm run generate:commerce-catalog.\nexport const COMMERCE_PRODUCTS = ${JSON.stringify(products, null, 2)};\n`;
fs.writeFileSync("functions/api/paypal/catalog.js", output);
console.log(`Commerce catalog generated: ${products.length} products.`);
