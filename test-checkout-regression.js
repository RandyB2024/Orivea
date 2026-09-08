const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
const script = read("script.js");
const checkout = read("checkout.html");
const scentClub = read("scent-club.js");

const checkbox = (name) => checkout.match(new RegExp(`<input[^>]+name=["']${name}["'][^>]*>`, "i"))?.[0] || "";

assert.match(checkbox("terms_accepted"), /\brequired\b/i, "Voorwaarden moeten verplicht blijven");
assert.match(checkbox("return_policy_accepted"), /\brequired\b/i, "Retourbeleid moet verplicht blijven");
assert.doesNotMatch(checkbox("newsletter_opt_in"), /\brequired\b/i, "Nieuwsbrief mag PayPal niet blokkeren");
assert.match(script, /form\.elements\.terms_accepted/);
assert.match(script, /form\.elements\.return_policy_accepted/);
assert.match(script, /return actions\.order\.create\s*\(/, "Native PayPal fallback ontbreekt");
assert.match(script, /await actions\.order\.capture\s*\(\s*\)/, "Native PayPal capture ontbreekt");
assert.match(script, /context\.captureCompleted = true/, "Geslaagde capture moet vóór orderafhandeling worden vastgelegd");
assert.match(script, /Server-side orderregistratie niet beschikbaar; PayPal checkout gaat door zonder korting/);
assert.match(script, /Nieuwsbrief-API niet beschikbaar; e-mailflow gaat door/);
assert.match(scentClub, /Scent Club API niet beschikbaar; e-mailflow gaat door/);

const businessHandler = script.slice(script.indexOf("function initBusinessForm"), script.indexOf("function initNewsletterForm"));
assert.doesNotMatch(businessHandler, /isUnsubscribe|\/api\/newsletter\/subscribe/, "Nieuwsbriefcode staat in het zakelijke formulier");

console.log("Checkout regressietests geslaagd: verplichte consent, PayPal fallback/capture en fail-open nevenservices.");
