import type { Channel, Program } from "../api";
import type { XtreamDetails, XtreamEpisode, XtreamTitle } from "./xtream";
import { createStalkerClient, normalizeStalker, STALKER_USER_AGENT, type StalkerLogin } from "./stalker";

type Kind = "movie" | "series";
type PortalRow = Record<string, unknown>;
type Client = ReturnType<typeof createStalkerClient>;
function mediaClient(login: StalkerLogin, signal?: AbortSignal): Client {
  return createStalkerClient(login, undefined, signal);
}
type Episode = XtreamEpisode & { command?: string; seriesNumber?: number };
type CatalogRow = { row: PortalRow; type: "vod" | "series"; title: XtreamTitle };
type Details = Omit<XtreamDetails, "episodes"> & { command?: string; episodes: Episode[] };
const catalogs = new WeakMap<StalkerLogin, Map<Kind, CatalogRow[]>>();
const text = (value: unknown) => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const idOf = (value: unknown) => /^[A-Za-z0-9_-]{1,64}$/.test(text(value)) ? text(value) : "";
const imageOf = (value: unknown) => /^https?:\/\/\S+$/i.test(text(value)) ? text(value) : "";

/** Clone InterfaceC5302 m2218/m10382/m10385 pagination and returned total_items. */
async function pages(client: Client, type: string, action: string, params: Record<string, string | number>): Promise<PortalRow[]> {
  const rows: PortalRow[] = [];
  const seen = new Set<string>();
  for (let p = 1; p <= 500; p++) {
    const reply = await client.call(type, action, { ...params, p });
    if (!Array.isArray(reply?.data)) throw new Error("Portal returned an invalid media page.");
    let added = 0;
    for (const row of reply.data) {
      if (!row || typeof row !== "object") continue;
      const key = JSON.stringify([row.id, row.series_number, row.season_number]);
      if (seen.has(key)) continue;
      seen.add(key); rows.push(row); added++;
    }
    if (rows.length > 25_000) throw new Error("Portal media exceeds the catalog limit.");
    const total = Number(reply.total_items);
    if (!reply.data.length || (Number.isFinite(total) && total >= 0 && rows.length >= total)) return rows;
    if (!added) throw new Error("Portal media paging did not complete.");
  }
  throw new Error("Portal media exceeds the paging limit.");
}

/** Clone C6936 m13368/m13357. Series-capable portals may expose titles under series or under vod. */
async function catalog(login: StalkerLogin, kind: Kind, client: Client): Promise<CatalogRow[]> {
  const cached = catalogs.get(login)?.get(kind);
  if (cached) return cached;
  let result: CatalogRow[] = [];
  for (const type of (kind === "series" ? ["series", "vod"] : ["vod"]) as ("series" | "vod")[]) {
    try {
      const categories = await client.call(type, "get_categories");
      const labels = new Map<string, string>((Array.isArray(categories) ? categories : []).map(row => [text(row?.id), text(row?.title)]));
      const rows = await pages(client, type, "get_ordered_list", { category: 0, genre: 0, sortby: "name" });
      result = rows.flatMap(row => {
        const id = idOf(row.id), name = text(row.name).trim();
        const series = type === "series" || ["1", "true"].includes(text(row.is_series).toLowerCase()) || (Array.isArray(row.series) && row.series.length > 0);
        if (!id || !name || series !== (kind === "series")) return [];
        const categoryId = text(row.category_id);
        return [{ row, type, title: { id, kind, name, image: imageOf(row.screenshot_uri), categoryId, category: labels.get(categoryId) || "", rating: text(row.rating_imdb) || text(row.rating_kinopoisk), added: Date.parse(text(row.added)) || 0 } }];
      });
      if (result.length || type === "vod") break;
    } catch (error) {
      if (type === "vod") throw error;
    }
  }
  let byKind = catalogs.get(login);
  if (!byKind) { byKind = new Map(); catalogs.set(login, byKind); }
  byKind.set(kind, result);
  return result;
}

