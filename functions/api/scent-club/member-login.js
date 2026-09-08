import { db, event, hash, json, normalizeEmail, sessionCookie, view } from "./_shared.js";
const generic = "De combinatie van abonnementsnummer en e-mailadres is niet geldig.";
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const code = String(body.member_code || "").trim();
    const email = normalizeEmail(body.email);
    const now = new Date();
    const key = await hash((env.SCENT_RATE_LIMIT_SALT || "orivea") + ":" + (request.headers.get("CF-Connecting-IP") || "unknown"));
    const attempt = await db(env).prepare("SELECT * FROM scent_club_login_attempts WHERE key_hash=?").bind(key).first();
    if (attempt?.locked_until && new Date(attempt.locked_until) > now) return json({ error: generic }, 429);
    const member = code.length <= 40 && email.length <= 254
      ? await db(env).prepare("SELECT * FROM scent_club_members WHERE member_code=? AND email_normalized=? AND blocked=0").bind(code, email).first()
      : null;
    if (!member) {
      const inside = attempt && now - new Date(attempt.window_started_at) < 900000;
      const failures = inside ? Number(attempt.failures) + 1 : 1;
      const locked = failures >= 5 ? new Date(now.getTime() + 900000).toISOString() : null;
      await db(env).prepare("INSERT INTO scent_club_login_attempts(key_hash,failures,window_started_at,locked_until) VALUES(?,?,?,?) ON CONFLICT(key_hash) DO UPDATE SET failures=excluded.failures,window_started_at=excluded.window_started_at,locked_until=excluded.locked_until").bind(key, failures, inside ? attempt.window_started_at : now.toISOString(), locked).run();
      return json({ error: generic }, 401);
    }
    await db(env).prepare("DELETE FROM scent_club_login_attempts WHERE key_hash=?").bind(key).run();
    const token = crypto.randomUUID() + crypto.randomUUID();
    const csrf = crypto.randomUUID() + crypto.randomUUID();
    const minutes = Math.min(30, Math.max(20, Number(env.SCENT_SESSION_MINUTES || 30)));
    const expires = new Date(now.getTime() + minutes * 60000).toISOString();
    await db(env).prepare("INSERT INTO scent_club_sessions(token_hash,member_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)").bind(await hash(token), member.id, csrf, expires, now.toISOString()).run();
    await event(env, member.id, "self_service_login");
    return json({ member: view(member, env), csrf_token: csrf }, 200, { "Set-Cookie": sessionCookie(token, minutes * 60) });
  } catch (error) {
    console.error("Scent Club member login failed:", error);
    return json({ error: "Inloggen is momenteel niet mogelijk." }, 503);
  }
}
