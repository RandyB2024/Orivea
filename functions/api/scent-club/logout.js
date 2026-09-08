import{clearCookie,cookie,db,hash,json}from"./_shared.js";
export async function onRequestPost({request,env}){try{const token=cookie(request,"orivea_scent_session");if(token)await db(env).prepare("DELETE FROM scent_club_sessions WHERE token_hash=?").bind(await hash(token)).run()}catch(error){console.error("Scent Club logout failed:",error)}return json({ok:true},200,{"Set-Cookie":clearCookie()})}
