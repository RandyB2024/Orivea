import { json } from "../paypal/_commerce.js";

export async function onRequestPost({request,env}) {
  const token=request.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
  if(!env.CONTENT_STUDIO_SYNC_SECRET||token!==env.CONTENT_STUDIO_SYNC_SECRET)return json({error:"Niet geautoriseerd."},401);
  try {
    const body=await request.json();
    if(!/^ORV-SC-[A-F0-9]{8}$/.test(body.member_code)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)||!["essential","signature","duo"].includes(body.plan))return json({error:"Ongeldige lidgegevens."},400);
    await env.SCENT_CLUB_DB.prepare(`INSERT INTO scent_club_members (member_code,email_normalized,first_name,plan,status,selection_mode,preference_gender,started_at,next_renewal_at,blocked) VALUES (?,?,?,?,?,?,?,?,?,0) ON CONFLICT(member_code) DO UPDATE SET email_normalized=excluded.email_normalized,first_name=excluded.first_name,plan=excluded.plan,status=excluded.status,selection_mode=excluded.selection_mode,preference_gender=excluded.preference_gender,started_at=excluded.started_at,next_renewal_at=excluded.next_renewal_at,blocked=0`).bind(body.member_code,body.email.toLowerCase(),body.first_name||"",body.plan,"active",body.selection_mode||"curated",body.preference_gender||"Unisex",body.started_at||new Date().toISOString().slice(0,10),body.next_renewal_at||null).run();
    return json({ok:true,member_code:body.member_code});
  } catch(error){return json({error:error.message||"Lid activeren mislukt."},500);}
}
