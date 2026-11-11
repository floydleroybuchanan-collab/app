import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, FlatList, LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Channel, Program } from "@/src/api";
import { NativeGuideCanvas } from "@/src/components/NativeGuideCanvas";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { fonts, glass, glassFocus, tvColors } from "@/src/theme";
import { usePlaylists } from "@/src/core/playlistRegistry";
import { playlistOwner } from "@/src/core/playlistCatalog";
import { buildPlaylistMenu, providerGroupKey } from "@/src/core/playlistGuideMenu";
import { fmtTime, progressPct } from "@/src/utils/time";
import { availableGuideDays, guidePanelOpacity, MAX_GUIDE_TRANSPARENCY, type GuidePresentationMode } from "@/src/core/guidePresentation";

type Props = {
  mode: GuidePresentationMode;
  transparency: number;
  channelTransparency: number;
  animationEnabled: boolean;
  autoplayOnFocus: boolean;
  stayInGuide: boolean;
  safeLeft: number;
  safeRight: number;
  safeTop: number;
  safeBottom: number;
  previewWidth: number;
  previewHeight: number;
  channels: Channel[];
  favoriteIds: readonly string[];
  /** Guide group the player was launched from (same key format as the Guide). */
  initialGroup?: string;
  playingChannel?: Channel;
  playingCurrent?: Program;
  playingNext?: Program;
  windowStart: string;
  windowEnd: string;
  channelNumbers: Record<string, number>;
  showLogos: boolean;
  onTune: (channel: Channel) => void;
  onDismiss: () => void;
  onModeChange: (mode: GuidePresentationMode) => void;
  onTransparencyChange: (value: number) => void;
  onChannelTransparencyChange: (value: number) => void;
  onAutoplayChange: (enabled: boolean) => void;
  onStayChange: (enabled: boolean) => void;
  onRunway: (ids: string[], priorityIds: string[]) => void;
};

