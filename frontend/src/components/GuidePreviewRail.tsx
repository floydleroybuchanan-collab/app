import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import type { Channel, Program } from "@/src/api";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { StreamPlayer, type StreamStatus } from "@/src/components/StreamPlayer";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { getLastAudioDiagnostics, matchesStreamFingerprint } from "@/src/core/audioDiagnostics";
import { usePlaybackBufferProfile } from "@/src/core/playbackBufferProfile";
import {
  noteGuidePreviewFocus,
  registerGuidePreviewNode,
} from "@/src/utils/guidePreviewFocus";
import { fonts, radius, tvColors } from "@/src/theme";
import { fmtTime, progressPct } from "@/src/utils/time";
import { guidePreviewLayout } from "@/src/core/guidePreviewLayout";

type Props = {
  width: number;
  channel: Channel | null;
  current?: Program;
  next?: Program;
  now: string;
  channelNumber?: number;
  showChannelNumbers: boolean;
  showLogos: boolean;
  isFavorite: boolean;
  hidePreview: boolean;
  muted: boolean;
  onToggleMute: () => void;
  previewVisible: boolean;
  previewEpoch: number;
  onPreviewStatus: (status: StreamStatus) => void;
  onPlay: () => void;
  onFavorite: () => void;
  onOpenReminders: () => void;
  onHideToggle: () => void;
  onOpenDrawer: () => void;
  onActionsFocusChange: (focused: boolean) => void;
  focusRequestToken: number;
  guideFocusTag?: number | null;
};

function usePreviewFocusNode(key: string, preferred = false) {
  const nodeRef = useRef<unknown>(null);
  const setRef = useCallback((node: unknown) => {
    nodeRef.current = node;
    registerGuidePreviewNode(key, node, preferred);
  }, [key, preferred]);
  const onFocus = useCallback(() => {
    noteGuidePreviewFocus(nodeRef.current);
  }, []);
  return { setRef, onFocus };
}

