import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { PurpleDrawerButton } from "@/src/components/PurpleDrawerButton";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { fonts, glass, glassFocus, tvColors } from "@/src/theme";
import { GlassPageTitle } from "@/src/components/GlassPageTitle";
import { nowNext } from "@/src/utils/time";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";

type CollectionRoute = "/movies" | "/series";

const Card = memo(function Card({
  channel,
  logos,
  now,
  onPress,
  onFocus,
  preferredFocus,
}: {
  channel: Channel;
  logos: boolean;
  now: Date;
  onPress: (channel: Channel) => void;
  onFocus: () => void;
  preferredFocus?: boolean;
}) {
  const programs = useGuidePrograms(channel.id);
  const current = nowNext(programs, now).current;
  return (
    <Pressable
      hasTVPreferredFocus={preferredFocus}
      onFocus={onFocus}
      onPress={() => onPress(channel)}
      style={({ focused }: any) => [styles.card, focused && styles.focused]}
      testID={`collection-${channel.id}`}
    >
      <View style={styles.art}>
        <LinearGradient colors={["rgba(168,85,247,0.46)", "rgba(30,12,60,0.96)"]} style={StyleSheet.absoluteFill} />
        <ChannelLogo name={channel.name} logo={channel.logo} disabled={!logos} size={58} />
      </View>
      <Text numberOfLines={2} style={styles.name}>{channel.name}</Text>
      <Text numberOfLines={1} style={styles.program}>{current?.title || channel.group || "Available now"}</Text>
    </Pressable>
  );
});

export function PurpleChannelCollection({
  active,
  title,
  subtitle,
  matcher,
}: {
  active: CollectionRoute;
  title: string;
  subtitle: string;
  matcher: (channel: Channel) => boolean;
}) {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();
  const { channels, addRecent, channelLogos, hardRefresh, loading, refreshing, error } = useStore();
  const columns = width >= 1500 ? 6 : width >= 1050 ? 5 : 4;
  const [now, setNow] = useState(() => new Date());
  const [preferInitialFocus, setPreferInitialFocus] = useState(true);

  useEffect(() => {
    if (!isFocused) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [isFocused]);

  // Tabs can stay mounted after navigation. Re-arm preferred focus on every
  // route entry so Android TV never returns to a collection with no focus owner.
  useFocusEffect(
    useCallback(() => {
      setPreferInitialFocus(true);
      return () => setPreferInitialFocus(false);
    }, []),
  );

  const disarmInitialFocus = useCallback(() => setPreferInitialFocus(false), []);

  const items = useMemo(() => channels.filter(matcher), [channels, matcher]);
  const playlistEmpty = channels.length === 0;

  const play = useCallback((channel: Channel) => {
    void Haptics.selectionAsync().catch(() => undefined);
    addRecent(channel);
    openFullscreenPlayer(router, channel.id);
  }, [addRecent, router]);

  return (
    <PurpleTvShell active={active}>
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <PurpleDrawerButton testID={`${active.slice(1)}-open-drawer`} />
            <GlassPageTitle page={title} kicker={subtitle} />
          </View>
          <Text style={styles.count}>{items.length} available channels</Text>
        </View>
        {items.length ? (
          <>
            <Text style={styles.section}>Available Now</Text>
            <FlatList
              data={items}
              numColumns={columns}
              keyExtractor={(item) => item.id}
              initialNumToRender={columns * 2}
              maxToRenderPerBatch={columns * 2}
              windowSize={5}
              removeClippedSubviews={false}
              showsVerticalScrollIndicator={false}
              columnWrapperStyle={styles.row}
              contentContainerStyle={styles.grid}
              renderItem={({ item, index }) => (
                <Card channel={item} logos={isFocused && channelLogos} now={now} onPress={play} onFocus={disarmInitialFocus} preferredFocus={preferInitialFocus && index === 0} />
              )}
            />
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {playlistEmpty ? (error ? "Guide failed to load" : "No channels loaded") : "No matching channels"}
            </Text>
            <Text style={styles.emptyText}>
              {playlistEmpty
                ? error || "Reload your playlist, then try again."
                : `Nothing in the current playlist matched ${title.toLowerCase()}. Try the TV Guide or Channels list instead.`}
            </Text>
            {playlistEmpty ? (
              <Pressable
                hasTVPreferredFocus={preferInitialFocus}
                onFocus={disarmInitialFocus}
                onPress={() => void hardRefresh()}
                disabled={loading || refreshing}
                style={({ focused }: any) => [styles.emptyButton, focused && styles.focused]}
              >
                <Ionicons name="refresh-outline" size={14} color="#fff" />
                <Text style={styles.emptyButtonText}>{refreshing || loading ? "Loading…" : "Retry load"}</Text>
              </Pressable>
            ) : (
              <Pressable
                hasTVPreferredFocus={preferInitialFocus}
                onFocus={disarmInitialFocus}
                onPress={() => router.replace("/guide" as any)}
                style={({ focused }: any) => [styles.emptyButton, focused && styles.focused]}
              >
                <Text style={styles.emptyButtonText}>Open TV Guide</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14, backgroundColor: glass.page },
  header: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1, minWidth: 0 },
  count: { color: "#D9C8F5", fontFamily: fonts.medium, fontSize: 9 },
  section: { color: "#fff", fontFamily: fonts.bold, fontSize: 12, marginTop: 8, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: glass.pink, paddingLeft: 7 },
  grid: { paddingBottom: 20, paddingTop: 2 },
  row: { gap: 9, marginBottom: 9 },
  card: { flex: 1, minWidth: 0, maxWidth: 220, minHeight: 158, backgroundColor: glass.panel, borderRadius: 14, borderWidth: 2, borderColor: glass.edgeSoft, padding: 6 },
  art: { height: 96, borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  name: { color: "#fff", fontFamily: fonts.bold, fontSize: 9.5, lineHeight: 12, marginTop: 6, minHeight: 24 },
  program: { color: "#C9B5EE", fontFamily: fonts.medium, fontSize: 7.5, letterSpacing: 0.4, marginTop: 2 },
  focused: glassFocus,
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 40 },
  emptyTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  emptyText: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9, textAlign: "center", maxWidth: 420 },
  emptyButton: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(140,70,240,0.80)",
    borderWidth: 2,
    borderColor: glass.selectedEdge,
    marginTop: 4,
  },
  emptyButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
});
