import type { Channel, Program } from "../api";

/** Protocol provenance: supplied clone C6936 / InterfaceC5302 and Stalker$Params.
 * Profile's damaged Java recovered from same APK, REA ev_9229e9dfae3630765ee5477bf01887cdf9ace4a0c8ec93863d2581bb461d06e5.
 * Bounded requests, cancellation and limits below are MediaLab integration safeguards.
 */
export type StalkerLogin = { server: string; mac: string; username?: string; password?: string; serial?: string; deviceId?: string; deviceId2?: string; timezone?: string };
export const STALKER_USER_AGENT = "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";
const PREFIX = "stalker-v1:";
const SAFE_ERROR = "Could not contact the Stalker portal. Check the portal address and provider-authorized device details. Previous channels and guide are unchanged.";
type Json = Record<string, any>;
export function normalizeStalker(raw: StalkerLogin): StalkerLogin {
  let url: URL;
  try { url = new URL(raw.server.trim()); } catch { throw new Error("Enter the complete Stalker portal address."); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Use a complete HTTP or HTTPS portal address without a query or login.");
  const mac = raw.mac.trim().toUpperCase();
  if (!/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) throw new Error("Enter the MAC address authorized by your provider (six pairs separated by colons).");
  for (const field of [raw.serial, raw.deviceId, raw.deviceId2, raw.username, raw.password, raw.timezone]) if (field && (field.length > 512 || /[\r\n;]/.test(field))) throw new Error("Invalid portal device details.");
  return { ...raw, server: url.toString().replace(/\/+$/, ""), mac, timezone: raw.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
}
export function encodeStalker(raw: StalkerLogin): string { return PREFIX + JSON.stringify(normalizeStalker(raw)); }
export function decodeStalker(value: string): StalkerLogin | null {
  if (!value.startsWith(PREFIX)) return null;
  try { return normalizeStalker(JSON.parse(value.slice(PREFIX.length))); } catch { throw new Error("Saved Stalker details could not be read. Edit this portal."); }
}
/** Stalker$Params constructor's default load.php routing. Explicit portal.php/load.php is retained. */
export function stalkerEndpoint(login: StalkerLogin): string {
  const url = new URL(login.server);
  if (/\/(?:load|engine|portal|portalott|portalis)\.php$/i.test(url.pathname)) return url.toString();
  url.pathname = /\/portal\//i.test(url.pathname + "/") ? "/portal/server/load.php" : /\/c\/?$/i.test(url.pathname) ? "/server/load.php" : "/stalker_portal/server/load.php";
  return url.toString();
}
class PortalAuthError extends Error {}
function aborted(signal?: AbortSignal) { if (signal?.aborted) throw new Error("Portal operation cancelled."); }
export function createStalkerClient(raw: StalkerLogin, fetcher: typeof fetch = fetch, lifetimeSignal?: AbortSignal) {
  const login = normalizeStalker(raw);
  const cookie = `mac=${login.mac}; timezone=${login.timezone}`;
  let token = "", hash = "", pending: Promise<void> | null = null;
  async function request(type: string, action: string, params: Record<string, string | number> = {}, signal: AbortSignal | undefined = lifetimeSignal, authenticated = true): Promise<any> {
    aborted(signal);
    const url = new URL(stalkerEndpoint(login));
    for (const [key, value] of Object.entries({ type, action, ...params })) url.searchParams.set(key, String(value));
    const controller = new AbortController(); const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 30_000);
    try {
      const response = await fetcher(url.toString(), { signal: controller.signal, redirect: "error", headers: {
        Cookie: cookie, "User-Agent": STALKER_USER_AGENT, "X-User-Agent": "Model: MAG270; Link: WiFi",
        ...(authenticated && token ? { Authorization: "Bearer " + token } : {}), ...(authenticated && hash ? { "X-Auth-Hash": hash } : {}),
      } });
      if (response.status === 401 || response.status === 403) throw new PortalAuthError("Portal authentication expired.");
      if (!response.ok || Number(response.headers.get("content-length")) > 32 * 1024 * 1024) throw new Error(SAFE_ERROR);
      const body = await response.text(); aborted(signal);
      if (body.length > 32 * 1024 * 1024) throw new Error(SAFE_ERROR);
      const payload = JSON.parse(body);
      if (!payload || !("js" in payload)) throw new Error(SAFE_ERROR);
      return payload.js;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
  }
  async function authenticate() {
    token = ""; hash = "";
    const handshake = await request("stb", "handshake", { token: "", prehash: "13f0848280789b506aeb024ec95eb65cc07b6ce7" }, undefined, false);
    if (!handshake?.token || typeof handshake.token !== "string") throw new PortalAuthError("The portal rejected this device.");
    token = handshake.token; hash = typeof handshake.hash === "string" ? handshake.hash : "";
    // Same clone MAG270 profile, supplied device IDs only; never manufacture an identity.
    const profileParams = { ver: "ImageDescription: 0.2.18-r22-pub-270; ImageDate: Tue Dec 19 11:33:53 EET 2017; PORTAL version: 5.6.1; API Version: JS API version: 328; STB API version: 134; Player Engine version: 0x566", sn: login.serial || "", stb_type: "MAG270", client_type: "STB", image_version: "0.2.18", device_id: login.deviceId || "", device_id2: login.deviceId2 || login.deviceId || "", auth_second_step: 1, hw_version: "1.7-BD-00", not_valid_token: 0, metrics: JSON.stringify({ mac: login.mac, sn: login.serial || "", model: "MAG270", type: "STB", uid: login.deviceId || "", random: handshake.random || "" }), hw_version_2: "ecf87650406bba50b0801a4347093864b89b38e6", timestamp: Math.floor(Date.now() / 1000), api_signature: 262, prehash: "efd15c16dc497e0839ff5accfdc6ed99c32c4e2a" };
    const profile = await request("stb", "get_profile", profileParams);
    if (profile?.block_msg || (profile?.msg && Number(profile.status) !== 2)) throw new PortalAuthError("The portal rejected this device. Check with your provider.");
    if (Number(profile?.status) === 1) await request("stb", "get_profile", { sn: login.serial || "", auth_second_step: 1 });
    if (login.username) {
      const auth = await request("stb", "do_auth", { login: login.username, password: login.password || "" });
      if (auth === false || auth === 0 || auth?.status === false) throw new PortalAuthError("The portal rejected this login.");
    }
  }
  async function ensure() {
    if (token) return;
    if (!pending) pending = authenticate().catch((error) => { token = ""; hash = ""; throw error; }).finally(() => { pending = null; });
    await pending;
  }
  async function call(type: string, action: string, params: Record<string, string | number> = {}, signal: AbortSignal | undefined = lifetimeSignal): Promise<any> {
    try {
      aborted(signal);
      await ensure(); aborted(signal);
      try { return await request(type, action, params, signal); }
      catch (error) { if (!(error instanceof PortalAuthError)) throw error; token = ""; await ensure(); aborted(signal); return await request(type, action, params, signal); }
    } catch (error) { if (signal?.aborted) throw new Error("Portal operation cancelled."); if (error instanceof PortalAuthError) throw error; throw new Error(SAFE_ERROR); }
  }
  async function channels(signal?: AbortSignal): Promise<Channel[]> {
    const genres = await call("itv", "get_genres", {}, signal);
    const groups = new Map((Array.isArray(genres) ? genres : []).map((row: Json) => [String(row.id), String(row.title || "Other")]));
    let payload: any;
    try { payload = await call("itv", "get_all_channels", {}, signal); } catch { aborted(signal); payload = null; }
    let rows: Json[] = Array.isArray(payload?.data) ? payload.data : [];
    if (!rows.length) {
      rows = []; const seen = new Set<string>();
      for (let page = 1; page <= 1000; page++) {
        const result = await call("itv", "get_ordered_list", { genre: "*", p: page }, signal);
        if (!Array.isArray(result?.data)) throw new Error(SAFE_ERROR);
        let added = 0;
        for (const row of result.data) { const id = String(row.id); if (!seen.has(id)) { rows.push(row); seen.add(id); added++; } }
        const total = Number(result.total_items);
        if (rows.length > 25_000) throw new Error("Playlist exceeds the 25,000 channel import limit.");
        if (!result.data.length || (Number.isFinite(total) && total >= 0 && rows.length >= total)) break;
        if (!added || page === 1000) throw new Error("Portal channel paging did not complete. Previous channels kept.");
      }
    }
    if (rows.length > 25_000) throw new Error("Playlist exceeds the 25,000 channel import limit.");
    const ids = new Set<string>();
    return rows.map((row) => {
      const id = String(row.id);
      if (!/^\d+$/.test(id) || ids.has(id) || typeof row.cmd !== "string" || !row.cmd.trim()) throw new Error("Playlist contains invalid portal channels.");
      ids.add(id);
      const archiveDays = Number(row.enable_tv_archive) === 1 ? Math.max(0, Number(row.tv_archive_duration) || 0) : 0;
      return { id: "st-" + id, source_channel_id: "st-" + id, stalker_id: id, stalker_cmd: row.cmd, archive_days: archiveDays, name: String(row.name || "Channel " + id), tvg_id: id, raw_tvg_id: id, logo: /^https?:\/\//i.test(String(row.logo)) ? row.logo : "", group: groups.get(String(row.tv_genre_id)) || "Other", url: "stalker://channel/" + id, stream_type: "auto" };
    });
  }
  async function resolve(command: string, signal?: AbortSignal) {
    const link = await call("itv", "create_link", { cmd: command, force_ch_link_check: 0 }, signal);
    const uri = String(link?.cmd || "").replace(/^ffmpeg\s+/i, "").trim();
    if (!/^https?:\/\/\S+$/i.test(uri)) throw new Error("The portal did not supply a supported playback address.");
    return { uri, headers: { "User-Agent": STALKER_USER_AGENT } };
  }
  async function guide(signal?: AbortSignal): Promise<Record<string, Program[]>> {
    for (const period of [72, 24, 8, 4]) {
      try { const payload = await call("itv", "get_epg_info", { period }, signal); return normalizeStalkerGuide(payload); }
      catch (error) { aborted(signal); if (error instanceof PortalAuthError || period === 4) throw error; }
    }
    return {};
  }
  return { channels, resolve, guide, call };
}
/** Clone EpgInfoResponseJs.data = List<Map<String,List<Program>>>; epoch seconds are UTC. */
export function normalizeStalkerGuide(payload: any): Record<string, Program[]> {
  if (!Array.isArray(payload?.data)) throw new Error("Portal returned an invalid guide.");
  const output: Record<string, Program[]> = {}; let count = 0;
  for (const map of payload.data) for (const [id, entries] of Object.entries(map as Json)) {
    if (!/^\d+$/.test(id) || !Array.isArray(entries)) continue;
    for (const row of entries) {
      const start = Number(row.start_timestamp), stop = Number(row.stop_timestamp);
      if (!Number.isFinite(start) || !Number.isFinite(stop) || start <= 0 || stop <= start || stop - start > 86400 || !row.name) continue;
      if (++count > 200_000) throw new Error("Portal guide exceeds the import limit. Previous guide kept.");
      (output[id] ||= []).push({ title: String(row.name).slice(0, 2000), desc: String(row.descr || "").slice(0, 16000), category: "", start: new Date(start * 1000).toISOString(), stop: new Date(stop * 1000).toISOString() });
    }
  }
  for (const id of Object.keys(output)) output[id].sort((a, b) => a.start.localeCompare(b.start));
  if (!count) throw new Error("Portal returned no valid guide programmes. Previous guide kept.");
  return output;
}
export async function previewStalker(login: StalkerLogin) {
  const rows = await createStalkerClient(login).channels();
  if (!rows.length) throw new Error("No playable portal channels found. Previous channels kept.");
  return Object.assign(rows, { epgUrls: [] as string[] });
}
