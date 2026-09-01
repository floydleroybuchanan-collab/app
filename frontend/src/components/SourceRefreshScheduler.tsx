import { useEffect } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";
import { refreshEpgOnly, refreshSource, refreshSourcesIfDue } from "@/src/source";
import { consumeNativeScheduledEpgRefresh, refreshNativeSourceGuide } from "@/src/nativeEpg";
import { getMultiEpgSources, saveMultiEpgSource } from "@/src/core/multiEpgSources";
import { isGuideSurfing } from "@/src/utils/guideSurfGate";
import { getSourceRefreshPreferences } from "@/src/core/sourceRefreshPreferences";
import { syncNativeCustomEpgPolicy } from "@/src/core/customEpgPolicy";
import { readCombinedPlaylists, refreshPlaylists } from "@/src/core/playlistRegistry";
import { syncPlaylistEpg } from "@/src/core/playlistEpg";
import { reloadPlaylistCatalog } from "@/src/source.native";

let schedulerGeneration = 0;

/**
 * Lightweight scheduler for direct-source builds. Automatic work has one
 * generation owner; route/AppState changes invalidate the old owner so it cannot
 * continue into later custom sources or publish stale scheduling state.
 */
export function SourceRefreshScheduler() {
  const pathname = usePathname();

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
      !pathname?.startsWith("/guide") &&
      !pathname?.startsWith("/player") &&
      !isGuideSurfing();

    const check = async () => {
      if (!screenIsSafe() || running || Date.now() < automaticRefreshEligibleAt) return;
      const prefs = await getSourceRefreshPreferences();
      if (!screenIsSafe()) return;
      // Synchronize settings -> native source records before checking due state.
      await syncNativeCustomEpgPolicy(prefs.epgHours, prefs.epgPastDays);
      if (!screenIsSafe()) return;

      const isInitialCheck = initialCheckPending;
      if (initialCheckPending) {
        initialCheckPending = false;
        // Cold start is cache-first by default. Only an explicit user opt-in is
        // allowed to force the provider playlist/EPG path after the 30s idle gate.
        if (!prefs.updateEpgOnAppStart) return;
      }

      running = true;
      try {
        if (isInitialCheck) {
          await refreshSource(true);
        } else {
          // Playlist jobs complete before dependent EPG association/import work.
          // A failed source keeps its previous revision, so the following EPG
          // pass never observes a half-written catalog.
          const scheduledChannels = await refreshPlaylists(undefined, true);
          if (!screenIsSafe()) return;
          if (prefs.updateEpgOnPlaylistChange) await syncPlaylistEpg(scheduledChannels, false);
          await reloadPlaylistCatalog();
          const nativeDue = await consumeNativeScheduledEpgRefresh();
          if (!screenIsSafe()) return;
          if (nativeDue) await refreshEpgOnly();
          else await refreshSourcesIfDue();
        }
        if (!screenIsSafe()) return;

        // Independent XMLTV stores refresh serially under this same owner. The
        // native custom parser also yields if Guide/player takes foreground.
        const customSources = await getMultiEpgSources();
        let customGuideChanged = false;
        for (const source of customSources) {
          if (!screenIsSafe()) return;
          if (!source.enabled || !source.url || source.refreshHours === 0) continue;
          if (Date.now() - source.lastRefreshAt < source.refreshHours * 60 * 60 * 1000) continue;
          try {
            const result = await refreshNativeSourceGuide(source.id, source.url);
            if (!stillOwner()) return;
            const swapped = result.programmeSwapSucceeded !== false;
            customGuideChanged = customGuideChanged || swapped;
            saveMultiEpgSource({ ...source,
              lastRefreshAt: swapped ? Date.now() : source.lastRefreshAt,
              lastStatus: swapped ? `Indexed ${Math.max(0, Math.round(result.count || 0))} programmes.` : "No usable new rows; kept last-good data.",
            });
          } catch (error) {
            if (!stillOwner()) return;
            saveMultiEpgSource({ ...source, lastStatus: error instanceof Error ? error.message : "Automatic EPG refresh failed." });
          }
        }
        if (customGuideChanged && screenIsSafe()) {
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
    const timer = setInterval(() => void check(), 10 * 60 * 1000);
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
  }, [pathname]);

  return null;
}
