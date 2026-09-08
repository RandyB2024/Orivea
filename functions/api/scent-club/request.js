import { ensureCommerceSchema, json, queueEvent, trySync } from "../paypal/_commerce.js";
const prices = { essential:17.95, signature:22.95, duo:34.95 };
export async function onRequestPost({request,env}) {
  try {
    const body=await request.json(); const plan=String(body.plan||"").toLowerCase(); const email=String(body.email||"").trim().toLowerCase();
    if(!prices[plan]||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!String(body.first_name||"").trim()||!String(body.last_name||"").trim()) return json({error:"Ongeldige Scent Club aanvraag."},400);
    await ensureCommerceSchema(env.SCENT_CLUB_DB); const externalId=String(body.external_id||crypto.randomUUID());
    const payload={external_id:externalId,first_name:String(body.first_name).trim(),last_name:String(body.last_name).trim(),email,phone:String(body.phone||"").trim(),plan,monthly_price:prices[plan],preference_gender:String(body.preference_gender||"Unisex"),preference_family:String(body.preference_family||"Geen voorkeur"),selection_mode:String(body.selection_mode||"curated"),notes:String(body.notes||"").slice(0,2000),source:"orivea.nl",created_at:new Date().toISOString()};
    const inserted=await env.SCENT_CLUB_DB.prepare("INSERT OR IGNORE INTO commerce_requests (external_id,request_type,payload,created_at) VALUES (?,'scent_club_request',?,?)").bind(externalId,JSON.stringify(payload),payload.created_at).run();
    if(inserted.meta?.changes){const eventId=await queueEvent(env.SCENT_CLUB_DB,"scent_club_request",externalId,payload);if(await trySync(env,eventId,"scent_club_request",payload))await env.SCENT_CLUB_DB.prepare("UPDATE commerce_outbox SET synced_at=? WHERE event_id=?").bind(new Date().toISOString(),eventId).run();}
    return json({ok:true,externalId,duplicate:!inserted.meta?.changes},inserted.meta?.changes?201:200);
  } catch(error){return json({error:error.message||"Aanvraag opslaan mislukt."},500);}
}
