/** Export only known numeric measurements. Never serialize arbitrary diagnostic strings. */
export function supportReport(version:string,versionCode:number,raw:string):string {
 let rows: unknown=[];try {if(raw.length<=200000)rows=JSON.parse(raw);}catch{}
 const keys=['atMs','bufferMs','width','height','droppedVideo','heapMiB','errorCode'];
 const playback=Array.isArray(rows)?rows.slice(-20).map(row=>Object.fromEntries(keys.flatMap(key=>typeof row?.[key]==='number'&&Number.isFinite(row[key])?[[key,row[key]]]:[]))):[];
 return JSON.stringify({app:'CharmIPTV',version:version.replace(/[^a-zA-Z0-9._-]/g,'').slice(0,64),versionCode,createdAt:new Date().toISOString(),playback},null,2);
}
