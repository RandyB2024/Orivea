import { ensureCommerceSchema, json, queueEvent } from "../paypal/_commerce.js";
import { payLaterConfig } from "./_shared.js";

export async function onRequestPost({ request, env }) {
  const token=request.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
  if(!env.CONTENT_STUDIO_SYNC_SECRET||token!==env.CONTENT_STUDIO_SYNC_SECRET)return json({error:"Niet geautoriseerd."},401);
  if(!env.SCENT_CLUB_DB)return json({error:"Commerce database ontbreekt."},503);
  await ensureCommerceSchema(env.SCENT_CLUB_DB);
  const body=await request.json(); const orderNumber=String(body.orderNumber||""); const action=String(body.action||"");
  const row=await env.SCENT_CLUB_DB.prepare("SELECT c.payload,p.* FROM commerce_orders c JOIN pay_later_orders p ON p.order_number=c.order_number WHERE c.order_number=?").bind(orderNumber).first();
  if(!row)return json({error:"Order niet gevonden."},404);
  const now=new Date(); const iso=now.toISOString(); const config=payLaterConfig(env); let status=row.pay_later_status; let payment=row.payment_status; let orderStatus=row.order_status; let due=row.due_date;
  if(action==="approve"){status="approved";orderStatus="approved";}
  else if(action==="reject"){status="rejected";payment="cancelled";orderStatus="cancelled";}
  else if(action==="ship"){if(!["approved","shipped"].includes(status))return json({error:"Keur de order eerst goed."},409);status="shipped";orderStatus="shipped";due=new Date(now.getTime()+config.days*86400000).toISOString();}
  else if(action==="paid"){status="paid";payment="paid";orderStatus="paid";}
  else if(action!=="remind")return json({error:"Onbekende actie."},400);
  const payload={...JSON.parse(row.payload),payment_status:payment,order_status:orderStatus,pay_later_status:status,pay_later_due_date:due,pay_later_approved_at:action==="approve"?iso:row.approved_at,pay_later_shipped_at:action==="ship"?iso:row.shipped_at,pay_later_paid_at:action==="paid"?iso:row.paid_at,pay_later_reminder_count:Number(row.reminder_count||0)+(action==="remind"?1:0),pay_later_last_reminder_at:action==="remind"?iso:row.last_reminder_at};
  await env.SCENT_CLUB_DB.batch([
    env.SCENT_CLUB_DB.prepare("UPDATE commerce_orders SET payload=?,payment_status=?,order_status=?,updated_at=? WHERE order_number=?").bind(JSON.stringify(payload),payment,orderStatus,iso,orderNumber),
    env.SCENT_CLUB_DB.prepare("UPDATE pay_later_orders SET payment_status=?,order_status=?,pay_later_status=?,due_date=?,approved_at=?,shipped_at=?,paid_at=?,reminder_count=?,last_reminder_at=?,updated_at=? WHERE order_number=?").bind(payment,orderStatus,status,due,payload.pay_later_approved_at||null,payload.pay_later_shipped_at||null,payload.pay_later_paid_at||null,payload.pay_later_reminder_count,payload.pay_later_last_reminder_at||null,iso,orderNumber)
  ]);
  await queueEvent(env.SCENT_CLUB_DB,`pay_later_${action}`,orderNumber,payload);
  return json({ok:true,order:payload});
}
