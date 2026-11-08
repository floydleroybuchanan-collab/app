import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, FlatList, LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Channel, Program } from "@/src/api";
import { NativeGuideCanvas } from "@/src/components/NativeGuideCanvas";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { fonts, tvColors } from "@/src/theme";
import { fmtTime, progressPct } from "@/src/utils/time";
import { availableGuideDays, guidePanelOpacity, type GuidePresentationMode } from "@/src/core/guidePresentation";

type Props = {
  mode: GuidePresentationMode;
  transparency: number;
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
  onAutoplayChange: (enabled: boolean) => void;
  onStayChange: (enabled: boolean) => void;
  onRunway: (ids: string[], priorityIds: string[]) => void;
};

/** Guide UI only: consumes existing native EPG and the existing fullscreen Media3 session. */
export function PlayerGuidePanel({
  mode, transparency, animationEnabled, autoplayOnFocus, stayInGuide,
  safeLeft, safeRight, safeTop, safeBottom, previewWidth, previewHeight,
  channels, favoriteIds, playingChannel, playingCurrent, playingNext,
  windowStart, windowEnd, channelNumbers, showLogos,
  onTune, onDismiss, onModeChange, onTransparencyChange, onAutoplayChange, onStayChange, onRunway,
}: Props) {
  const [group, setGroup] = useState("All");
  const [groupsOpen, setGroupsOpen] = useState(false);
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
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const channel of channels) {
      const name = channel.group?.trim();
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    counts.set("All", channels.length);
    counts.set("Favorites", channels.reduce((count, channel) => count + Number(favoriteSet.has(channel.id)), 0));
    return counts;
  }, [channels, favoriteSet]);
  const groups = useMemo(() => {
    const distinct = new Set<string>();
    for (const channel of channels) if (channel.group?.trim()) distinct.add(channel.group.trim());
    return ["All", "Favorites", ...distinct].filter((name, index, list) => list.indexOf(name) === index);
  }, [channels]);
  const filtered = useMemo(() => group === "All" ? channels :
    group === "Favorites" ? channels.filter((channel) => favoriteSet.has(channel.id)) :
      channels.filter((channel) => channel.group?.trim() === group), [channels, favoriteSet, group]);
  const days = useMemo(() => availableGuideDays(windowStart, windowEnd), [windowEnd, windowStart]);
  const active = !groupsOpen && !daysOpen && detail === null;
  const visibleChannel = focus?.channel || playingChannel;
  const visibleProgram = focus?.program || playingCurrent;
  const panelAlpha = guidePanelOpacity(mode, transparency);
  const progress = visibleProgram ? progressPct(visibleProgram, new Date()) : 0;
  const panelBackground = `rgba(12,14,18,${panelAlpha.toFixed(3)})`;
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
    setGroupsOpen(false);
  }, [playingChannel?.id]);

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
      return false;
    });
    return () => sub.remove();
  }, [daysOpen, detail, groupsOpen]);

  const openDays = useCallback(() => { setGroupsOpen(false); setDaysOpen(true); }, []);
  const openGroups = useCallback(() => { setDaysOpen(false); setGroupsOpen(true); }, []);
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
          <View pointerEvents="none" style={{ width: previewWidth, height: previewHeight, backgroundColor: "transparent", borderColor: tvColors.silverEdge, borderWidth: 1 }}>
            <View style={styles.liveBadge}><Text style={styles.badgeText}>LIVE PREVIEW</Text></View>
          </View>
          <View style={[styles.previewInfo, { backgroundColor: "#0C0E12" }]}>
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
      <View style={[styles.toolbar, { backgroundColor: mode === "preview" ? "#1B1E25" : panelBackground }]}>
        <Pressable ref={groupRef} testID="player-guide-groups" onPress={openGroups}
          style={({ focused }: any) => [styles.action, focused && styles.focused]}>
          <Ionicons name="list-outline" color="#fff" size={14}/><Text numberOfLines={1} style={styles.actionText}>{group} ▾</Text>
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
            <Pressable accessibilityLabel="Decrease guide transparency" onPress={() => onTransparencyChange(Math.max(0, transparency - 25))}
              style={({ focused }: any) => [styles.step, focused && styles.focused]}><Text style={styles.actionText}>−</Text></Pressable>
            <Text style={styles.opacityText}>{Math.round((1 - panelAlpha) * 100)}% clear</Text>
            <Pressable accessibilityLabel="Increase guide transparency" onPress={() => onTransparencyChange(Math.min(100, transparency + 25))}
              style={({ focused }: any) => [styles.step, focused && styles.focused]}><Text style={styles.actionText}>+</Text></Pressable>
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
          windowStart={windowStart}
          windowEnd={windowEnd}
          restoreTimeMs={restoreTimeMs}
          restoreChannelId={restoreChannelId}
          overlayMode={mode === "overlay"}
          transparencyLevel={transparency}
          enableUpBoundary
          active={active}
          showLogos={showLogos}
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
      {groupsOpen ? (
        <View style={[styles.layer, { backgroundColor: mode === "preview" ? "#171B23" : panelBackground }]}>
          <Text style={styles.layerTitle}>CHANNEL GROUPS</Text>
          <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.layerContent}>
            <FlatList data={groups} keyExtractor={(item) => item} style={{ flex: 1 }} initialNumToRender={18}
              maxToRenderPerBatch={12} windowSize={5} removeClippedSubviews={false}
              renderItem={({ item }) => <Pressable testID={`player-guide-group-${item}`} onPress={() => selectGroup(item)}
                style={({ focused }: any) => [styles.listEntry, group === item && styles.current, focused && styles.focused]}>
                <Text style={styles.entryText}>{item}</Text>
                <Text style={styles.count}>{groupCounts.get(item) || 0}</Text>
              </Pressable>}
            />
            <Pressable onPress={() => setGroupsOpen(false)} style={({ focused }: any) => [styles.action, focused && styles.focused]}>
              <Text style={styles.actionText}>Back to guide</Text>
            </Pressable>
          </FocusGuide>
        </View>
      ) : null}
      {daysOpen ? (
        <View style={[styles.layer, { backgroundColor: mode === "preview" ? "#171B23" : panelBackground }]}>
          <Text style={styles.layerTitle}>SELECT GUIDE DAY</Text>
          <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.layerContent}>
            <FlatList data={days} keyExtractor={(item) => item.key} initialNumToRender={10}
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
        <View style={[styles.layer, { backgroundColor: "#171B23" }]}>
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

const styles = StyleSheet.create({
  frame: { position: "absolute", zIndex: 40, gap: 0, overflow: "hidden" },
  previewHeader: { flexShrink: 0, flexDirection: "row", overflow: "hidden" },
  previewInfo: { flex: 1, minWidth: 0, padding: 14, justifyContent: "center", gap: 7 },
  infoChannel: { fontFamily: fonts.bold, color: "#fff", fontSize: 17 },
  infoTitle: { fontFamily: fonts.semibold, color: "#fff", fontSize: 15 },
  infoTime: { fontFamily: fonts.medium, color: tvColors.textMuted, fontSize: 12 },
  infoDescription: { fontFamily: fonts.regular, color: "#D4D8E1", fontSize: 11 },
  progressTrack: { height: 3, width: "100%", backgroundColor: "rgba(255,255,255,0.15)", overflow: "hidden", borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: tvColors.purpleBright },
  overlayInfo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 9, paddingVertical: 5, gap: 12 },
  overlayInfoTitle: { flex: 1, color: "#fff", fontFamily: fonts.medium, fontSize: 11 },
  overlayInfoTime: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 10 },
  liveBadge: { position: "absolute", bottom: 7, left: 7, backgroundColor: "rgba(124,58,237,0.92)", paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { color: "#fff", fontFamily: fonts.bold, fontSize: 10 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5, padding: 5, minHeight: 42 },
  action: { minHeight: 32, flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderColor: "transparent", borderWidth: 2, borderRadius: 5, backgroundColor: "rgba(45,37,65,0.55)" },
  actionText: { fontFamily: fonts.medium, color: "#fff", fontSize: 11 },
  transparencyControls: { flexDirection: "row", alignItems: "center", gap: 3 },
  step: { minHeight: 31, minWidth: 31, borderColor: "transparent", borderWidth: 2, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(45,37,65,0.55)" },
  opacityText: { color: "#fff", fontFamily: fonts.medium, fontSize: 10 },
  grid: { flex: 1, minHeight: 0, backgroundColor: "transparent" },
  opaqueGrid: { backgroundColor: "#0C0E12" },
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 50, padding: 13 },
  layerTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 17, marginBottom: 10 },
  layerContent: { flex: 1, minHeight: 0, gap: 8 },
  listEntry: { minHeight: 42, paddingHorizontal: 10, marginVertical: 2, flexDirection: "row", alignItems: "center", borderColor: "transparent", borderWidth: 2, borderRadius: 6, backgroundColor: "rgba(75,68,96,0.45)" },
  current: { backgroundColor: tvColors.purpleDeep },
  entryText: { color: "#fff", flex: 1, fontFamily: fonts.medium, fontSize: 13 },
  count: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 11 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
  detailDescription: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 12, marginBottom: 8 },
  detailActions: { flexDirection: "row", gap: 8, marginTop: 16 },
});
