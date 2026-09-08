import { COMMERCE_PRODUCTS } from "./catalog.js";

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

const clean = (value, max = 250) => String(value || "").trim().slice(0, max);
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const productMap = new Map(COMMERCE_PRODUCTS.map((product) => [product.id, product]));

export async function ensureCommerceSchema(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS commerce_orders (order_number TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,paypal_order_id TEXT UNIQUE,paypal_capture_id TEXT,payload TEXT NOT NULL,payment_status TEXT NOT NULL DEFAULT 'payment_pending',order_status TEXT NOT NULL DEFAULT 'order_created',created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS commerce_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,event_type TEXT NOT NULL,aggregate_id TEXT NOT NULL,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,synced_at TEXT,created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_commerce_outbox_pending ON commerce_outbox(synced_at,id); CREATE TABLE IF NOT EXISTS commerce_requests (external_id TEXT PRIMARY KEY,request_type TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);`);
}

export function validateCheckout(body) {
  const customer = body.customer || {};
  const email = clean(customer.email, 254).toLowerCase();
  if (!clean(customer.name, 160) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Naam en geldig e-mailadres zijn verplicht.");
  if (body.termsAccepted !== true || body.returnPolicyAccepted !== true) throw new Error("Voorwaarden en retourbeleid moeten zijn geaccepteerd.");
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) throw new Error("Winkelwagen is leeg of ongeldig.");
  const items = body.items.map((line) => {
    const product = productMap.get(clean(line.id, 100));
    const variant = clean(line.variant || "signature", 30);
    const quantity = Number.parseInt(line.quantity, 10);
    if (!product || !product.active || !Number.isInteger(quantity) || quantity < 1 || quantity > 25) throw new Error("Een product of aantal is ongeldig.");
    const unitPrice = product.prices[variant];
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error("De gekozen variant is niet beschikbaar.");
    return { product_id: product.id, product_name: product.name, reference: product.reference, variant, variant_label: product.labels[variant], quantity, unit_price: money(unitPrice), line_total: money(unitPrice * quantity) };
  });
  const subtotal = money(items.reduce((sum, item) => sum + item.line_total, 0));
  const shippingCost = subtotal >= 75 ? 0 : subtotal >= 40 ? 4.95 : 6.95;
  const discountAmount = 0;
  const total = money(subtotal - discountAmount + shippingCost);
  return {
    customer: { name: clean(customer.name, 160), email, phone: clean(customer.phone, 40), address: clean(customer.address, 500) },
    items, subtotal, discounts: [], discount_amount: discountAmount, shipping_cost: shippingCost, total,
    newsletter_opt_in: body.newsletterOptIn === true,
    newsletter_opt_in_at: body.newsletterOptIn === true ? new Date().toISOString() : null,
    terms_accepted: true, return_policy_accepted: true,
    scent_club_discount_applied: false, scent_club_member_id: null,
    note: clean(body.note, 2000)
  };
}

export function newOrderNumber() {
  const year = new Date().getUTCFullYear();
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `ORV-${year}-${suffix}`;
}

export async function queueEvent(db, eventType, aggregateId, payload) {
  const eventId = crypto.randomUUID();
  await db.prepare("INSERT INTO commerce_outbox (event_id,event_type,aggregate_id,payload,created_at) VALUES (?,?,?,?,?)").bind(eventId, eventType, aggregateId, JSON.stringify(payload), new Date().toISOString()).run();
  return eventId;
}

export async function trySync(env, eventId, eventType, payload) {
  if (!env.CONTENT_STUDIO_URL || !env.CONTENT_STUDIO_SYNC_SECRET) return false;
  try {
    const response = await fetch(`${env.CONTENT_STUDIO_URL.replace(/\/$/, "")}/api/webhooks/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ORIVEA-WORKSPACE-SECRET": env.CONTENT_STUDIO_SYNC_SECRET, "X-Idempotency-Key": eventId },
      body: JSON.stringify({ event_id: eventId, event_type: eventType, payload })
    });
    return response.ok;
  } catch (error) {
    console.warn("Content Studio sync queued:", error.message);
    return false;
  }
}
