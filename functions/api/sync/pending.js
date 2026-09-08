import { ensureCommerceSchema, json } from "../paypal/_commerce.js";

function authorized(request, env) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(env.CONTENT_STUDIO_SYNC_SECRET && token === env.CONTENT_STUDIO_SYNC_SECRET);
}

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) return json({ error: "Niet geautoriseerd." }, 401);
  if (!env.SCENT_CLUB_DB) return json({ error: "Commerce database binding ontbreekt." }, 503);
  await ensureCommerceSchema(env.SCENT_CLUB_DB);
  const result = await env.SCENT_CLUB_DB.prepare("SELECT event_id,event_type,aggregate_id,payload,created_at FROM commerce_outbox WHERE synced_at IS NULL ORDER BY id LIMIT 100").all();
  return json({ events: (result.results || []).map((row) => ({ ...row, payload: JSON.parse(row.payload) })) });
}