/** Guide UI only: consumes existing native EPG and the existing fullscreen Media3 session. */
export function PlayerGuidePanel({
  mode, transparency, channelTransparency, animationEnabled, autoplayOnFocus, stayInGuide,
  safeLeft, safeRight, safeTop, safeBottom, previewWidth, previewHeight,
  channels, favoriteIds, initialGroup, playingChannel, playingCurrent, playingNext,
  windowStart, windowEnd, channelNumbers, showLogos,
  onTune, onDismiss, onModeChange, onTransparencyChange, onChannelTransparencyChange, onAutoplayChange, onStayChange, onRunway,
}: Props) {
  const sources = usePlaylists();
  const favoriteSetForMenu = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  // Same playlist -> group menu the Guide uses, built once per catalog change.
  const menu = useMemo(() => buildPlaylistMenu(sources, channels, favoriteSetForMenu, EMPTY_SET),
    [channels, favoriteSetForMenu, sources]);
  // Open on the playlist and group the viewer launched from: the Guide group
  // when started from the Guide, otherwise the playing channel's own group.
  const [playlist, setPlaylist] = useState(() => (playingChannel ? playlistOwner(playingChannel) : "all"));
  const [group, setGroup] = useState(() => {
    const launched = String(initialGroup || "").trim();
    if (launched && launched !== "All") return launched;
    return playingChannel?.group ? providerGroupKey(playingChannel.group) : "All";
  });
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [playlistsOpen, setPlaylistsOpen] = useState(false);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const [daysOpen, setDaysOpen] = useState(false);
  const [detail, setDetail] = useState<{ channel: Channel; program: Program } | null>(null);
  const [focus, setFocus] = useState<{ channel: Channel; program?: Program } | null>(null);
  const [restoreTimeMs, setRestoreTimeMs] = useState<number | null>(null);
  const [restoreChannelId, setRestoreChannelId] = useState<string | null>(playingChannel?.id || null);
  const [nativeTag, setNativeTag] = useState<number | null>(null);
  const dayRef = useRef<any>(null);
  const groupRef = useRef<any>(null);
  const focusRetry = useRef<(() => void) | null>(null);
  const tuneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const favoriteSet = favoriteSetForMenu;
  const section = menu.find((item) => item.id === playlist) || menu[0];
  const groups = section?.groups || EMPTY_GROUPS;
  const currentGroup = groups.find((item) => item.key === group) || groups[0];
  const groupKey = currentGroup?.key || "All";
  const filtered = useMemo(() => {
    const inPlaylist = !section || section.id === "all" ? channels : channels.filter((channel) => playlistOwner(channel) === section.id);
    if (groupKey === "All") return inPlaylist;
    if (groupKey === "Favorites") return inPlaylist.filter((channel) => favoriteSet.has(channel.id));
    return inPlaylist.filter((channel) => providerGroupKey(channel.group || "") === groupKey);
  }, [channels, favoriteSet, groupKey, section]);
  const groupIndex = Math.max(0, groups.findIndex((item) => item.key === groupKey));
  const playlistIndex = Math.max(0, menu.findIndex((item) => item.id === section?.id));
  const days = useMemo(() => availableGuideDays(windowStart, windowEnd), [windowEnd, windowStart]);
  const active = !groupsOpen && !playlistsOpen && !daysOpen && detail === null;
  const visibleChannel = focus?.channel || playingChannel;
  const visibleProgram = focus?.program || playingCurrent;
  const panelAlpha = guidePanelOpacity(mode, transparency);
  const progress = visibleProgram ? progressPct(visibleProgram, new Date()) : 0;
  const panelBackground = `rgba(26,11,51,${panelAlpha.toFixed(3)})`;
  const requestGridFocus = useCallback(() => {
    focusRetry.current?.();
    focusRetry.current = requestNativeFocusWithRetry(nativeTag ?? undefined);
  }, [nativeTag]);
  useEffect(() => () => {
    focusRetry.current?.();
    if (tuneTimer.current) clearTimeout(tuneTimer.current);
  }, []);

  useEffect(() => {
    if (active) requestGridFocus();
    else focusRetry.current?.();
  }, [active, requestGridFocus]);

  const selectGroup = useCallback((name: string) => {
    if (tuneTimer.current) clearTimeout(tuneTimer.current);
    setGroup(name);
    setFocus(null);
    setRestoreChannelId(playingChannel?.id || null);
    setReloadGeneration((value) => value + 1);
    setGroupsOpen(false);
  }, [playingChannel?.id]);

  // Picking a playlist goes straight on to that playlist's groups.
  const selectPlaylist = useCallback((id: string) => {
    if (tuneTimer.current) clearTimeout(tuneTimer.current);
    setPlaylist(id);
    setGroup("All");
    setFocus(null);
    setReloadGeneration((value) => value + 1);
    setPlaylistsOpen(false);
    setGroupsOpen(true);
  }, []);

  const selectDay = useCallback((at: number) => {
    setRestoreTimeMs(Math.max(Date.parse(windowStart), Math.min(Date.parse(windowEnd) - 1, at + 30 * 60_000)));
    setDaysOpen(false);
  }, [windowEnd, windowStart]);

  const focusChannel = useCallback((channel: Channel, settled = true) => {
    if (!settled) return;
    setFocus({ channel });
    setRestoreChannelId(channel.id);
    if (tuneTimer.current) clearTimeout(tuneTimer.current);
    if (autoplayOnFocus && channel.id !== playingChannel?.id && channel.url) {
      // Avoid repeated codec/Media3 churn while the user is scrolling rapidly.
      tuneTimer.current = setTimeout(() => onTune(channel), 550);
    }
  }, [autoplayOnFocus, onTune, playingChannel?.id]);
  const focusProgram = useCallback((program: Program, channel: Channel, settled = true) => {
    if (!settled) return;
    setFocus({ channel, program });
    setRestoreChannelId(channel.id);
    if (tuneTimer.current) clearTimeout(tuneTimer.current);
  }, []);
  const tuneChannel = useCallback((channel: Channel) => {
    if (tuneTimer.current) clearTimeout(tuneTimer.current);
    onTune(channel);
    if (!stayInGuide) onDismiss();
  }, [onDismiss, onTune, stayInGuide]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (detail) { setDetail(null); return true; }
      if (daysOpen) { setDaysOpen(false); return true; }
      if (groupsOpen) { setGroupsOpen(false); return true; }
      if (playlistsOpen) { setPlaylistsOpen(false); return true; }
      return false;
    });
    return () => sub.remove();
  }, [daysOpen, detail, groupsOpen, playlistsOpen]);

  const openDays = useCallback(() => { setGroupsOpen(false); setPlaylistsOpen(false); setDaysOpen(true); }, []);
  const openGroups = useCallback(() => { setDaysOpen(false); setPlaylistsOpen(false); setGroupsOpen(true); }, []);
  const openPlaylists = useCallback(() => { setDaysOpen(false); setGroupsOpen(false); setPlaylistsOpen(true); }, []);
  const dayLabel = restoreTimeMs != null
    ? days.find((day) => restoreTimeMs >= day.at && restoreTimeMs < day.at + 86400000)?.label || "Date"
    : "Today";

  return (
    <View
      testID={mode === "overlay" ? "player-unified-guide-overlay" : "player-unified-guide-preview"}
      style={[styles.frame, mode === "overlay"
        ? { left: safeLeft + 14, right: safeRight + 14, bottom: safeBottom + 12, height: "72%" }
        : { left: safeLeft + 14, right: safeRight + 14, top: safeTop + 20, bottom: safeBottom + 10 }]}
    >
      {mode === "preview" ? (
        <View style={[styles.previewHeader, { height: previewHeight, backgroundColor: "transparent" }]}>
          {/* This transparent slot shows the already-mounted fullscreen player,
              repositioned by player.tsx. No second Media3 decoder is created. */}
          <View pointerEvents="none" style={{ width: previewWidth, height: previewHeight, backgroundColor: "transparent", borderColor: tvColors.lineStrong, borderWidth: 1 }}>
            <View style={styles.liveBadge}><Text style={styles.badgeText}>LIVE PREVIEW</Text></View>
          </View>
          <View style={[styles.previewInfo, { backgroundColor: "#1A0B33" }]}>
            <Text numberOfLines={1} style={styles.infoChannel}>{visibleChannel?.name || "Live TV"}</Text>
            <Text numberOfLines={2} style={styles.infoTitle}>{visibleProgram?.title || "No program information"}</Text>
            <Text numberOfLines={1} style={styles.infoTime}>{visibleProgram
              ? `${fmtTime(visibleProgram.start)} – ${visibleProgram.stop ? fmtTime(visibleProgram.stop) : "LIVE"}`
              : "Browse the channels below"}</Text>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
            <Text numberOfLines={3} style={styles.infoDescription}>{visibleProgram?.desc || playingNext?.title || "Use the D-pad to browse the guide."}</Text>
          </View>
        </View>
      ) : null}
      <View style={[styles.toolbar, { backgroundColor: mode === "preview" ? "#1E0C3C" : panelBackground }]}>
        <Pressable testID="player-guide-playlists" onPress={openPlaylists}
          style={({ focused }: any) => [styles.action, styles.pickerAction, focused && styles.focused]}>
          <Ionicons name="albums-outline" color="#fff" size={14}/><Text numberOfLines={1} style={[styles.actionText, styles.pickerText]}>{section?.label || "All Playlists"} ▾</Text>
        </Pressable>
        <Pressable ref={groupRef} testID="player-guide-groups" onPress={openGroups}
          style={({ focused }: any) => [styles.action, styles.groupAction, focused && styles.focused]}>
          <Ionicons name="list-outline" color="#fff" size={14}/><Text numberOfLines={1} style={[styles.actionText, styles.pickerText]}>{currentGroup?.label || "All Channels"} ▾</Text>
        </Pressable>
        <Pressable ref={dayRef} testID="player-guide-day-picker" onPress={openDays}
          style={({ focused }: any) => [styles.action, focused && styles.focused]}>
          <Ionicons name="calendar-outline" color="#fff" size={14}/><Text style={styles.actionText}>{dayLabel} ▾</Text>
        </Pressable>
        <Pressable testID="player-guide-mode-toggle" onPress={() => {
          if (animationEnabled) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          onModeChange(mode === "overlay" ? "preview" : "overlay");
        }}
          style={({ focused }: any) => [styles.action, focused && styles.focused]}>
          <Text style={styles.actionText}>{mode === "overlay" ? "Preview mode" : "Overlay mode"}</Text>
        </Pressable>
        {mode === "overlay" ? (
          <View style={styles.transparencyControls}>
              <View style={styles.adjustRow}>
                <Text style={styles.adjustLabel}>Guide</Text>
                <Pressable accessibilityLabel="Decrease guide transparency" onPress={() => onTransparencyChange(Math.max(0, transparency - 10))}
                  style={({ focused }: any) => [styles.step, focused && styles.focused]}><Text style={styles.actionText}>−</Text></Pressable>
                <Text style={styles.opacityText}>{transparency}%</Text>
                <Pressable accessibilityLabel="Increase guide transparency" onPress={() => onTransparencyChange(Math.min(MAX_GUIDE_TRANSPARENCY, transparency + 10))}
                  style={({ focused }: any) => [styles.step, focused && styles.focused]}><Text style={styles.actionText}>+</Text></Pressable>
              </View>
              <View style={styles.adjustRow}>
                <Text style={styles.adjustLabel}>Channels</Text>
                <Pressable accessibilityLabel="Decrease channel transparency" onPress={() => onChannelTransparencyChange(Math.max(0, channelTransparency - 10))}
                  style={({ focused }: any) => [styles.step, focused && styles.focused]}><Text style={styles.actionText}>−</Text></Pressable>
                <Text style={styles.opacityText}>{channelTransparency}%</Text>
                <Pressable accessibilityLabel="Increase channel transparency" onPress={() => onChannelTransparencyChange(Math.min(MAX_GUIDE_TRANSPARENCY, channelTransparency + 10))}
                  style={({ focused }: any) => [styles.step, focused && styles.focused]}><Text style={styles.actionText}>+</Text></Pressable>
              </View>
          </View>
        ) : null}
        <Pressable accessibilityLabel="Toggle automatic channel preview" onPress={() => onAutoplayChange(!autoplayOnFocus)}
          style={({ focused }: any) => [styles.action, focused && styles.focused]}>
          <Text style={styles.actionText}>Auto {autoplayOnFocus ? "On" : "Off"}</Text>
        </Pressable>
        <Pressable accessibilityLabel="Toggle stay on guide when changing channels" onPress={() => onStayChange(!stayInGuide)}
          style={({ focused }: any) => [styles.action, focused && styles.focused]}>
          <Text style={styles.actionText}>Stay {stayInGuide ? "On" : "Off"}</Text>
        </Pressable>
        <Pressable onPress={onDismiss} testID="player-guide-close" style={({ focused }: any) => [styles.action, focused && styles.focused]}>
          <Ionicons name="close-outline" size={15} color="#fff"/>
        </Pressable>
      </View>
      {mode === "overlay" ? (
        <View pointerEvents="none" style={[styles.overlayInfo, { backgroundColor: panelBackground }]}>
          <Text numberOfLines={1} style={styles.overlayInfoTitle}>{visibleChannel?.name || "Live TV"} · {visibleProgram?.title || "No program information"}</Text>
          <Text numberOfLines={1} style={styles.overlayInfoTime}>{visibleProgram ? `${fmtTime(visibleProgram.start)} – ${visibleProgram.stop ? fmtTime(visibleProgram.stop) : "LIVE"}` : "Select a channel or program"}</Text>
        </View>
      ) : null}
      <View style={[styles.grid, mode === "preview" && styles.opaqueGrid]}>
        <NativeGuideCanvas
          channels={filtered}
          showLogos={showLogos}
          windowStart={windowStart}
          windowEnd={windowEnd}
          restoreTimeMs={restoreTimeMs}
          restoreChannelId={restoreChannelId}
          reloadGeneration={reloadGeneration}
          overlayMode={mode === "overlay"}
          transparencyLevel={transparency}
          channelTransparencyLevel={channelTransparency}
          enableUpBoundary
          active={active}
          channelNumberById={channelNumbers}
          onNativeGuideTag={setNativeTag}
          onChannelFocus={focusChannel}
          onProgramFocus={focusProgram}
          onChannelPress={tuneChannel}
          onProgramPress={(program, channel) => setDetail({ program, channel })}
          onViewportChannelIds={onRunway}
          onLeftBoundary={openGroups}
          onUpBoundary={() => requestNativeFocusWithRetry(dayRef.current)}
        />
      </View>
      {playlistsOpen ? (
        <View style={styles.layer}>
          <Text style={styles.layerTitle}>PLAYLISTS</Text>
          <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.layerContent}>
            <FlatList data={menu} keyExtractor={(item) => item.id} style={styles.layerList} initialNumToRender={12}
              removeClippedSubviews={false}
              getItemLayout={(_, index) => ({ length: LIST_ROW_HEIGHT, offset: LIST_ROW_HEIGHT * index, index })}
              renderItem={({ item, index }) => <Pressable testID={`player-guide-playlist-${item.id}`} hasTVPreferredFocus={index === playlistIndex}
                onPress={() => selectPlaylist(item.id)}
                style={({ focused }: any) => [styles.listEntry, section?.id === item.id && styles.current, focused && styles.focused]}>
                <Text numberOfLines={1} style={styles.entryText}>{item.label}</Text>
                <Text style={styles.count}>{item.count}</Text>
              </Pressable>}
            />
            <Pressable onPress={() => setPlaylistsOpen(false)} style={({ focused }: any) => [styles.action, focused && styles.focused]}>
              <Text style={styles.actionText}>Back to guide</Text>
            </Pressable>
          </FocusGuide>
        </View>
      ) : null}
      {groupsOpen ? (
        <View style={styles.layer}>
          <Text style={styles.layerTitle}>{(section?.label || "All Playlists").toUpperCase()} · CHANNEL GROUPS</Text>
          <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.layerContent}>
            {/* The current group is mounted and focused first so OK on it never lands nowhere. */}
            <FlatList data={groups} keyExtractor={(item) => item.key} style={styles.layerList} initialNumToRender={18}
              initialScrollIndex={groupIndex > 6 ? groupIndex - 3 : undefined}
              maxToRenderPerBatch={12} windowSize={5} removeClippedSubviews={false}
              getItemLayout={(_, index) => ({ length: LIST_ROW_HEIGHT, offset: LIST_ROW_HEIGHT * index, index })}
              renderItem={({ item, index }) => <Pressable testID={`player-guide-group-${item.label}`} hasTVPreferredFocus={index === groupIndex}
                onPress={() => selectGroup(item.key)}
                style={({ focused }: any) => [styles.listEntry, groupKey === item.key && styles.current, focused && styles.focused]}>
                <Text numberOfLines={1} style={styles.entryText}>{item.label}</Text>
                <Text style={styles.count}>{item.count}</Text>
              </Pressable>}
            />
            <Pressable onPress={() => setGroupsOpen(false)} style={({ focused }: any) => [styles.action, focused && styles.focused]}>
              <Text style={styles.actionText}>Back to guide</Text>
            </Pressable>
          </FocusGuide>
        </View>
      ) : null}
      {daysOpen ? (
        <View style={styles.layer}>
          <Text style={styles.layerTitle}>SELECT GUIDE DAY</Text>
          <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.layerContent}>
            <FlatList data={days} keyExtractor={(item) => item.key} style={styles.layerList} initialNumToRender={10} removeClippedSubviews={false}
              renderItem={({ item }) => <Pressable onPress={() => selectDay(item.at)} style={({ focused }: any) => [styles.listEntry, focused && styles.focused]}>
                <Text style={styles.entryText}>{item.label}</Text></Pressable>}
            />
            <Pressable onPress={() => setDaysOpen(false)} style={({ focused }: any) => [styles.action, focused && styles.focused]}>
              <Text style={styles.actionText}>Back to guide</Text>
            </Pressable>
          </FocusGuide>
        </View>
      ) : null}
      {detail ? (
        <View style={styles.layer}>
          <Text style={styles.layerTitle}>{detail.program.title || "Program information"}</Text>
          <Text style={styles.detailDescription}>{detail.channel.name}</Text>
          <Text style={styles.detailDescription}>{fmtTime(detail.program.start)} – {detail.program.stop ? fmtTime(detail.program.stop) : "LIVE"}</Text>
          <Text style={styles.detailDescription} numberOfLines={6}>{detail.program.desc || "No description available."}</Text>
          <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.detailActions}>
            <Pressable onPress={() => { const tuned = detail.channel; setDetail(null); tuneChannel(tuned); }}
              style={({ focused }: any) => [styles.action, focused && styles.focused]}>
              <Text style={styles.actionText}>Watch channel</Text>
            </Pressable>
            <Pressable onPress={() => setDetail(null)} style={({ focused }: any) => [styles.action, focused && styles.focused]}>
              <Text style={styles.actionText}>Back to guide</Text>
            </Pressable>
          </FocusGuide>
        </View>
      ) : null}
    </View>
  );
}

