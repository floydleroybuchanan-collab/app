import { NativeModules, Platform } from "react-native";

/** One recently watched VOD title, as shown on the Live TV screen. */
export type VodRecentItem = {
  id: string;
  kind: "movie" | "tv_show";
  title: string;
  image: string | null;
  playedAt: number;
  progress: number;
};

const MAX_ITEMS = 10;

type NativeVodHistory = { recent(limit: number): Promise<unknown> };

function nativeModule(): NativeVodHistory | null {
  if (Platform.OS !== "android") return null;
  return (NativeModules.CharmVodHistory as NativeVodHistory | undefined) ?? null;
}

function clean(raw: unknown): VodRecentItem[] {
  if (!Array.isArray(raw)) return [];
  const out: VodRecentItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    const kind = item.kind === "movie" || item.kind === "tv_show" ? item.kind : null;
    if (!id || !kind) continue;
    out.push({
      id,
      kind,
      title: typeof item.title === "string" && item.title ? item.title : "Untitled",
      image: typeof item.image === "string" && /^https?:\/\//i.test(item.image) ? item.image : null,
      playedAt: Number(item.playedAt) || 0,
      progress: Math.max(0, Math.min(100, Number(item.progress) || 0)),
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** Recently watched movies and shows from VOD, newest first. Never throws. */
export async function loadVodRecent(): Promise<VodRecentItem[]> {
  const module = nativeModule();
  if (!module) return [];
  try {
    return clean(await module.recent(MAX_ITEMS));
  } catch {
    return [];
  }
}

/** VOD `section` param that opens this title's page ("movie:<id>"). */
export function vodTitleSection(item: Pick<VodRecentItem, "id" | "kind">): string {
  return `${item.kind}:${item.id}`;
}

/** Same-content check so a refresh with no change does not re-render the row. */
export function sameVodRecent(a: VodRecentItem[], b: VodRecentItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.kind !== y.kind || x.playedAt !== y.playedAt || x.progress !== y.progress || x.image !== y.image || x.title !== y.title) return false;
  }
  return true;
}
