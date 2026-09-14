import {ACCOUNT_API_BASE_URL} from './accountApi';
import {storage} from '@/src/utils/storage';

export type AccountChallenge={token:string;code:string;expires_at:number;bot_username:string;telegram_url:string};
export type ChallengeStatus='waiting'|'approved'|'denied'|'consumed'|'canceled';
export async function securityRequest<T>(path:string,body?:Record<string,unknown>,authenticated=false):Promise<T>{
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const token=authenticated?await storage.secureGet<string|null>('charm_account_session_token_v1',null):null;
  if(authenticated&&!token)throw new Error('Sign in again to continue.');
  const response=await fetch(ACCOUNT_API_BASE_URL+path,{method:body?'POST':'GET',headers:{Accept:'application/json','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
  const result=await response.json();
  if(!response.ok||!result.success)throw new Error(result.error||'The account service could not complete this request.');
  return result as T;
 }catch(error){if(controller.signal.aborted)throw new Error('The account service took too long to respond. Try again.');throw error;}
 finally{clearTimeout(timeout);}
}
