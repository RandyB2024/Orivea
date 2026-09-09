import { json, newOrderNumber, queueEvent, trySync, validateCheckout } from "../paypal/_commerce.js";
import { preparePayLater } from "./_shared.js";

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const prepared = await preparePayLater(env);
    if (prepared.error) return prepared.error;
    const { config, db } = prepared;
    const idempotencyKey = String(request.headers.get("Idempotency-Key") || body.idempotencyKey || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 100) return json({ error: "Ongeldige aanvraag." }, 400);
    const duplicate = await db.prepare("SELECT payload FROM commerce_orders WHERE idempotency_key=?").bind(idempotencyKey).first();
    if (duplicate) return json({ order: JSON.parse(duplicate.payload), duplicate: true });
    if (body.ageConfirmed !== true) return json({ error: "Bevestig dat je 18 jaar of ouder bent." }, 400);
    if (String(body.country || "").toUpperCase() !== config.country) return json({ error: "Achteraf betalen is voor deze bestelling niet beschikbaar. Kies een andere betaalmethode." }, 400);
    const order = validateCheckout(body);
    const memberCode = String(body.memberCode || "").trim().toUpperCase();
    if (memberCode) {
      const member = await db.prepare("SELECT id,plan,status FROM scent_club_members WHERE member_code=? AND email_normalized=? AND blocked=0").bind(memberCode,order.customer.email).first();
      if (!member || member.status !== "active") return json({ error: "Scent Club lidnummer is niet geldig voor dit e-mailadres." }, 400);
      if (["signature","duo"].includes(member.plan)) {
        order.discount_amount = money(order.subtotal * .10);
        order.discounts = [{ type:"scent_club",percent:10,amount:order.discount_amount }];
        order.total = money(order.subtotal - order.discount_amount + order.shipping_cost);
        order.scent_club_discount_applied = true;
        order.scent_club_member_id = member.id;
        order.member_reference = memberCode;
      }
    }
    if (order.total <= 0 || order.total > config.maxOrderAmount) return json({ error: "Achteraf betalen is voor deze bestelling niet beschikbaar. Kies een andere betaalmethode." }, 409);
    const open = await db.prepare("SELECT order_number FROM pay_later_orders WHERE email_normalized=? AND payment_status='unpaid' AND pay_later_status NOT IN ('rejected','cancelled','paid') LIMIT 1").bind(order.customer.email).first();
    if (open) return json({ error: "Achteraf betalen is voor deze bestelling niet beschikbaar. Kies een andere betaalmethode." }, 409);
    const orderNumber = newOrderNumber();
    const now = new Date().toISOString();
    const orderPayload = { ...order, order_number:orderNumber, created_at:now, payment_method:"pay_later", payment_status:"unpaid", order_status:config.manualApproval?"review_required":"approved", pay_later_status:config.manualApproval?"review_required":"approved", pay_later_due_date:null, age_confirmed:true, pay_later_days:config.days };
    await db.batch([
      db.prepare("INSERT INTO commerce_orders (order_number,idempotency_key,payload,payment_status,order_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(orderNumber,idempotencyKey,JSON.stringify(orderPayload),"unpaid",orderPayload.order_status,now,now),
      db.prepare("INSERT INTO pay_later_orders (order_number,email_normalized,customer_id,payment_status,order_status,pay_later_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(orderNumber,order.customer.email,order.scent_club_member_id||null,"unpaid",orderPayload.order_status,orderPayload.pay_later_status,now,now)
    ]);
    const eventId = await queueEvent(db,"pay_later_order_created",orderNumber,orderPayload);
    if (await trySync(env,eventId,"pay_later_order_created",orderPayload)) await db.prepare("UPDATE commerce_outbox SET synced_at=? WHERE event_id=?").bind(new Date().toISOString(),eventId).run();
    return json({ order: orderPayload }, 201);
  } catch (error) {
    console.error("Pay later order error:", error, error?.stack);
    return json({ error: /verplicht|ongeldig|geaccepteerd/i.test(error.message||"") ? error.message : "Achteraf betalen kon niet veilig worden geregistreerd. Kies PayPal of probeer later opnieuw." }, 500);
  }
}
