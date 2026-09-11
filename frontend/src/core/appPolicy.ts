export type AppPolicy = { multiview_max: number; provider_limits: Record<string,number>; update: { version_code:number; message:string; url:string } };
const DEFAULT: AppPolicy = {multiview_max:4,provider_limits:{},update:{version_code:0,message:"",url:""}};
let current=DEFAULT;
const listeners=new Set<()=>void>();
export const getAppPolicy=()=>current;
export function subscribeAppPolicy(listener:()=>void) { listeners.add(listener); return ()=>{listeners.delete(listener);}; }
export function configureAppPolicy(raw?: Partial<AppPolicy> | null) {
  const cap=raw?.multiview_max;
  const limits: Record<string,number>={};
  for(const id of ["primary","secondary","tertiary","quaternary"]) {
    const n=raw?.provider_limits?.[id];
    if(typeof n==="number"&&Number.isInteger(n)&&n>0&&n<=4) limits[`charm-${id}`]=n;
  }
  const update=raw?.update;
  let validUrl=false;
  try { const url=new URL(update?.url||""); validUrl=url.protocol==="https:"&&!url.username&&!url.password&&!url.hash; } catch {}
  current={multiview_max:raw==null?4:typeof cap==="number"&&Number.isInteger(cap)?Math.max(0,Math.min(4,cap)):0,provider_limits:limits,
    update:validUrl&&update&&Number.isInteger(update.version_code)&&typeof update.message==="string"?{version_code:update.version_code,message:update.message.slice(0,500),url:update.url}:DEFAULT.update};
  listeners.forEach(fn=>fn());
}
