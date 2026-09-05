import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";
import { refreshEpgOnly, refreshSourcesIfDue } from "@/src/source";
import { consumeNativeScheduledEpgRefresh, refreshNativeSourceGuide } from "@/src/nativeEpg";
import { getMultiEpgSources, updateMultiEpgRefreshStatus } from "@/src/core/multiEpgSources";
import { isGuideSurfing } from "@/src/utils/guideSurfGate";
import { getSourceRefreshPreferences } from "@/src/core/sourceRefreshPreferences";
import { syncNativeCustomEpgPolicy } from "@/src/core/customEpgPolicy";
import { listPlaylists, readCombinedPlaylists, refreshPlaylists } from "@/src/core/playlistRegistry";
import { syncPlaylistEpg } from "@/src/core/playlistEpg";
import { reloadPlaylistCatalog } from "@/src/source.native";

let schedulerGeneration = 0;

/**
 * Lightweight scheduler for direct-source builds. Automatic work has one
 * generation owner for its mount lifetime. Navigation must not restart the
 * startup delay, repeat a forced refresh, or abandon an accepted guide update.
 */
export function SourceRefreshScheduler() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    const generation = ++schedulerGeneration;
    let active = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    let running = false;
    let initialCheckPending = true;
    let cancelled = false;
    const automaticRefreshEligibleAt = Date.now() + 30_000;

    const stillOwner = () => !cancelled && generation === schedulerGeneration && active;
    const screenIsSafe = () =>
      stillOwner() &&
      !pathnameRef.current?.startsWith("/player") &&
      !isGuideSurfing();

    const check = async () => {
      if (!screenIsSafe() || running || Date.now() < automaticRefreshEligibleAt) return;
      running = true;
      try {
        const prefs = await getSourceRefreshPreferences();
        if (!screenIsSafe()) return;
        // Synchronize settings -> native source records before checking due state.
        await syncNativeCustomEpgPolicy(prefs.epgHours, prefs.epgPastDays);
        if (!screenIsSafe()) return;

        const isInitialCheck = initialCheckPending;
        initialCheckPending = false;

        if (isInitialCheck && prefs.updateEpgOnAppStart) {
          await refreshEpgOnly();
        } else {
          // Playlist jobs complete before dependent EPG association/import work.
          // A failed source keeps its previous revision, so the following EPG
          // pass never observes a half-written catalog.
          const before = await listPlaylists();
          const scheduledChannels = await refreshPlaylists(undefined, true);
          if (!stillOwner()) return;
          const after = await listPlaylists();
          const playlistChanged = after.some(row => row.revision !== before.find(previous => previous.id === row.id)?.revision);
          if (playlistChanged) {
            if (prefs.updateEpgOnPlaylistChange) await syncPlaylistEpg(scheduledChannels, false);
            await reloadPlaylistCatalog();
          }
          const nativeDue = await consumeNativeScheduledEpgRefresh();
          if (!stillOwner()) return;
          if (nativeDue && prefs.epgHours > 0) await refreshEpgOnly(false);
          else await refreshSourcesIfDue();
        }
        if (!stillOwner()) return;

        // Independent XMLTV stores refresh serially under this same owner. The
        // native custom parser also yields if Guide/player takes foreground.
        const [customSources, playlists, activeChannels] = await Promise.all([getMultiEpgSources(), listPlaylists(), readCombinedPlaylists()]);
        const usedSources = new Set(playlists.filter(playlist => playlist.enabled).flatMap(playlist => playlist.epgSourceIds));
        const activeChannelIds = new Set(activeChannels.map(channel => channel.id));
        let customGuideChanged = false;
        for (const source of customSources) {
          if (!stillOwner()) return;
          if (!source.enabled || !source.url || source.refreshHours === 0) continue;
          if (!usedSources.has(source.id) && !Object.keys(source.overrides).some(id => activeChannelIds.has(id))) continue;
          if (Date.now() - source.lastRefreshAt < source.refreshHours * 60 * 60 * 1000) continue;
          try {
            const result = await refreshNativeSourceGuide(source.id, source.url);
            if (!stillOwner()) return;
            const swapped = result.programmeSwapSucceeded !== false;
            customGuideChanged = customGuideChanged || swapped;
            updateMultiEpgRefreshStatus(source.id, source.url, {
              ...(swapped ? { lastRefreshAt: Date.now() } : {}),
              lastStatus: swapped ? `Indexed ${Math.max(0, Math.round(result.count || 0))} programmes.` : "No usable new rows; kept last-good data.",
            });
          } catch {
            if (!stillOwner()) return;
            updateMultiEpgRefreshStatus(source.id, source.url, { lastStatus: "Automatic EPG refresh failed; previous guide kept. Check source and connection." });
          }
        }
        if (customGuideChanged && stillOwner()) {
          const channels = await readCombinedPlaylists();
          await syncPlaylistEpg(channels, false);
          await reloadPlaylistCatalog();
        }
      } catch {
        // Last-good playlist/guide remains authoritative; normal source UI surfaces errors.
      } finally {
        running = false;
      }
    };

    // TiViMate-style cold start: let UI/playback own CPU, sockets and SQLite first.
    const initialTimer = setTimeout(() => void check(), 30_000);
    // A skipped busy check retries in one minute, not ten. Per-source intervals
    // still decide whether any network download is due; fresh sources stay cached.
    const timer = setInterval(() => void check(), 60_000);
    const sub = AppState.addEventListener("change", (state) => {
      active = state !== "background" && state !== "inactive";
      if (active) void check();
    });

    return () => {
      cancelled = true;
      schedulerGeneration += 1;
      clearTimeout(initialTimer);
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  return null;
}
