import { cutoffOpen, db, event, json, loadSession, task, validCsrf } from "./_shared.js";
export async function onRequestPost({ request, env }) {
  try {
    const session = await loadSession(request, env);
    if (!session) return json({ error: "Sessie verlopen." }, 401);
    if (!validCsrf(request, session)) return json({ error: "Ongeldige beveiligingscontrole." }, 403);
    if (session.selection_mode !== "self_select" || !cutoffOpen(session, env)) return json({ error: "De keuzeperiode voor deze maand is gesloten." }, 409);
    const body = await request.json();
    const reference = String(body.product_reference || "").trim();
    const product = await db(env).prepare("SELECT reference FROM scent_club_products WHERE reference=? AND active=1 AND discontinued=0 AND (gender=? OR gender='Unisex' OR ? IN ('Unisex','Verrassing'))").bind(reference, session.preference_gender, session.preference_gender).first();
    if (!product) return json({ error: "Deze geur is niet beschikbaar voor jouw abonnement." }, 400);
    const now = new Date(), month = now.getUTCMonth() + 1, year = now.getUTCFullYear();
    const existing = await db(env).prepare("SELECT id FROM scent_club_selections WHERE member_id=? AND month=? AND year=?").bind(session.id, month, year).first();
    await db(env).prepare("INSERT INTO scent_club_selections(member_id,month,year,product_reference,selected_at,source) VALUES(?,?,?,?,?,'self_service') ON CONFLICT(member_id,month,year) DO UPDATE SET product_reference=excluded.product_reference,selected_at=excluded.selected_at,source='self_service'").bind(session.id, month, year, reference, now.toISOString()).run();
    await event(env, session.id, existing ? "perfume_selection_changed" : "perfume_selected", { product_reference: reference, month, year });
    await task(env, session.id, "send_member_confirmation", "Keuzebevestiging Glantier " + reference, { notification_required: true });
    return json({ message: "Je keuze voor Glantier " + reference + " is ontvangen.", reference });
  } catch (error) {
    console.error("Scent Club selection failed:", error);
    return json({ error: "Je keuze kon niet worden opgeslagen." }, 503);
  }
}
