import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FocusedTabMount } from "@/src/components/FocusedTabMount";
import { DeviceEventEmitter, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import { PurpleTvShell, useIconRailFocusBoundary } from "@/src/components/PurpleTvShell";
import { PurpleDrawerButton } from "@/src/components/PurpleDrawerButton";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { TvCalibrationControls } from "@/src/components/TvCalibrationControls";
import {
  useStore,
  type DeviceLayoutMode,
  type GuideDensity,
  type GuideLayout,
  type PlayerControlsTimeoutMs,
  type PowerProfile,
  type SafePreviewMode,
  type SleepTimerMinutes,
  type StartScreen,
} from "@/src/store";
import { sourceDiagnostics } from "@/src/source";
import {
  type LongDownAction,
  type PlayerRemoteAction,
  useRemoteShortcutPreferences,
} from "@/src/core/remoteShortcutPreferences";

import {
  readLatestFavoritesBackup,
  resolveFavoritesBackup,
  serializeFavoritesBackup,
  writeFavoritesBackup,
} from "@/src/utils/favoritesBackup";
import { formatDiagnosticsExport } from "@/src/core/diagnosticsExport";
import {
  audioDiagnosticsExtras,
  getLastAudioDiagnostics,
} from "@/src/core/audioDiagnostics";
import { POWER_PROFILE_OPTIONS } from "@/src/core/devicePowerProfile";
import { getCacheStorageReport, pruneDiskCaches } from "@/src/utils/tvRemote";
import {
  usePlaybackBufferProfile,
  type PlaybackBufferProfile,
} from "@/src/core/playbackBufferProfile";
import { useChannelCustomize } from "@/src/core/channelCustomize";
import { useGuideUiPreferences } from "@/src/core/guideUiPreferences";
import { useParentalPin } from "@/src/core/parentalPin";
import { failedStreamCount, listFailedChannelIds } from "@/src/core/streamFailureRegistry";
import {
  useSubtitlePreferences,
  type SubtitleBg,
  type SubtitleSize,
} from "@/src/core/subtitlePreferences";
import { fonts, radius, tvColors } from "@/src/theme";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import { useAudioTrackPreferences } from "@/src/core/audioTrackPreferences";
import { PREFERRED_AUDIO_LANGUAGE_OPTIONS } from "@/src/core/preferredAudioLanguages";
import {
  getDeviceCodecCapabilities,
  type DeviceCodecCapabilities,
} from "@/src/core/deviceCodecCapabilities";
import * as FileSystem from "expo-file-system/legacy";
import { useAuth } from "@/src/auth/AuthContext";
import type { ReferralSummary } from "@/src/auth/accountApi";
import { restoreFullBackup, writeFullBackup } from "@/src/utils/fullBackup";
import { useTvRouteEntryFocus } from "@/src/hooks/use-tv-route-entry-focus";

const PLAYER_REMOTE_ACTIONS: { label: string; value: PlayerRemoteAction }[] = [
  { label: "Previous channel", value: "previous" },
  { label: "Channel up", value: "channel_up" },
  { label: "Channel down", value: "channel_down" },
  { label: "Open channel bar", value: "channels" },
  { label: "Show player controls", value: "controls" },
  { label: "Add/remove Favorite", value: "favorite" },
  { label: "Open TV Guide", value: "guide" },
  { label: "No shortcut", value: "none" },
];

type Section =
  | "general"
  | "player"
  | "remote"
  | "playlists"
  | "epg"
  | "appearance"
  | "health"
  | "channels"
  | "parental"
  | "backup"
  | "invites"
  | "account"
  | "about";

type Tile = {
  id: Section;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
};

const TILES: Tile[] = [
  { id: "general", label: "General", icon: "settings-outline" },
  { id: "player", label: "Player", icon: "play-circle-outline" },
  { id: "remote", label: "Remote Control", icon: "game-controller-outline" },
  { id: "playlists", label: "Playlists", icon: "list-outline" },
  { id: "epg", label: "EPG", icon: "calendar-outline" },
  { id: "appearance", label: "Appearance", icon: "color-palette-outline" },
  { id: "health", label: "Health", icon: "pulse-outline" },
  { id: "channels", label: "Channels", icon: "list-circle-outline" },
  { id: "parental", label: "Parental", icon: "lock-closed-outline" },
  { id: "backup", label: "Backup & Restore", icon: "cloud-download-outline" },
  { id: "invites", label: "Invites", icon: "gift-outline" },
  { id: "account", label: "Account", icon: "person-outline" },
  { id: "about", label: "About", icon: "information-circle-outline" },
];

const ADULT_GROUP_RE = /adult|xxx|porn/i;
const TELEGRAM_COMMUNITY_URL = "https://t.me/+f2Pr2-L3WWI4MDJh";

function formatAccountExpiry(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric)
    ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleDateString();
}

function formatAccountDateTime(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric)
    ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString();
}

