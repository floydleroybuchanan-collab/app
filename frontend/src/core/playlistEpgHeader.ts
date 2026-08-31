/** Only the playlist header can advertise a guide; stream URLs never do. */
export function playlistEpgUrls(text: string, playlistUrl: string): string[] {
  const header = text.slice(0, 16_384).replace(/^\uFEFF/, "").split(/\r?\n/).find((line) => line.trim().length)?.trim() || "";
  if (!/^#EXTM3U(?:\s|$)/i.test(header)) return [];
  const out: string[] = [];
  const attributes = /(?:^|\s)(?:url-tvg|x-tvg-url|tvg-url)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/gi;
  for (const match of header.matchAll(attributes)) {
    for (const raw of (match[1] ?? match[2] ?? match[3] ?? "").split(/,(?=\s*https?:\/\/)|\s+/)) {
      const value = raw.trim().replace(/&amp;/gi, "&");
      if (!value || value.length > 2048) continue;
      try {
        const url = new URL(value, /^https?:\/\//i.test(playlistUrl) ? playlistUrl : undefined);
        if (!/^https?:$/.test(url.protocol)) continue;
        url.hash = "";
        if (url.href.length <= 2048 && !out.includes(url.href)) out.push(url.href);
      } catch { /* Ignore invalid/unsupported guide addresses without rejecting playable channels. */ }
      if (out.length === 8) return out;
    }
  }
  return out;
}
