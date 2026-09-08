const PAYPAL_API = {
  live: "https://api-m.paypal.com",
  sandbox: "https://api-m.sandbox.paypal.com"
};
import { ensureCommerceSchema, json, newOrderNumber, queueEvent, trySync, validateCheckout } from "./_commerce.js";

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
    if (!env.SCENT_CLUB_DB) return json({ error: "Commerce database binding ontbreekt." }, 503);
    await ensureCommerceSchema(env.SCENT_CLUB_DB);
    const idempotencyKey = String(request.headers.get("Idempotency-Key") || body.idempotencyKey || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 100) return json({ error: "Idempotency-Key ontbreekt." }, 400);
    const existing = await env.SCENT_CLUB_DB.prepare("SELECT order_number,paypal_order_id,payload FROM commerce_orders WHERE idempotency_key=?").bind(idempotencyKey).first();
    if (existing?.paypal_order_id) return json({ id: existing.paypal_order_id, orderNumber: existing.order_number, order: JSON.parse(existing.payload), duplicate: true });
    const order = validateCheckout(body);
    const memberCode = String(body.memberCode || "").trim().toUpperCase();
    if (memberCode) {
      const member = await env.SCENT_CLUB_DB.prepare("SELECT id,plan,status FROM scent_club_members WHERE member_code=? AND email_normalized=? AND blocked=0").bind(memberCode,order.customer.email).first();
      if (!member || member.status !== "active") return json({ error:"Scent Club lidnummer is niet geldig voor dit e-mailadres." },400);
      if (["signature","duo"].includes(member.plan)) {
        order.discount_amount = Math.round(order.subtotal * 10) / 100;
        order.discounts = [{ type:"scent_club",percent:10,amount:order.discount_amount }];
        order.total = Math.round((order.subtotal - order.discount_amount + order.shipping_cost) * 100) / 100;
        order.scent_club_discount_applied = true;
        order.scent_club_member_id = member.id;
        order.member_reference = memberCode;
      }
    }
    const orderNumber = existing?.order_number || newOrderNumber();
    const createdAt = new Date().toISOString();
    const orderPayload = { ...order, order_number: orderNumber, created_at: createdAt, payment_method: "PayPal", payment_status: "payment_pending", order_status: "order_created" };
    if (!existing) await env.SCENT_CLUB_DB.prepare("INSERT INTO commerce_orders (order_number,idempotency_key,payload,payment_status,order_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(orderNumber,idempotencyKey,JSON.stringify(orderPayload),"payment_pending","order_created",createdAt,createdAt).run();
    const token = await accessToken(env);
    const response = await fetch(`${paypalBase(env)}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": crypto.randomUUID()
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        application_context: {
          brand_name: "ORIVEA",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW"
        },
        purchase_units: [{
          custom_id: orderNumber,
          invoice_id: orderNumber,
          description: "ORIVÈA Glantier bestelling",
          amount: {
            currency_code: "EUR",
            value: order.total.toFixed(2)
          }
        }]
      })
    });
    const data = await response.json();
    if (!response.ok) return json(data, response.status);
    await env.SCENT_CLUB_DB.prepare("UPDATE commerce_orders SET paypal_order_id=?,updated_at=? WHERE order_number=?").bind(data.id,new Date().toISOString(),orderNumber).run();
    const eventPayload = { ...orderPayload, paypal_order_id: data.id };
    const eventId = await queueEvent(env.SCENT_CLUB_DB,"order_created",orderNumber,eventPayload);
    if (await trySync(env,eventId,"order_created",eventPayload)) await env.SCENT_CLUB_DB.prepare("UPDATE commerce_outbox SET synced_at=? WHERE event_id=?").bind(new Date().toISOString(),eventId).run();
    return json({ ...data, orderNumber, order: eventPayload });
  } catch (error) {
    const status = /ongeldig|verplicht|geaccepteerd|leeg/i.test(error.message || "") ? 400 : 500;
    return json({ error: error.message || "PayPal order aanmaken mislukt" }, status);
  }
}
