import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import {
  StreamPlayer,
  StreamStatus,
  type StreamTrack,
  type PlayerScaleMode,
} from "@/src/components/StreamPlayer";
import { useStore } from "@/src/store";
import { fonts, radius, tvColors } from "@/src/theme";
import { addPlayerQuickCommandListener, addTvKeyListener, addTvLongPressListener, addTvShortcutListener, emitTvQuickActions, resetRemoteContextIfOwned, setRemoteContext } from "@/src/utils/tvRemote";
import { useRemoteShortcutPreferences, type PlayerRemoteAction } from "@/src/core/remoteShortcutPreferences";
import { getTvSafeInsets } from "@/src/utils/tvLayout";
import { requestNativeFocus, requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { stopFullscreenSession, stopAllPlaybackSessions, type SessionFailReason } from "@/src/core/playbackSession";
import { clearStreamFailure, noteStreamFailure } from "@/src/core/streamFailureRegistry";
import { restartNativePlaybackChannel } from "@/src/nativePlayback";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { requestGuideJump } from "@/src/core/guideSearchJump";
import {
  audioDiagnosticsExtras,
  getLastAudioDiagnostics,
} from "@/src/core/audioDiagnostics";
import { pickDefaultSubtitleTrack, useSubtitlePreferences } from "@/src/core/subtitlePreferences";
import { pickPreferredAudioTrack, useAudioTrackPreferences } from "@/src/core/audioTrackPreferences";
import { usePlaybackBufferProfile } from "@/src/core/playbackBufferProfile";
import * as FileSystem from "expo-file-system/legacy";
import type { Channel } from "@/src/api";
import { multiview } from "@/src/multiview";
import { useAppPolicy } from "@/src/core/useAppPolicy";

const SWITCH_NOTICE_MS = 1800;
const STABLE_HISTORY_DELAY_MS = 5000;
type PlayerViewMode = "fit" | "fill" | "zoom" | "stretch";

const FAIL_REASON_LABEL: Record<SessionFailReason, string> = {
  "start-timeout": "start timeout",
  "stream-error": "stream error",
  "unsupported-protocol": "This stream protocol is not supported by this build. Ask your provider for an HTTP(S) HLS, DASH, or MPEG-TS URL for Media3.",
  "user-stop": "stopped",
  superseded: "replaced",
  crashed: "player crash",
};

function AutoScrollProgramDescription({ text }: { text: string; activeKey: string }) {
  if (!text) return null;
  return (
    <View style={styles.descriptionViewport}>
      <Text numberOfLines={2} style={styles.description}>{text}</Text>
    </View>
  );
}

export default function PlayerScreen() {
  const appPolicy=useAppPolicy();
  const router = useRouter();
  const params = useLocalSearchParams<{ channelId: string; returnToGuide?: string; returnGuideGroup?: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const {
    channels,
    recent,
    channelById,
    addRecent,
    toggleFavorite,
    playerControlsTimeoutMs,
    channelLogos,
    channelNumbers,
    deviceLayoutMode,
    sleepTimerMinutes,
    setSleepTimerMinutes,
  } = useStore();

  const [channelId, setChannelId] = useState(params.channelId);
  const [status, setStatus] = useState<StreamStatus>("loading");
  const [failReason, setFailReason] = useState<SessionFailReason | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [controls, setControls] = useState(true);
  const [playerOverlay, setPlayerOverlay] = useState<"channels" | "tracks" | null>(null);
  const [guidePreviewId, setGuidePreviewId] = useState(params.channelId);
  const [notice, setNotice] = useState<string | null>(null);
  const [playerNow, setPlayerNow] = useState(() => new Date());
  const [playbackPaused, setPlaybackPaused] = useState(false);
  const [scaleMode, setScaleMode] = useState<PlayerViewMode>("fit");
  const [audioTracks, setAudioTracks] = useState<StreamTrack[]>([]);
  const [textTracks, setTextTracks] = useState<StreamTrack[]>([]);
  const [audioTrackId, setAudioTrackId] = useState<string | number | undefined>(undefined);
  const [textTrackId, setTextTrackId] = useState<string | number | undefined>(undefined);
  const channelsOpen = playerOverlay === "channels";
  const tracksOpen = playerOverlay === "tracks";
  const setOverlayOpen = useCallback((name: "channels" | "tracks", next: React.SetStateAction<boolean>) => {
    setPlayerOverlay((current) => {
      const open = current === name;
      const resolved = typeof next === "function" ? next(open) : next;
      return resolved ? name : current === name ? null : current;
    });
  }, []);
  const setChannelsOpen = useCallback((next: React.SetStateAction<boolean>) => setOverlayOpen("channels", next), [setOverlayOpen]);
  const setTracksOpen = useCallback((next: React.SetStateAction<boolean>) => setOverlayOpen("tracks", next), [setOverlayOpen]);
  const { defaultLanguage: subtitleDefaultLanguage } = useSubtitlePreferences();
  const audioPreferences = useAudioTrackPreferences();
  const [playbackBufferProfile] = usePlaybackBufferProfile();
  const remoteShortcuts = useRemoteShortcutPreferences();

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableHistoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef = useRef(true);
  const channelsOpenRef = useRef(false);
  const tracksOpenRef = useRef(false);
  const controlsFocusedRef = useRef(false);
  const generationRef = useRef(0);
  const exitInFlightRef = useRef(false);
  const channelsButtonRef = useRef<any>(null);
  const stopButtonRef = useRef<any>(null);
  const stopFocusedRef = useRef(false);
  const cancelStopFocusRef = useRef<(() => void) | null>(null);
  const overlayOpenerRef = useRef<any>(null);
  const saveAudioReportRef = useRef<() => void>(() => undefined);
  const nextButtonRef = useRef<any>(null);
  const prevButtonRef = useRef<any>(null);
  const preferControlRef = useRef<"next" | "prev" | null>(null);
  const pendingChannelIdRef = useRef(params.channelId);
  const channelIdRef = useRef(params.channelId);
  const lastRouteChannelIdRef = useRef(params.channelId);
  const previousChannelIdRef = useRef<string | null>(null);
  const textTrackIdRef = useRef<string | number | undefined>(undefined);
  const subtitleDefaultLanguageRef = useRef(subtitleDefaultLanguage);
  const subtitleAutoAppliedRef = useRef<string | null>(null);
  const audioAutoAppliedRef = useRef<string | null>(null);

  const isTV = Platform.OS !== "web" && Platform.isTV;
  useEffect(() => {
    if (!isTV) return;
    setRemoteContext("player");
    return () => { resetRemoteContextIfOwned("player", "default"); };
  }, [isTV]);
  const overlayHideMs = playerControlsTimeoutMs;
  const safe = useMemo(() => getTvSafeInsets(width, height, deviceLayoutMode), [deviceLayoutMode, height, width]);
  const channelMeta = useMemo(() => channelById(channelId), [channelById, channelId]);
  const channelPrograms = useGuidePrograms(channelId);
  // A single row-level subscription; the in-player guide never copies the
  // entire EPG or starts a second player/decoder just to preview a channel.
  const guidePreviewPrograms = useGuidePrograms(channelsOpen ? guidePreviewId : channelId);
  const guidePreviewChannel = channelById(guidePreviewId);
  const { current: guideCurrent, next: guideNext } = nowNext(guidePreviewPrograms, playerNow);
  const channel = useMemo(() => (channelMeta ? { ...channelMeta, programs: channelPrograms } : undefined), [channelMeta, channelPrograms]);
  const streamUri = channel?.url || "";
  const streamChannels = channels;
  const historyChannels = useMemo(() => {
    const seen = new Set<string>();
    const out: Channel[] = [];
    for (const item of recent) {
      if (!item.url || seen.has(item.id)) continue;
      seen.add(item.id); out.push(item);
    }
    for (const item of streamChannels) {
      if (!item.url || seen.has(item.id)) continue;
      seen.add(item.id); out.push(item);
    }
    return out;
  }, [recent, streamChannels]);
  const numberById = useMemo(() => {
    const result: Record<string, number> = {};
    if (!channelNumbers) return result;
    for (let index = 0; index < channels.length; index += 1) result[channels[index].id] = index + 1;
    return result;
  }, [channelNumbers, channels]);

  useEffect(() => {
    const timer = setInterval(() => setPlayerNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!sleepTimerMinutes) return;
    const endsAt = Date.now() + sleepTimerMinutes * 60_000;
    const timer = setInterval(() => {
      if (Date.now() < endsAt || exitInFlightRef.current) return;
      exitInFlightRef.current = true;
      setSleepTimerMinutes(0);
      generationRef.current += 1;
      void stopFullscreenSession().then(() => router.replace("/" as any));
    }, 15_000);
    return () => clearInterval(timer);
  }, [router, setSleepTimerMinutes, sleepTimerMinutes]);

  useEffect(() => { textTrackIdRef.current = textTrackId; }, [textTrackId]);
  useEffect(() => { subtitleDefaultLanguageRef.current = subtitleDefaultLanguage; }, [subtitleDefaultLanguage]);
  useEffect(() => {
    setAudioTracks([]); setTextTracks([]); setAudioTrackId(undefined); setTextTrackId(undefined);
    textTrackIdRef.current = undefined; subtitleAutoAppliedRef.current = null; audioAutoAppliedRef.current = null; setTracksOpen(false);
  }, [channelId, retryToken, setTracksOpen]);

  const { current, next } = nowNext(channel?.programs, playerNow);
  const progress = current ? progressPct(current, playerNow) : 0;
  const hasStream = !!streamUri;
  const programDescription = current?.desc || (next ? `Next: ${next.title}` : "Live television");
  const programDescriptionKey = `${channelId}:${current?.start || ""}:${current?.title || ""}`;

  const showNotice = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), SWITCH_NOTICE_MS);
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      // Never remove player controls while the remote is navigating them or
      // while a modal/guide is open. Otherwise the focused view disappears
      // under a D-pad press and can strand the user on a black video surface.
      if (controlsFocusedRef.current || channelsOpenRef.current || tracksOpenRef.current) return;
      controlsRef.current = false; setControls(false); setChannelsOpen(false); setTracksOpen(false);
    }, overlayHideMs);
  }, [overlayHideMs, setChannelsOpen, setTracksOpen]);

  const revealControls = useCallback((opts?: { claimChannelsFocus?: boolean }) => {
    const wasHidden = !controlsRef.current;
    controlsRef.current = true; setControls(true);
    if (status === "error" || !hasStream) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      return;
    }
    scheduleHide();
    const shouldClaim = opts?.claimChannelsFocus !== false && wasHidden && isTV && !channelsOpenRef.current;
    if (shouldClaim) requestAnimationFrame(() => requestNativeFocus(channelsButtonRef.current));
  }, [hasStream, isTV, scheduleHide, status]);

  const restartInFlightRef = useRef(false);
  const restartThisChannel = useCallback(async () => {
    if (restartInFlightRef.current || exitInFlightRef.current) return;
    restartInFlightRef.current = true;
    const requested = channelIdRef.current;
    try {
      const restarted = await restartNativePlaybackChannel(requested);
      if (requested !== channelIdRef.current || exitInFlightRef.current) return;
      if (restarted) { setPlaybackPaused(false); showNotice("Restarting this channel…"); }
      else showNotice("Recovery is already running, or no active channel is available. Use Retry if an error appears.");
    } catch {
      if (!exitInFlightRef.current) showNotice("Could not restart this channel. Try switching away and back.");
    } finally { restartInFlightRef.current = false; }
  }, [showNotice]);

  const changeChannel = useCallback((id: string, haptic = false) => {
    if (!id || exitInFlightRef.current) return;
    const target = channelById(id);
    if (!target) return;
    if (haptic) void Haptics.selectionAsync().catch(() => undefined);
    pendingChannelIdRef.current = id;
    if (channelIdRef.current && channelIdRef.current !== id) previousChannelIdRef.current = channelIdRef.current;
    channelIdRef.current = id; generationRef.current += 1; setStatus("loading"); setFailReason(null); setChannelId(id); setPlaybackPaused(false);
    if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
    showNotice(`Switching to ${target.name}`);
    revealControls({ claimChannelsFocus: false });
  }, [channelById, revealControls, showNotice]);

  const stepChannel = useCallback((direction: -1 | 1) => {
    if (streamChannels.length < 2 || exitInFlightRef.current) return;
    const currentId = pendingChannelIdRef.current || channelIdRef.current;
    const base = Math.max(0, streamChannels.findIndex((item) => item.id === currentId));
    const nextIndex = (base + direction + streamChannels.length) % streamChannels.length;
    const target = streamChannels[nextIndex];
    if (!target) return;
    preferControlRef.current = direction > 0 ? "next" : "prev";
    changeChannel(target.id, true);
  }, [changeChannel, streamChannels]);

  const returnToPreviousChannel = useCallback(() => {
    const previous = previousChannelIdRef.current;
    if (!previous || previous === channelIdRef.current) return;
    changeChannel(previous, true); setPlayerOverlay(null);
  }, [changeChannel]);

  const cycleScaleMode = useCallback(() => {
    setScaleMode((currentMode) => {
      const nextMode: PlayerViewMode = currentMode === "fit" ? "fill" : currentMode === "fill" ? "zoom" : currentMode === "zoom" ? "stretch" : "fit";
      showNotice(nextMode === "fit" ? "Aspect: Fit" : nextMode === "fill" ? "Aspect: Fill" : nextMode === "zoom" ? "Aspect: Zoom" : "Aspect: Stretch");
      return nextMode;
    });
    revealControls({ claimChannelsFocus: false });
  }, [revealControls, showNotice]);

  useEffect(() => {
    if (!isTV) return;
    return addPlayerQuickCommandListener((command) => {
      if (command === "CYCLE_ASPECT") return cycleScaleMode();
      if (command === "OPEN_TRACKS") {
        controlsRef.current = true; setControls(true); setChannelsOpen(false); setTracksOpen(true); overlayOpenerRef.current = null; scheduleHide(); return;
      }
      if (command === "PREVIOUS_CHANNEL") return returnToPreviousChannel();
      if (command === "SAVE_DIAGNOSTICS") saveAudioReportRef.current();
    });
  }, [cycleScaleMode, isTV, returnToPreviousChannel, scheduleHide, setChannelsOpen, setTracksOpen]);

  const restartStream = useCallback(() => {
    if (!hasStream || exitInFlightRef.current || failReason === "unsupported-protocol") return;
    generationRef.current += 1; setStatus("loading"); setFailReason(null); showNotice(`Reconnecting ${channel?.name || "stream"}`); setRetryToken((value) => value + 1);
  }, [channel?.name, failReason, hasStream, showNotice]);
  const retryNow = useCallback(() => restartStream(), [restartStream]);

  useEffect(() => { controlsRef.current = controls; }, [controls]);
  useEffect(() => { channelsOpenRef.current = channelsOpen; }, [channelsOpen]);
  useEffect(() => { tracksOpenRef.current = tracksOpen; }, [tracksOpen]);

  const closeOverlayAndRestoreFocus = useCallback(() => {
    channelsOpenRef.current = false;
    tracksOpenRef.current = false;
    setPlayerOverlay(null);
    const opener = overlayOpenerRef.current; overlayOpenerRef.current = null;
    if (opener) requestAnimationFrame(() => requestNativeFocus(opener));
  }, []);

  useEffect(() => {
    revealControls({ claimChannelsFocus: true });
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]);

  useEffect(() => () => { void stopFullscreenSession(); }, [setTracksOpen]);

  useEffect(() => {
    if (!controls) return;
    const which = preferControlRef.current;
    if (!which) return;
    const node = which === "next" ? nextButtonRef.current : prevButtonRef.current;
    requestAnimationFrame(() => requestNativeFocus(node));
  }, [channelId, controls, status, retryToken]);

  useEffect(() => {
    if (status !== "playing") return;
    if (controlsRef.current) scheduleHide();
    if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current);
    const stableChannelId = channelIdRef.current;
    stableHistoryTimer.current = setTimeout(() => {
      if (channelIdRef.current !== stableChannelId) return;
      const stableChannel = channelById(stableChannelId);
      if (stableChannel) addRecent(stableChannel);
    }, STABLE_HISTORY_DELAY_MS);
    return () => { if (stableHistoryTimer.current) clearTimeout(stableHistoryTimer.current); };
  }, [addRecent, channelById, scheduleHide, status]);

  useEffect(() => {
    if (status !== "error" && hasStream) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    controlsRef.current = true; setControls(true);
  }, [hasStream, status]);

  useEffect(() => {
    if (!isTV) return;
    const unsubscribe = addTvKeyListener((key) => {
      if (!controlsRef.current) {
        revealControls({ claimChannelsFocus: key !== "DOWN" });
        if (key === "DOWN") {
          cancelStopFocusRef.current?.();
          stopFocusedRef.current = false;
          // Pressable mounts during the React commit after controls are shown.
          // Retrying a few frames prevents a blank-focus Down on slow TVs.
          cancelStopFocusRef.current = requestNativeFocusWithRetry(
            () => stopButtonRef.current,
            [0, 60, 130, 230],
            () => stopFocusedRef.current,
          );
        }
      } else {
        // A fresh key is the user's decision, not a late focus-retry hint.
        // Cancel queued Stop refocus so it cannot steal the next selection.
        cancelStopFocusRef.current?.();
        cancelStopFocusRef.current = null;
        scheduleHide();
      }
    });
    return () => {
      unsubscribe();
      cancelStopFocusRef.current?.();
      cancelStopFocusRef.current = null;
    };
  }, [isTV, revealControls, scheduleHide]);

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const stopAndExit = useCallback(() => {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    void Haptics.selectionAsync().catch(() => undefined);
    const currentChannelId = pendingChannelIdRef.current || channelIdRef.current;
    generationRef.current += 1;
    const returnToGuide = params.returnToGuide === "1" && !!currentChannelId;
    const returnGuideGroup = String(params.returnGuideGroup || "").trim() || "All";
    if (returnToGuide && currentChannelId) requestGuideJump({ channelId: currentChannelId, group: returnGuideGroup });
    // Do not mount the Guide/home tree while MediaCodec/ExoPlayer is still
    // releasing. That overlap was a reproducible peak-RAM/lifecycle crash path.
    void stopFullscreenSession().then(() => {
      if (returnToGuide) router.replace("/guide" as any);
      else router.back();
    });
  }, [params.returnGuideGroup, params.returnToGuide, router]);

  const handleStreamStatus = useCallback((nextStatus: StreamStatus, reason?: SessionFailReason | null) => {
    setStatus(nextStatus);
    if (reason !== undefined) setFailReason(reason);
    const channelKey = channelIdRef.current;
    if (nextStatus === "playing") {
      setFailReason(null);
      if (channelKey) clearStreamFailure(channelKey);
    } else if (nextStatus === "error" && channelKey) {
      noteStreamFailure(channelKey);
    }
  }, []);

  const saveAudioReport = useCallback(async () => {
    void Haptics.selectionAsync().catch(() => undefined);
    try {
      const snap = getLastAudioDiagnostics(); const extras = audioDiagnosticsExtras(snap);
      const lines = [
        `channelId=${channelIdRef.current}`,
        `channelName=${channelMeta?.name || ""}`,
        failReason ? `failReason=${failReason}` : null,
        ...Object.entries(extras).map(([key, value]) => `${key}=${value == null ? "" : String(value)}`),
      ].filter((line): line is string => !!line);
      const root = FileSystem.documentDirectory || "";
      if (!root || Platform.OS === "web") { showNotice("Diagnostics unavailable"); return; }
      const path = `${root}charming-medialab-audio-${Date.now()}.txt`;
      await FileSystem.writeAsStringAsync(path, lines.join("\n")); showNotice("Diagnostics saved");
    } catch { showNotice("Diagnostics failed"); }
  }, [channelMeta?.name, failReason, showNotice]);
  saveAudioReportRef.current = () => { void saveAudioReport(); };

  const openQuickGuide = useCallback(() => {
    if (exitInFlightRef.current) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    controlsRef.current = true;
    channelsOpenRef.current = true;
    tracksOpenRef.current = false;
    setControls(true);
    setTracksOpen(false);
    setGuidePreviewId(pendingChannelIdRef.current || channelIdRef.current);
    setChannelsOpen(true);
  }, [setChannelsOpen, setTracksOpen]);

  // The full-screen Guide remains available explicitly from the two-pane
  // player guide. The Guide button itself must not tear down playback.
  const goGuide = useCallback(() => {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    void Haptics.selectionAsync().catch(() => undefined);
    const currentChannelId = pendingChannelIdRef.current || channelIdRef.current;
    const returnGuideGroup = String(params.returnGuideGroup || "").trim() || "All";
    if (currentChannelId) requestGuideJump({ channelId: currentChannelId, group: returnGuideGroup });
    generationRef.current += 1;
    void stopFullscreenSession().then(() => router.replace("/guide" as any));
  }, [params.returnGuideGroup, router]);

  const runRemoteAction = useCallback((action: PlayerRemoteAction) => {
    if (exitInFlightRef.current) return;
    if (action === "channel_up") return stepChannel(-1);
    if (action === "channel_down") return stepChannel(1);
    if (action === "channels") { openQuickGuide(); return; }
    if (action === "controls") return revealControls({ claimChannelsFocus: true });
    if (action === "favorite") {
      const target = pendingChannelIdRef.current || channelIdRef.current;
      if (target) { toggleFavorite(target); showNotice("Favorite updated"); }
      return;
    }
    if (action === "guide") return openQuickGuide();
    if (action === "previous") return returnToPreviousChannel();
  }, [openQuickGuide, returnToPreviousChannel, revealControls, showNotice, stepChannel, toggleFavorite]);

  useEffect(() => {
    if (!isTV) return;
    return addTvShortcutListener((key) => {
      if (key === "CHANNEL_UP") runRemoteAction(remoteShortcuts.channelUp);
      else if (key === "CHANNEL_DOWN") runRemoteAction(remoteShortcuts.channelDown);
      else runRemoteAction(remoteShortcuts.mediaPlayPause);
    });
  }, [isTV, remoteShortcuts.channelDown, remoteShortcuts.channelUp, remoteShortcuts.mediaPlayPause, runRemoteAction]);

  useEffect(() => {
    if (!isTV) return;
    return addTvLongPressListener((key) => { if (key === "DOWN") runRemoteAction(remoteShortcuts.longDown); });
  }, [isTV, remoteShortcuts.longDown, runRemoteAction]);

  useEffect(() => {
    const routeChannelId = String(params.channelId || "").trim();
    if (!routeChannelId || routeChannelId === lastRouteChannelIdRef.current) return;
    lastRouteChannelIdRef.current = routeChannelId;
    if (routeChannelId === channelIdRef.current) return;
    changeChannel(routeChannelId);
  }, [changeChannel, params.channelId]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (exitInFlightRef.current) return true;
      if (!controlsRef.current) { revealControls(); return true; }
      if (tracksOpen || channelsOpen) { closeOverlayAndRestoreFocus(); scheduleHide(); return true; }
      stopAndExit(); return true;
    });
    return () => sub.remove();
  }, [channelsOpen, closeOverlayAndRestoreFocus, revealControls, scheduleHide, stopAndExit, tracksOpen]);

  const engineScaleMode: PlayerScaleMode = scaleMode;

  return (
    <View style={styles.root}>
      <RNStatusBar hidden />
      {hasStream ? (
        <ErrorBoundary
          onReset={() => {
            const generation = generationRef.current + 1; generationRef.current = generation; setStatus("loading"); setFailReason(null);
            void stopAllPlaybackSessions("crashed").then(() => { if (generation === generationRef.current) setRetryToken((value) => value + 1); });
          }}
          fallback={(reset) => (
            <View style={styles.errorOverlay}>
              <Ionicons name="warning-outline" size={32} color={tvColors.purpleSoft} />
              <Text style={styles.errorTitle}>Player crashed</Text>
              <Text style={styles.errorText}>The decoder hit an unexpected error. Retry keeps you on this channel.</Text>
              <Pressable hasTVPreferredFocus onPress={reset} style={({ focused }: any) => [styles.retry, focused && styles.focused]}>
                <Ionicons name="refresh" size={14} color="#fff" /><Text style={styles.retryText}>Retry Player</Text>
              </Pressable>
            </View>
          )}
        >
          <StreamPlayer
            key={`play-${retryToken}`}
            uri={streamUri}
            channelKey={channelId}
            streamTypeHint={channel?.stream_type}
            mode="full"
            sessionRole="fullscreen"
            bufferProfile={playbackBufferProfile}
            audioTrack={audioTrackId}
            textTrack={textTrackId}
            paused={playbackPaused}
            scaleMode={engineScaleMode}
            onTracksAvailable={(tracks) => {
              const audio = tracks.audio.filter((track) => track.id !== "" && track.id != null);
              const text = tracks.text.filter((track) => track.id !== "" && track.id != null);
              setAudioTracks(audio); setTextTracks(text);
              const appliedAudioFor = channelIdRef.current;
              if (audioAutoAppliedRef.current !== appliedAudioFor) {
                const pickedAudio = pickPreferredAudioTrack(audio.filter((track) => track.isSupported !== false), audioPreferences.byChannel[appliedAudioFor], audioPreferences.defaultLanguage);
                if (pickedAudio) setAudioTrackId(pickedAudio.id);
                audioAutoAppliedRef.current = appliedAudioFor;
              }
              const appliedFor = channelIdRef.current;
              if (textTrackIdRef.current === undefined && subtitleAutoAppliedRef.current !== appliedFor && subtitleDefaultLanguageRef.current) {
                const picked = pickDefaultSubtitleTrack(text, subtitleDefaultLanguageRef.current);
                if (picked) { textTrackIdRef.current = picked.id; setTextTrackId(picked.id); }
                subtitleAutoAppliedRef.current = appliedFor;
              }
            }}
            onStatus={handleStreamStatus}
            style={StyleSheet.absoluteFill}
          />
        </ErrorBoundary>
      ) : null}

      {!isTV ? (
        <Pressable
          style={[StyleSheet.absoluteFill, styles.touchCatcher]}
          focusable
          onPress={() => {
            if (controls) { controlsRef.current = false; setControls(false); setChannelsOpen(false); setTracksOpen(false); }
            else revealControls();
          }}
          testID="player-surface"
        />
      ) : null}

      {(!hasStream || status === "error") ? (
        <View style={styles.errorOverlay} pointerEvents="box-none">
          <Ionicons name="warning-outline" size={32} color={tvColors.purpleSoft} />
          <Text style={styles.errorTitle}>{failReason === "unsupported-protocol" ? "Unsupported stream protocol" : hasStream ? "Stream unavailable" : "No stream available"}</Text>
          {hasStream ? <Text style={styles.errorText}>{failReason ? FAIL_REASON_LABEL[failReason] : "Use Retry Now to re-prepare this stream."}</Text> : null}
          {hasStream && failReason !== "unsupported-protocol" ? (
            <Pressable hasTVPreferredFocus={!controls} onPress={retryNow} style={({ focused }: any) => [styles.retry, focused && styles.focused]}>
              <Ionicons name="refresh" size={14} color="#fff" /><Text style={styles.retryText}>Retry Now</Text>
            </Pressable>
          ) : (
            <Pressable hasTVPreferredFocus={!controls} onPress={stopAndExit} style={({ focused }: any) => [styles.retry, focused && styles.focused]}>
              <Ionicons name="arrow-back" size={14} color="#fff" /><Text style={styles.retryText}>Back to Guide</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {notice ? <View style={styles.notice} pointerEvents="none"><ActivityIndicator size="small" color="#fff" /><Text numberOfLines={1} style={styles.noticeText}>{notice}</Text></View> : null}

      {controls ? (
        <>
          <LinearGradient colors={["rgba(5,4,13,0.92)", "rgba(5,4,13,0.42)", "transparent"]} style={[styles.topOverlay, { paddingTop: insets.top + safe.top + 8, paddingLeft: safe.left + 14, paddingRight: safe.right + 14 }]}>
            <View style={styles.channelIdentity}>
              {channel ? <ChannelLogo name={channel.name} logo={channel.logo} disabled={!channelLogos} size={34} /> : null}
              <View>
                <Text style={styles.channelTitle}>{channel ? `${channelNumbers ? `${numberById[channel.id] || ""}  ` : ""}${channel.name}` : "Live TV"}</Text>
                <Text numberOfLines={1} style={styles.nowText}>{current?.title || "Live channel"}</Text>
              </View>
            </View>
            <View style={styles.topSpacer} /><Text style={styles.clock}>{fmtTime(playerNow.toISOString())}</Text>
          </LinearGradient>

          <LinearGradient colors={["transparent", "rgba(5,4,13,0.90)", "rgba(5,4,13,0.98)"]} style={[styles.bottomOverlay, { paddingLeft: safe.left + 14, paddingRight: safe.right + 14, paddingBottom: insets.bottom + safe.bottom + 10 }]}>
            <View style={styles.infoRow}><View style={styles.programCopy}>
              <View style={styles.liveLine}><View style={styles.livePill}><Text style={styles.livePillText}>LIVE</Text></View><Text style={styles.programTime}>{current ? `${fmtTime(current.start)}${current.stop ? ` - ${fmtTime(current.stop)}` : ""}` : "Streaming now"}</Text></View>
              <Text numberOfLines={1} style={styles.programTitle}>{current?.title || channel?.name || "Live TV"}</Text>
              <AutoScrollProgramDescription text={programDescription} activeKey={programDescriptionKey} />
            </View></View>
            <View style={styles.progressRow}><Text style={styles.edgeTime}>{current ? fmtTime(current.start) : "LIVE"}</Text><View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View><Text style={styles.edgeTime}>{current?.stop ? fmtTime(current.stop) : "LIVE"}</Text></View>

            <View style={styles.controlsRow}
              onFocusCapture={() => {
                controlsFocusedRef.current = true;
                if (hideTimer.current) clearTimeout(hideTimer.current);
              }}
              onBlurCapture={() => {
                controlsFocusedRef.current = false;
                scheduleHide();
              }}>
              {multiview && appPolicy.multiview_max>0 && <Pressable onPress={() => {
                if (exitInFlightRef.current) return;
                exitInFlightRef.current = true;
                void stopAllPlaybackSessions("superseded").then(() => router.replace({ pathname: "/multiview" as any, params: { channelId, returnGuideGroup: params.returnGuideGroup } })).catch(() => { exitInFlightRef.current = false; showNotice("The current player could not close. Try again."); });
              }} style={({ focused }: any) => [styles.textControl, focused && styles.focused]}><Ionicons name="grid-outline" size={15} color="#fff" /><Text style={styles.controlLabel}>Multiview</Text></Pressable>}
              <Pressable onPress={openQuickGuide} style={({ focused }: any) => [styles.textControl, channelsOpen && styles.controlActive, focused && styles.focused]}><Ionicons name="information-circle-outline" size={15} color="#fff" /><Text style={styles.controlLabel}>Guide</Text></Pressable>
              <Pressable ref={channelsButtonRef} onPress={() => { overlayOpenerRef.current = channelsButtonRef.current; if (channelsOpen) { closeOverlayAndRestoreFocus(); scheduleHide(); } else openQuickGuide(); }} style={({ focused }: any) => [styles.textControl, channelsOpen && styles.controlActive, focused && styles.focused]}><Ionicons name="list" size={15} color="#fff" /><Text style={styles.controlLabel}>Channels</Text></Pressable>
              <View style={styles.controlsSpacer} />
              <Pressable accessibilityLabel="Restart this channel" testID="restart-current-channel" onPress={() => void restartThisChannel()} style={({ focused }: any) => [styles.textControl, focused && styles.focused]}><Ionicons name="refresh" size={15} color="#fff" /><Text style={styles.controlLabel}>Restart channel</Text></Pressable>
              <Pressable ref={prevButtonRef} disabled={streamChannels.length < 2} onPress={() => stepChannel(-1)} style={({ focused }: any) => [styles.iconControl, focused && styles.focused]}><Ionicons name="play-skip-back" size={18} color="#fff" /></Pressable>
              <Pressable accessibilityLabel={playbackPaused ? "Play stream" : "Pause stream"} onPress={() => { setPlaybackPaused((value) => !value); revealControls({ claimChannelsFocus: false }); }} style={({ focused }: any) => [styles.pauseControl, focused && styles.focused]}><Ionicons name={playbackPaused ? "play" : "pause"} size={18} color="#fff" /></Pressable>
              <Pressable ref={nextButtonRef} disabled={streamChannels.length < 2} onPress={() => stepChannel(1)} style={({ focused }: any) => [styles.iconControl, focused && styles.focused]}><Ionicons name="play-skip-forward" size={18} color="#fff" /></Pressable>
              <View style={styles.controlsSpacer} />
              <Pressable onPress={() => { setChannelsOpen(false); setTracksOpen(false); if (hideTimer.current) clearTimeout(hideTimer.current); emitTvQuickActions("player"); }} style={({ focused }: any) => [styles.textControl, focused && styles.focused]}><Ionicons name="ellipsis-horizontal" size={15} color="#fff" /><Text style={styles.controlLabel}>Quick Actions</Text></Pressable>
              <Pressable ref={stopButtonRef} onFocus={() => { stopFocusedRef.current = true; }} onBlur={() => { stopFocusedRef.current = false; }} onPress={stopAndExit} style={({ focused }: any) => [styles.textControl, focused && styles.focused]}><Ionicons name="stop" size={15} color="#fff" /><Text style={styles.controlLabel}>Stop</Text></Pressable>
            </View>

            {tracksOpen ? (
              <View style={styles.tracksPanel}>
                <Text style={styles.controlLabel}>Audio</Text>
                {audioTracks.length ? audioTracks.map((track) => (
                  <Pressable key={`a-${track.id}`} disabled={track.isSupported === false} onPress={() => { setAudioTrackId(track.id); audioPreferences.rememberChannelTrack(channelId, track.id); }} style={({ focused }: any) => [styles.trackRow, audioTrackId === track.id && styles.controlActive, track.isSupported === false && styles.trackUnsupported, focused && styles.focused]}>
                    <Text style={styles.controlLabel}>{track.name}{track.isSupported === false ? " · unsupported on this decoder" : ""}</Text>
                  </Pressable>
                )) : <Text style={styles.errorText}>No audio tracks reported</Text>}
                <Text style={[styles.controlLabel, { marginTop: 8 }]}>Subtitles</Text>
                <Pressable onPress={() => setTextTrackId(undefined)} style={({ focused }: any) => [styles.trackRow, textTrackId == null && styles.controlActive, focused && styles.focused]}><Text style={styles.controlLabel}>Off</Text></Pressable>
                {textTracks.map((track) => <Pressable key={`t-${track.id}`} onPress={() => setTextTrackId(track.id)} style={({ focused }: any) => [styles.trackRow, textTrackId === track.id && styles.controlActive, focused && styles.focused]}><Text style={styles.controlLabel}>{track.name}</Text></Pressable>)}
              </View>
            ) : null}

            {channelsOpen ? (
              <View style={styles.inPlayerGuide}>
                <View style={styles.guideChannelsPane}>
                  <Text style={styles.guideHeading}>Channels</Text>
                  <FlatList
                    data={historyChannels}
                    keyExtractor={(item) => item.id}
                    initialNumToRender={10}
                    maxToRenderPerBatch={8}
                    windowSize={4}
                    removeClippedSubviews={false}
                    showsVerticalScrollIndicator={false}
                    style={styles.guideChannelList}
                    renderItem={({ item }) => (
                      <Pressable
                        // Guide focus updates lightweight EPG data only. Never
                        // rebuild Media3/decoder for every D-pad movement.
                        onFocus={() => setGuidePreviewId(item.id)}
                        onPress={() => { changeChannel(item.id, true); closeOverlayAndRestoreFocus(); }}
                        style={({ focused }: any) => [styles.guideChannelRow, item.id === channelId && styles.guideCurrentChannel, focused && styles.focused]}
                      >
                        <ChannelLogo name={item.name} logo={item.logo} disabled={!channelLogos} size={28} />
                        <Text numberOfLines={1} style={styles.guideChannelName}>
                          {channelNumbers ? (numberById[item.id] || "") + "  " : ""}{item.name}
                        </Text>
                      </Pressable>
                    )}
                  />
                </View>
                <View style={styles.guideDetailsPane}>
                  <Text style={styles.guideHeading}>{guidePreviewChannel?.name || "Program details"}</Text>
                  <Text style={styles.guideSubheading}>NOW PLAYING</Text>
                  <Text numberOfLines={2} style={styles.guideProgram}>{guideCurrent?.title || "No program information"}</Text>
                  <Text style={styles.guideProgramTime}>{guideCurrent ? fmtTime(guideCurrent.start) + (guideCurrent.stop ? " – " + fmtTime(guideCurrent.stop) : "") : "Guide information will appear here"}</Text>
                  <Text numberOfLines={3} style={styles.guideDescription}>{guideCurrent?.desc || "Browse channels without leaving playback. Select a channel to tune it."}</Text>
                  <Text style={styles.guideSubheading}>UP NEXT</Text>
                  <Text numberOfLines={2} style={styles.guideProgram}>{guideNext?.title || "No upcoming information"}</Text>
                  <View style={styles.guideFooter}>
                    <Pressable onPress={() => { closeOverlayAndRestoreFocus(); scheduleHide(); }} style={({ focused }: any) => [styles.guideFooterButton, focused && styles.focused]}>
                      <Text style={styles.controlLabel}>Close guide</Text>
                    </Pressable>
                    <Pressable onPress={goGuide} style={({ focused }: any) => [styles.guideFooterButton, focused && styles.focused]}>
                      <Text style={styles.controlLabel}>Full Guide</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : null}
          </LinearGradient>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", overflow: "visible" },
  touchCatcher: { backgroundColor: "transparent" },
  errorOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(0,0,0,0.54)" },
  errorTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 13 },
  errorText: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5 },
  retry: { minHeight: 31, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.purple },
  retryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 8.5 },
  notice: { position: "absolute", top: "47%", alignSelf: "center", maxWidth: "70%", minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, borderRadius: 18, backgroundColor: "rgba(10,8,22,0.88)", borderWidth: 1, borderColor: tvColors.lineStrong },
  noticeText: { color: "#fff", fontFamily: fonts.medium, fontSize: 9 },
  topOverlay: { position: "absolute", top: 0, left: 0, right: 0, minHeight: 82, flexDirection: "row", alignItems: "flex-start", paddingBottom: 18 },
  channelIdentity: { flexDirection: "row", alignItems: "center", gap: 9 },
  channelTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 15 },
  nowText: { color: "rgba(255,255,255,0.78)", fontFamily: fonts.regular, fontSize: 8.5, marginTop: 2, maxWidth: 360 },
  topSpacer: { flex: 1 },
  clock: { color: "#fff", fontFamily: fonts.medium, fontSize: 9.5, marginTop: 4 },
  bottomOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 70 },
  infoRow: { flexDirection: "row", alignItems: "flex-end" },
  programCopy: { maxWidth: "62%" },
  liveLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  livePill: { backgroundColor: tvColors.purple, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  livePillText: { color: "#fff", fontFamily: fonts.bold, fontSize: 6.5 },
  programTime: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 14, marginTop: 3 },
  descriptionViewport: { height: 26, overflow: "hidden" },
  description: { color: "rgba(255,255,255,0.76)", fontFamily: fonts.regular, fontSize: 8.5, lineHeight: 12, marginTop: 2 },
  progressRow: { height: 20, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  edgeTime: { width: 42, color: "#fff", fontFamily: fonts.medium, fontSize: 7.5 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  fill: { height: 3, backgroundColor: tvColors.purpleBright },
  controlsRow: { minHeight: 42, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  textControl: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, borderRadius: 5, borderWidth: 2, borderColor: "transparent" },
  controlActive: { backgroundColor: tvColors.purpleDeep },
  controlLabel: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  controlsSpacer: { flex: 1 },
  iconControl: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, borderWidth: 2, borderColor: "transparent" },
  pauseControl: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.purple },
  channelStrip: { gap: 6, paddingTop: 5 },
  inPlayerGuide: {
    flexDirection: "row", height: 272, marginTop: 8, marginBottom: 4,
    borderRadius: 14, overflow: "hidden", borderColor: "rgba(218,135,255,0.65)",
    borderWidth: 1, backgroundColor: "rgba(18,8,38,0.86)",
  },
  guideChannelsPane: { width: "47%", paddingHorizontal: 11, paddingVertical: 8, borderRightWidth: 1, borderRightColor: "rgba(210,128,255,0.28)" },
  guideDetailsPane: { flex: 1, paddingHorizontal: 14, paddingVertical: 10 },
  guideHeading: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16, marginBottom: 6 },
  guideSubheading: { color: "#EC88F7", fontFamily: fonts.bold, fontSize: 9, marginTop: 6, marginBottom: 3 },
  guideChannelList: { flex: 1 },
  guideChannelRow: { minHeight: 43, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 9, paddingHorizontal: 8, borderWidth: 2, borderColor: "transparent" },
  guideCurrentChannel: { backgroundColor: "rgba(132,49,230,0.35)" },
  guideChannelName: { flex: 1, color: "#FFFFFF", fontFamily: fonts.medium, fontSize: 11 },
  guideProgram: { color: "#FFFFFF", fontFamily: fonts.semibold, fontSize: 12 },
  guideProgramTime: { color: "#BEADD4", fontFamily: fonts.medium, fontSize: 9, marginTop: 3 },
  guideDescription: { color: "#D4C5EB", fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, marginTop: 7 },
  guideFooter: { marginTop: "auto", flexDirection: "row", gap: 8, paddingTop: 8 },
  guideFooterButton: { minHeight: 33, borderColor: "rgba(193,127,255,0.58)", borderWidth: 1, backgroundColor: "rgba(83,25,152,0.52)", borderRadius: 8, paddingHorizontal: 13, justifyContent: "center" },
  tracksPanel: { maxHeight: 160, marginTop: 6, padding: 8, borderRadius: radius.sm, backgroundColor: "rgba(16,16,30,0.94)", gap: 4 },
  trackRow: { minHeight: 28, justifyContent: "center", paddingHorizontal: 8, borderRadius: 5, borderWidth: 2, borderColor: "transparent" },
  trackUnsupported: { opacity: 0.45 },
  channelCard: { width: 96, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: "rgba(16,16,30,0.94)", padding: 4 },
  channelCardActive: { backgroundColor: tvColors.purpleDeep, borderColor: tvColors.purpleBright },
  channelCardName: { color: "#fff", fontFamily: fonts.medium, fontSize: 7.5, textAlign: "center" },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
