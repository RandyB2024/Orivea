const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");
const script = read("script.js");
const checkout = read("checkout.html");
const scentClub = read("scent-club.js");
const style = read("style.css");

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
assert.match(script, /--- ORIVEA-DATA ---/, "Webshopmails missen het machineleesbare intakeblok");
assert.match(script, /type:\"order\"/);
assert.match(script, /type:\"contact\"/);
assert.match(script, /type:\"b2b_request\"/);
assert.match(script, /type:\"newsletter\"/);
assert.match(scentClub, /type:\"scent_club_request\"/);
assert.match(script, /external_id:intakeId/, "Nieuwsbrief-API en e-mail moeten hetzelfde request-ID gebruiken");

const businessHandler = script.slice(script.indexOf("function initBusinessForm"), script.indexOf("function initNewsletterForm"));
assert.doesNotMatch(businessHandler, /isUnsubscribe|\/api\/newsletter\/subscribe/, "Nieuwsbriefcode staat in het zakelijke formulier");
assert.match(checkout, /name="payment_method" value="pay_later"/);
assert.match(checkout, /payment-method-card/);
assert.match(checkout, /data-pay-later-age hidden/);
assert.match(style, /\.checkout-consent\[hidden\].*display:none!important/, "Verborgen checkouttoestemmingen mogen niet door grid-styling zichtbaar worden");
assert.match(read("index.html"), /ORIVÈA Achteraf Betalen/);
assert.match(read("index.html"), /De betaaltermijn start zodra je bestelling is verzonden/);
assert.match(checkbox("age_confirmed"), /name=["']age_confirmed["']/i);
assert.match(script, /ageConfirmed:source\.elements\.age_confirmed/);
assert.match(script, /pay_later_idempotency/);
assert.match(script, /payment_status:"unpaid"/);
assert.match(script, /Achteraf-order EmailJS fallback mislukt/);
const payLaterRoute = read("functions/api/pay-later/create-order.js");
assert.match(payLaterRoute, /validateCheckout\(body\)/, "Backend moet prijzen opnieuw berekenen");
assert.match(payLaterRoute, /order\.total > config\.maxOrderAmount/);
assert.match(payLaterRoute, /pay_later_orders WHERE email_normalized=/);
assert.match(payLaterRoute, /pay_later_order_created/);
assert.doesNotMatch(payLaterRoute, /PAY_LATER_IBAN/, "IBAN mag niet naar publieke orderresponse lekken");
const payLaterManage = read("functions/api/pay-later/manage.js");
assert.match(payLaterManage, /CONTENT_STUDIO_SYNC_SECRET/);
assert.match(payLaterManage, /new Date\(now\.getTime\(\)\+config\.days\*86400000\)/, "Vervaldatum moet vanaf verzending worden berekend");

console.log("Checkout regressietests geslaagd: verplichte consent, PayPal fallback/capture en fail-open nevenservices.");
