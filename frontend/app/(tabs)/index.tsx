import { GlassPageTitle } from "@/src/components/GlassPageTitle";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FocusedTabMount } from "@/src/components/FocusedTabMount";
import { findNodeHandle, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { loadVodRecent, sameVodRecent, vodTitleSection, type VodRecentItem } from "@/src/core/vodRecent";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell, useIconRailFocusBoundary, usePurpleTvDrawer } from "@/src/components/PurpleTvShell";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { useStore } from "@/src/store";
import { Channel } from "@/src/api";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { fonts, glass, glassFocus, tvColors } from "@/src/theme";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { addTvKeyListener, resetRemoteContextIfOwned, setRemoteContext } from "@/src/utils/tvRemote";
import { useTvRouteEntryFocus } from "@/src/hooks/use-tv-route-entry-focus";

function RecentChannelCard({
  channel,
  now,
  isFocused,
  channelLogos,
  channelNumbers,
  channelNumber,
  onPlay,
  inputRef,
  nextFocusUp,
  nextFocusLeft,
  onFocus,
  onBlur,
}: {
  channel: Channel;
  now: Date;
  isFocused: boolean;
  channelLogos: boolean;
  channelNumbers: boolean;
  channelNumber?: number;
  onPlay: (channel: Channel) => void;
  inputRef?: (node: unknown) => void;
  nextFocusUp?: number;
  nextFocusLeft?: number;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const programs = useGuidePrograms(channel.id);
  const current = nowNext(programs, now).current;
  return (
    <Pressable
      ref={inputRef as any}
      nextFocusUp={nextFocusUp}
      nextFocusLeft={nextFocusLeft}
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={() => onPlay(channel)}
      style={({ focused }: any) => [styles.channelCard, focused && styles.focused]}
      testID={`home-recent-${channel.id}`}
    >
      <View style={styles.channelCardArt}>
        <LinearGradient
          colors={["rgba(168,85,247,0.38)", "rgba(30,12,60,0.96)"]}
          style={StyleSheet.absoluteFill}
        />
        <ChannelLogo name={channel.name} logo={channel.logo} disabled={!isFocused || !channelLogos} size={46} />
      </View>
      <Text numberOfLines={1} style={styles.channelName}>
        {channelNumbers ? `${channelNumber || ""}  ` : ""}{channel.name}
      </Text>
      <Text numberOfLines={1} style={styles.channelProgram}>{current?.title || "Guide information loading…"}</Text>
    </Pressable>
  );
}

const VodRecentCard = React.memo(function VodRecentCard({ item, onOpen }: { item: VodRecentItem; onOpen: (item: VodRecentItem) => void }) {
  return (
    <Pressable
      onPress={() => onOpen(item)}
      style={({ focused }: any) => [styles.vodCard, focused && styles.focused]}
      testID={`home-vod-recent-${item.kind}-${item.id}`}
    >
      <View style={styles.vodArt}>
        {item.image ? (
          // Decoded at the card's size (resizeMethod), never full resolution.
          <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} resizeMode="cover" resizeMethod="resize" />
        ) : (
          <Ionicons name={item.kind === "movie" ? "film-outline" : "tv-outline"} size={30} color={tvColors.purpleSoft} />
        )}
        <View style={styles.vodKind}><Text style={styles.vodKindText}>{item.kind === "movie" ? "MOVIE" : "SERIES"}</Text></View>
        {item.progress > 0 && item.progress < 100 ? (
          <View style={styles.vodTrack}><View style={[styles.vodFill, { width: `${item.progress}%` }]} /></View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.channelName}>{item.title}</Text>
      <Text numberOfLines={1} style={styles.channelProgram}>
        {item.progress > 0 && item.progress < 100 ? `Resume · ${item.progress}% watched` : "Open in Video OnDemand"}
      </Text>
    </Pressable>
  );
});

function LiveTvHomeScreenContent() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { focusIconRail } = usePurpleTvDrawer();
  const { iconRailEntryTag } = useIconRailFocusBoundary();
  const {
    channels,
    recent,
    lastChannelId,
    channelById,
    addRecent,
    channelLogos,
    channelNumbers,
    hardRefresh,
    patchProgramsForChannelIds,
    loading,
    refreshing,
    error,
    clock24h,
  } = useStore();
  void clock24h;
  const [now, setNow] = useState(() => new Date());
  const entryFocus = useTvRouteEntryFocus(true, "live-tv-home");
  const heroButtonRef = useRef<unknown>(null);
  const firstRecentRef = useRef<unknown>(null);
  const [heroButtonTag, setHeroButtonTag] = useState<number | undefined>();
  const [firstRecentTag, setFirstRecentTag] = useState<number | undefined>();
  const leftEdgeFocusRef = useRef<string | null>(null);

  const claimLeftEdge = useCallback((owner: string) => {
    leftEdgeFocusRef.current = owner;
    setRemoteContext("drawer_edge");
  }, []);
  const releaseLeftEdge = useCallback((owner: string) => {
    if (leftEdgeFocusRef.current !== owner) return;
    leftEdgeFocusRef.current = null;
    resetRemoteContextIfOwned("drawer_edge", "default");
  }, []);

  const bindHeroButtonRef = useCallback((node: unknown) => {
    heroButtonRef.current = node;
    entryFocus.targetRef.current = node;
    const tag = node ? findNodeHandle(node as any) : null;
    setHeroButtonTag(tag || undefined);
  }, [entryFocus.targetRef]);
  const bindFirstRecentRef = useCallback((node: unknown) => {
    firstRecentRef.current = node;
    const tag = node ? findNodeHandle(node as any) : null;
    setFirstRecentTag(tag || undefined);
  }, []);

  useEffect(() => {
    if (!isFocused) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [isFocused]);

  useFocusEffect(
    useCallback(() => {
      const offKey = addTvKeyListener((key) => {
        if (key !== "LEFT") return;
        // Android TV may mark Watch Last Channel as preferred focus before
        // its first onFocus callback. LEFT must work immediately on startup.
        const owner = leftEdgeFocusRef.current;
        if (!owner && !entryFocus.preferredFocus) return;
        focusIconRail();
      });
      return () => {
        offKey();
        leftEdgeFocusRef.current = null;
        resetRemoteContextIfOwned("drawer_edge", "default");
      };
    }, [entryFocus.preferredFocus, focusIconRail]),
  );

  const channelNumberById = useMemo(() => {
    const result: Record<string, number> = {};
    if (!channelNumbers) return result;
    for (let index = 0; index < channels.length; index += 1) result[channels[index].id] = index + 1;
    return result;
  }, [channelNumbers, channels]);

  const heroChannel = useMemo(() => {
    const last = lastChannelId ? channelById(lastChannelId) : null;
    return last || recent[0] || channels[0] || null;
  }, [channelById, channels, lastChannelId, recent]);

  const recentLive = useMemo(() => {
    if (recent.length) return recent.slice(0, 6);
    return channels.slice(0, 6);
  }, [channels, recent]);

  const heroPrograms = useGuidePrograms(heroChannel?.id);
  const heroProgram = useMemo(
    () => (heroChannel ? nowNext(heroPrograms, now).current : undefined),
    [heroChannel, heroPrograms, now],
  );
  const heroProgress = heroProgram ? progressPct(heroProgram, now) : 0;

  useEffect(() => {
    if (!isFocused || !channels.length) return;
    const idSet = new Set<string>();
    if (heroChannel?.id) idSet.add(heroChannel.id);
    for (const channel of recentLive) if (channel.id) idSet.add(channel.id);
    const ids = Array.from(idSet);
    if (!ids.length) return;
    void patchProgramsForChannelIds(ids, heroChannel?.id ? [heroChannel.id] : ids.slice(0, 1));
  }, [channels.length, heroChannel?.id, isFocused, patchProgramsForChannelIds, recentLive]);

  const play = useCallback(
    (channel: Channel) => {
      void Haptics.selectionAsync().catch(() => undefined);
      addRecent(channel);
      openFullscreenPlayer(router, channel.id);
    },
    [addRecent, router],
  );

  // Recently watched VOD titles (read from VOD's own history each time Live TV
  // is shown; at most 10 small rows, nothing kept while Live TV is hidden).
  const [vodRecent, setVodRecent] = useState<VodRecentItem[]>([]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadVodRecent().then((items) => {
        if (alive) setVodRecent((current) => (sameVodRecent(current, items) ? current : items));
      });
      return () => { alive = false; };
    }, []),
  );
  const openVodTitle = useCallback((item: VodRecentItem) => {
    void Haptics.selectionAsync().catch(() => undefined);
    router.replace({ pathname: "/vod", params: { section: vodTitleSection(item) } } as any);
  }, [router]);

  return (
    <PurpleTvShell active="/">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.page}>
        <View style={styles.topbar}>
          <GlassPageTitle page="Live TV" style={{ flex: 1 }} />
          <View style={styles.topRight}>
            <Pressable
              onPress={() => router.replace("/search" as any)}
              style={({ focused }: any) => [styles.searchHit, focused && styles.focused]}
              testID="home-open-search"
            >
              <Ionicons name="search-outline" size={14} color="#fff" />
              <Text style={styles.searchText}>Search</Text>
            </Pressable>
            <Text style={styles.clock}>{fmtTime(now.toISOString())}</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <LinearGradient
            colors={["rgba(168,85,247,0.34)", "rgba(52,20,104,0.86)", "#1A0B38"]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroCopy}>
            <Text style={styles.heroLabel}>LAST WATCHED · ON NOW</Text>
            <Text numberOfLines={1} style={styles.heroTitle}>
              {heroChannel?.name || "Choose a channel"}
            </Text>
            <View style={styles.heroMetaRow}>
              <View style={styles.livePill}><Text style={styles.livePillText}>LIVE</Text></View>
              <Text style={styles.heroMeta}>
                {heroProgram
                  ? `${fmtTime(heroProgram.start)}${heroProgram.stop ? ` - ${fmtTime(heroProgram.stop)}` : ""}`
                  : "Loading current programme…"}
              </Text>
            </View>
            <Text numberOfLines={2} style={styles.heroProgram}>
              {heroProgram?.title || "Guide information loading…"}
            </Text>
            <Text numberOfLines={3} style={styles.heroDescription}>
              {heroProgram?.desc || "Select the last-watched channel to resume live TV."}
            </Text>
            <View style={styles.heroProgressTrack}>
              <View style={[styles.heroProgressFill, { width: `${heroProgress}%` }]} />
            </View>
            {heroChannel ? (
              <Pressable
                ref={bindHeroButtonRef as any}
                hasTVPreferredFocus={entryFocus.preferredFocus}
                nextFocusLeft={iconRailEntryTag}
                nextFocusDown={firstRecentTag}
                onFocus={() => {
                  entryFocus.onFocus();
                  claimLeftEdge("hero-action");
                }}
                onBlur={() => { entryFocus.onBlur(); releaseLeftEdge("hero-action"); }}
                onPress={() => play(heroChannel)}
                style={({ focused }: any) => [styles.primaryButton, focused && styles.focused]}
                testID="home-continue-watching"
              >
                <Ionicons name="play" size={15} color="#fff" />
                <Text style={styles.primaryButtonText}>Watch Last Channel</Text>
              </Pressable>
            ) : (
              <Pressable
                ref={bindHeroButtonRef as any}
                hasTVPreferredFocus={entryFocus.preferredFocus}
                nextFocusLeft={iconRailEntryTag}
                onFocus={() => {
                  entryFocus.onFocus();
                  claimLeftEdge("hero-action");
                }}
                onBlur={() => { entryFocus.onBlur(); releaseLeftEdge("hero-action"); }}
                onPress={() => void hardRefresh()}
                disabled={loading || refreshing}
                style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
                testID="home-reload-guide"
              >
                <Ionicons name="refresh-outline" size={14} color="#fff" />
                <Text style={styles.secondaryButtonText}>
                  {refreshing || loading ? "Loading…" : error ? "Retry guide load" : "Load channels"}
                </Text>
              </Pressable>
            )}
          </View>

          <Pressable
            disabled={!heroChannel}
            nextFocusDown={firstRecentTag}
            onPress={() => heroChannel && play(heroChannel)}
            style={({ focused }: any) => [styles.heroArtwork, focused && styles.heroArtworkFocused]}
            testID="home-last-channel-logo"
          >
            <View style={styles.heroGlow} />
            {heroChannel ? (
              <ChannelLogo name={heroChannel.name} logo={heroChannel.logo} disabled={!isFocused || !channelLogos} size={118} />
            ) : (
              <Ionicons name="tv-outline" size={72} color={tvColors.purpleSoft} />
            )}
            <Text numberOfLines={1} style={styles.heroArtName}>{heroChannel?.name || "Charming MediaLab"}</Text>
            {heroProgram?.title ? <Text numberOfLines={1} style={styles.heroArtNow}>{heroProgram.title}</Text> : null}
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recently Watched Channels</Text>
          <Text style={styles.sectionHint}>Currently airing on channels you watched</Text>
        </View>
        <ScrollView horizontal style={styles.rowScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
          {recentLive.map((channel, index) => (
            <RecentChannelCard
              key={channel.id}
              channel={channel}
              inputRef={index === 0 ? bindFirstRecentRef : undefined}
              nextFocusUp={index === 0 ? heroButtonTag : undefined}
              nextFocusLeft={index === 0 ? iconRailEntryTag : undefined}
              onFocus={index === 0 ? () => claimLeftEdge("recent-first") : undefined}
              onBlur={index === 0 ? () => releaseLeftEdge("recent-first") : undefined}
              now={now}
              isFocused={isFocused}
              channelLogos={channelLogos}
              channelNumbers={channelNumbers}
              channelNumber={channelNumberById[channel.id]}
              onPlay={play}
            />
          ))}
        </ScrollView>

        {vodRecent.length ? (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recently Watched On Demand</Text>
              <Text style={styles.sectionHint}>Movies and shows from Video OnDemand</Text>
            </View>
            <ScrollView horizontal style={styles.rowScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
              {vodRecent.map((item) => (
                <VodRecentCard key={`${item.kind}:${item.id}`} item={item} onOpen={openVodTitle} />
              ))}
            </ScrollView>
          </>
        ) : null}
      </ScrollView>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 26, gap: 12, flexGrow: 1, backgroundColor: glass.page },
  topbar: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: 1.2, marginTop: 2 },
  pageTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 28 },
  topRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  clock: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12 },
  hero: { minHeight: 224, flexDirection: "row", borderRadius: 16, borderWidth: 1, borderColor: glass.edge, overflow: "hidden" },
  heroCopy: { flex: 1.1, padding: 18, justifyContent: "center", alignItems: "flex-start" },
  heroLabel: { color: glass.kicker, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1.8 },
  heroTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 22, marginTop: 4, maxWidth: "95%" },
  heroMetaRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5 },
  livePill: { backgroundColor: glass.live, borderColor: glass.liveEdge, borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  livePillText: { color: "#fff", fontFamily: fonts.bold, fontSize: 7 },
  heroMeta: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 10 },
  heroProgram: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, marginTop: 6, maxWidth: "94%" },
  heroDescription: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9.5, lineHeight: 13, marginTop: 4, maxWidth: "94%" },
  heroProgressTrack: { width: "70%", height: 3, backgroundColor: "rgba(255,255,255,0.14)", marginTop: 8, borderRadius: 2, overflow: "hidden" },
  heroProgressFill: { height: 3, borderRadius: 2, backgroundColor: glass.pink },
  primaryButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "rgba(140,70,240,0.80)", borderWidth: 2, borderColor: glass.selectedEdge, marginTop: 11 },
  primaryButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  secondaryButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, borderRadius: 12, backgroundColor: glass.button, borderWidth: 2, borderColor: glass.buttonEdge, marginTop: 8 },
  secondaryButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  searchHit: { minHeight: 30, flexDirection: "row", gap: 6, paddingHorizontal: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: glass.buttonEdge, backgroundColor: glass.button },
  searchText: { color: "#fff", fontFamily: fonts.medium, fontSize: 9.5 },
  heroArtwork: { flex: 0.9, alignItems: "center", justifyContent: "center", gap: 7, overflow: "hidden", borderWidth: 2, borderColor: glass.edgeSoft, backgroundColor: "rgba(40,14,84,0.55)", margin: 10, borderRadius: 14 },
  heroArtworkFocused: { borderColor: "#fff", backgroundColor: "rgba(124,58,237,0.30)" },
  heroGlow: { position: "absolute", width: 168, height: 168, borderRadius: 84, backgroundColor: "rgba(168,85,247,0.26)" },
  heroArtName: { color: "#fff", fontFamily: fonts.bold, fontSize: 12, maxWidth: "84%" },
  heroArtNow: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 9, maxWidth: "84%" },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 2 },
  sectionTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 13, borderLeftWidth: 3, borderLeftColor: glass.pink, paddingLeft: 7 },
  sectionHint: { color: "#D9C8F5", fontFamily: fonts.regular, fontSize: 8.5 },
  rowScroll: { flexGrow: 0 },
  recentRow: { gap: 9, paddingBottom: 2, paddingTop: 2, alignItems: "flex-start" },
  vodCard: { width: 170, minHeight: 132, backgroundColor: glass.panel, borderRadius: 14, borderWidth: 2, borderColor: glass.edgeSoft, padding: 7 },
  vodArt: { height: 88, borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center", marginBottom: 6, backgroundColor: "rgba(40,14,84,0.75)" },
  vodKind: { position: "absolute", top: 5, left: 5, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: "rgba(26,11,51,0.85)" },
  vodKindText: { color: "#fff", fontFamily: fonts.bold, fontSize: 6.5, letterSpacing: 0.8 },
  vodTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "rgba(255,255,255,0.18)" },
  vodFill: { height: 3, backgroundColor: glass.pink },
  channelCard: { width: 150, minHeight: 116, backgroundColor: glass.panel, borderRadius: 14, borderWidth: 2, borderColor: glass.edgeSoft, padding: 7 },
  channelCardArt: { height: 64, borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center", marginBottom: 6 },
  channelName: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9.5 },
  channelProgram: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 8.5, marginTop: 2 },
  focused: glassFocus,
});

export default function LiveTvHomeScreen() {
  return (
    <FocusedTabMount>
      <LiveTvHomeScreenContent />
    </FocusedTabMount>
  );
}