export async function listStalkerCatalog(login: StalkerLogin, kind: Kind, signal?: AbortSignal): Promise<XtreamTitle[]> {
  return (await catalog(login, kind, mediaClient(login, signal))).map(item => item.title);
}

/** Clone m13381 recovered as m12185 (ev_7d7eb79ba28559c6affc486a04b8a3e7677e126aae8f31021bfa14149c2ea58f).
 * Season payloads may carry episode numbers and a shared command, or separate paginated episode IDs.
 */
async function episodesFor(client: Client, item: CatalogRow): Promise<Episode[]> {
  const movie = item.title.id;
  const seasons = await pages(client, item.type, "get_ordered_list", { movie_id: movie });
  const episodes: Episode[] = [];
  for (const season of seasons) {
    const seasonId = idOf(season.id);
    if (!seasonId) continue;
    const seasonNumber = text(season.season_number) || text(season.name) || seasonId;
    const numbers = Array.isArray(season.season_series) && season.season_series.length ? season.season_series : season.series;
    const rows = Array.isArray(numbers) && numbers.length
      ? numbers.map(number => ({ id: String(number), series_number: number }))
      : await pages(client, item.type, "get_ordered_list", { movie_id: movie, season_id: seasonId });
    for (const row of rows) {
      const episode = idOf(row.id);
      const seriesNumber = Number(row.series_number);
      if (!episode || !Number.isSafeInteger(seriesNumber) || seriesNumber < 1) continue;
      episodes.push({
        id: `${movie}.${seasonId}.${episode}.${seriesNumber}`, title: `Episode ${seriesNumber}`, season: seasonNumber,
        extension: "", image: item.title.image, released: "", command: text(season.cmd) || undefined, seriesNumber,
      });
    }
  }
  if (!episodes.length && Array.isArray(item.row.series)) {
    for (const number of item.row.series) {
      const seriesNumber = Number(number);
      if (!Number.isSafeInteger(seriesNumber) || seriesNumber < 1) continue;
      episodes.push({ id: `${movie}.0.${seriesNumber}.${seriesNumber}`, title: `Episode ${seriesNumber}`, season: "1", extension: "", image: item.title.image, released: "", command: text(item.row.cmd) || undefined, seriesNumber });
    }
  }
  return [...new Map(episodes.map(episode => [episode.id, episode])).values()];
}

export async function loadStalkerDetails(login: StalkerLogin, kind: Kind, id: string, signal?: AbortSignal): Promise<Details> {
  const client = mediaClient(login, signal);
  const item = (await catalog(login, kind, client)).find(entry => entry.title.id === id);
  if (!item) throw new Error("This portal title is unavailable.");
  const row = item.row;
  return { plot: text(row.description), genre: text(row.genres_str), cast: text(row.actors), director: text(row.director), released: text(row.year), durationSeconds: 0, trailer: "", extension: "", command: text(row.cmd) || undefined, episodes: kind === "series" ? await episodesFor(client, item) : [] };
}

function playbackLink(result: PortalRow | undefined) {
  const uri = text(result?.cmd).replace(/^(?:ffmpeg|auto)\s+/i, "").trim();
  if (!/^https?:\/\/\S+$/i.test(uri)) throw new Error("The portal did not supply a supported playback address.");
  return { uri, headers: { "User-Agent": STALKER_USER_AGENT } };
}

