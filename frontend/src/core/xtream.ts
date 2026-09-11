import type { Channel } from "../api";

export type XtreamLogin = { server: string; username: string; password: string; output: "ts" | "m3u8" };
export type XtreamAccount = { status: string; expires: number | null; activeConnections: number; maxConnections: number; trial: boolean };
export type XtreamPreview = Channel[] & { epgUrls: string[]; account: XtreamAccount };
const PREFIX = "xtream-v1:";

export function normalizeXtream(login: XtreamLogin): XtreamLogin {
  let server: URL;
  try { server = new URL(login.server.trim()); } catch { throw new Error("Enter the complete provider server address, including http:// or https:// and any port."); }
  if (!["http:", "https:"].includes(server.protocol) || server.username || server.password || server.search || server.hash)
    throw new Error("Use the server address only; enter your username and password in their own fields.");
  if (!login.username.trim() || !login.password) throw new Error("Enter your provider username and password.");
  return { server: server.toString().replace(/\/+$/, ""), username: login.username.trim(), password: login.password,
    output: login.output === "m3u8" ? "m3u8" : "ts" };
}
export function encodeXtream(login: XtreamLogin): string { return PREFIX + JSON.stringify(normalizeXtream(login)); }
export function decodeXtream(value: string): XtreamLogin | null {
  if (!value.startsWith(PREFIX)) return null;
  try { return normalizeXtream(JSON.parse(value.slice(PREFIX.length))); }
  catch { throw new Error("Saved Xtream account could not be read. Edit its login details."); }
}
function endpoint(login: XtreamLogin, file: string, action?: string) {
  const url = new URL(login.server + "/" + file);
  url.searchParams.set("username", login.username); url.searchParams.set("password", login.password);
  if (action) url.searchParams.set("action", action);
  return url.toString();
}
async function json(login: XtreamLogin, action?: string): Promise<any> {
  const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 30_000);
  try {
    const response = await fetch(endpoint(login, "player_api.php", action), { signal: abort.signal, redirect: "error" });
    if (!response.ok) throw new Error("Provider request failed.");
    const length = Number(response.headers.get("content-length"));
    if (length > 32 * 1024 * 1024) throw new Error("Provider catalog is too large.");
    const body = await response.text();
    if (body.length > 32 * 1024 * 1024) throw new Error("Provider catalog is too large.");
    return JSON.parse(body);
  } catch {
    throw new Error("Could not contact the Xtream provider. Check the server, login and connection. Existing channels are unchanged.");
  } finally { clearTimeout(timer); }
}
export function accountInfo(payload: any): XtreamAccount {
  const user = payload?.user_info;
  if (String(user?.auth) !== "1") throw new Error("The provider rejected this username or password.");
  const status = String(user.status || "Unknown");
  if (status.toLowerCase() !== "active") throw new Error("Your provider account is " + (["expired","banned","disabled"].includes(status.toLowerCase()) ? status.toLowerCase() : "not active") + ".");
  const expiry = Number(user.exp_date);
  if (Number.isFinite(expiry) && expiry > 0 && expiry * 1000 < Date.now()) throw new Error("Your provider account has expired.");
  return { status, expires: expiry > 0 ? expiry * 1000 : null, activeConnections: Number(user.active_cons) || 0,
    maxConnections: Number(user.max_connections) || 0, trial: String(user.is_trial) === "1" };
}
export function mapXtreamChannels(login: XtreamLogin, streams: any, categories: any): Channel[] {
  if (!Array.isArray(streams) || !Array.isArray(categories)) throw new Error("Provider returned an invalid catalog.");
  if (streams.length > 25_000) throw new Error("Playlist exceeds the 25,000 channel import limit.");
  const groups = new Map(categories.map((c: any) => [String(c.category_id), String(c.category_name || "Other")]));
  const ids = new Set<string>();
  return streams.map((s: any) => {
    const id = String(s.stream_id);
    if (!/^\d+$/.test(id) || ids.has(id)) throw new Error("Playlist contains invalid or duplicate stream IDs.");
    ids.add(id);
    const url = login.server + "/live/" + encodeURIComponent(login.username) + "/" + encodeURIComponent(login.password) + "/" + id + "." + login.output;
    return { id: "xc-" + id, source_channel_id: "xc-" + id, tvg_id: String(s.epg_channel_id || ""),
      raw_tvg_id: String(s.epg_channel_id || ""), name: String(s.name || "Channel " + id).slice(0, 250),
      logo: /^https?:\/\//i.test(String(s.stream_icon)) ? String(s.stream_icon) : "",
      group: groups.get(String(s.category_id)) || "Other", url, stream_type: login.output === "m3u8" ? "hls" : "ts" };
  });
}
export async function previewXtream(raw: XtreamLogin): Promise<XtreamPreview> {
  const login = normalizeXtream(raw);
  const account = accountInfo(await json(login));
  const categories = await json(login, "get_live_categories");
  const streams = await json(login, "get_live_streams");
  const channels = mapXtreamChannels(login, streams, categories);
  if (!channels.length) throw new Error("No playable live channels are available for this account.");
  return Object.assign(channels, { account, epgUrls: [endpoint(login, "xmltv.php")] });
}
