export const EXPIRED_RETENTION_SECONDS=30*86400;
export function expiredViewer(user,at=Math.floor(Date.now()/1000)){
 return user.role==='user'&&(user.status==='expired'||user.expires_at!==null&&Number(user.expires_at)<=at);
}
export function deletionDue(user,at=Math.floor(Date.now()/1000)){
 return expiredViewer(user,at)&&user.expires_at!==null&&Number(user.expires_at)+EXPIRED_RETENTION_SECONDS<=at;
}
// expires_at is the original expiration anchor, never the last cleanup/login time.
export async function retainExpiredViewer(env,id,at=Math.floor(Date.now()/1000)){
 await env.DB.batch([
  env.DB.prepare("UPDATE users SET status='expired',expires_at=CASE WHEN expires_at IS NULL OR expires_at>?2 THEN ?2 ELSE expires_at END WHERE id=?1 AND role='user' AND (status='expired' OR expires_at<=?2)").bind(id,at),
  env.DB.prepare("UPDATE sessions SET revoked=1 WHERE user_id=?1 AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND role='user' AND status='expired' AND expires_at<=?2)").bind(id,at)
 ]);
}
