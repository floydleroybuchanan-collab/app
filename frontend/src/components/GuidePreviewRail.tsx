import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import type { Channel, Program } from "@/src/api";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { StreamPlayer, type StreamStatus } from "@/src/components/StreamPlayer";
import { getLastAudioDiagnostics, matchesStreamFingerprint } from "@/src/core/audioDiagnostics";
import { usePlaybackBufferProfile } from "@/src/core/playbackBufferProfile";
import { fonts, tvColors } from "@/src/theme";
import { fmtTime, progressPct } from "@/src/utils/time";
import { guidePreviewLayout } from "@/src/core/guidePreviewLayout";

type Props = {
  width: number;
  channel: Channel | null;
  tunedChannel?: Channel;
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
};

export function GuidePreviewRail({
  width,
  channel,
  tunedChannel,
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
}: Props) {
  const [playbackBufferProfile] = usePlaybackBufferProfile();
  const layout = guidePreviewLayout(width);
  const nowDate = useMemo(() => new Date(now), [now]);
  const progress = current ? progressPct(current, nowDate) : 0;
  const endsIn = current?.stop
    ? Math.max(0, dayjs(current.stop).diff(dayjs(nowDate), "minute"))
    : null;
  const audio = getLastAudioDiagnostics();
  const codecChip =
    audio && tunedChannel?.url && matchesStreamFingerprint(tunedChannel.url, audio.streamKey)
      ? `${audio.mimeType?.replace(/^audio\//, "").toUpperCase() || "AUDIO"} · ${String(audio.engine).toUpperCase()}`
      : null;
  const about = current?.desc || "Focus a channel to preview it and read the current program.";

  return (
    <View style={[styles.panel, { height: layout.previewHeight }]} testID="guide-preview-rail">
      <View style={[styles.previewColumn, { width: layout.previewWidth }]}>
        {!hidePreview ? (
          <View style={[styles.preview, { height: layout.previewHeight }]}>
            {previewVisible && tunedChannel?.url ? (
              <ErrorBoundary
                key={`preview-boundary-${tunedChannel.id}-${previewEpoch}`}
                onError={() => onPreviewStatus("error")}
                fallback={() => (
                  <View style={styles.fallback}>
                    <ChannelLogo name={tunedChannel.name} logo={tunedChannel.logo} disabled={!showLogos} size={132} />
                    <Text maxFontSizeMultiplier={1.15} style={styles.fallbackHint}>Preview unavailable</Text>
                  </View>
                )}
              >
                <StreamPlayer
                  key={`guide-preview-${tunedChannel.id}-${previewEpoch}`}
                  uri={tunedChannel.url}
                  channelKey={tunedChannel.id}
                  streamTypeHint={tunedChannel.stream_type}
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
          <View style={styles.hiddenPreview}><Text style={styles.hiddenPreviewText}>Preview hidden · Settings → Player</Text></View>
        )}
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
  panel: { width: "100%", flexShrink: 0, flexDirection: "row", alignItems: "stretch", overflow: "hidden" },
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
});