function formatTimeRemaining(value: number | string | null | undefined): string {
  if (value == null || value === "") return "No expiration";
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric) ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric) : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((timestamp - Date.now()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return seconds <= 0 ? "Expired" : `${days}d ${hours}h remaining`;
}

function SettingsScreenContent() {
  const router = useRouter();
  const { iconRailEntryTag } = useIconRailFocusBoundary();
  const { user: accountUser, signOut, loadReferrals, createReferral, deleteReferral, cancelAccount } = useAuth();
  const {
    channels,
    favorites,
    replaceFavorites,
    pointerMode,
    setPointerMode,
    guideLayout,
    setGuideLayout,
    guideDensity,
    setGuideDensity,
    safePreviewMode,
    setSafePreviewMode,
    channelNumbers,
    setChannelNumbers,
    channelLogos,
    setChannelLogos,
    deviceLayoutMode,
    setDeviceLayoutMode,
    playerControlsTimeoutMs,
    setPlayerControlsTimeoutMs,
    preferTvgIdOnly,
    powerProfile,
    setPowerProfile,
    logosOffWhileSurfing,
    setLogosOffWhileSurfing,
    instantGuide,
    setInstantGuide,
    epgGuideFilter,
    guideWindowHours,
    clock24h,
    setClock24h,
    startScreen,
    setStartScreen,
    sleepTimerMinutes,
    setSleepTimerMinutes,
  } = useStore();
  const remoteShortcuts = useRemoteShortcutPreferences();
  const [playbackBufferProfile, setPlaybackBufferProfile] = usePlaybackBufferProfile();
  const channelCustomize = useChannelCustomize();
  const guideUi = useGuideUiPreferences();
  const parental = useParentalPin();
  const subtitles = useSubtitlePreferences();
  const audioPreferences = useAudioTrackPreferences();
  const latestAudio = getLastAudioDiagnostics();
  const [section, setSection] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [clearFavoritesArmed, setClearFavoritesArmed] = useState(false);
  const [codecCapabilities, setCodecCapabilities] = useState<DeviceCodecCapabilities | null>(null);
  const [pinDraft, setPinDraft] = useState("");
  const [focusedCustomizeId, setFocusedCustomizeId] = useState<string | null>(null);
  const [channelEditPage, setChannelEditPage] = useState(0);
  const clearFavoritesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralStatus, setReferralStatus] = useState<string | null>(null);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [cancelPassword, setCancelPassword] = useState("");
  const [cancelPhrase, setCancelPhrase] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelStatus, setCancelStatus] = useState<string | null>(null);
  const tileEntryFocus = useTvRouteEntryFocus(!section, "settings-tiles");
  const detailEntryFocus = useTvRouteEntryFocus(!!section, section || "settings-none");

  useEffect(() => {
    if (section !== "health" && section !== "about") return;
    void getDeviceCodecCapabilities().then(setCodecCapabilities);
  }, [section]);

  useEffect(() => {
    if (section !== "invites") return;
    let cancelled = false;
    setReferralBusy(true);
    setReferralStatus(null);
    void loadReferrals().then((result) => {
      if (cancelled) return;
      setReferral(result.data);
      setReferralStatus(result.error);
      setReferralBusy(false);
    });
    return () => { cancelled = true; };
  }, [loadReferrals, section]);

  const generateInvite = useCallback(async () => {
    if (referralBusy) return;
    setReferralBusy(true);
    setReferralStatus(null);
    try {
      const result = await createReferral();
      if (result.data) {
        setReferral(result.data);
        const newest = result.data.invitations.find((item) => item.status === "unused");
        setReferralStatus(newest ? `Invitation ${newest.invite_code} is ready. It expires in 3 days if unused.` : "Invitation created.");
      } else {
        setReferralStatus(result.error || "Unable to create an invitation.");
      }
    } finally {
      setReferralBusy(false);
    }
  }, [createReferral, referralBusy]);

  const removeInviteHistory = useCallback(async (invitationId: string) => {
    if (referralBusy) return;
    setReferralBusy(true);
    setReferralStatus(null);
    const result = await deleteReferral(invitationId);
    setReferral(result.data);
    setReferralStatus(result.error || "Inactive invitation removed from your list.");
    setReferralBusy(false);
  }, [deleteReferral, referralBusy]);

  const permanentlyCancel = useCallback(async () => {
    if (!cancelPassword || cancelBusy) {
      setCancelStatus("Enter your current password to permanently cancel this account.");
      return;
    }
    if (cancelPhrase.trim().toLowerCase() !== "please cancel me") {
      setCancelStatus('Type "please cancel me" exactly to confirm permanent deletion.');
      return;
    }
    setCancelBusy(true);
    setCancelStatus(null);
    const error = await cancelAccount(cancelPassword);
    if (error) {
      setCancelStatus(error);
      setCancelBusy(false);
      return;
    }
    setCancelPassword("");
  }, [cancelAccount, cancelBusy, cancelPassword, cancelPhrase]);

  useEffect(() => {
    if (!section) return;
    setClearFavoritesArmed(false);
  }, [section]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("CharmShowAllSettings", () => {
      setBackupStatus(null);
      setClearFavoritesArmed(false);
      setSection(null);
    });
    return () => sub.remove();
  }, []);

  useEffect(
    () => () => {
      if (clearFavoritesTimer.current) clearTimeout(clearFavoritesTimer.current);
    },
    [],
  );

  useTvBackHandler(
    useCallback(() => {
      if (section) {
        setBackupStatus(null);
        setClearFavoritesArmed(false);
        setSection(null);
        return true;
      }
      return false;
    }, [section]),
  );

  const appVersion = Constants.expoConfig?.version || "2.0.0-purple";
  const versionCode = (Constants.expoConfig as any)?.android?.versionCode;
  const selected = useMemo(() => TILES.find((item) => item.id === section), [section]);

  const channelEditPageCount = Math.max(1, Math.ceil(channels.length / 100));
  const channelEditIds = useMemo(
    () => section === "channels" ? channels.map((channel) => channel.id) : [],
    [channels, section],
  );
  const customizeChannels = useMemo(() => channels.slice(channelEditPage * 100, channelEditPage * 100 + 100), [channelEditPage, channels]);
  const hiddenSet = useMemo(() => new Set(channelCustomize.hiddenIds), [channelCustomize.hiddenIds]);

  useEffect(() => {
    if (section !== "channels") return;
    setChannelEditPage((current) => Math.max(0, Math.min(channelEditPageCount - 1, current)));
    setFocusedCustomizeId(null);
  }, [channelEditPageCount, channels, section]);
  const failedChannelRows = useMemo(() => {
    if (section !== "health") return [] as { id: string; name: string }[];
    return listFailedChannelIds()
      .slice(0, 8)
      .map((id) => {
        const channel = channels.find((item) => item.id === id);
        return { id, name: channel?.name || id };
      });
  }, [channels, section]);
  const lockableGroups = useMemo(() => {
    const groups = ["Movies", "Kids"];
    const seen = new Set(groups);
    for (const channel of channels) {
      const name = String(channel.group || "").trim();
      if (!name || seen.has(name) || !ADULT_GROUP_RE.test(name)) continue;
      seen.add(name);
      groups.push(name);
      if (groups.length >= 10) break;
    }
    return groups;
  }, [channels]);

  const choose = useCallback((id: Section) => {
    void Haptics.selectionAsync().catch(() => undefined);
    setBackupStatus(null);
    setClearFavoritesArmed(false);
    if (id === "playlists") { router.push("/playlists" as any); return; }
    if (id === "epg") {
      router.push("/epg-sources" as any);
      return;
    }
    setSection(id);
  }, [router]);

  const exportDiagnostics = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const snap = await sourceDiagnostics();
      const body = formatDiagnosticsExport({
        diagnostics: snap,
        appVersion,
        preferTvgIdOnly,
        powerProfile,
        guideFilter: epgGuideFilter,
        extras: {
          guideWindowHours,
          clock24h,
          startScreen,
          sleepTimerMinutes,
          logosOffWhileSurfing,
          favorites: favorites.length,
          ...audioDiagnosticsExtras(),
        },
      });
      const root = FileSystem.documentDirectory || "";
      if (!root || Platform.OS === "web") {
        setBackupStatus("Diagnostics ready (copy unavailable on this platform).");
        return;
      }
      const path = `${root}charmiptv-diagnostics-${Date.now()}.txt`;
      await FileSystem.writeAsStringAsync(path, body);
      setBackupStatus(`Diagnostics saved to ${path.split("/").pop()}`);
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Diagnostics export failed.");
    } finally {
      setBusy(false);
    }
  }, [
    appVersion,
    busy,
    clock24h,
    epgGuideFilter,
    favorites.length,
    guideWindowHours,
    logosOffWhileSurfing,
    powerProfile,
    preferTvgIdOnly,
    sleepTimerMinutes,
    startScreen,
  ]);

  const clearFavoritesDangerous = useCallback(async () => {
    if (busy) return;
    if (!clearFavoritesArmed) {
      setClearFavoritesArmed(true);
      setBackupStatus("Press again to confirm clear favorites.");
      if (clearFavoritesTimer.current) clearTimeout(clearFavoritesTimer.current);
      clearFavoritesTimer.current = setTimeout(() => setClearFavoritesArmed(false), 7000);
      return;
    }
    if (clearFavoritesTimer.current) {
      clearTimeout(clearFavoritesTimer.current);
      clearFavoritesTimer.current = null;
    }
    setBusy(true);
    setBackupStatus("Clearing all favorites…");
    try {
      replaceFavorites([]);
      setClearFavoritesArmed(false);
      setBackupStatus("Favorites cleared. This does not clear the guide cache.");
    } finally {
      setBusy(false);
    }
  }, [busy, clearFavoritesArmed, replaceFavorites]);

  const backupFavorites = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setBackupStatus("Saving favorites backup…");
    try {
      const raw = serializeFavoritesBackup(favorites, channels);
      const { fileName, portable } = await writeFavoritesBackup(raw);
      setBackupStatus(
        portable
          ? `Exported ${favorites.length} favorite${favorites.length === 1 ? "" : "s"} to ${fileName} in your chosen folder (and kept a local copy). Stream URLs are not stored.`
          : `Saved ${favorites.length} favorite${favorites.length === 1 ? "" : "s"} to ${fileName} in app storage. Choose a shared folder next time to make the backup portable. Stream URLs are not stored.`,
      );
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Favorites backup failed.");
    } finally {
      setBusy(false);
    }
  }, [busy, channels, favorites]);

  const restoreFavorites = useCallback(async () => {
    if (busy) return;
    if (!channels.length) {
      setBackupStatus("Channels must be loaded before restoring favorites.");
      return;
    }
    setBusy(true);
    setBackupStatus("Looking for the newest CharmIPTV favorites backup…");
    try {
      const { fileName, raw } = await readLatestFavoritesBackup();
      const restored = resolveFavoritesBackup(raw, channels);
      replaceFavorites(restored);

      const unavailableCount = restored.unavailable.length;
      const unavailableNames = restored.unavailable
        .map((item) => item.name || item.tvgId || item.id)
        .filter(Boolean)
        .slice(0, 3);
      const skippedSummary = unavailableCount
        ? ` ${unavailableCount} unavailable favorite${unavailableCount === 1 ? " was" : "s were"} skipped${unavailableNames.length ? ` (${unavailableNames.join(", ")}${unavailableCount > unavailableNames.length ? ", …" : ""})` : ""}.`
        : " All favorites matched current playable channels.";

      setBackupStatus(
        `Restored ${restored.length} favorite${restored.length === 1 ? "" : "s"} from ${fileName}.${skippedSummary}`,
      );
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Favorites restore failed.");
    } finally {
      setBusy(false);
    }
  }, [busy, channels, replaceFavorites]);

  const backupEverything = useCallback(async () => {
    if (busy) return;
    setBusy(true); setBackupStatus("Creating a complete CharmIPTV backup…");
    try {
      const result = await writeFullBackup();
      setBackupStatus(`${result.portable ? "Exported" : "Saved"} ${result.fileName}. It includes settings, playlists, source addresses, EPG assignments, hidden/order choices, and custom groups. Keep it private.`);
    } catch (error) { setBackupStatus(error instanceof Error ? error.message : "Full backup failed."); }
    finally { setBusy(false); }
  }, [busy]);

  const restoreEverything = useCallback(async () => {
    if (busy) return;
    setBusy(true); setBackupStatus("Validating and restoring the newest complete backup…");
    try {
      const name = await restoreFullBackup();
      setBackupStatus(`Restored ${name} with integrity checks and rollback protection. Restart CharmIPTV once so every restored setting is reloaded.`);
    } catch (error) { setBackupStatus(error instanceof Error ? error.message : "Full restore failed; previous settings were kept."); }
    finally { setBusy(false); }
  }, [busy]);

  return (
    <PurpleTvShell active="/settings">
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <PurpleDrawerButton testID="settings-open-drawer" />
            {section ? (
              <Pressable
                ref={detailEntryFocus.targetRef as any}
                hasTVPreferredFocus={detailEntryFocus.preferredFocus}
                nextFocusLeft={iconRailEntryTag}
                onFocus={detailEntryFocus.onFocus}
                onBlur={detailEntryFocus.onBlur}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  setBackupStatus(null);
                  setClearFavoritesArmed(false);
                  setSection(null);
                }}
                style={({ focused }: any) => [styles.backButton, focused && styles.focused]}
                testID="settings-all-settings"
              >
                <Ionicons name="arrow-back" size={14} color="#fff" />
                <Text style={styles.backText}>All Settings</Text>
              </Pressable>
            ) : null}
            <View>
              <Text style={styles.kicker}>SYSTEM</Text>
              <Text style={styles.title}>{selected ? selected.label : "Settings"}</Text>
            </View>
          </View>
        </View>

        {!section ? (
          <FocusGuide style={styles.tileGridWrap}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.tileGrid}
            >
              {TILES.map((tile, index) => (
                <Pressable
                  key={tile.id}
                  ref={index === 0 ? tileEntryFocus.targetRef as any : undefined}
                  hasTVPreferredFocus={tileEntryFocus.preferredFocus && index === 0}
                  nextFocusLeft={index % 4 === 0 ? iconRailEntryTag : undefined}
                  onFocus={index === 0 ? tileEntryFocus.onFocus : undefined}
                  onBlur={index === 0 ? tileEntryFocus.onBlur : undefined}
                  onPress={() => choose(tile.id)}
                  style={({ focused }: any) => [styles.tile, focused && styles.focused]}
                  testID={`settings-tile-${tile.id}`}
                >
                  <View style={styles.tileIcon}><Ionicons name={tile.icon} size={27} color={tvColors.purpleSoft} /></View>
                  <Text style={styles.tileText}>{tile.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </FocusGuide>
        ) : (
          <FocusGuide style={styles.detailsWrap}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.details}>

            {section === "general" ? (
              <SettingsCard title="Guide & channels" icon="list-outline">
                <ChoiceRow<GuideLayout>
                  label="Guide layout"
                  value={guideLayout}
                  options={[{ label: "Timeline", value: "cinematic" }, { label: "Mobile", value: "compact" }]}
                  onChange={setGuideLayout}
                />
                {guideLayout === "cinematic" ? (
                  <ChoiceRow<GuideDensity>
                    label="Guide density"
                    value={guideDensity}
                    options={[{ label: "Comfortable", value: "large" }, { label: "Normal", value: "normal" }, { label: "Compact", value: "compact" }, { label: "Extra compact", value: "extra_compact" }]}
                    onChange={setGuideDensity}
                  />
                ) : (
                  <Text style={styles.help}>Guide density applies to Timeline layout. Mobile uses block cards sized for phones and touch.</Text>
                )}
                <ChoiceRow<SafePreviewMode>
                  label="Live preview"
                  value={safePreviewMode}
                  options={[
                    { label: "Normal", value: "on" },
                    { label: "Delayed", value: "delayed" },
                    { label: "Off while surfing", value: "surf" },
                    { label: "Off", value: "off" },
                  ]}
                  onChange={setSafePreviewMode}
                />
                <Text style={styles.help}>
                  Off while surfing soft-clears preview during D-pad surfing and arms after settle. Preview never shares a decoder with fullscreen.
                </Text>
                <ToggleRow label="Channel numbers" value={channelNumbers} onChange={setChannelNumbers} />
                <ToggleRow label="Channel logos" value={channelLogos} onChange={setChannelLogos} />
                <ToggleRow label="Logos off while surfing" value={logosOffWhileSurfing} onChange={setLogosOffWhileSurfing} />
                <ToggleRow label="Instant Guide / reduce motion" value={instantGuide} onChange={setInstantGuide} />
                <Text style={styles.help}>Snaps Guide movement and avoids repeated transition work during fast remote navigation.</Text>
                <ChoiceRow<PowerProfile>
                  label="Power profile"
                  value={powerProfile}
                  options={POWER_PROFILE_OPTIONS}
                  onChange={setPowerProfile}
                />
                <Text style={styles.help}>
                  Compatibility lengthens preview arm and settle times for older devices. Max preview arms sooner on stronger devices.
                </Text>
                <ToggleRow label="24-hour clock" value={clock24h} onChange={setClock24h} />
                <ChoiceRow<StartScreen>
                  label="Start screen"
                  value={startScreen}
                  options={[
                    { label: "Home", value: "home" },
                    { label: "Guide", value: "guide" },
                    { label: "Last channel", value: "last_channel" },
                  ]}
                  onChange={setStartScreen}
                />
              </SettingsCard>
            ) : null}

            {section === "player" ? (
              <SettingsCard title="Playback" icon="play-circle-outline">
                <Text style={styles.settingLabel}>Live TV player</Text>
                <Text style={styles.help}>
                  All supported streams play in Media3/ExoPlayer. Brief source buffering keeps the current player; recoverable network errors retry within Media3. No alternate player is installed.
                </Text>
                <ChoiceRow<PlayerControlsTimeoutMs>
                  label="Controls timeout"
                  value={playerControlsTimeoutMs}
                  options={[{ label: "8 sec", value: 8000 }, { label: "15 sec", value: 15000 }, { label: "30 sec", value: 30000 }, { label: "60 sec", value: 60000 }]}
                  onChange={setPlayerControlsTimeoutMs}
                />
                <ChoiceRow<LongDownAction>
                  label="Remote · Long Down"
                  value={remoteShortcuts.longDown}
                  options={[
                    { label: "Open channel bar", value: "channels" },
                    { label: "Open TV Guide", value: "guide" },
                    { label: "No shortcut", value: "none" },
                  ]}
                  onChange={remoteShortcuts.setLongDown}
                />
                <Text style={styles.help}>Long OK/Select is reserved for contextual Quick Actions. Directional D-pad keys remain deterministic; Long Down is the only remappable D-pad hold.</Text>
                <ChoiceRow<PlaybackBufferProfile>
                  label="Buffer size"
                  value={playbackBufferProfile}
                  options={[
                    { label: "Small", value: "low_latency" },
                    { label: "Medium", value: "balanced" },
                    { label: "Large", value: "stable" },
                  ]}
                  onChange={setPlaybackBufferProfile}
                />
                <Text style={styles.help}>Small starts sooner; Medium balances startup and jitter; Large is the 48 MB-capped TV default.</Text>
                <ChoiceRow<SleepTimerMinutes>
                  label="Sleep timer"
                  value={sleepTimerMinutes}
                  options={[
                    { label: "Off", value: 0 },
                    { label: "15m", value: 15 },
                    { label: "30m", value: 30 },
                    { label: "60m", value: 60 },
                    { label: "90m", value: 90 },
                  ]}
                  onChange={setSleepTimerMinutes}
                />
                <View style={styles.divider} />
                <Text style={styles.settingLabel}>Audio / CC</Text>
                <Text style={styles.help}>
                  Preferred audio language auto-selects a matching native Media3 track.
                  The last working track is remembered per channel (up to 128). Use Audio/CC in the fullscreen player to pick a track manually.
                </Text>
                <ChoiceRow<string>
                  label="Preferred audio language"
                  value={audioPreferences.defaultLanguage}
                  options={PREFERRED_AUDIO_LANGUAGE_OPTIONS}
                  onChange={audioPreferences.setDefaultLanguage}
                />
                <View style={styles.divider} />
                <Text style={styles.settingLabel}>Subtitles (CC)</Text>
                <Text style={styles.help}>Default language auto-selects when tracks appear. Size/background are stored for Settings (native burn-in styling is not available yet).</Text>
                <View style={styles.pinInputRow}>
                  <Text style={styles.infoLabel}>Default language</Text>
                  <TextInput
                    value={subtitles.defaultLanguage}
                    onChangeText={subtitles.setDefaultLanguage}
                    placeholder="eng"
                    placeholderTextColor={tvColors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={16}
                    style={styles.pinInput}
                    testID="settings-subtitle-lang"
                  />
                </View>
                <ChoiceRow<SubtitleSize>
                  label="Subtitle size"
                  value={subtitles.size}
                  options={[
                    { label: "Small", value: "small" },
                    { label: "Normal", value: "normal" },
                    { label: "Large", value: "large" },
                  ]}
                  onChange={subtitles.setSize}
                />
                <ChoiceRow<SubtitleBg>
                  label="Subtitle background"
                  value={subtitles.background}
                  options={[
                    { label: "None", value: "none" },
                    { label: "Dim", value: "dim" },
                    { label: "Solid", value: "solid" },
                  ]}
                  onChange={subtitles.setBackground}
                />
                <View style={styles.divider} />
                <Text style={styles.settingLabel}>Guide preview</Text>
                <ToggleRow label="Mute preview by default" value={guideUi.mutePreview} onChange={guideUi.setMutePreview} />
                <ToggleRow label="Hide preview by default" value={guideUi.hidePreview} onChange={guideUi.setHidePreview} />
              </SettingsCard>
            ) : null}

            {section === "health" ? (
              <SettingsCard title="Health" icon="pulse-outline">
                <InfoRow
                  label="Native codecs"
                  value={codecCapabilities
                    ? [codecCapabilities.h264 && "H.264", codecCapabilities.hevc && "HEVC", codecCapabilities.vp9 && "VP9", codecCapabilities.av1 && "AV1", codecCapabilities.aac && "AAC", codecCapabilities.ac3 && "AC-3", codecCapabilities.eac3 && "E-AC-3"].filter(Boolean).join(", ")
                    : "Unavailable"}
                />
                <InfoRow
                  label="FFmpeg audio extension"
                  value={codecCapabilities ? (codecCapabilities.ffmpegAudio ? "Available (AC-3 soft decode)" : "Missing — rebuild APK") : "Unavailable"}
                />
                <InfoRow
                  label="Advertised video max"
                  value={codecCapabilities?.maxWidth ? `${codecCapabilities.maxWidth} × ${codecCapabilities.maxHeight}` : "Unavailable"}
                />
                <InfoRow label="Failed streams" value={String(failedStreamCount())} />
                <InfoRow
                  label="Last audio engine"
                  value={latestAudio?.engine ? String(latestAudio.engine).toUpperCase() : "—"}
                />
                <InfoRow
                  label="Last audio mime"
                  value={latestAudio?.mimeType || "—"}
                />
                <InfoRow
                  label="Last audio decoder"
                  value={latestAudio?.decoder || "—"}
                />
                <InfoRow
                  label="Audio tracks seen"
                  value={latestAudio?.trackCount != null ? String(latestAudio.trackCount) : "—"}
                />
                <Action label="Report cache storage" icon="server-outline" onPress={() => void (async () => {
                  const report = await getCacheStorageReport();
                  if (!report) return setBackupStatus("Cache storage report is unavailable.");
                  const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`;
                  setBackupStatus(`Cache ${mib(report.cacheDiskBytes)} · Logos ${mib(report.logoDiskBytes)} · Databases ${mib(report.databaseBytes)}`);
                })()} />
                <Action label="Prune old disk cache" icon="trash-bin-outline" onPress={() => void (async () => {
                  const report = await pruneDiskCaches(14);
                  if (!report) return setBackupStatus("Disk cache pruning is unavailable.");
                  setBackupStatus(`Removed ${report.removedFiles} old cache files (${(report.removedBytes / 1048576).toFixed(1)} MiB).`);
                })()} />
                <Action label={busy ? "Working…" : "Export diagnostics"} icon="document-text-outline" onPress={exportDiagnostics} disabled={busy} />
                {backupStatus && section === "health" ? <Text style={styles.status}>{backupStatus}</Text> : null}
                {failedChannelRows.length ? (
                  <View style={styles.matchBlock}>
                    <Text style={styles.settingLabel}>Recent failed channels</Text>
                    {failedChannelRows.map((row) => (
                      <InfoRow key={row.id} label={row.name} value={row.id.slice(0, 18)} />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.help}>No recent stream failures recorded this session.</Text>
                )}
              </SettingsCard>
            ) : null}

            {section === "channels" ? (
              <SettingsCard title="Channels" icon="list-circle-outline">
                <Text style={styles.help}>
                  All channels are available in 100-row pages so very large playlists stay memory-safe. Focus a channel, then Hide, Move, or set a custom number.
                </Text>
                <Action label="Manage custom channel groups" icon="albums-outline" onPress={() => router.push("/group-settings" as any)} />
                <View style={styles.backupActions}>
                  <Action label="Previous 100" icon="chevron-up-outline" disabled={channelEditPage <= 0} onPress={() => { setFocusedCustomizeId(null); setChannelEditPage((value) => Math.max(0, value - 1)); }} />
                  <InfoRow label="Channel page" value={`${channelEditPage + 1} / ${channelEditPageCount}`} />
                  <Action label="Next 100" icon="chevron-down-outline" disabled={channelEditPage + 1 >= channelEditPageCount} onPress={() => { setFocusedCustomizeId(null); setChannelEditPage((value) => Math.min(channelEditPageCount - 1, value + 1)); }} />
                </View>
                <Action
                  label="Clear custom order"
                  icon="refresh-outline"
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => undefined);
                    channelCustomize.clearCustomOrder();
                    setBackupStatus("Custom channel order cleared.");
                  }}
                />
                {backupStatus && section === "channels" ? <Text style={styles.status}>{backupStatus}</Text> : null}
                {customizeChannels.map((channel, index) => {
                  const hidden = hiddenSet.has(channel.id);
                  const focused = focusedCustomizeId === channel.id;
                  const customNumber = channelCustomize.customNumbers[channel.id];
                  const displayNumber = customNumber || channelEditPage * 100 + index + 1;
                  return (
                    <View key={channel.id} style={styles.channelEditBlock}>
                      <Pressable
                        onFocus={() => setFocusedCustomizeId(channel.id)}
                        onPress={() => setFocusedCustomizeId(channel.id)}
                        style={({ focused: rowFocused }: any) => [
                          styles.settingRow,
                          (focused || rowFocused) && styles.focused,
                        ]}
                      >
                        <Text numberOfLines={1} style={styles.settingLabel}>
                          {displayNumber}. {channel.name}
                        </Text>
                        <Text style={styles.infoValue}>{hidden ? "Hidden" : "Visible"}</Text>
                      </Pressable>
                      {focused ? (
                        <>
                          <View style={styles.channelEditActions}>
                            <Pressable
                              onPress={() => channelCustomize.toggleHidden(channel.id)}
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                            >
                              <Text style={styles.miniActionText}>{hidden ? "Show" : "Hide"}</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => channelCustomize.moveInCustomOrder(channel.id, -1, channelEditIds)}
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                            >
                              <Text style={styles.miniActionText}>Up</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => channelCustomize.moveInCustomOrder(channel.id, 1, channelEditIds)}
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                            >
                              <Text style={styles.miniActionText}>Down</Text>
                            </Pressable>
                          </View>
                          <View style={styles.channelEditActions}>
                            <Pressable
                              onPress={() =>
                                channelCustomize.setCustomNumber(
                                  channel.id,
                                  Math.max(1, (customNumber || displayNumber) - 1),
                                )
                              }
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                              testID="settings-channel-number-dec"
                            >
                              <Text style={styles.miniActionText}>Num −</Text>
                            </Pressable>
                            <Text style={styles.infoValue}>#{displayNumber}</Text>
                            <Pressable
                              onPress={() =>
                                channelCustomize.setCustomNumber(
                                  channel.id,
                                  Math.min(99999, (customNumber || displayNumber) + 1),
                                )
                              }
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                              testID="settings-channel-number-inc"
                            >
                              <Text style={styles.miniActionText}>Num +</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => channelCustomize.setCustomNumber(channel.id, null)}
                              style={({ focused: btnFocused }: any) => [styles.miniAction, btnFocused && styles.focused]}
                            >
                              <Text style={styles.miniActionText}>Clear #</Text>
                            </Pressable>
                          </View>
                        </>
                      ) : null}
                    </View>
                  );
                })}
              </SettingsCard>
            ) : null}

            {section === "parental" ? (
              <SettingsCard title="Parental" icon="lock-closed-outline">
                <Text style={styles.help}>
                  PIN unlocks locked groups for this app session. Lock session again to re-require the PIN.
                </Text>
                <InfoRow label="PIN" value={parental.hasPin ? "Set" : "Not set"} />
                <View style={styles.pinInputRow}>
                  <TextInput
                    value={pinDraft}
                    onChangeText={(value) => setPinDraft(value.replace(/\D/g, "").slice(0, 8))}
                    placeholder="4–8 digit PIN"
                    placeholderTextColor={tvColors.textMuted}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={8}
                    style={styles.pinInput}
                    testID="settings-parental-pin"
                  />
                </View>
                <View style={styles.backupActions}>
                  <Action
                    label="Set PIN"
                    icon="key-outline"
                    onPress={() => {
                      if (pinDraft.replace(/\D/g, "").length < 4) {
                        setBackupStatus("PIN must be at least 4 digits.");
                        return;
                      }
                      parental.setPin(pinDraft);
                      setPinDraft("");
                      setBackupStatus("Parental PIN saved.");
                    }}
                  />
                  <Action
                    label="Clear PIN"
                    icon="trash-outline"
                    onPress={() => {
                      parental.setPin(null);
                      setPinDraft("");
                      setBackupStatus("Parental PIN cleared.");
                    }}
                  />
                  <Action
                    label="Lock session now"
                    icon="lock-closed-outline"
                    onPress={() => {
                      parental.lockSession();
                      setBackupStatus("Session locked. Locked groups require PIN again.");
                    }}
                  />
                </View>
                {backupStatus && section === "parental" ? <Text style={styles.status}>{backupStatus}</Text> : null}
                <Text style={[styles.settingLabel, { marginTop: 6 }]}>Locked groups</Text>
                {lockableGroups.map((group) => {
                  const locked = parental.lockedGroups.includes(group);
                  return (
                    <ToggleRow
                      key={group}
                      label={group}
                      value={locked}
                      onChange={(next) => {
                        const set = new Set(parental.lockedGroups);
                        if (next) set.add(group);
                        else set.delete(group);
                        parental.setLockedGroups(Array.from(set));
                      }}
                    />
                  );
                })}
              </SettingsCard>
            ) : null}

            {section === "remote" ? (
              <SettingsCard title="Remote Control" icon="game-controller-outline">
                <ChoiceRow<PlayerRemoteAction> label="Channel Up button" value={remoteShortcuts.channelUp} options={PLAYER_REMOTE_ACTIONS} onChange={remoteShortcuts.setChannelUp} />
                <ChoiceRow<PlayerRemoteAction> label="Channel Down button" value={remoteShortcuts.channelDown} options={PLAYER_REMOTE_ACTIONS} onChange={remoteShortcuts.setChannelDown} />
                <ChoiceRow<PlayerRemoteAction> label="Play/Pause media button" value={remoteShortcuts.mediaPlayPause} options={PLAYER_REMOTE_ACTIONS} onChange={remoteShortcuts.setMediaPlayPause} />
                <ChoiceRow<LongDownAction>
                  label="Long Down"
                  value={remoteShortcuts.longDown}
                  options={[{ label: "Open channel bar", value: "channels" }, { label: "Open TV Guide", value: "guide" }, { label: "No shortcut", value: "none" }]}
                  onChange={remoteShortcuts.setLongDown}
                />
                <Text style={styles.help}>Long OK/Select always opens contextual Quick Actions. Other hardware mappings apply only while fullscreen playback owns the remote.</Text>
                <Action label="Restore remote defaults" icon="refresh-outline" onPress={remoteShortcuts.reset} />
                <View style={styles.divider} />
                <ToggleRow label="Pointer mode" value={pointerMode} onChange={setPointerMode} />
                <Text style={styles.help}>D-pad remains the primary TV navigation method. Pointer mode is a fallback for devices with unreliable native focus.</Text>
              </SettingsCard>
            ) : null}

            {section === "appearance" ? (
              <SettingsCard title="Appearance" icon="color-palette-outline">
                <ChoiceRow<DeviceLayoutMode>
                  label="Device layout"
                  value={deviceLayoutMode}
                  options={[{ label: "Auto", value: "auto" }, { label: "TV", value: "tv" }, { label: "Mobile", value: "mobile" }]}
                  onChange={setDeviceLayoutMode}
                />
                <ChoiceRow<GuideDensity>
                  label="Guide density"
                  value={guideDensity}
                  options={[{ label: "Comfortable", value: "large" }, { label: "Normal", value: "normal" }, { label: "Compact", value: "compact" }, { label: "Extra compact", value: "extra_compact" }]}
                  onChange={setGuideDensity}
                />
                <ToggleRow
                  label="Instant Guide / reduce motion"
                  value={instantGuide}
                  onChange={setInstantGuide}
                />
                <Text style={styles.help}>
                  Snaps Guide panning and drawer motion so focus borders and metadata keep pace with rapid remote input. Enabled by default.
                </Text>
                <ToggleRow label="Mute guide preview" value={guideUi.mutePreview} onChange={guideUi.setMutePreview} />
                <ToggleRow label="Hide guide preview" value={guideUi.hidePreview} onChange={guideUi.setHidePreview} />
                <View style={styles.calibrationWrap}><TvCalibrationControls /></View>
              </SettingsCard>
            ) : null}

            {section === "backup" ? (
              <SettingsCard title="Backup & Restore" icon="cloud-download-outline">
                <Text style={styles.help}>Complete backups include source addresses and may contain provider credentials. Keep the file private. Restore validates the file first and rolls back live settings if any write fails.</Text>
                <View style={styles.backupActions}>
                  <Action label={busy ? "Working…" : "Back Up Complete App"} icon="archive-outline" onPress={backupEverything} disabled={busy} />
                  <Action label={busy ? "Working…" : "Restore Complete App"} icon="reload-outline" onPress={restoreEverything} disabled={busy} />
                </View>
                <View style={styles.divider} />
                <Text style={styles.help}>Favorites backups are portable JSON files. Back Up writes a local copy and offers a shared folder (Downloads / USB) via the system picker so you can move the file off this device. They contain channel identity only—never stream URLs. Restore matches the current playlist and uses the current build&apos;s stream, logo and EPG data.</Text>
                <View style={styles.backupActions}>
                  <Action label={busy ? "Working…" : "Back Up Favorites"} icon="save-outline" onPress={backupFavorites} disabled={busy} />
                  <Action label={busy ? "Working…" : "Restore Favorites"} icon="download-outline" onPress={restoreFavorites} disabled={busy} />
                </View>
                {backupStatus ? <Text style={styles.status}>{backupStatus}</Text> : null}
                <View style={styles.divider} />
                <Text style={styles.help}>
                  Clear favorites is destructive and separate from guide cache. Export a backup first if you may need them later.
                </Text>
                <Action
                  label={
                    busy
                      ? "Working…"
                      : clearFavoritesArmed
                        ? "Confirm clear all favorites"
                        : "Clear all favorites"
                  }
                  icon="warning-outline"
                  onPress={clearFavoritesDangerous}
                  disabled={busy || favorites.length === 0}
                />
              </SettingsCard>
            ) : null}

            {section === "account" ? (
              <SettingsCard title="Account" icon="person-outline">
                <InfoRow label="Username" value={accountUser?.username || "—"} />
                {accountUser?.email ? <InfoRow label="Email" value={accountUser.email} /> : null}
                <InfoRow label="Status" value={accountUser?.status || "Active"} />
                <InfoRow label="Account expires" value={formatAccountExpiry(accountUser?.expires_at)} />
                <InfoRow label="Account time remaining" value={formatTimeRemaining(accountUser?.expires_at)} />
                <InfoRow label="Simultaneous sessions" value={accountUser?.max_sessions != null ? String(accountUser.max_sessions) : "Managed by account"} />
                <Text style={styles.help}>Session limits and expired or revoked access are enforced by the CharmIPTV account service.</Text>
                <Action label="Sign Out" icon="log-out-outline" onPress={() => void signOut()} />
                <View style={styles.divider} />
                <Text style={styles.dangerTitle}>Permanently cancel account</Text>
                <Text style={styles.help}>This immediately deletes your account, sessions, personal information, and server-side preferences. It cannot be undone. If this account used a friend&apos;s invitation, their available capacity is returned automatically.</Text>
                {!cancelArmed ? (
                  <Action label="Cancel Account" icon="trash-outline" onPress={() => setCancelArmed(true)} />
                ) : (
                  <View style={styles.cancelBlock}>
                    <View style={styles.cancelNotice}>
                      <Text style={styles.dangerTitle}>Are you absolutely sure?</Text>
                      <Text style={styles.help}>Your sign-in, account timer, sessions, and personal account data will be permanently erased. You will need a new invitation to return. Enter your password, then type &quot;please cancel me&quot; to unlock the final cancellation.</Text>
                    </View>
                    <TextInput
                      value={cancelPassword}
                      onChangeText={setCancelPassword}
                      editable={!cancelBusy}
                      secureTextEntry
                      placeholder="Enter current password"
                      placeholderTextColor="#777184"
                      style={styles.pinInput}
                      testID="cancel-account-password"
                    />
                    <TextInput
                      value={cancelPhrase}
                      onChangeText={setCancelPhrase}
                      editable={!cancelBusy}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder='Type "please cancel me"'
                      placeholderTextColor="#777184"
                      style={styles.pinInput}
                      testID="cancel-account-confirmation"
                    />
                    <View style={styles.backupActions}>
                      <Action label={cancelBusy ? "Deleting…" : "Cancel My Account Forever"} icon="warning-outline" onPress={() => void permanentlyCancel()} disabled={cancelBusy || !cancelPassword || cancelPhrase.trim().toLowerCase() !== "please cancel me"} />
                      <Action label="Keep Account" icon="close-outline" onPress={() => { setCancelArmed(false); setCancelPassword(""); setCancelPhrase(""); setCancelStatus(null); }} disabled={cancelBusy} />
                    </View>
                  </View>
                )}
                {cancelStatus ? <Text style={styles.errorStatus}>{cancelStatus}</Text> : null}
              </SettingsCard>
            ) : null}

            {section === "invites" ? (
              <SettingsCard title="Family & Friend Invites" icon="gift-outline">
                <InfoRow label="Code opportunities available" value={referral ? `${referral.available} of ${referral.limit}` : referralBusy ? "Loading…" : "—"} />
                <InfoRow label="Active invited accounts" value={referral ? `${referral.active_accounts} of ${referral.active_limit}` : "—"} />
                <InfoRow label="Family positions available" value={referral ? `${referral.network_available} of ${referral.active_limit}` : "—"} />
                <InfoRow label="Used this 6-month period" value={referral ? String(referral.used) : "—"} />
                <InfoRow label="Active unused codes" value={referral ? String(referral.active) : "—"} />
                <InfoRow label="Renews" value={formatAccountDateTime(referral?.renews_at)} />
                <Text style={styles.help}>You can keep up to two code opportunities and six active invited accounts. Each generated code expires after three days if unused and returns automatically. When an invited account is canceled or expires, its family position and one code opportunity return, without ever stacking above two.</Text>
                <Action
                  label={referralBusy ? "Working…" : "Generate Invite"}
                  icon="add-circle-outline"
                  onPress={() => void generateInvite()}
                  disabled={referralBusy || !referral || referral.available < 1}
                />
                {referralStatus ? <Text style={styles.status}>{referralStatus}</Text> : null}
                {referral?.invitations.length ? (
                  <View style={styles.inviteList}>
                    {referral.invitations.map((invite) => (
                      <View key={invite.id} style={styles.inviteRow}>
                        <View style={styles.inviteMain}>
                          <Text style={styles.inviteLabel}>Invite {invite.network_slot_number || "—"}</Text>
                          <Text style={styles.inviteCode}>{invite.invite_code}</Text>
                          <Text style={styles.help}>
                            {invite.status === "unused"
                              ? `Sent ${formatAccountDateTime(invite.created_at)} · Code expires ${formatAccountDateTime(invite.expires_at)}`
                              : invite.status === "active"
                                ? `Activated ${formatAccountDateTime(invite.redeemed_at)} · ${formatTimeRemaining(invite.account_expires_at)}`
                                : `Ended ${formatAccountDateTime(invite.ended_at)} · Capacity returned`}
                          </Text>
                        </View>
                        <View style={styles.inviteStatusBlock}>
                          <View style={styles.statusLine}>
                            <View style={[styles.statusDot, invite.status === "active" || invite.status === "unused" ? styles.statusDotActive : styles.statusDotEnded]} />
                            <Text style={styles.inviteStatus}>
                              {invite.status === "active" ? "ACTIVE" : invite.status === "unused" ? "PENDING" : invite.status.replace("_", " ").toUpperCase()}
                            </Text>
                          </View>
                          {["code_expired", "account_expired", "canceled", "disabled"].includes(invite.status) ? (
                            <Action label="Delete" icon="trash-outline" onPress={() => void removeInviteHistory(invite.id)} disabled={referralBusy} />
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : referral && !referralBusy ? <Text style={styles.help}>You have not generated any invitation codes yet.</Text> : null}
              </SettingsCard>
            ) : null}

            {section === "about" ? (
              <SettingsCard title="About CharmIPTV" icon="information-circle-outline">
                <InfoRow label="Version" value={appVersion} />
                <InfoRow label="Android build" value={versionCode ? String(versionCode) : "—"} />
                <InfoRow label="Interface" value="Purple TV experiment" />
                <InfoRow label="Install package" value="Purple / side-by-side" />
                <InfoRow label="Core" value="perf/opt-fix performance grade" />
                <Text style={styles.help}>This branch changes presentation and navigation while preserving the optimized playback, guide, cache, and source architecture underneath.</Text>
                <View style={styles.divider} />
                <Text style={styles.help}>Questions, announcements, and community help:</Text>
                <Action label="Open CharmIPTV Telegram" icon="paper-plane-outline" onPress={() => void Linking.openURL(TELEGRAM_COMMUNITY_URL)} />
                <View style={styles.divider} />
                <Text style={styles.settingLabel}>Account privacy</Text>
                <Text style={styles.help}>CharmIPTV keeps the username, email, password hash, account timer, and session records needed to operate your account. Canceling or reaching the account expiration time permanently removes that account data. A referring user may retain only an anonymous Invite number, status, and dates—never your username, email, or password.</Text>
              </SettingsCard>
            ) : null}
          </ScrollView>
          </FocusGuide>
        )}
      </View>
    </PurpleTvShell>
  );
}

function SettingsCard({ title, icon, children }: { title: string; icon: React.ComponentProps<typeof Ionicons>["name"]; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}><Ionicons name={icon} size={18} color={tvColors.purpleSoft} /></View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={({ focused }: any) => [styles.settingRow, focused && styles.focused]}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={[styles.toggle, value && styles.toggleOn]}><View style={[styles.knob, value && styles.knobOn]} /></View>
    </Pressable>
  );
}

function ChoiceRow<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { label: string; value: T }[]; onChange: (value: T) => void }) {
  return (
    <View style={styles.choiceBlock}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.choices}>
        {options.map((option) => (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            style={({ focused }: any) => [styles.choice, option.value === value && styles.choiceActive, focused && styles.focused]}
          >
            <Text style={[styles.choiceText, option.value === value && styles.choiceTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Action({ label, icon, onPress, disabled }: { label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ focused }: any) => [styles.action, disabled && styles.disabled, focused && styles.focused]}>
      <Ionicons name={icon} size={14} color="#fff" />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minWidth: 0, padding: 14, overflow: "hidden" },
  header: { minHeight: 52, flexShrink: 0, zIndex: 2, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line, backgroundColor: tvColors.canvas },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  backButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panel },
  backText: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  tileGridWrap: { flex: 1, minHeight: 0, overflow: "hidden" },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", gap: 9, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24 },
  detailsWrap: { flex: 1 },
  tile: { width: "23.8%", minHeight: 118, alignItems: "center", justifyContent: "center", gap: 10, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  tileIcon: { width: 48, height: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: tvColors.purpleDeep },
  tileText: { color: "#fff", fontFamily: fonts.medium, fontSize: 9.5, textAlign: "center" },
  details: { paddingTop: 10, paddingHorizontal: 24, paddingBottom: 24 },
  card: { backgroundColor: tvColors.panel, borderWidth: 1, borderColor: tvColors.line, borderRadius: radius.md, padding: 14, gap: 9 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 9, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: tvColors.line },
  cardIcon: { width: 32, height: 32, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: tvColors.purpleDeep },
  cardTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12 },
  settingRow: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 5, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 8 },
  settingLabel: { color: "#fff", fontFamily: fonts.medium, fontSize: 9.5 },
  toggle: { width: 34, height: 19, borderRadius: 10, backgroundColor: "#343145", padding: 2 },
  toggleOn: { backgroundColor: tvColors.purple },
  knob: { width: 15, height: 15, borderRadius: 8, backgroundColor: "#817D91" },
  knobOn: { alignSelf: "flex-end", backgroundColor: "#fff" },
  choiceBlock: { gap: 7, paddingVertical: 4 },
  choices: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  choice: { minHeight: 29, justifyContent: "center", paddingHorizontal: 10, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  choiceActive: { backgroundColor: tvColors.purple },
  choiceText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  choiceTextActive: { color: "#fff" },
  action: { alignSelf: "flex-start", minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.purple },
  actionText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 8.5 },
  disabled: { opacity: 0.55 },
  backupActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  status: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 8.5, lineHeight: 12.5 },
  inviteList: { gap: 6, paddingTop: 4, borderTopWidth: 1, borderTopColor: tvColors.line },
  inviteRow: { minHeight: 68, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 5, backgroundColor: tvColors.panelRaised },
  inviteMain: { flex: 1, gap: 2 },
  inviteLabel: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 8.5 },
  inviteCode: { color: "#fff", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 },
  inviteStatusBlock: { alignItems: "flex-end", gap: 6 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusDotActive: { backgroundColor: "#55D889" },
  statusDotEnded: { backgroundColor: "#FF6868" },
  inviteStatus: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 8 },
  dangerTitle: { color: "#FF9191", fontFamily: fonts.semibold, fontSize: 10 },
  cancelBlock: { gap: 8 },
  cancelNotice: { gap: 5, padding: 9, borderRadius: 5, borderWidth: 1, borderColor: "#A74755", backgroundColor: "rgba(93, 24, 34, 0.4)" },
  errorStatus: { color: "#FF9191", fontFamily: fonts.medium, fontSize: 8.5, lineHeight: 12.5 },
  divider: { height: 1, backgroundColor: tvColors.line, marginVertical: 2 },
  infoRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  infoLabel: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5 },
  infoValue: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  help: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5, lineHeight: 12.5 },
  matchBlock: { gap: 2, paddingTop: 4, borderTopWidth: 1, borderTopColor: tvColors.line },
  matchGroups: { gap: 1, paddingTop: 4 },
  calibrationWrap: { borderTopWidth: 1, borderTopColor: tvColors.line, marginTop: 4, paddingTop: 8 },
  pinInputRow: { gap: 6 },
  pinInput: {
    minHeight: 36,
    borderWidth: 1,
    borderColor: tvColors.lineStrong,
    borderRadius: 5,
    paddingHorizontal: 10,
    color: "#fff",
    fontFamily: fonts.medium,
    fontSize: 11,
    backgroundColor: tvColors.panelRaised,
  },
  channelEditBlock: { gap: 3 },
  channelEditActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 8, paddingBottom: 4 },
  miniAction: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.panelRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  miniActionText: { color: "#fff", fontFamily: fonts.medium, fontSize: 8 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});

export default function SettingsScreen() {
  return (
    <FocusedTabMount>
      <SettingsScreenContent />
    </FocusedTabMount>
  );
}
