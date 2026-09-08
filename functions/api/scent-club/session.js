import{json,loadSession,view}from"./_shared.js";
export async function onRequestGet({request,env}){try{const session=await loadSession(request,env);return session?json({member:view(session,env),csrf_token:session.csrf_token}):json({error:"Sessie verlopen."},401)}catch(error){console.error("Scent Club session failed:",error);return json({error:"Sessie kon niet worden geladen."},503)}}
