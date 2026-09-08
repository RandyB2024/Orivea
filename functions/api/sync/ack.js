import { ensureCommerceSchema, json } from "../paypal/_commerce.js";

export async function onRequestPost({ request, env }) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!env.CONTENT_STUDIO_SYNC_SECRET || token !== env.CONTENT_STUDIO_SYNC_SECRET) return json({ error: "Niet geautoriseerd." }, 401);
  if (!env.SCENT_CLUB_DB) return json({ error: "Commerce database binding ontbreekt." }, 503);
  const body = await request.json();
  const ids = Array.isArray(body.eventIds) ? body.eventIds.filter((id) => /^[a-f0-9-]{20,50}$/i.test(id)).slice(0,100) : [];
  await ensureCommerceSchema(env.SCENT_CLUB_DB);
  const statement = env.SCENT_CLUB_DB.prepare("UPDATE commerce_outbox SET synced_at=? WHERE event_id=?");
  await env.SCENT_CLUB_DB.batch(ids.map((id) => statement.bind(new Date().toISOString(), id)));
  return json({ ok: true, acknowledged: ids.length });
}