export function GuidePreviewRail({
  width,
  channel,
  current,
  next,
  now,
  channelNumber,
  showChannelNumbers,
  showLogos,
  isFavorite,
  hidePreview,
  muted,
  onToggleMute,
  previewVisible,
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
}: Props) {
  const [playbackBufferProfile] = usePlaybackBufferProfile();
  const playFocus = usePreviewFocusNode("play", true);
  const favoriteFocus = usePreviewFocusNode("favorite");
  const remindersFocus = usePreviewFocusNode("reminders");
  const drawerFocus = usePreviewFocusNode("drawer");
  const muteFocus = usePreviewFocusNode("mute");
  const hideFocus = usePreviewFocusNode("hide");
  const showFocus = usePreviewFocusNode("show-preview");
  const [preferPlayFocus, setPreferPlayFocus] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const layout = guidePreviewLayout(width);
  useEffect(() => {
    if (focusRequestToken <= 0) return;
    setActionsVisible(true);
    setPreferPlayFocus(true);
    return () => setPreferPlayFocus(false);
  }, [focusRequestToken]);
  const nowDate = useMemo(() => new Date(now), [now]);
  const progress = current ? progressPct(current, nowDate) : 0;
  const endsIn = current?.stop
    ? Math.max(0, dayjs(current.stop).diff(dayjs(nowDate), "minute"))
    : null;
  const audio = getLastAudioDiagnostics();
  const codecChip =
    audio && channel?.url && matchesStreamFingerprint(channel.url, audio.streamKey)
      ? `${audio.mimeType?.replace(/^audio\//, "").toUpperCase() || "AUDIO"} · ${String(audio.engine).toUpperCase()}`
      : null;
  const about = current?.desc || "Focus a channel to preview it and read the current program.";

  return (
    <View style={[styles.panel, { width, height: layout.previewHeight }]} testID="guide-preview-rail">
      <View style={[styles.previewColumn, { width: layout.previewWidth }]}>
        {!hidePreview ? (
          <View style={[styles.preview, { height: layout.previewHeight }]}>
            {previewVisible && channel?.url ? (
              <ErrorBoundary
                key={`preview-boundary-${channel.id}-${previewEpoch}`}
                onError={() => onPreviewStatus("error")}
                fallback={() => (
                  <View style={styles.fallback}>
                    <ChannelLogo name={channel.name} logo={channel.logo} disabled={!showLogos} size={132} />
                    <Text maxFontSizeMultiplier={1.15} style={styles.fallbackHint}>Preview unavailable</Text>
                  </View>
                )}
              >
                <StreamPlayer
                  key={`guide-preview-${channel.id}-${previewEpoch}`}
                  uri={channel.url}
                  channelKey={channel.id}
                  streamTypeHint={channel.stream_type}
                  onStatus={onPreviewStatus}
                  mode="preview"
                  sessionRole="preview"
                  bufferProfile={playbackBufferProfile}
                  muted={muted}
                  style={StyleSheet.absoluteFill}
                />
              </ErrorBoundary>
            ) : (
              <View style={styles.fallback}>
                {channel ? (
                  <ChannelLogo name={channel.name} logo={channel.logo} disabled={!showLogos} size={132} />
                ) : (
                  <Ionicons name="tv-outline" size={58} color={tvColors.purpleSoft} />
                )}
                <Text maxFontSizeMultiplier={1.15} style={styles.fallbackHint}>{channel ? "Tuning preview…" : "Select a channel"}</Text>
              </View>
            )}
            <View style={styles.liveTag}>
              <Text maxFontSizeMultiplier={1.15} style={styles.liveTagText}>{muted ? "PREVIEW MUTED" : "LIVE PREVIEW"}</Text>
            </View>
            {codecChip ? (
              <View style={styles.codecChip} pointerEvents="none">
                <Text maxFontSizeMultiplier={1.15} style={styles.codecText} numberOfLines={1}>{codecChip}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Pressable
            ref={showFocus.setRef}
            nextFocusDown={guideFocusTag || undefined}
            onPress={onHideToggle}
            onFocus={showFocus.onFocus}
            style={({ focused }: any) => [styles.hiddenPreview, focused && styles.focused]}
            testID="guide-preview-show"
          >
            <Ionicons name="eye-outline" size={14} color={tvColors.purpleSoft} />
            <Text maxFontSizeMultiplier={1.15} style={styles.hiddenPreviewText}>Show preview</Text>
          </Pressable>
        )}
      <FocusGuide style={[styles.actionGrid, !actionsVisible && styles.actionsHidden]} onFocusCapture={() => { setActionsVisible(true); setPreferPlayFocus(false); }} onFocusLost={() => { setActionsVisible(false); onActionsFocusChange(false); }}>
        <View style={styles.actionColumn}>
          <Pressable
            ref={playFocus.setRef}
            hasTVPreferredFocus={preferPlayFocus}
            disabled={!channel}
            onPress={onPlay}
            onFocus={() => { onActionsFocusChange(true); playFocus.onFocus(); }}
            style={({ focused }: any) => [styles.watchButton, focused && styles.focused]}
            testID="guide-preview-play"
          >
            <Ionicons name="play" size={12} color="#fff" />
            <Text maxFontSizeMultiplier={1.15} style={styles.watchText}>Play</Text>
          </Pressable>
          <Pressable ref={favoriteFocus.setRef} disabled={!channel} onPress={onFavorite} onFocus={() => { onActionsFocusChange(true); favoriteFocus.onFocus(); }} style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]} testID="guide-preview-favorite">
            <Ionicons name={isFavorite ? "heart" : "heart-outline"} size={12} color={tvColors.purpleSoft} />
            <Text maxFontSizeMultiplier={1.15} style={styles.secondaryText}>Favorite</Text>
          </Pressable>
          <Pressable ref={remindersFocus.setRef} onPress={onOpenReminders} onFocus={() => { onActionsFocusChange(true); remindersFocus.onFocus(); }} style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]} testID="guide-preview-remind">
            <Ionicons name="notifications-outline" size={12} color={tvColors.purpleSoft} />
            <Text maxFontSizeMultiplier={1.15} style={styles.secondaryText}>Reminders</Text>
          </Pressable>
          <Pressable ref={drawerFocus.setRef} onPress={onOpenDrawer} onFocus={() => { onActionsFocusChange(true); drawerFocus.onFocus(); }} style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]} testID="guide-preview-drawer">
            <Ionicons name="menu-outline" size={12} color={tvColors.purpleSoft} />
            <Text maxFontSizeMultiplier={1.15} style={styles.secondaryText}>Drawer</Text>
          </Pressable>
          <Pressable ref={muteFocus.setRef} disabled={hidePreview} onPress={onToggleMute} onFocus={() => { onActionsFocusChange(true); muteFocus.onFocus(); }} style={({ focused }: any) => [styles.secondaryButton, hidePreview && styles.disabledButton, focused && styles.focused]} testID="guide-preview-mute">
            <Ionicons name={muted ? "volume-mute-outline" : "volume-medium-outline"} size={10} color={tvColors.purpleSoft} />
            <Text maxFontSizeMultiplier={1.15} style={styles.secondaryText}>{muted ? "Unmute" : "Mute"}</Text>
          </Pressable>
          <Pressable ref={hideFocus.setRef} nextFocusDown={guideFocusTag || undefined} onPress={onHideToggle} onFocus={() => { onActionsFocusChange(true); hideFocus.onFocus(); }} style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]} testID="guide-preview-hide">
            <Ionicons name={hidePreview ? "eye-outline" : "eye-off-outline"} size={12} color={tvColors.purpleSoft} />
            <Text maxFontSizeMultiplier={1.15} style={styles.secondaryText}>{hidePreview ? "Show" : "Hide"}</Text>
          </Pressable>
        </View>
      </FocusGuide>
      </View>

      <View style={styles.copy}>
        <Text maxFontSizeMultiplier={1.15} numberOfLines={1} style={styles.channelName}>{channel ? `${showChannelNumbers && channelNumber ? `${channelNumber}  ` : ""}${channel.name}` : "Select a channel"}</Text>
        <Text maxFontSizeMultiplier={1.15} numberOfLines={2} style={styles.programTitle}>{current?.title || "No program information"}</Text>
        <View style={styles.nowNextRow}>
          <Text maxFontSizeMultiplier={1.15} numberOfLines={1} style={styles.timeText}>{current ? `${fmtTime(current.start)}${current.stop ? ` – ${fmtTime(current.stop)}` : ""}` : "Guide information will appear here"}</Text>
          {endsIn != null ? <Text maxFontSizeMultiplier={1.15} style={styles.endsIn}>{endsIn}m left</Text> : null}
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
        {next?.title ? <Text maxFontSizeMultiplier={1.15} numberOfLines={1} style={styles.nextTitle}>Next · {next.title}</Text> : null}
        <Text maxFontSizeMultiplier={1.15} accessibilityRole="text" accessibilityLabel={about} style={styles.description} numberOfLines={3}>{about}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flexShrink: 0, flexDirection: "row", alignItems: "stretch", overflow: "hidden" },
  previewColumn: { flexShrink: 0, position: "relative" },
  preview: { width: "100%", aspectRatio: 16 / 9, flexShrink: 0, backgroundColor: "#05050B", overflow: "hidden" },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tvColors.purpleDeep, gap: 6, paddingHorizontal: 8 },
  fallbackHint: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5, textAlign: "center" },
  liveTag: { position: "absolute", left: 6, bottom: 6, backgroundColor: "rgba(124,58,237,0.92)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  liveTagText: { color: "#fff", fontFamily: fonts.bold, fontSize: 6 },
  codecChip: { position: "absolute", right: 6, top: 6, maxWidth: "70%", backgroundColor: "rgba(0,0,0,0.72)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  codecText: { color: "#fff", fontFamily: fonts.medium, fontSize: 7 },
  hiddenPreview: { flex: 1, minHeight: 80, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 2, borderColor: "transparent", borderRadius: 5 },
  hiddenPreviewText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
  actionGrid: { position: "absolute", left: 4, right: 4, bottom: 4, height: 66, padding: 4, backgroundColor: "rgba(12,10,18,0.94)", borderRadius: radius.sm, zIndex: 5 },
  // Keep native action nodes mounted for the Guide's Up-boundary focus handoff.
  // They occupy no extra layout row/column and become visible on actual focus.
  actionsHidden: { opacity: 0 },
  actionColumn: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 3 },
  copy: { flex: 1, minWidth: 0, paddingLeft: 24, paddingRight: 4, paddingVertical: 2 },
  channelName: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 10 },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, marginTop: 3 },
  nowNextRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  timeText: { flex: 1, minWidth: 0, color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
  endsIn: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 12 },
  progressTrack: { height: 4, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 2, overflow: "hidden", marginTop: 7 },
  progressFill: { height: 4, backgroundColor: tvColors.purpleBright },
  nextTitle: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 12, marginTop: 5 },
  descLabel: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 0.7, marginTop: 7, marginBottom: 3 },
  description: { color: "rgba(255,255,255,0.86)", fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 7 },
  watchButton: { width: "31%", flexGrow: 1, minWidth: 0, minHeight: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: tvColors.panelRaised, borderRadius: 5, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 4 },
  watchText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 7.5 },
  secondaryButton: { width: "31%", flexGrow: 1, minWidth: 0, minHeight: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: tvColors.panelRaised, borderRadius: 5, borderWidth: 2, borderColor: "transparent", paddingHorizontal: 3 },
  secondaryText: { color: "#fff", fontFamily: fonts.medium, fontSize: 7.2 },
  disabledButton: { opacity: 0.45 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