const LIST_ROW_HEIGHT = 46;
const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_GROUPS: { key: string; label: string; count: number }[] = [];

const styles = StyleSheet.create({
  frame: { position: "absolute", zIndex: 40, gap: 0, overflow: "hidden" },
  previewHeader: { flexShrink: 0, flexDirection: "row", overflow: "hidden" },
  previewInfo: { flex: 1, minWidth: 0, padding: 14, justifyContent: "center", gap: 7 },
  infoChannel: { fontFamily: fonts.bold, color: "#fff", fontSize: 17 },
  infoTitle: { fontFamily: fonts.semibold, color: "#fff", fontSize: 15 },
  infoTime: { fontFamily: fonts.medium, color: tvColors.textMuted, fontSize: 12 },
  infoDescription: { fontFamily: fonts.regular, color: "#D4D8E1", fontSize: 11 },
  progressTrack: { height: 3, width: "100%", backgroundColor: "rgba(255,255,255,0.15)", overflow: "hidden", borderRadius: 2 },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: glass.pink },
  overlayInfo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 9, paddingVertical: 5, gap: 12 },
  overlayInfoTitle: { flex: 1, color: "#fff", fontFamily: fonts.medium, fontSize: 11 },
  overlayInfoTime: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 10 },
  liveBadge: { position: "absolute", bottom: 7, left: 7, backgroundColor: "rgba(124,58,237,0.92)", borderColor: tvColors.purpleSoft, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { color: "#fff", fontFamily: fonts.bold, fontSize: 10 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5, padding: 5, minHeight: 42 },
  action: { minHeight: 32, flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center", paddingHorizontal: 9, borderColor: glass.buttonEdge, borderWidth: 2, borderRadius: 11, backgroundColor: "rgba(60,26,112,0.62)" },
  actionText: { fontFamily: fonts.medium, color: "#fff", fontSize: 11 },
  // Group picker is twice as wide as before so long group names fit.
  groupAction: { width: 230, justifyContent: "flex-start" },
  pickerAction: { width: 150, justifyContent: "flex-start" },
  pickerText: { flexShrink: 1 },
  transparencyControls: { gap: 2 },
  adjustRow: { flexDirection: "row", alignItems: "center", gap: 3, height: 20 },
  adjustLabel: { width: 48, color: "#fff", fontFamily: fonts.medium, fontSize: 9 },
  step: { height: 20, width: 24, borderColor: glass.edgeSoft, borderWidth: 2, borderRadius: 6, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(60,26,112,0.62)" },
  opacityText: { color: "#fff", fontFamily: fonts.medium, fontSize: 10 },
  grid: { flex: 1, minHeight: 0, backgroundColor: "transparent" },
  opaqueGrid: { backgroundColor: "#120826" },
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 50, padding: 13, backgroundColor: "rgba(30,12,60,0.97)", borderRadius: 16, borderWidth: 1, borderColor: glass.edge },
  layerTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 15, letterSpacing: 0.6, marginBottom: 10 },
  layerContent: { flex: 1, minHeight: 0, gap: 8 },
  layerList: { flexGrow: 1, flexShrink: 1, minHeight: LIST_ROW_HEIGHT * 3 },
  listEntry: { height: 42, paddingHorizontal: 10, marginVertical: 2, flexDirection: "row", alignItems: "center", borderColor: glass.edgeSoft, borderWidth: 2, borderRadius: 11, backgroundColor: "rgba(40,18,78,0.70)" },
  current: { backgroundColor: glass.selected, borderColor: glass.selectedEdge },
  entryText: { color: "#fff", flex: 1, fontFamily: fonts.medium, fontSize: 13 },
  count: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 11 },
  focused: glassFocus,
  detailDescription: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 12, marginBottom: 8 },
  detailActions: { flexDirection: "row", gap: 8, marginTop: 16 },
});
