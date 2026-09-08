import { db, json, loadSession } from "./_shared.js";
export async function onRequestGet({ request, env }) {
  try {
    const session = await loadSession(request, env);
    if (!session) return json({ error: "Sessie verlopen." }, 401);
    if (session.selection_mode !== "self_select") return json({ products: [] });
    const rows = await db(env).prepare("SELECT reference,gender,image,profile,description FROM scent_club_products WHERE active=1 AND discontinued=0 AND (gender=? OR gender='Unisex' OR ? IN ('Unisex','Verrassing')) ORDER BY reference").bind(session.preference_gender, session.preference_gender).all();
    return json({ products: rows.results || [] });
  } catch (error) {
    console.error("Scent Club catalog failed:", error);
    return json({ error: "Geuren konden niet worden geladen." }, 503);
  }
}
