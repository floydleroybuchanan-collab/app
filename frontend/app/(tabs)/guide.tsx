import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FocusedTabMount } from "@/src/components/FocusedTabMount";
import {
  ActivityIndicator,
  BackHandler,
  DeviceEventEmitter,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useAppForeground } from "@/src/hooks/useAppForeground";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  PurpleTvShell,
  usePurpleTvDrawer,
  type PurpleGuideGroup,
} from "@/src/components/PurpleTvShell";
import { NativeGuideCanvas } from "@/src/components/NativeGuideCanvas";
import { PurpleGuideGroupDrawer } from "@/src/components/PurpleGuideGroupDrawer";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { GuidePreviewRail } from "@/src/components/GuidePreviewRail";
import { EpgProgressBar } from "@/src/components/EpgProgressBar";
import { Channel, Program } from "@/src/api";
import { useStore } from "@/src/store";
import { setPriorityMatchChannelIds, setViewportGuideChannelIds } from "@/src/source";
import { isGuideSurfing, markGuideSurfing, setGuideScreenActive } from "@/src/utils/guideSurfGate";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { getGuideRailMetrics } from "@/src/core/guideLayoutPolicy";
import { buildGuideRunwayIds } from "@/src/core/guideRunwayPolicy";
import {
  buildChannelIndexMap,
  expandRunwayKeepSet,
} from "@/src/core/guideSlidingCache";
import {
  resetGuideSelection,
  setGuideFocusedProgram,
  useGuideSelection,
} from "@/src/core/guideSelectionStore";
import { hasPlaybackReleaseFailure, stopPreviewSession, subscribePlaybackOwnership } from "@/src/core/playbackSession";
import { detectStreamKind, isNativeMedia3SupportedStreamKind, parsePipeHeaders } from "@/src/core/streamPolicy";
import { getPowerProfileTuning } from "@/src/core/devicePowerProfile";
import { shouldUseLowRamTuning, useDeviceMemoryProfile } from "@/src/core/deviceMemoryProfile";
import { channelHasOwnedEpgMatch } from "@/src/core/epgUserOverrides";
import { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";
import {
  buildGroupCounts,
  buildVisibleGroups,
  filterChannelsByGroup,
  listPlaylistGroupNames,
  pinGroup,
  unpinGroup,
} from "@/src/core/guideGroups";
import { GUIDE_START_LAST_USED, useGuideUiPreferences } from "@/src/core/guideUiPreferences";
import { useCustomGuideGroups } from "@/src/core/customGuideGroups";
import { resolveChannelNumber, useChannelCustomize } from "@/src/core/channelCustomize";
import { useParentalPin } from "@/src/core/parentalPin";
import {
  failedStreamCount,
  isFailedChannel,
} from "@/src/core/streamFailureRegistry";
import { consumeGuideJump, peekGuideJump } from "@/src/core/guideSearchJump";
import { consumeGuideGroupsOnEntry } from "@/src/core/guideEntryIntent";
import { fonts, spacing, tvColors } from "@/src/theme";
import { nowNext } from "@/src/utils/time";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import type { StreamStatus } from "@/src/components/StreamPlayer";
import { subscribeAndroidMemoryPressure } from "@/src/utils/androidMemoryPressure";
import { emitTvQuickActions, resetRemoteContextIfOwned, setGuideNavigationActive, setGuideRepeatInterval, setRemoteContext } from "@/src/utils/tvRemote";
import { focusGuidePreviewSurface } from "@/src/utils/guidePreviewFocus";

// Session-only guide position survives the root player route unmounting tabs.
// Do not persist to disk: this is navigation state, not a user preference.
let guideSessionGroup = "All";
let guideSessionChannelId: string | null = null;
const guideSessionChannelByGroup = new Map<string, string>();
const MAX_REMEMBERED_GUIDE_GROUPS = 128;
function rememberGuideGroupChannel(groupName: string, channelId: string): void {
  if (!groupName || !channelId) return;
  guideSessionChannelByGroup.delete(groupName);
  guideSessionChannelByGroup.set(groupName, channelId);
  while (guideSessionChannelByGroup.size > MAX_REMEMBERED_GUIDE_GROUPS) {
    const oldest = guideSessionChannelByGroup.keys().next().value;
    if (!oldest) break;
    guideSessionChannelByGroup.delete(oldest);
  }
}

function isPreviewProtocolSupported(channel: Channel | null | undefined): boolean {
  if (!channel?.url) return true;
  return isNativeMedia3SupportedStreamKind(detectStreamKind(parsePipeHeaders(channel.url).uri, channel.stream_type));
}

/**
 * The only React subtree subscribed to logical Guide selection. The native
 * canvas and screen shell therefore stay render-stable while the cursor moves;
 * metadata still updates synchronously and decoder tuning remains delayed.
 */
function GuideSelectionPreview({
  width,
  channelById,
  fallbackChannel,
  now,
  channelNumberById,
  showChannelNumbers,
  showLogos,
  favoriteSet,
  hidePreview,
  muted,
  onToggleMute,
  previewId,
  previewStatus,
  previewMemoryPaused,
  previewReleaseBlocked,
  previewEpoch,
  onPreviewStatus,
  onPlay,
  onFavorite,
  onOpenReminders,
  onHideToggle,
  onOpenDrawer,
  onActionsFocusChange,
  focusRequestToken,
  guideFocusTag,
}: {
  width: number;
  channelById: ReadonlyMap<string, Channel>;
  fallbackChannel: Channel | null;
  now: string;
  channelNumberById: Record<string, number>;
  showChannelNumbers: boolean;
  showLogos: boolean;
  favoriteSet: ReadonlySet<string>;
  hidePreview: boolean;
  muted: boolean;
  onToggleMute: () => void;
  previewId: string | null;
  previewStatus: StreamStatus;
  previewMemoryPaused: boolean;
  previewReleaseBlocked: boolean;
  previewEpoch: number;
  onPreviewStatus: (status: StreamStatus) => void;
  onPlay: (channel: Channel) => void;
  onFavorite: (channelId: string) => void;
  onOpenReminders: () => void;
  onHideToggle: () => void;
  onOpenDrawer: () => void;
  onActionsFocusChange: (focused: boolean) => void;
  focusRequestToken: number;
  guideFocusTag?: number | null;
}) {
  const selection = useGuideSelection();
  const channel = (selection.channelId ? channelById.get(selection.channelId) : null) || fallbackChannel;
  const programs = useGuidePrograms(channel?.id);
  const { current: liveCurrent, next: liveNext } = useMemo(
    () => (channel ? nowNext(programs, new Date(now)) : {}),
    [channel, now, programs],
  );
  const { displayedProgram, nextProgram } = useMemo(() => {
    if (!channel || selection.channelId !== channel.id || !selection.program) {
      return { displayedProgram: liveCurrent, nextProgram: liveNext };
    }
    const selected = selection.program;
    const index = programs.findIndex(
      (program) => program.start === selected.start && program.stop === selected.stop,
    );
    return {
      displayedProgram: selected,
      nextProgram: index >= 0 ? programs[index + 1] : undefined,
    };
  }, [channel, liveCurrent, liveNext, programs, selection]);
  const unsupportedPreviewProtocol = !isPreviewProtocolSupported(channel);
  const previewVisible =
    !hidePreview &&
    !previewMemoryPaused &&
    !unsupportedPreviewProtocol &&
    !!channel?.url &&
    previewId === channel.id;

  return (
    <View style={styles.previewRailContainer}>
      <GuidePreviewRail
        width={width}
        channel={channel}
        current={displayedProgram}
        next={nextProgram}
        now={now}
        channelNumber={channel ? channelNumberById[channel.id] : undefined}
        showChannelNumbers={showChannelNumbers}
        showLogos={showLogos}
        isFavorite={!!channel && favoriteSet.has(channel.id)}
        hidePreview={hidePreview}
        muted={muted}
        onToggleMute={onToggleMute}
        previewVisible={previewVisible}
        previewEpoch={previewEpoch}
        onPreviewStatus={onPreviewStatus}
        onPlay={() => channel && onPlay(channel)}
        onFavorite={() => channel && onFavorite(channel.id)}
        onOpenReminders={onOpenReminders}
        onHideToggle={onHideToggle}
        onOpenDrawer={onOpenDrawer}
        onActionsFocusChange={onActionsFocusChange}
        focusRequestToken={focusRequestToken}
        guideFocusTag={guideFocusTag}
      />
      {!hidePreview && !previewReleaseBlocked && unsupportedPreviewProtocol ? (
        <View pointerEvents="none" style={styles.unsupportedPreview} testID="guide-preview-unsupported-protocol">
          <Ionicons name="warning-outline" size={22} color={tvColors.purpleSoft} />
          <Text style={styles.unsupportedPreviewTitle}>Unsupported stream protocol</Text>
          <Text style={styles.unsupportedPreviewText}>This build uses Media3. Ask your provider for an HTTP(S) HLS, DASH, or MPEG-TS URL.</Text>
        </View>
      ) : null}
      {!hidePreview && !previewReleaseBlocked && !unsupportedPreviewProtocol && previewMemoryPaused ? (
        <View pointerEvents="none" style={styles.unsupportedPreview} testID="guide-preview-memory-paused">
          <Ionicons name="pause-circle-outline" size={22} color={tvColors.purpleSoft} />
          <Text style={styles.unsupportedPreviewTitle}>Preview paused to free memory</Text>
          <Text style={styles.unsupportedPreviewText}>Select another channel or press Play to watch fullscreen.</Text>
        </View>
      ) : null}
      {!hidePreview && previewReleaseBlocked ? (
        <View pointerEvents="none" style={styles.unsupportedPreview} testID="guide-preview-release-blocked">
          <Ionicons name="pause-circle-outline" size={22} color={tvColors.purpleSoft} />
          <Text style={styles.unsupportedPreviewTitle}>Previous player could not finish stopping</Text>
          <Text style={styles.unsupportedPreviewText}>Press Play to try again. If this persists, force-stop CharmIPTV in Android Settings, then reopen it.</Text>
        </View>
      ) : null}
    </View>
  );
}

function PurpleGuideScreenContent() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const appForeground = useAppForeground();
  const guideForeground = isFocused && appForeground;
  const guideForegroundRef = useRef(guideForeground);
  guideForegroundRef.current = guideForeground;
  // Observe only the retained failure flag, not every buffering/ownership
  // revision. This changes the notice without resetting preview identity.
  const previewReleaseBlocked = useSyncExternalStore(
    subscribePlaybackOwnership, hasPlaybackReleaseFailure, hasPlaybackReleaseFailure,
  );
  const { drawerOpen, openDrawer, closeDrawer } = usePurpleTvDrawer();
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  useEffect(() => {
    if (!guideForeground) return;
    guideForegroundRef.current = true;
    setGuideScreenActive(true);
    // The overlay-aware ownership effect below chooses Guide, drawers or PIN.
    // An unconditional claim here would steal an open drawer on app resume.
    return () => {
      guideForegroundRef.current = false;
      setGuideScreenActive(false);
      setGuideNavigationActive(false);
      resetRemoteContextIfOwned("guide", "default");
    };
  }, [guideForeground]);
  const {
    channels,
    windowStart,
    windowEnd,
    loading,
    refreshing,
    error,
    hardRefresh,
    patchProgramsForChannelIds,
    addRecent,
    activeProgram,
    favorites,
    recent,
    recentIds,
    lastChannelId,
    channelById,
    toggleFavorite,
    guideDensity,
    safePreviewMode,
    channelNumbers,
    channelLogos,
    powerProfile,
    logosOffWhileSurfing,
    epgGuideFilter,
    retainGuideSlidingCache,
    releaseGuideSlidingCache,
    clock24h,
  } = useStore();

  const {
    pinnedGroups,
    hidePreview,
    mutePreview,
    startGroup,
    setPinnedGroups,
    setHidePreview,
    setMutePreview,
    showProviderGroups,
    hiddenGroups,
  } = useGuideUiPreferences();
  const customGuideGroups = useCustomGuideGroups();
  const epgOwnership = useEpgSourcePreferences();
  const epgMatchOwnership = useMemo(() => ({
    primaryEnabled: epgOwnership.primaryEnabled,
    userEnabled: epgOwnership.userEnabled,
    userOverrides: epgOwnership.userOverrides,
  }), [epgOwnership.primaryEnabled, epgOwnership.userEnabled, epgOwnership.userOverrides]);
  const hasOwnedEpgMatch = useCallback(
    (channel: Channel) => channelHasOwnedEpgMatch(channel, epgMatchOwnership),
    [epgMatchOwnership],
  );
  const { hiddenIds, customOrder, customNumbers } = useChannelCustomize();
  const hiddenIdSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const { isGroupLocked, unlockGroup, verifyPin, hasPin } = useParentalPin();

  const deviceMemoryProfile = useDeviceMemoryProfile();
  const effectivePowerProfile = shouldUseLowRamTuning(deviceMemoryProfile) && powerProfile === "normal"
    ? "weak"
    : powerProfile;
  const powerTuning = useMemo(() => getPowerProfileTuning(effectivePowerProfile), [effectivePowerProfile]);
  useEffect(() => {
    setGuideRepeatInterval(powerTuning.guideRepeatIntervalMs);
  }, [powerTuning.guideRepeatIntervalMs]);
  const [surfLogosSuppressed, setSurfLogosSuppressed] = useState(false);

  const [now, setNow] = useState(() => new Date().toISOString());
  const [group, setGroup] = useState(() => guideSessionGroup);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<StreamStatus>("loading");
  const [previewMemoryPaused, setPreviewMemoryPaused] = useState(false);
  const [previewActionsFocused, setPreviewActionsFocused] = useState(false);
  const [previewFocusRequestToken, setPreviewFocusRequestToken] = useState(0);
  const [nativeGuideFocusTag, setNativeGuideFocusTag] = useState<number | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [restoreTimeMs, setRestoreTimeMs] = useState<number | null>(null);
  const [jumpFilterBypassId, setJumpFilterBypassId] = useState<string | null>(null);
  const [pinPromptGroup, setPinPromptGroup] = useState<string | null>(null);
  const [pinDigits, setPinDigits] = useState("");
  const [pinError, setPinError] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRequestGenerationRef = useRef(0);
  const previewMemoryPauseRef = useRef<{ channelId: string | null } | null>(null);
  const surfReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoryLogoRestoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runwayPatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewFocusFrame = useRef<number | null>(null);
  const pendingRunwayPatchRef = useRef<{ ids: string[]; priorityIds: string[] } | null>(null);
  const groupChangedAt = useRef(0);
  const bootRetryRef = useRef(0);
  const lastFocusAtRef = useRef(0);
  const rapidSurfUntilRef = useRef(0);
  const hadProgramModalRef = useRef(false);
  const modalOriginRef = useRef<{ channelId: string; programStart: string } | null>(null);
  const pinModalOwnedRef = useRef(false);
  const pinReturnToGroupsRef = useRef(false);
  const orderedFilteredIdsRef = useRef<string[]>([]);
  const filteredIdIndexRef = useRef<Map<string, number>>(new Map());
  const lastRunwayRef = useRef<{ ids: string[]; priority: string[]; pageSize: number }>({
    ids: [],
    priority: [],
    pageSize: 8,
  });
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const startPreferenceAppliedRef = useRef(false);

  const cancelGuideTransientTimers = useCallback(() => {
    previewRequestGenerationRef.current += 1;
    if (previewFocusFrame.current != null) cancelAnimationFrame(previewFocusFrame.current);
    previewFocusFrame.current = null;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (surfReleaseTimer.current) clearTimeout(surfReleaseTimer.current);
    if (runwayPatchTimer.current) clearTimeout(runwayPatchTimer.current);
    previewTimer.current = null;
    surfReleaseTimer.current = null;
    runwayPatchTimer.current = null;
    pendingRunwayPatchRef.current = null;
    rapidSurfUntilRef.current = 0;
  }, []);

  const quiesceGuideForTransition = useCallback((releaseCache: boolean, preserveRunway = false) => {
    cancelGuideTransientTimers();
    if (memoryLogoRestoreTimer.current) clearTimeout(memoryLogoRestoreTimer.current);
    memoryLogoRestoreTimer.current = null;
    setPreviewId(null);
    setPreviewStatus("loading");
    setPreviewActionsFocused(false);
    setViewportGuideChannelIds(null);
    setPriorityMatchChannelIds([]);
    if (!preserveRunway) lastRunwayRef.current = { ids: [], priority: [], pageSize: 8 };
    void stopPreviewSession("superseded");
    if (releaseCache) releaseGuideSlidingCache();
  }, [cancelGuideTransientTimers, releaseGuideSlidingCache]);

  useEffect(() => {
    resetGuideSelection(guideSessionChannelId);
  }, []);
  useEffect(
    () => subscribeAndroidMemoryPressure((pressure) => {
      // Store/native listeners trim bounded programme and logo caches for every
      // pressure level. A moderate/UI-hidden hint must not cancel a visible or
      // pending tune. Actual route/app background already quiesces the Guide.
      if (pressure !== "critical") return;
      previewMemoryPauseRef.current = { channelId: guideSessionChannelId };
      setPreviewMemoryPaused(true);
      cancelGuideTransientTimers();
      if (memoryLogoRestoreTimer.current) clearTimeout(memoryLogoRestoreTimer.current);
      setPreviewId(null);
      void stopPreviewSession("superseded");
      setSurfLogosSuppressed(true);
      if (!guideForegroundRef.current) return;
      memoryLogoRestoreTimer.current = setTimeout(() => {
        memoryLogoRestoreTimer.current = null;
        if (guideForegroundRef.current) setSurfLogosSuppressed(false);
      }, 12_000);
    }),
    [cancelGuideTransientTimers],
  );
  useEffect(() => {
    if (activeProgram) hadProgramModalRef.current = true;
  }, [activeProgram]);

  const openDrawerFromPreview = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    openDrawer({ focusTop: true });
  }, [openDrawer]);

  const openGuideSources = useCallback(() => {
    closeDrawer();
    router.replace("/epg-sources" as any);
  }, [closeDrawer, router]);

  useEffect(() => {
    if (activeProgram) return;
    if (!hadProgramModalRef.current) return;
    hadProgramModalRef.current = false;
    const origin = modalOriginRef.current;
    modalOriginRef.current = null;
    if (origin?.channelId) guideSessionChannelId = origin.channelId;
  }, [activeProgram]);

  useTvBackHandler(
    useCallback(() => {
      if (drawerOpen || activeProgram) return false;
      if (groupDrawerOpen) {
        setGroupDrawerOpen(false);
        openDrawer();
        return true;
      }
      setGroupDrawerOpen(true);
      return true;
    }, [activeProgram, drawerOpen, groupDrawerOpen, openDrawer]),
    !pinPromptGroup,
  );

  useEffect(() => {
    if (!guideForeground) {
      setQuickActionsOpen(false);
      return;
    }
    const sub = DeviceEventEmitter.addListener("CharmQuickActionsVisibility", (open: boolean) => {
      setQuickActionsOpen(!!open);
    });
    return () => {
      sub.remove();
      setQuickActionsOpen(false);
    };
  }, [guideForeground]);

  useEffect(() => {
    if (!guideForeground) {
      setGuideNavigationActive(false);
      if (pinModalOwnedRef.current) {
        pinModalOwnedRef.current = false;
        pinReturnToGroupsRef.current = false;
        resetRemoteContextIfOwned("modal", "default");
      }
      return;
    }

    if (quickActionsOpen || activeProgram || pinPromptGroup) {
      setGuideNavigationActive(false);
    }

    if (pinPromptGroup) {
      pinModalOwnedRef.current = true;
      setRemoteContext("modal");
      return;
    }

    if (!quickActionsOpen && !activeProgram && !drawerOpen && !groupDrawerOpen) {
      setRemoteContext("guide");
      setGuideNavigationActive(true);
    }
  }, [activeProgram, drawerOpen, groupDrawerOpen, guideForeground, pinPromptGroup, quickActionsOpen]);

  useEffect(() => {
    if (!guideForeground) return;
    const sub = DeviceEventEmitter.addListener("CharmGuideGroupsRequestOpen", () => {
      closeDrawer({ force: true });
      setGroupDrawerOpen(true);
    });
    return () => sub.remove();
  }, [closeDrawer, guideForeground]);

  useFocusEffect(
    useCallback(() => {
      if (consumeGuideGroupsOnEntry()) setGroupDrawerOpen(true);
    }, []),
  );

  useEffect(() => {
    if (!guideForeground || loading || refreshing || channels.length > 0) return;
    if (bootRetryRef.current >= 1) return;
    bootRetryRef.current += 1;
    const timer = setTimeout(() => void hardRefresh(), 5000);
    return () => clearTimeout(timer);
  }, [guideForeground, loading, refreshing, channels.length, hardRefresh]);

  useEffect(() => {
    if (!guideForeground) return;
    setNow(new Date().toISOString());
    const timer = setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => clearInterval(timer);
  }, [guideForeground]);

  useEffect(
    () => () => {
      cancelGuideTransientTimers();
      if (memoryLogoRestoreTimer.current) clearTimeout(memoryLogoRestoreTimer.current);
      memoryLogoRestoreTimer.current = null;
      setViewportGuideChannelIds(null);
      setPriorityMatchChannelIds([]);
      void stopPreviewSession("superseded");
    },
    [cancelGuideTransientTimers],
  );

  const runwayLifecycleRef = useRef({ channelsCount: channels.length, patchProgramsForChannelIds, quiesceGuideForTransition, retainGuideSlidingCache });
  runwayLifecycleRef.current = { channelsCount: channels.length, patchProgramsForChannelIds, quiesceGuideForTransition, retainGuideSlidingCache };
  useEffect(() => {
    if (!guideForeground) return;
    if (previewMemoryPauseRef.current) {
      previewMemoryPauseRef.current = null;
      setPreviewMemoryPaused(false);
      // One real foreground transition may resume the preserved selection. A
      // fresh native restore also covers an active event queued before effects.
      setResetToken((value) => value + 1);
    }
    const lifecycle = runwayLifecycleRef.current;
    setSurfLogosSuppressed(false);
    const last = lastRunwayRef.current;
    if (!peekGuideJump() && last.ids.length) {
      setViewportGuideChannelIds(last.ids);
      setPriorityMatchChannelIds(
        lifecycle.channelsCount >= 400
          ? Array.from(new Set([...last.priority, ...last.ids])).slice(0, 400)
          : [],
      );
      lifecycle.retainGuideSlidingCache(
        expandRunwayKeepSet(orderedFilteredIdsRef.current, last.ids, last.pageSize, 1, filteredIdIndexRef.current),
      );
      void lifecycle.patchProgramsForChannelIds(last.ids, last.priority);
    }
    return () => {
      // Preserve the runway for a background/foreground round trip. A group or
      // channel transition still deliberately clears it through the same helper.
      runwayLifecycleRef.current.quiesceGuideForTransition(true, true);
    };
  }, [guideForeground]);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const recentIdSet = useMemo(() => new Set(recentIds), [recentIds]);
  const failedCount = failedStreamCount();

  const groupCounts = useMemo(
    () => {
      void failedCount;
      return buildGroupCounts(channels, {
        favoriteSet,
        recentIds: recentIdSet,
        hasEpgMatch: hasOwnedEpgMatch,
        isFailed: isFailedChannel,
        hiddenIds: hiddenIdSet,
        customGroups: customGuideGroups.byName,
        includeProviderGroups: showProviderGroups,
      });
    },
    [channels, favoriteSet, recentIdSet, hasOwnedEpgMatch, hiddenIdSet, failedCount, customGuideGroups.byName, showProviderGroups],
  );

  const playlistGroups = useMemo(
    () => showProviderGroups ? listPlaylistGroupNames(channels, hiddenIdSet) : [],
    [channels, hiddenIdSet, showProviderGroups],
  );

  const { tabs: groups, overflow: overflowGroups } = useMemo(
    () =>
      buildVisibleGroups({
        counts: groupCounts,
        pinned: pinnedGroups,
        playlistGroups,
        customGroups: customGuideGroups.groups.map((item) => item.name),
        hiddenGroups: new Set(hiddenGroups),
        showProviderGroups,
        maxPlaylistTabs: 10,
      }),
    [customGuideGroups.groups, groupCounts, hiddenGroups, pinnedGroups, playlistGroups, showProviderGroups],
  );

  useEffect(() => {
    if (startPreferenceAppliedRef.current || !guideForeground || !channels.length) return;
    if (peekGuideJump()) return;
    startPreferenceAppliedRef.current = true;
    // A remembered channel/group means this is a session restore (for example,
    // BACK from fullscreen). Do not re-apply the configured startup tab over the
    // user's current Guide group; the startup preference is only for a fresh entry.
    if (guideSessionChannelId || guideSessionGroup !== "All") {
      if (group !== guideSessionGroup) setGroup(guideSessionGroup);
      return;
    }
    if (!startGroup || startGroup === GUIDE_START_LAST_USED) return;
    const available = groups.includes(startGroup) || overflowGroups.includes(startGroup);
    const next = available ? startGroup : "All";
    guideSessionGroup = next;
    guideSessionChannelId = guideSessionChannelByGroup.get(next) || null;
    setGroup(next);
    resetGuideSelection(guideSessionChannelId);
    setRestoreTimeMs(null);
    setResetToken((value) => value + 1);
  }, [channels.length, group, groups, guideForeground, overflowGroups, startGroup]);

  const filteredMeta = useMemo(() => {
    let list = filterChannelsByGroup(channels, group, {
      favoriteSet,
      recent,
      recentIds: recentIdSet,
      hasEpgMatch: hasOwnedEpgMatch,
      isFailed: isFailedChannel,
      hiddenIds: hiddenIdSet,
      customOrder,
      customGroups: customGuideGroups.byName,
    });
    if (epgGuideFilter === "all") return list;
    const filteredList = epgGuideFilter === "matched"
      ? list.filter(hasOwnedEpgMatch)
      : list.filter((c) => !hasOwnedEpgMatch(c));
    if (!jumpFilterBypassId || filteredList.some((channel) => channel.id === jumpFilterBypassId)) {
      return filteredList;
    }
    const target = list.find((channel) => channel.id === jumpFilterBypassId);
    if (!target) return filteredList;
    const visibleIds = new Set(filteredList.map((channel) => channel.id));
    visibleIds.add(target.id);
    return list.filter((channel) => visibleIds.has(channel.id));
  }, [channels, customGuideGroups.byName, customOrder, epgGuideFilter, favoriteSet, group, hasOwnedEpgMatch, hiddenIdSet, jumpFilterBypassId, recent, recentIdSet]);

  const filtered = filteredMeta;

  const orderedFilteredIds = useMemo(() => {
    const ids: string[] = [];
    for (const channel of filtered) if (channel.id) ids.push(channel.id);
    return ids;
  }, [filtered]);
  const filteredIdIndex = useMemo(
    () => buildChannelIndexMap(orderedFilteredIds),
    [orderedFilteredIds],
  );
  orderedFilteredIdsRef.current = orderedFilteredIds;
  filteredIdIndexRef.current = filteredIdIndex;

  const onViewportChannelIds = useCallback((ids: string[], priorityIds: string[] = [], pageSize = 8, velocity = 0) => {
    if (!guideForegroundRef.current) return;
    const focusIndex = Math.max(0, ids.indexOf(priorityIds[0] || ""));
    const rapid = velocity > 0 || isGuideSurfing();
    const dataIds = rapid
      ? ids.slice(
          Math.max(0, focusIndex - pageSize * 2),
          Math.min(ids.length, focusIndex + pageSize * 4 + 1),
        )
      : ids;
    lastRunwayRef.current = { ids: dataIds, priority: priorityIds, pageSize };
    setViewportGuideChannelIds(ids);
    if (channels.length >= 400) {
      setPriorityMatchChannelIds(
        Array.from(new Set([...priorityIds, ...ids])).slice(0, 400),
      );
    } else {
      setPriorityMatchChannelIds([]);
    }
    retainGuideSlidingCache(
      expandRunwayKeepSet(orderedFilteredIds, ids, pageSize, 1, filteredIdIndex),
    );

    pendingRunwayPatchRef.current = { ids: dataIds, priorityIds };
    if (runwayPatchTimer.current) clearTimeout(runwayPatchTimer.current);
    const delay = rapid ? 110 : 0;
    runwayPatchTimer.current = setTimeout(() => {
      runwayPatchTimer.current = null;
      const pending = pendingRunwayPatchRef.current;
      pendingRunwayPatchRef.current = null;
      if (!pending || !guideForegroundRef.current) return;
      void patchProgramsForChannelIds(pending.ids, pending.priorityIds);
    }, delay);
  }, [
    channels.length,
    filteredIdIndex,
    orderedFilteredIds,
    patchProgramsForChannelIds,
    retainGuideSlidingCache,
  ]);

  const viewportSeedKeyRef = useRef("");
  useEffect(() => {
    if (!guideForeground || !filtered.length) return;
    const key = `${group}:${resetToken}:${powerProfile}`;
    if (viewportSeedKeyRef.current === key) return;
    viewportSeedKeyRef.current = key;
    const rowHeight = getGuideRailMetrics(
      screenWidth,
      guideDensity,
      channelNumbers,
      channelLogos,
    ).rowHeight;
    const visibleRows = Math.max(6, Math.min(24, Math.ceil(screenHeight / rowHeight)));
    const restoreIndex = guideSessionChannelId
      ? (filteredIdIndex.get(guideSessionChannelId) ?? 0)
      : 0;
    const ids = buildGuideRunwayIds(filtered, restoreIndex, visibleRows, 1, powerProfile);
    const priorityFrom = Math.max(0, restoreIndex);
    const priority = filtered
      .slice(priorityFrom, Math.min(filtered.length, priorityFrom + visibleRows))
      .map((channel) => channel.id)
      .filter(Boolean);
    lastRunwayRef.current = {
      ids,
      priority: Array.from(new Set([guideSessionChannelId, ...priority, ...ids.slice(0, 3)].filter((id): id is string => !!id))),
      pageSize: visibleRows,
    };
    setViewportGuideChannelIds(ids);
    setPriorityMatchChannelIds(
      channels.length >= 400
        ? Array.from(new Set([...lastRunwayRef.current.priority, ...ids])).slice(0, 400)
        : [],
    );
    retainGuideSlidingCache(
      expandRunwayKeepSet(orderedFilteredIds, ids, visibleRows, 1, filteredIdIndex),
    );
    void patchProgramsForChannelIds(
      ids,
      lastRunwayRef.current.priority,
    );
  }, [
    channelLogos,
    channelNumbers,
    channels.length,
    filtered,
    filteredIdIndex,
    group,
    guideDensity,
    guideForeground,
    orderedFilteredIds,
    patchProgramsForChannelIds,
    powerProfile,
    retainGuideSlidingCache,
    resetToken,
    screenHeight,
    screenWidth,
  ]);

  useEffect(() => {
    if (!groups.includes(group) && !overflowGroups.includes(group)) {
      quiesceGuideForTransition(true);
      guideSessionGroup = "All";
      guideSessionChannelId = null;
      setGroup("All");
      setResetToken((value) => value + 1);
    }
  }, [group, groups, overflowGroups, quiesceGuideForTransition]);

  const channelNumberById = useMemo(() => {
    const result: Record<string, number> = {};
    if (!channelNumbers) return result;
    for (let index = 0; index < channels.length; index += 1) {
      const channel = channels[index];
      result[channel.id] = resolveChannelNumber(channel.id, index + 1, customNumbers);
    }
    return result;
  }, [channelNumbers, channels, customNumbers]);

  const filteredChannelById = useMemo(
    () => new Map(filtered.map((channel) => [channel.id, channel] as const)),
    [filtered],
  );
  const previewFallbackChannel = useMemo(
    () => (lastChannelId ? filteredChannelById.get(lastChannelId) : null) || filtered[0] || null,
    [filtered, filteredChannelById, lastChannelId],
  );

  const previewDelay =
    safePreviewMode === "delayed" || safePreviewMode === "surf"
      ? powerTuning.previewArmDelayedMs
      : powerTuning.previewArmOnMs;
  const surfSettleExtraMs =
    safePreviewMode === "surf"
      ? powerTuning.surfSettleExtraMs + 100
      : powerTuning.surfSettleExtraMs;

  const schedulePreview = useCallback((requestedId: string, delay: number, hasUrl: boolean) => {
    const generation = ++previewRequestGenerationRef.current;
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    if (!guideForegroundRef.current || safePreviewMode === "off" || !hasUrl) {
      setPreviewId(null);
      return;
    }
    if (previewMemoryPauseRef.current) return;
    // Unsupported transports cannot recover through another native mount.
    // Re-evaluate the current URL so a refreshed provider entry can play later.
    if (!isPreviewProtocolSupported(channelById(requestedId))) {
      setPreviewId(null);
      setPreviewStatus("error");
      return;
    }
    previewTimer.current = setTimeout(() => {
      if (generation !== previewRequestGenerationRef.current) return;
      previewTimer.current = null;
      if (!guideForegroundRef.current) return;
      if (previewMemoryPauseRef.current) return;
      setPreviewStatus("loading");
      setPreviewEpoch((value) => value + 1);
      setPreviewId(requestedId);
      setSurfLogosSuppressed(false);
    }, delay);
  }, [channelById, safePreviewMode]);

  const guideTopPanelWidth = useMemo(
    () => Math.max(0, screenWidth - 24),
    [screenWidth],
  );
  const armPreviewForChannel = useCallback(
    (channel: Channel) => {
      if (!guideForegroundRef.current) return;
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = null;
      previewRequestGenerationRef.current += 1;
      const requestedId = channel.id;
      guideSessionChannelId = requestedId;
      const memoryPause = previewMemoryPauseRef.current;
      if (memoryPause) {
        // EPG refresh/restore events for the same channel are not user retries.
        // If pressure preceded the first selection, record it without tuning.
        if (memoryPause.channelId == null) memoryPause.channelId = requestedId;
        if (memoryPause.channelId === requestedId) return;
        previewMemoryPauseRef.current = null;
        setPreviewMemoryPaused(false);
      }
      if (!isPreviewProtocolSupported(channel)) {
        setPreviewId(null);
        setPreviewStatus("error");
        return;
      }
      if (previewId === requestedId && previewStatus !== "error") return;

      const nowTs = Date.now();
      const rapid = nowTs - lastFocusAtRef.current < 240;
      lastFocusAtRef.current = nowTs;
      if (rapid) rapidSurfUntilRef.current = nowTs + powerTuning.rapidSurfHoldMs;
      if (rapid || nowTs < rapidSurfUntilRef.current) {
        markGuideSurfing(powerTuning.rapidSurfHoldMs);
      }
      if (surfReleaseTimer.current) {
        clearTimeout(surfReleaseTimer.current);
        surfReleaseTimer.current = null;
      }

      if (nowTs < rapidSurfUntilRef.current || rapid) {
        if (!surfReleaseTimer.current) {
          surfReleaseTimer.current = setTimeout(() => {
            surfReleaseTimer.current = null;
            setPreviewId(null);
            if (logosOffWhileSurfing) setSurfLogosSuppressed(true);
          }, 48);
        }
        schedulePreview(
          requestedId,
          Math.max(powerTuning.rapidSurfHoldMs + 80, previewDelay + surfSettleExtraMs),
          !!channel.url,
        );
        return;
      }

      const recentlyChangedGroup = nowTs - groupChangedAt.current < 1800;
      const delay = recentlyChangedGroup
        ? Math.max(previewDelay + surfSettleExtraMs, powerTuning.previewArmDelayedMs)
        : previewDelay;
      schedulePreview(requestedId, delay, !!channel.url);
    },
    [logosOffWhileSurfing, powerTuning, previewDelay, previewId, previewStatus, schedulePreview, surfSettleExtraMs],
  );

  const onFocusChannel = useCallback((channel: Channel, settled = true) => {
    guideSessionChannelId = channel.id;
    if (jumpFilterBypassId && channel.id !== jumpFilterBypassId) setJumpFilterBypassId(null);
    rememberGuideGroupChannel(group, channel.id);
    resetGuideSelection(channel.id);
    if (settled) armPreviewForChannel(channel);
  }, [armPreviewForChannel, group, jumpFilterBypassId]);

  const onFocusProgram = useCallback((program: Program, channel: Channel, settled = true) => {
    guideSessionChannelId = channel.id;
    if (jumpFilterBypassId && channel.id !== jumpFilterBypassId) setJumpFilterBypassId(null);
    rememberGuideGroupChannel(group, channel.id);
    setGuideFocusedProgram(channel.id, program);
    if (settled) armPreviewForChannel(channel);
  }, [armPreviewForChannel, group, jumpFilterBypassId]);

  const openGuideProgram = useCallback((_program: Program, _channel: Channel) => {
    emitTvQuickActions("guide");
  }, []);

  const play = useCallback(
    (channel: Channel) => {
      void Haptics.selectionAsync().catch(() => undefined);
      // Capture both pieces of Guide navigation state before the root player route
      // can unmount the tabs. BACK must restore the chosen group as well as focus.
      guideSessionGroup = group;
      guideSessionChannelId = channel.id;
      rememberGuideGroupChannel(group, channel.id);
      quiesceGuideForTransition(true);
      addRecent(channel);
      openFullscreenPlayer(router, channel.id, { returnToGuide: true, returnGuideGroup: group });
    },
    [addRecent, group, quiesceGuideForTransition, router],
  );

  const applyGroup = useCallback((next: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    // Explicit group selection is an allowed retry, unlike a cache timer.
    previewMemoryPauseRef.current = null;
    setPreviewMemoryPaused(false);
    if (next !== group) quiesceGuideForTransition(true);
    else cancelGuideTransientTimers();
    groupChangedAt.current = Date.now();
    if (guideSessionChannelId) rememberGuideGroupChannel(group, guideSessionChannelId);
    const rememberedChannelId = guideSessionChannelByGroup.get(next) || null;
    guideSessionGroup = next;
    guideSessionChannelId = rememberedChannelId;
    setGroup(next);
    setJumpFilterBypassId(null);
    resetGuideSelection(rememberedChannelId);
    setRestoreTimeMs(null);
    setPreviewId(null);
    setResetToken((value) => value + 1);
    setGroupDrawerOpen(false);
    closeDrawer();
  }, [cancelGuideTransientTimers, closeDrawer, group, quiesceGuideForTransition]);

  const openPinPrompt = useCallback((next: string, returnToGroups: boolean) => {
    pinModalOwnedRef.current = true;
    pinReturnToGroupsRef.current = returnToGroups;
    setGuideNavigationActive(false);
    setRemoteContext("modal");
    cancelGuideTransientTimers();
    setPreviewId(null);
    void stopPreviewSession("superseded");
    setPreviewActionsFocused(false);
    if (returnToGroups) setGroupDrawerOpen(false);
    setPinPromptGroup(next);
    setPinDigits("");
    setPinError(false);
  }, [cancelGuideTransientTimers]);

  const closePinPrompt = useCallback((restoreGroups: boolean) => {
    const returnToGroups = restoreGroups && pinReturnToGroupsRef.current;
    pinReturnToGroupsRef.current = false;
    pinModalOwnedRef.current = false;
    setPinPromptGroup(null);
    setPinDigits("");
    setPinError(false);
    if (returnToGroups) {
      setGuideNavigationActive(false);
      setRemoteContext("guide_groups");
      setGroupDrawerOpen(true);
      return;
    }
    const restored = resetRemoteContextIfOwned("modal", "guide");
    if (restored) setGuideNavigationActive(true);
  }, []);

  useEffect(() => {
    if (!pinPromptGroup) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closePinPrompt(true);
      return true;
    });
    return () => sub.remove();
  }, [closePinPrompt, pinPromptGroup]);

  const chooseGroup = useCallback(
    (next: string) => {
      if (hasPin && isGroupLocked(next)) {
        openPinPrompt(next, groupDrawerOpen);
        return;
      }
      applyGroup(next);
    },
    [applyGroup, groupDrawerOpen, hasPin, isGroupLocked, openPinPrompt],
  );

  const submitPin = useCallback(() => {
    if (!pinPromptGroup) return;
    if (!verifyPin(pinDigits)) {
      setPinError(true);
      setPinDigits("");
      return;
    }
    unlockGroup(pinPromptGroup);
    const next = pinPromptGroup;
    closePinPrompt(false);
    applyGroup(next);
  }, [applyGroup, closePinPrompt, pinDigits, pinPromptGroup, unlockGroup, verifyPin]);

  const togglePinGroup = useCallback(
    (name: string) => {
      void Haptics.selectionAsync().catch(() => undefined);
      if (pinnedGroups.includes(name)) {
        setPinnedGroups(unpinGroup(pinnedGroups, name));
      } else {
        setPinnedGroups(pinGroup(pinnedGroups, name));
      }
    },
    [pinnedGroups, setPinnedGroups],
  );

  const onGuideLeftBoundary = useCallback(() => {
    if (!drawerOpen && !groupDrawerOpen && !activeProgram) setGroupDrawerOpen(true);
  }, [activeProgram, drawerOpen, groupDrawerOpen]);

  const onGuideUpBoundary = useCallback(() => {
    if (!guideForegroundRef.current) return;
    setPreviewFocusRequestToken((value) => value + 1);
    if (previewFocusFrame.current != null) cancelAnimationFrame(previewFocusFrame.current);
    previewFocusFrame.current = requestAnimationFrame(() => {
      previewFocusFrame.current = null;
      if (guideForegroundRef.current) focusGuidePreviewSurface();
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      const jump = consumeGuideJump();
      if (!jump) return;
      startPreferenceAppliedRef.current = true;
      const nextGroup = jump.group || guideSessionGroup || "All";
      if (hasPin && isGroupLocked(nextGroup)) {
        openPinPrompt(nextGroup, false);
        guideSessionChannelId = jump.channelId;
        return;
      }
      if (nextGroup !== guideSessionGroup) quiesceGuideForTransition(true);
      guideSessionGroup = nextGroup;
      guideSessionChannelId = jump.channelId;
      setJumpFilterBypassId(jump.channelId);
      rememberGuideGroupChannel(nextGroup, jump.channelId);
      setGroup(nextGroup);
      const requestedTime = jump.programStart ? Date.parse(jump.programStart) : NaN;
      setRestoreTimeMs(Number.isFinite(requestedTime) ? requestedTime : null);
      resetGuideSelection(jump.channelId);
      setResetToken((value) => value + 1);
      const ch = channelById(jump.channelId);
      if (ch) {
        schedulePreview(jump.channelId, previewDelay + surfSettleExtraMs, !!ch.url);
      }
    }, [channelById, hasPin, isGroupLocked, openPinPrompt, previewDelay, quiesceGuideForTransition, schedulePreview, surfSettleExtraMs]),
  );

  const onPreviewStatus = useCallback((status: StreamStatus) => {
    setPreviewStatus(status);
  }, []);

  const drawerGroups = useMemo<PurpleGuideGroup[]>(() => {
    const names = Array.from(new Set([...groups, ...overflowGroups]));
    return names.map((name) => ({
      name,
      count: groupCounts[name] || 0,
      active: group === name,
      pinned: pinnedGroups.includes(name),
      onPress: () => chooseGroup(name),
      onLongPress: () => togglePinGroup(name),
    }));
  }, [chooseGroup, group, groupCounts, groups, overflowGroups, pinnedGroups, togglePinGroup]);

  return (
    <PurpleTvShell
      active="/guide"
      watchingChannelId={lastChannelId}
      footerAction={{
        label: "Guide Sources",
        icon: "refresh-outline",
        onPress: openGuideSources,
        testID: "guide-open-sources",
      }}
    >
      <View style={styles.page}>
        <PurpleGuideGroupDrawer
          open={groupDrawerOpen && guideForeground}
          groups={drawerGroups}
          onCloseToGuide={() => setGroupDrawerOpen(false)}
          onOpenMainDrawer={() => {
            setGroupDrawerOpen(false);
            openDrawer();
          }}
        />
        <EpgProgressBar />
        {loading && channels.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={tvColors.purpleBright} size="large" />
            <Text style={styles.centerText}>Loading channels and guide…</Text>
            <Pressable focusable disabled={refreshing} onPress={() => void hardRefresh()} style={({ focused }: any) => [styles.retryButton, focused && styles.focused]} testID="purple-guide-retry-loading">
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing ? "Loading…" : "Retry now"}</Text>
            </Pressable>
          </View>
        ) : error && channels.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={32} color={tvColors.purpleSoft} />
            <Text style={styles.centerText}>{error}</Text>
            <Pressable focusable disabled={refreshing} onPress={() => void hardRefresh()} style={({ focused }: any) => [styles.retryButton, focused && styles.focused]} testID="purple-guide-retry-error">
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing ? "Reloading…" : "Reload guide"}</Text>
            </Pressable>
          </View>
        ) : channels.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="tv-outline" size={32} color={tvColors.purpleSoft} />
            <Text style={styles.centerText}>No channels in the current playlist yet.</Text>
            <Pressable focusable disabled={refreshing} onPress={() => void hardRefresh()} style={({ focused }: any) => [styles.retryButton, focused && styles.focused]} testID="purple-guide-retry-empty">
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing ? "Loading…" : "Reload guide"}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.body}>
            <GuideSelectionPreview
              width={guideTopPanelWidth}
              channelById={filteredChannelById}
              fallbackChannel={previewFallbackChannel}
              now={now}
              channelNumberById={channelNumberById}
              showChannelNumbers={channelNumbers}
              showLogos={guideForeground && channelLogos && !surfLogosSuppressed}
              favoriteSet={favoriteSet}
              hidePreview={hidePreview}
              muted={mutePreview}
              onToggleMute={() => setMutePreview(!mutePreview)}
              previewId={safePreviewMode === "off" || drawerOpen || groupDrawerOpen || !!activeProgram || !!pinPromptGroup || quickActionsOpen || !guideForeground ? null : previewId}
              previewStatus={previewStatus}
              previewMemoryPaused={previewMemoryPaused}
              previewReleaseBlocked={previewReleaseBlocked}
              previewEpoch={previewEpoch}
              onPreviewStatus={onPreviewStatus}
              onPlay={play}
              onFavorite={toggleFavorite}
              onOpenReminders={() => {
                quiesceGuideForTransition(true);
                router.replace("/reminders" as any);
              }}
              onHideToggle={() => setHidePreview(!hidePreview)}
              onOpenDrawer={openDrawerFromPreview}
              onActionsFocusChange={setPreviewActionsFocused}
              focusRequestToken={previewFocusRequestToken}
              guideFocusTag={nativeGuideFocusTag}
            />

            <View style={styles.gridPanel}>
              <NativeGuideCanvas
                channels={filtered}
                windowStart={windowStart}
                windowEnd={windowEnd}
                active={guideForeground && !activeProgram && !pinPromptGroup && !quickActionsOpen && !drawerOpen && !groupDrawerOpen && !previewActionsFocused}
                restoreChannelId={guideSessionChannelId}
                restoreTimeMs={restoreTimeMs}
                reloadGeneration={resetToken}
                clock24h={clock24h}
                channelNumberById={channelNumberById}
                onProgramPress={openGuideProgram}
                onChannelFocus={onFocusChannel}
                onProgramFocus={onFocusProgram}
                onViewportChannelIds={onViewportChannelIds}
                onNativeGuideTag={setNativeGuideFocusTag}
                onLeftBoundary={onGuideLeftBoundary}
                onUpBoundary={onGuideUpBoundary}
              />
            </View>
          </View>
        )}

        {pinPromptGroup ? (
          <View style={styles.overlay} testID="guide-pin-overlay">
            <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
              <View style={styles.pinCard}>
                <Text style={styles.overlayTitle}>Enter PIN</Text>
                <Text style={styles.pinHint}>Unlock “{pinPromptGroup}”</Text>
                <Text style={styles.pinDigits}>{pinDigits.padEnd(4, "•").slice(0, 4)}</Text>
                {pinError ? <Text style={styles.pinError}>Incorrect PIN</Text> : null}
                <View style={styles.pinPad}>
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((digit) => (
                    <Pressable
                      key={digit}
                      onPress={() => {
                        setPinError(false);
                        setPinDigits((prev) => (prev + digit).slice(0, 8));
                      }}
                      style={({ focused }: any) => [styles.pinKey, focused && styles.focused]}
                    >
                      <Text style={styles.pinKeyText}>{digit}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.pinActions}>
                  <Pressable onPress={() => closePinPrompt(true)} style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}>
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={submitPin} style={({ focused }: any) => [styles.watchButton, focused && styles.focused]}>
                    <Text style={styles.watchText}>Unlock</Text>
                  </Pressable>
                </View>
              </View>
            </FocusGuide>
          </View>
        ) : null}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  previewRailContainer: { position: "relative", flexShrink: 0 },
  unsupportedPreview: { position: "absolute", left: 7, top: 7, bottom: 7, width: 278, justifyContent: "center", alignItems: "center", gap: 7, padding: 12, backgroundColor: "#05050B" },
  unsupportedPreviewTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11, textAlign: "center" },
  unsupportedPreviewText: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 14, textAlign: "center" },
  page: { flex: 1, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 3 },
  body: { flex: 1, minHeight: 0, flexDirection: "column", gap: 6 },
  gridPanel: { flex: 1, minWidth: 0, minHeight: 0 },
  pinCard: { width: 340, maxWidth: "100%", borderRadius: 10, backgroundColor: tvColors.panel, padding: 16, gap: 10 },
  overlayTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 16, textAlign: "center" },
  watchButton: { flex: 1, minWidth: 0, minHeight: 27, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: tvColors.purple, borderRadius: 5, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 3 },
  watchText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 7.5 },
  secondaryButton: { flex: 1, minWidth: 0, minHeight: 27, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: tvColors.panelRaised, borderRadius: 5, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 3 },
  secondaryText: { color: "#fff", fontFamily: fonts.medium, fontSize: 7.2 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", zIndex: 120, elevation: 120, padding: 24 },
  pinHint: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 10 },
  pinDigits: { color: "#fff", fontFamily: fonts.bold, fontSize: 22, letterSpacing: 8, textAlign: "center", marginVertical: 4 },
  pinError: { color: "#f87171", fontFamily: fonts.medium, fontSize: 10, textAlign: "center" },
  pinPad: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  pinKey: { width: 44, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  pinKeyText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  pinActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  centerText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 11, textAlign: "center", maxWidth: 320 },
  retryButton: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 6, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.purple, marginTop: 4 },
  retryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});

export default function PurpleGuideScreen() {
  return (
    <FocusedTabMount>
      <PurpleGuideScreenContent />
    </FocusedTabMount>
  );
}
