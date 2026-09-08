import { db, event, json, loadSession, task, validCsrf, view } from "./_shared.js";
const actions = { pause: ["pause_requested", "subscription_pause_requested", "Abonnementspauze verwerken"], resume: ["resume_requested", "subscription_resume_requested", "Hervatting verwerken"], cancel: ["cancel_requested", "subscription_cancellation_requested", "Opzegging verwerken"] };
export async function onRequestPost({ request, env }) {
  try {
    const session = await loadSession(request, env);
    if (!session) return json({ error: "Sessie verlopen." }, 401);
    if (!validCsrf(request, session)) return json({ error: "Ongeldige beveiligingscontrole." }, 403);
    const body = await request.json();
    const action = actions[body.action];
    if (!action) return json({ error: "Ongeldige actie." }, 400);
    if (body.action === "resume" && session.status !== "paused") return json({ error: "Dit abonnement kan niet worden hervat." }, 409);
    if (["pause", "cancel"].includes(body.action) && session.status !== "active") return json({ error: "Deze wijziging kan nu niet worden aangevraagd." }, 409);
    const reason = String(body.reason || "").trim().slice(0, 500);
    const now = new Date().toISOString();
    await db(env).prepare("UPDATE scent_club_members SET pending_action=?,pending_action_at=?,cancellation_reason=CASE WHEN ?='cancel' THEN ? ELSE cancellation_reason END WHERE id=?").bind(action[0], now, body.action, reason, session.id).run();
    await event(env, session.id, action[1], { requested_via: "self_service" });
    await task(env, session.id, action[1], action[2], { requested_via: "self_service", notification_required: true });
    session.pending_action = action[0];
    return json({ message: "Je verzoek is ontvangen. ORIVÈA verwerkt dit vanaf de volgende abonnementsperiode.", member: view(session, env) });
  } catch (error) {
    console.error("Scent Club action failed:", error);
    return json({ error: "Je verzoek kon niet worden opgeslagen." }, 503);
  }
}
