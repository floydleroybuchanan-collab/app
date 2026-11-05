import type { Channel } from "../api";

export type XtreamLogin = { server: string; username: string; password: string; output: "ts" | "m3u8" };
export type XtreamAccount = { status: string; expires: number | null; activeConnections: number; maxConnections: number; trial: boolean; timeZone?: string };
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
export function xtreamEndpoint(login: XtreamLogin, file: string, action?: string, params: Record<string, string> = {}) {
  const url = new URL(login.server + "/" + file);
  url.searchParams.set("username", login.username); url.searchParams.set("password", login.password);
  if (action) url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
async function json(login: XtreamLogin, action?: string, params: Record<string, string> = {}): Promise<any> {
  const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 30_000);
  try {
    const response = await fetch(xtreamEndpoint(login, "player_api.php", action, params), { signal: abort.signal, redirect: "error" });
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
    maxConnections: Number(user.max_connections) || 0, trial: String(user.is_trial) === "1", ...(payload?.server_info?.timezone ? { timeZone: String(payload.server_info.timezone) } : {}) };
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
    return { id: "xc-" + id, source_channel_id: "xc-" + id, xtream_stream_id: id, archive_days: Math.max(0, Number(s.tv_archive_duration) || 0), tvg_id: String(s.epg_channel_id || ""),
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
  return Object.assign(channels, { account, epgUrls: [xtreamEndpoint(login, "xmltv.php")] });
}

// Protocol/fields recovered from supplied clone InterfaceC2867, *JsonAdapter;
// playback paths C3860:264, C1847:77 and C7027:1248. No external provider SDK.
export type XtreamTitle = { id: string; kind: "movie" | "series"; name: string; image: string; categoryId: string; category: string; rating: string; added: number };
export type XtreamEpisode = { id: string; title: string; season: string; extension: string; image: string; released: string };
export type XtreamDetails = { plot: string; genre: string; cast: string; director: string; released: string; durationSeconds: number; trailer: string; extension: string; episodes: XtreamEpisode[] };
function text(value: unknown): string { return value == null ? "" : String(value).slice(0, 20_000); }
function numericId(value: unknown): string { const id = text(value); if (!/^\d+$/.test(id)) throw new Error("Provider returned an invalid media ID."); return id; }
function image(value: unknown): string { const url = text(value); return /^https?:\/\//i.test(url) ? url : ""; }
function extension(value: unknown): string { const ext = text(value).trim(); if (ext && !/^[a-zA-Z0-9]{1,12}$/.test(ext)) throw new Error("Provider returned an invalid media format."); return ext; }
export function mapXtreamTitles(kind: "movie" | "series", rows: unknown, categories: unknown): XtreamTitle[] {
  if (!Array.isArray(rows) || !Array.isArray(categories) || rows.length > 50_000) throw new Error("Provider returned an invalid media catalog.");
  const groups = new Map(categories.map(row => [text(row.category_id), text(row.category_name)]));
  const seen = new Set<string>();
  return rows.map(row => {
    const id = numericId(kind === "movie" ? row.stream_id : row.series_id);
    if (seen.has(id)) throw new Error("Provider returned duplicate media IDs."); seen.add(id);
    return { id, kind, name: text(row.name), image: image(kind === "movie" ? row.stream_icon : row.cover),
      categoryId: text(row.category_id), category: groups.get(text(row.category_id)) || "Other", rating: text(row.rating), added: Number(kind === "movie" ? row.added : row.last_modified) || 0 };
  });
}
export function mapXtreamDetails(payload: any, kind: "movie" | "series"): XtreamDetails {
  if (!payload || typeof payload !== "object") throw new Error("Provider returned invalid title details.");
  const info = payload.info || {};
  const episodes: XtreamEpisode[] = [];
  if (kind === "series") {
    if (!payload.episodes || typeof payload.episodes !== "object") throw new Error("Provider returned invalid series episodes.");
    for (const [season, rows] of Object.entries(payload.episodes)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (episodes.length >= 20_000) throw new Error("Provider returned too many episodes.");
        const episodeInfo = Array.isArray(row.info) ? row.info[0] || {} : row.info || {};
        episodes.push({ id: numericId(row.id), title: text(row.title), season: text(row.season || season), extension: extension(row.container_extension), image: image(episodeInfo.movie_image), released: text(episodeInfo.releasedate) });
      }
    }
  }
  return { plot: text(info.plot || info.description), genre: text(info.genre), cast: text(info.cast), director: text(info.director),
    released: text(kind === "movie" ? info.releasedate : info.releaseDate), durationSeconds: Math.max(0, Number(info.duration_secs) || 0),
    trailer: text(info.youtube_trailer), extension: kind === "movie" ? extension(payload.movie_data?.container_extension) : "", episodes };
}
export async function loadXtreamCatalog(raw: XtreamLogin, kind: "movie" | "series"): Promise<XtreamTitle[]> {
  const login = normalizeXtream(raw);
  accountInfo(await json(login));
  const prefix = kind === "movie" ? "vod" : "series";
  const categories = await json(login, `get_${prefix}_categories`);
  const rows = await json(login, kind === "movie" ? "get_vod_streams" : "get_series");
  return mapXtreamTitles(kind, rows, categories);
}
export async function loadXtreamDetails(raw: XtreamLogin, kind: "movie" | "series", id: string): Promise<XtreamDetails> {
  const login = normalizeXtream(raw), key = kind === "movie" ? "vod_id" : "series_id";
  return mapXtreamDetails(await json(login, kind === "movie" ? "get_vod_info" : "get_series_info", { [key]: numericId(id) }), kind);
}
export function xtreamMediaUrl(raw: XtreamLogin, kind: "movie" | "series", id: string, format: string): string {
  const login = normalizeXtream(raw), ext = extension(format);
  return `${login.server}/${kind}/${encodeURIComponent(login.username)}/${encodeURIComponent(login.password)}/${numericId(id)}${ext ? "." + ext : ""}`;
}
export function xtreamCatchupUrl(raw: XtreamLogin, streamId: string, startMs: number, endMs: number, timeZone?: string, offsetSeconds = 0): string {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error("This programme has no valid replay interval.");
  const login = normalizeXtream(raw);
  const date = new Date(startMs + offsetSeconds * 1000);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const start = `${parts.year}-${parts.month}-${parts.day}:${parts.hour}-${parts.minute}`;
  const minutes = Math.max(1, Math.round((endMs - startMs) / 60_000));
  return `${login.server}/timeshift/${encodeURIComponent(login.username)}/${encodeURIComponent(login.password)}/${minutes}/${start}/${numericId(streamId)}.${login.output}`;
}