/** Clone C6936 m13377/m13383 create_link and m13382/m2843 file lookup. */
export async function resolveStalkerMedia(login: StalkerLogin, kind: Kind, id: string, command?: string, seriesNumber?: number) {
  const client = createStalkerClient(login);
  if (kind === "series") {
    const [movie, season, episode, series] = id.split(".");
    if (id.split(".").length !== 4 || !idOf(movie) || !idOf(season) || !idOf(episode) || !/^\d{1,8}$/.test(series || "")) throw new Error("Invalid portal episode identity.");
    const item = (await catalog(login, kind, client)).find(entry => entry.title.id === movie);
    if (!item) throw new Error("This portal series is unavailable.");
    if (!command) {
      const entry = (await episodesFor(client, item)).find(candidate => candidate.id === id);
      if (!entry) throw new Error("This portal episode is unavailable.");
      command = entry.command;
    }
    if (!command) {
      const reply = await client.call(item.type, "get_ordered_list", { movie_id: movie, season_id: season, episode_id: episode });
      const file = idOf(reply?.data?.[0]?.id);
      if (!file) throw new Error("This portal episode has no playable file.");
      command = `/media/file_${file}.mpg`;
    }
    return playbackLink(await client.call("vod", "create_link", { cmd: command, series: seriesNumber || Number(series), force_ch_link_check: 0 }));
  }
  const item = (await catalog(login, kind, client)).find(entry => entry.title.id === id);
  if (!item) throw new Error("This portal movie is unavailable.");
  if (Number(item.row.has_files) === 1) {
    const reply = await client.call(item.type, "get_ordered_list", { movie_id: id });
    const file = idOf(reply?.data?.[0]?.id);
    if (!file) throw new Error("This portal movie has no playable file.");
    command = `/media/file_${file}.mpg`;
  } else command = command || text(item.row.cmd) || `/media/${id}.mpg`;
  return playbackLink(await client.call("vod", "create_link", { cmd: command, force_ch_link_check: 0 }));
}

export function canReplayStalker(channel: Channel, program: Program, now = Date.now()): boolean {
  const start = Date.parse(program.start), end = Date.parse(program.stop || "");
  const days = channel.archive_days || 0;
  return !!channel.stalker_id && days > 0 && Number.isFinite(start) && end > start && end <= now && start >= now - days * 86_400_000;
}

/** C6936 m13354/m13350 and recovered archive lookup m12174 (ev_d6ac6cff3c53a695b38e6c4d85910ea0c99cb7f9ff43e2eebf37ed4a604c49ba). */
export async function resolveStalkerCatchup(raw: StalkerLogin, channel: Channel, program: Program) {
  if (!canReplayStalker(channel, program)) throw new Error("This programme is outside the portal archive window.");
  const login = normalizeStalker(raw), client = createStalkerClient(login);
  const start = Math.floor(Date.parse(program.start) / 1000);
  const parts = new Intl.DateTimeFormat("en", { timeZone: login.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(start * 1000));
  const date = ["year", "month", "day"].map(part => parts.find(entry => entry.type === part)?.value).join("-");
  let match: PortalRow | undefined;
  let previous = -Infinity;
  const seen = new Set<string>();
  for (let p = 1; p <= 100; p++) {
    const page = await client.call("epg", "get_simple_data_table", { ch_id: channel.stalker_id!, date, p });
    if (!Array.isArray(page?.data)) throw new Error("Portal returned an invalid archive page.");
    let added = 0;
    for (const row of page.data) {
      const id = idOf(row?.id), seconds = Number(row?.start_timestamp);
      if (!id || !Number.isFinite(seconds) || seen.has(id)) continue;
      seen.add(id); added++;
      if (seconds <= start && seconds > previous) { match = row; previous = seconds; }
    }
    if (previous === start || !added) break;
  }
  const archive = idOf(match?.id);
  if (!archive) throw new Error("No matching programme was found in this portal archive.");
  const modernPortal = /\/(?:portal|portalott|portalis)\.php$/i.test(new URL(login.server).pathname);
  const suffix = modernPortal && !archive.includes("_") ? `_${channel.stalker_id}` : "";
  return playbackLink(await client.call("tv_archive", "create_link", { cmd: `auto /media/${archive}${suffix}.mpg`, force_ch_link_check: 0 }));
}
