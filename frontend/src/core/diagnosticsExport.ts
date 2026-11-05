import type { SourceDiagnostics } from "@/src/source";
import { sourceRefreshTrace } from "./sourceRefreshTrace";

/** Build a portable plain-text diagnostics dump (no stream URLs). */
export function formatDiagnosticsExport(input: {
  diagnostics: SourceDiagnostics | null;
  appVersion?: string;
  preferTvgIdOnly?: boolean;
  powerProfile?: string;
  guideFilter?: string;
  extras?: Record<string, string | number | boolean | null | undefined>;
}): string {
  const d = input.diagnostics;
  const trace = sourceRefreshTrace.read();
  const lines: string[] = [
    "Charming MediaLab diagnostics",
    `exportedAt=${new Date().toISOString()}`,
    `appVersion=${input.appVersion || "unknown"}`,
    "",
    "[source]",
    `mode=${d?.mode ?? "unknown"}`,
    `channels=${d?.channels ?? 0}`,
    `programs=${d?.programs ?? 0}`,
    `cacheBytes=${d?.cacheBytes ?? 0}`,
    `cacheAgeMinutes=${d?.cacheAgeMinutes ?? "null"}`,
    `refreshInFlight=${d?.refreshInFlight ?? false}`,
    `playlistRefreshedAt=${d?.playlistRefreshedAt ?? "null"}`,
    `guideRefreshedAt=${d?.guideRefreshedAt ?? "null"}`,
    `playlistEpoch=${d?.playlistEpoch ?? "null"}`,
    `guideEpoch=${d?.guideEpoch ?? "null"}`,
    `epgError=${d?.epgError ?? "null"}`,
    `refreshStage=${trace.active?.stage ?? "idle"}`,
    `refreshStageMs=${trace.active?.elapsedMs ?? 0}`,
    `recentRefreshStages=${trace.completed.map(row => `${row.stage}:${row.elapsedMs}`).join(",")}`,
    "",
    "[matchQuality]",
    `matched=${d?.matchQuality?.matched ?? 0}`,
    `ambiguous=${d?.matchQuality?.ambiguous ?? 0}`,
    `unmatched=${d?.matchQuality?.unmatched ?? 0}`,
    "",
    "[settings]",
    `preferTvgIdOnly=${!!input.preferTvgIdOnly}`,
    `powerProfile=${input.powerProfile || "normal"}`,
    `guideFilter=${input.guideFilter || "all"}`,
  ];
  if (input.extras) {
    lines.push("", "[extras]");
    for (const [key, value] of Object.entries(input.extras)) {
      lines.push(`${key}=${value == null ? "null" : String(value)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
