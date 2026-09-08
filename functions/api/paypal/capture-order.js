const PAYPAL_API = {
  live: "https://api-m.paypal.com",
  sandbox: "https://api-m.sandbox.paypal.com"
};
import { ensureCommerceSchema, json, queueEvent, trySync } from "./_commerce.js";

function paypalBase(env) {
  return PAYPAL_API[(env.PAYPAL_ENVIRONMENT || "live").toLowerCase()] || PAYPAL_API.live;
}

async function accessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal environment variables ontbreken");
  }
  const credentials = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error("PayPal access token kon niet worden opgehaald");
  const data = await response.json();
  return data.access_token;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const orderId = String(body.orderId || "").trim();
    if (!/^[A-Z0-9-]+$/i.test(orderId)) return json({ error: "Ongeldig order ID" }, 400);
    if (!env.SCENT_CLUB_DB) return json({ error: "Commerce database binding ontbreekt." }, 503);
    await ensureCommerceSchema(env.SCENT_CLUB_DB);
    const stored = await env.SCENT_CLUB_DB.prepare("SELECT * FROM commerce_orders WHERE paypal_order_id=?").bind(orderId).first();
    if (!stored) return json({ error: "Onbekende PayPal order." }, 404);
    if (stored.payment_status === "paid") return json({ status: "COMPLETED", orderNumber: stored.order_number, order: JSON.parse(stored.payload), duplicate: true });
    const token = await accessToken(env);
    const response = await fetch(`${paypalBase(env)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": crypto.randomUUID()
      }
    });
    const data = await response.json();
    if (!response.ok) return json(data, response.status);
    const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
    if (data.status !== "COMPLETED" && capture?.status !== "COMPLETED") return json({ error: "PayPal bevestigde de betaling niet als voltooid.", paypal: data }, 409);
    const original = JSON.parse(stored.payload);
    const paidOrder = { ...original, paypal_order_id: orderId, paypal_transaction_id: capture?.id || orderId, payment_status: "paid", order_status: "paid", paid_at: new Date().toISOString() };
    await env.SCENT_CLUB_DB.prepare("UPDATE commerce_orders SET paypal_capture_id=?,payload=?,payment_status='paid',order_status='paid',updated_at=? WHERE order_number=?").bind(paidOrder.paypal_transaction_id,JSON.stringify(paidOrder),new Date().toISOString(),stored.order_number).run();
    const eventId = await queueEvent(env.SCENT_CLUB_DB,"payment_completed",stored.order_number,paidOrder);
    if (await trySync(env,eventId,"payment_completed",paidOrder)) await env.SCENT_CLUB_DB.prepare("UPDATE commerce_outbox SET synced_at=? WHERE event_id=?").bind(new Date().toISOString(),eventId).run();
    return json({ ...data, orderNumber: stored.order_number, order: paidOrder });
  } catch (error) {
    return json({ error: error.message || "PayPal order capturen mislukt" }, 500);
  }
}
