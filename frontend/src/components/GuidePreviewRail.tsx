import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import type { Channel, Program } from "@/src/api";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { StreamPlayer, type StreamStatus } from "@/src/components/StreamPlayer";
import { getLastAudioDiagnostics, matchesStreamFingerprint } from "@/src/core/audioDiagnostics";
import { usePlaybackBufferProfile } from "@/src/core/playbackBufferProfile";
import {
  noteGuidePreviewFocus,
  registerGuidePreviewNode,
} from "@/src/utils/guidePreviewFocus";
import { fonts, glass, glassFocus, tvColors } from "@/src/theme";
import { fmtTime, progressPct } from "@/src/utils/time";

type Props = {
  width: number;
  channel: Channel | null;
  current?: Program;
  next?: Program;
  now: string;
  channelNumber?: number;
  showChannelNumbers: boolean;
  showLogos: boolean;
  hidePreview: boolean;
  muted: boolean;
  previewVisible: boolean;
  previewEpoch: number;
  onPreviewStatus: (status: StreamStatus) => void;
  /** Only used by "Show preview" when the preview is hidden. */
  onHideToggle: () => void;
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
  hidePreview,
  muted,
  previewVisible,
  previewEpoch,
  onPreviewStatus,
  onHideToggle,
  focusRequestToken,
  guideFocusTag,
}: Props) {
  const [playbackBufferProfile] = usePlaybackBufferProfile();
  // The preview row has no button column (removed at the owner's request):
  // Play is OK on the channel, Favorite/Remind live in Quick Actions, the
  // drawer opens with LEFT, and mute/hide are in Settings. The only stop up
  // here is "Show preview" while the preview is hidden.
  const showFocus = usePreviewFocusNode("show-preview", true);
  const [preferShowFocus, setPreferShowFocus] = useState(false);
  useEffect(() => {
    if (focusRequestToken <= 0) return;
    setPreferShowFocus(true);
    return () => setPreferShowFocus(false);
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
    <View style={[styles.panel, { width }]} testID="guide-preview-rail">
      <View style={styles.previewColumn}>
        {!hidePreview ? (
          <View style={styles.preview}>
            {previewVisible && channel?.url ? (
              <ErrorBoundary
                key={`preview-boundary-${channel.id}-${previewEpoch}`}
                onError={() => onPreviewStatus("error")}
                fallback={() => (
                  <View style={styles.fallback}>
                    <ChannelLogo name={channel.name} logo={channel.logo} disabled={!showLogos} size={132} />
                    <Text style={styles.fallbackHint}>Preview unavailable</Text>
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
                <Text style={styles.fallbackHint}>{channel ? "Tuning preview…" : "Select a channel"}</Text>
              </View>
            )}
            <View style={styles.liveTag}>
              <Text style={styles.liveTagText}>{muted ? "PREVIEW MUTED" : "LIVE PREVIEW"}</Text>
            </View>
            {codecChip ? (
              <View style={styles.codecChip} pointerEvents="none">
                <Text style={styles.codecText} numberOfLines={1}>{codecChip}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Pressable
            ref={showFocus.setRef}
            hasTVPreferredFocus={preferShowFocus}
            nextFocusDown={guideFocusTag || undefined}
            onPress={onHideToggle}
            onFocus={() => { setPreferShowFocus(false); showFocus.onFocus(); }}
            style={({ focused }: any) => [styles.hiddenPreview, focused && styles.focused]}
            testID="guide-preview-show"
          >
            <Ionicons name="eye-outline" size={14} color={tvColors.purpleSoft} />
            <Text style={styles.hiddenPreviewText}>Show preview</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.channelName}>{channel ? `${showChannelNumbers && channelNumber ? `${channelNumber}  ` : ""}${channel.name}` : "Select a channel"}</Text>
        <Text numberOfLines={2} style={styles.programTitle}>{current?.title || "No program information"}</Text>
        <View style={styles.nowNextRow}>
          <Text numberOfLines={1} style={styles.timeText}>{current ? `${fmtTime(current.start)}${current.stop ? ` – ${fmtTime(current.stop)}` : ""}` : "Guide information will appear here"}</Text>
          {endsIn != null ? <Text style={styles.endsIn}>{endsIn}m left</Text> : null}
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
        {next?.title ? <Text numberOfLines={1} style={styles.nextTitle}>Next · {next.title}</Text> : null}
        <Text style={styles.descLabel}>ABOUT</Text>
        <Text accessibilityRole="text" accessibilityLabel={about} style={styles.description} numberOfLines={5}>{about}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Top of the screen: flush top edge, rounded glass bottom corners.
  panel: { height: 174, flexShrink: 0, flexDirection: "row", alignItems: "stretch", backgroundColor: "#22104A", borderBottomLeftRadius: 14, borderBottomRightRadius: 14, borderWidth: 1, borderTopWidth: 0, borderColor: glass.edge, overflow: "visible" },
  previewColumn: { width: 292, flexShrink: 0, padding: 7, justifyContent: "center", borderRightWidth: 1, borderRightColor: glass.edgeSoft },
  preview: { width: "100%", aspectRatio: 16 / 9, maxHeight: 158, flexShrink: 0, backgroundColor: "#0C0520", borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", overflow: "hidden" },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#2A1060", gap: 6, paddingHorizontal: 8 },
  fallbackHint: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8.5, textAlign: "center" },
  liveTag: { position: "absolute", left: 6, bottom: 6, backgroundColor: "rgba(124,58,237,0.92)", borderColor: tvColors.purpleSoft, borderWidth: 1, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  liveTagText: { color: "#fff", fontFamily: fonts.bold, fontSize: 6 },
  codecChip: { position: "absolute", right: 6, top: 6, maxWidth: "70%", backgroundColor: "rgba(10,4,24,0.78)", borderColor: "rgba(255,255,255,0.35)", borderWidth: 1, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  codecText: { color: "#fff", fontFamily: fonts.medium, fontSize: 7 },
  hiddenPreview: { flex: 1, minHeight: 80, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: glass.buttonEdge, backgroundColor: glass.button, borderRadius: 10 },
  hiddenPreviewText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9 },
  copy: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 9 },
  channelName: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 10 },
  programTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 17, lineHeight: 21, marginTop: 3 },
  nowNextRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  timeText: { flex: 1, minWidth: 0, color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9 },
  endsIn: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 9 },
  progressTrack: { height: 4, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 2, overflow: "hidden", marginTop: 7 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: glass.pink },
  nextTitle: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9, marginTop: 5 },
  descLabel: { color: glass.kicker, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1.6, marginTop: 7, marginBottom: 3 },
  description: { color: "rgba(255,255,255,0.86)", fontFamily: fonts.regular, fontSize: 9.5, lineHeight: 13 },
  focused: glassFocus,
});
