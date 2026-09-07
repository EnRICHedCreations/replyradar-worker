import { db, transaction } from "./db";
import { decrypt, discordURL } from "./security";
export class DeliveryError extends Error {
  constructor(public code: string, public retryable: boolean, public uncertain = false, public retryAfter = 30) { super(code); }
}
export async function sendNotification(type: string, secret: string, text: string, id: string) {
  let url: string, headers: Record<string,string> = { "Content-Type":"application/json" }, body: unknown;
  if (type === "discord") { url = discordURL(secret); body = { content:text.slice(0,1900), allowed_mentions:{parse:[]} }; }
  else if (type === "telegram") {
    if (!process.env.TELEGRAM_BOT_TOKEN) throw new DeliveryError("TELEGRAM_NOT_CONFIGURED",false);
    url=`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`; body={chat_id:secret,text:text.slice(0,4000),disable_web_page_preview:true};
  } else {
    if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM)throw new DeliveryError("EMAIL_NOT_CONFIGURED",false);
    url="https://api.resend.com/emails"; headers={...headers,Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Idempotency-Key":id}; body={from:process.env.EMAIL_FROM,to:[secret],subject:"ReplyRadar · A conversation worth joining",text};
  }
  let res:Response; try{res=await fetch(url,{method:"POST",headers,body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(15000)});}catch{throw new DeliveryError("DELIVERY_OUTCOME_UNKNOWN",false,true);}
  if(!res.ok)throw new DeliveryError(`DELIVERY_HTTP_${res.status}`,res.status===429,false,Math.max(30,Number(res.headers.get("retry-after")||30)));
  if(type==="telegram"){const data=await res.json();if(!data.ok)throw new DeliveryError("TELEGRAM_REJECTED",false);}
}
export async function deliverNext(){
  const d=await transaction(async(c)=>{const row=(await c.query(`select d.* from notification_deliveries d where d.status='queued' and d.next_attempt_at<=now() order by d.next_attempt_at for update skip locked limit 1`)).rows[0];if(!row)return null;await c.query("update notification_deliveries set status='sending',attempt_count=attempt_count+1,next_attempt_at=now() where id=$1",[row.id]);return row;});
  if(!d)return false;
  try{
    const i=(await db().query("select * from integrations where id=$1 and user_id=$2 and enabled",[d.integration_id,d.user_id])).rows[0];
    if(!i){await db().query("update notification_deliveries set status='cancelled',last_error='Integration disconnected' where id=$1",[d.id]);return true;}
    const match=d.match_id?(await db().query("select m.score,m.intent,p.username,p.text,p.url,r.name from matches m join posts p on p.id=m.post_id join radars r on r.id=m.radar_id where m.id=$1 and m.user_id=$2",[d.match_id,d.user_id])).rows[0]:null;
    if(d.match_id&&!match)throw new DeliveryError("MATCH_UNAVAILABLE",false);
    const text=match?`${match.score}/100 · ${match.intent.replaceAll("_"," ")}\n\n@${match.username}\n${match.text}\n\nMatched: ${match.name}\n${match.url}`:"ReplyRadar test notification. Your integration is connected.";
    await sendNotification(i.type,decrypt(i.encrypted_credentials),text,d.id);
    await transaction(async(c)=>{await c.query("update notification_deliveries set status='sent',sent_at=now(),last_error=null where id=$1",[d.id]);await c.query("update integrations set last_success_at=now(),last_error=null where id=$1",[i.id]);await c.query("insert into usage_events(user_id,type) values($1,'notification_sent')",[d.user_id]);});
    console.log(JSON.stringify({delivery_id:d.id,integration_type:i.type,status:"sent"}));
  }catch(error){const e=error instanceof DeliveryError?error:new DeliveryError("DELIVERY_FAILED",false);const retry=e.retryable&&d.attempt_count<4;await db().query("update notification_deliveries set status=$2,last_error=$3,next_attempt_at=now()+make_interval(secs=>$4) where id=$1",[d.id,e.uncertain?"uncertain":retry?"queued":"failed",e.code,Math.max(e.retryAfter,30*2**d.attempt_count)]);await db().query("update integrations set last_error=$2 where id=$1",[d.integration_id,e.code]);console.log(JSON.stringify({delivery_id:d.id,status:"failed",code:e.code}));}
  return true;
}
