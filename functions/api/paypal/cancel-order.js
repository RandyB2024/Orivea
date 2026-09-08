import { ensureCommerceSchema, json, queueEvent, trySync } from "./_commerce.js";

export async function onRequestPost({ request, env }) {
  try {
    const { orderId } = await request.json();
    if (!env.SCENT_CLUB_DB) return json({ error: "Commerce database binding ontbreekt." }, 503);
    await ensureCommerceSchema(env.SCENT_CLUB_DB);
    const stored = await env.SCENT_CLUB_DB.prepare("SELECT * FROM commerce_orders WHERE paypal_order_id=?").bind(String(orderId || "")).first();
    if (!stored) return json({ ok: true });
    if (stored.payment_status === "paid") return json({ error: "Een betaalde order kan niet via deze route worden geannuleerd." }, 409);
    const payload = { ...JSON.parse(stored.payload), payment_status: "cancelled", order_status: "cancelled", cancelled_at: new Date().toISOString() };
    await env.SCENT_CLUB_DB.prepare("UPDATE commerce_orders SET payload=?,payment_status='cancelled',order_status='cancelled',updated_at=? WHERE order_number=?").bind(JSON.stringify(payload),new Date().toISOString(),stored.order_number).run();
    const eventId = await queueEvent(env.SCENT_CLUB_DB,"payment_cancelled",stored.order_number,payload);
    if (await trySync(env,eventId,"payment_cancelled",payload)) await env.SCENT_CLUB_DB.prepare("UPDATE commerce_outbox SET synced_at=? WHERE event_id=?").bind(new Date().toISOString(),eventId).run();
    return json({ ok: true, orderNumber: stored.order_number });
  } catch (error) {
    return json({ error: error.message || "Annuleren mislukt." }, 500);
  }
}
