import { ensureCommerceSchema, json, queueEvent, trySync } from "../paypal/_commerce.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Ongeldig e-mailadres." }, 400);
    await ensureCommerceSchema(env.SCENT_CLUB_DB);
    const externalId = String(body.external_id || crypto.randomUUID());
    const optIn = body.optIn !== false;
    const eventType = optIn ? "newsletter_opt_in" : "newsletter_opt_out";
    const payload = { external_id:externalId, email, name:String(body.name || "").trim(), newsletter_opt_in:optIn, newsletter_opt_in_at:optIn ? new Date().toISOString() : null, source:"orivea.nl" };
    const inserted = await env.SCENT_CLUB_DB.prepare("INSERT OR IGNORE INTO commerce_requests (external_id,request_type,payload,created_at) VALUES (?,?,?,?)").bind(externalId,eventType,JSON.stringify(payload),new Date().toISOString()).run();
    if (inserted.meta?.changes) {
      const eventId = await queueEvent(env.SCENT_CLUB_DB,eventType,externalId,payload);
      if (await trySync(env,eventId,eventType,payload)) await env.SCENT_CLUB_DB.prepare("UPDATE commerce_outbox SET synced_at=? WHERE event_id=?").bind(new Date().toISOString(),eventId).run();
    }
    return json({ ok:true, externalId, duplicate:!inserted.meta?.changes }, inserted.meta?.changes ? 201 : 200);
  } catch (error) { return json({ error:error.message || "Nieuwsbriefvoorkeur opslaan mislukt." },500); }
}
