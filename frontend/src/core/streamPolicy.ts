export type Engine = "media3" | "vlc";
/** CMAF is packaging (fMP4) carried inside HLS or DASH — not a separate engine path. */
export type StreamKind =
  | "hls"
  | "dash"
  | "progressive"
  | "rtsp"
  | "rtmp"
  | "transport"
  | "srt"
  | "webrtc"
  | "unknown";

function kindFromHint(raw: string | null | undefined): StreamKind | null {
  const hint = String(raw || "").trim().toLowerCase();
  if (!hint || hint === "unknown") return null;
  if (hint === "hls" || hint === "m3u8" || hint.includes("application/x-mpegurl") || hint.includes("application/vnd.apple.mpegurl")) return "hls";
  if (hint === "dash" || hint === "mpd" || hint.includes("application/dash+xml")) return "dash";
  if (hint === "ts" || hint === "m2ts" || hint === "transport" || hint === "mpegts" || hint === "mpeg-ts" || hint.includes("video/mp2t")) return "transport";
  if (hint === "rtsp") return "rtsp";
  if (hint === "rtmp" || hint === "rtmps") return "rtmp";
  if (hint === "srt" || hint === "rist") return "srt";
  if (hint === "webrtc") return "webrtc";
  if (hint === "progressive" || hint === "mp4") return "progressive";
  return null;
}

/**
 * Resolve the real live transport. URL markers win when present, then the
 * playlist/native parser hint fills in extensionless provider URLs. This keeps
 * direct MPEG-TS on the explicit TS extractor/watchdog path instead of silently
 * downgrading it to generic progressive playback.
 */
export const DEFAULT_STREAM_USER_AGENT = "TiviMate/5.1.6 (Linux; Android TV)";

export function detectStreamKind(uri: string, streamTypeHint?: string | null): StreamKind {
  const lower = uri.toLowerCase();
  const protocol = lower.split(":", 1)[0];
  if (protocol === "rtsp") return "rtsp";
  if (protocol === "rtmp" || protocol === "rtmps") return "rtmp";
  if (protocol === "srt" || protocol === "rist") return "srt";
  if (protocol === "webrtc" || (protocol === "http" && lower.includes("webrtc"))) return "webrtc";
  if (
    /\.m3u8(?:$|[?#])/.test(lower) ||
    /[?&](?:format|type|output)=(?:hls|m3u8)(?:&|$)/.test(lower) ||
    lower.includes("/hls/") ||
    lower.includes("playlist.m3u8")
  ) return "hls";
  if (
    /\.mpd(?:$|[?#])/.test(lower) ||
    /[?&](?:format|type|output)=(?:dash|mpd)(?:&|$)/.test(lower) ||
    lower.includes("/dash/") ||
    lower.includes("manifest.mpd")
  ) return "dash";
  if (
    /\.(?:ts|m2ts)(?:$|[?#])/.test(lower) ||
    lower.includes("mpegts") ||
    lower.includes("mpeg-ts") ||
    /[?&](?:format|type|output)=(?:ts|mpegts|mpeg-ts)(?:&|$)/.test(lower)
  ) return "transport";

  const hinted = kindFromHint(streamTypeHint);
  if (hinted) return hinted;

  if (/\.(?:mp4|m4v|m4a|m4s|mov|webm|mkv|avi|flv|mpg|mpeg|vob|mp3|aac|ogg|wav|flac|amr|cmfv|cmfa)(?:$|[?#])/.test(lower)) return "progressive";
  return "unknown";
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function parsePipeHeaders(rawUri: string): { uri: string; headers: Record<string, string> } {
  const pipeIndex = rawUri.indexOf("|");
  if (pipeIndex < 0) {
    return { uri: rawUri, headers: { "User-Agent": DEFAULT_STREAM_USER_AGENT } };
  }
  const uri = rawUri.slice(0, pipeIndex);
  // Preserve headers supplied by the stream/provider. When the playlist omits
  // User-Agent, use the same TiViMate-style Android TV UA the cloud builder
  // already retries with so IPTV panels that gate on that identity still deliver bytes.
  const headers: Record<string, string> = {};
  for (const pair of rawUri.slice(pipeIndex + 1).split("&")) {
    const equals = pair.indexOf("=");
    if (equals <= 0) continue;
    const key = safeDecode(pair.slice(0, equals)).trim();
    const value = safeDecode(pair.slice(equals + 1)).trim();
    if (key && value) headers[key] = value;
  }
  if (!Object.keys(headers).some((key) => key.toLowerCase() === "user-agent")) {
    headers["User-Agent"] = DEFAULT_STREAM_USER_AGENT;
  }
  return { uri, headers };
}

export function isNativeMedia3SupportedStreamKind(kind: StreamKind): boolean {
  return kind === "hls" || kind === "dash" || kind === "progressive" || kind === "transport" || kind === "unknown";
}

export function isVlcSupportedStreamKind(kind: StreamKind): boolean {
  // This build has no WebRTC signaling/session stack. LibVLC is the explicit
  // compatibility choice for the remaining ordinary/live protocols.
  return kind !== "webrtc";
}

/** TiViMate-class routing: LibVLC for live/opaque IPTV; Media3 for clear HLS/DASH/files. */
export function preferredEngine(kind: StreamKind): Engine {
  if (kind === "hls" || kind === "dash" || kind === "progressive") return "media3";
  return "vlc";
}

/**
 * Media3 contentType hint for the native source factory. Unknown HTTP(S) URLs
 * deliberately remain unknown so the native learned-type cache and bounded
 * single-player candidate router can classify them without a second decoder.
 */
export function media3ContentType(kind: StreamKind): "hls" | "dash" | "transport" | "progressive" | "unknown" {
  if (kind === "dash") return "dash";
  if (kind === "hls") return "hls";
  if (kind === "transport") return "transport";
  if (kind === "progressive") return "progressive";
  return "unknown";
}
