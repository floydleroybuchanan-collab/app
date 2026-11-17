import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { useChannelCustomize } from "@/src/core/channelCustomize";
import { useGuideUiPreferences } from "@/src/core/guideUiPreferences";
import { buildPlaylistMenu, providerGroupKey } from "@/src/core/playlistGuideMenu";
import { playlistOwner } from "@/src/core/playlistCatalog";
import { usePlaylists } from "@/src/core/playlistRegistry";
import { selectPlaylist, useSelectedPlaylist } from "@/src/core/playlistSelection";
import { fonts, glass, phoneGlass } from "@/src/theme";
import { nowNext, progressPct } from "@/src/utils/time";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";

/**
 * Phone Live TV: a playlist button, search and a pop-down for choosing playlists and channel groups.
 * Categories first, then channel cards that show what is on now (and next). There is no timeline Guide on
 * a phone; that stays on the TV. Touch only; the TV never renders this.
 */

type Panel = null | "playlists" | "groups" | "more";
type GroupRow = { key: string; label: string; count: number };

const CARD_COLORS: [string, string][] = [
  ["#8E3B52", "#4B2A7A"], ["#3C4FA8", "#4B2A7A"], ["#2F7A6A", "#3B3A8F"], ["#8A5A2B", "#4B2A7A"],
  ["#7A3FA8", "#3A2A7A"], ["#2E6FA8", "#3A2A7A"], ["#A83F7A", "#3A2A7A"], ["#3F8A4B", "#3A2A7A"],
];
const colorsFor = (text: string) => CARD_COLORS[(text.split("").reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) | 0, 7) >>> 0) % CARD_COLORS.length];

const ChannelCard = memo(function ChannelCard({ channel, now, logos, onPlay, onFavorite }: {
  channel: Channel; now: Date; logos: boolean; onPlay: (channel: Channel) => void; onFavorite: (id: string) => void;
}) {
  const programs = useGuidePrograms(channel.id);
  const { current, next } = nowNext(programs, now);
  const progress = current ? progressPct(current, now) : 0;
  const [from, to] = colorsFor(channel.name);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${channel.name}. ${current?.title || "Live channel"}`}
      onPress={() => onPlay(channel)}
      onLongPress={() => onFavorite(channel.id)}
      delayLongPress={450}
      style={({ focused }: any) => [styles.card, focused && styles.focusRing]}
      testID={`phone-live-card-${channel.id}`}
    >
      <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardTile}>
        {channel.logo && logos ? <ChannelLogo name={channel.name} logo={channel.logo} size={44} /> : (
          // No logo: the whole channel name, so you can tell which channel it is.
          <Text numberOfLines={3} style={styles.cardNameBig}>{channel.name}</Text>
        )}
      </LinearGradient>
      <View style={styles.cardBody}>
        <Text numberOfLines={1} style={styles.cardName}>{channel.name}</Text>
        <Text numberOfLines={1} style={styles.cardProgram}>{current ? `Now: ${current.title}` : "No guide info"}</Text>
        {next ? <Text numberOfLines={1} style={styles.cardNext}>{`Next: ${next.title}`}</Text> : null}
        <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
      </View>
    </Pressable>
  );
});

export function PhoneLiveHub() {
  const router = useRouter();
  const { channels, favorites, toggleFavorite, addRecent, channelLogos, hardRefresh, patchProgramsForChannelIds } = useStore();
  const playlists = usePlaylists();
  const selected = useSelectedPlaylist();
  const activePlaylist = playlists.some((item) => item.id === selected && item.enabled) ? selected : "all";
  const { hiddenIds } = useChannelCustomize();
  const { hiddenGroups } = useGuideUiPreferences();
  const [group, setGroup] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const hiddenIdSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const menu = useMemo(
    () => buildPlaylistMenu(playlists, channels, favoriteSet, hiddenIdSet, new Set(hiddenGroups)),
    [playlists, channels, favoriteSet, hiddenIdSet, hiddenGroups],
  );
  const section = menu.find((item) => item.id === activePlaylist) || menu[0];
  const playlistName = activePlaylist === "all" ? "All Playlists" : playlists.find((item) => item.id === activePlaylist)?.name || "Playlist";
  const groupRows: GroupRow[] = section?.groups || [];
  const categories = groupRows.filter((row) => row.key !== "All" && row.key !== "Favorites");
  const activeGroup = group ?? "All";
  const groupLabel = groupRows.find((row) => row.key === activeGroup)?.label || "All Channels";
  const groupCount = groupRows.find((row) => row.key === activeGroup)?.count ?? 0;

  const shown = useMemo(() => {
    const base = activePlaylist === "all" ? channels : channels.filter((channel) => playlistOwner(channel) === activePlaylist);
    return base.filter((channel) => {
      if (hiddenIdSet.has(channel.id)) return false;
      if (activeGroup === "All") return true;
      if (activeGroup === "Favorites") return favoriteSet.has(channel.id);
      return providerGroupKey(channel.group || "") === activeGroup;
    });
  }, [activeGroup, activePlaylist, channels, favoriteSet, hiddenIdSet]);

  // What is on now comes from the guide data: ask for the rows on screen and a few pages around them.
  const shownRef = useRef<Channel[]>(shown);
  shownRef.current = shown;
  const patchRef = useRef(patchProgramsForChannelIds);
  patchRef.current = patchProgramsForChannelIds;
  const loadAround = useCallback((first: number, last: number) => {
    const list = shownRef.current;
    const ids = list.slice(Math.max(0, first - 12), Math.min(list.length, last + 30)).map((channel) => channel.id);
    if (ids.length) void patchRef.current(ids, list.slice(Math.max(0, first), last + 1).map((channel) => channel.id));
  }, []);
  useEffect(() => { loadAround(0, 18); }, [shown, loadAround]);
  const viewableRef = useRef(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    const indexes = viewableItems.map((item) => item.index).filter((index): index is number => typeof index === "number");
    if (indexes.length) loadAround(Math.min(...indexes), Math.max(...indexes));
  });
  const viewabilityRef = useRef({ itemVisiblePercentThreshold: 20 });
  const play = useCallback((channel: Channel) => {
    void Haptics.selectionAsync().catch(() => undefined);
    addRecent(channel);
    openFullscreenPlayer(router, channel.id);
  }, [addRecent, router]);
  const favorite = useCallback((id: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    toggleFavorite(id);
  }, [toggleFavorite]);
  const choosePlaylist = (id: string) => {
    selectPlaylist(id);
    setGroup(null);
    setPanel(null);
  };
  const chooseGroup = (key: string) => {
    setGroup(key);
    setPanel(null);
  };
  const showCategories = group === null;

  return (
    <View style={styles.page} testID="phone-live-hub">
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playlist ${playlistName}. Change playlist`}
          onPress={() => setPanel(panel === "playlists" ? null : "playlists")}
          style={({ focused }: any) => [styles.pill, styles.playlistPill, focused && styles.focusRing]}
          testID="phone-live-playlist"
        >
          <View style={styles.playlistIcon}><Ionicons name="tv-outline" size={16} color="#fff" /></View>
          <Text numberOfLines={1} style={styles.playlistText}>{playlistName}</Text>
          <Ionicons name={panel === "playlists" ? "chevron-up" : "chevron-down"} size={18} color="#CFE6FF" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More actions"
          onPress={() => setPanel(panel === "more" ? null : "more")}
          style={({ focused }: any) => [styles.circle, focused && styles.focusRing]}
          testID="phone-live-more"
        >
          <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search channels and programs"
        onPress={() => router.replace("/search" as any)}
        style={({ focused }: any) => [styles.pill, styles.searchPill, focused && styles.focusRing]}
        testID="phone-live-search"
      >
        <Ionicons name="search" size={18} color="#CDBBEE" />
        <Text numberOfLines={1} style={styles.searchText}>Search channels and programs</Text>
      </Pressable>
      {!showCategories ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Group ${groupLabel}. Change group`}
          onPress={() => setPanel(panel === "groups" ? null : "groups")}
          style={({ focused }: any) => [styles.pill, styles.groupPill, focused && styles.focusRing]}
          testID="phone-live-group"
        >
          <Text numberOfLines={1} style={styles.groupText}>{groupLabel}</Text>
          <Text style={styles.groupCount}>{groupCount.toLocaleString()}</Text>
          <Ionicons name={panel === "groups" ? "chevron-up" : "chevron-down"} size={18} color="#CFE6FF" />
        </Pressable>
      ) : null}

      {showCategories ? (
        <FlatList
          key="categories"
          data={categories}
          numColumns={2}
          keyExtractor={(item) => item.key}
          ListHeaderComponent={<Text style={styles.heading}>Categories</Text>}
          ListEmptyComponent={<Text style={styles.empty}>No channels loaded yet. Pull Reload from the menu above.</Text>}
          columnWrapperStyle={styles.categoryRow}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const [from, to] = colorsFor(item.label);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.label}, ${item.count} channels`}
                onPress={() => chooseGroup(item.key)}
                style={({ focused }: any) => [styles.category, focused && styles.focusRing]}
                testID={`phone-live-category-${item.key}`}
              >
                <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                <Text style={styles.categoryName}>{item.label}</Text>
                <Text style={styles.categoryCount}>{item.count} channels</Text>
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          key="cards"
          data={shown}
          numColumns={3}
          keyExtractor={(item) => item.id}
          columnWrapperStyle={styles.cardRow}
          contentContainerStyle={styles.list}
          onViewableItemsChanged={viewableRef.current}
          viewabilityConfig={viewabilityRef.current}
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={7}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<Text style={styles.empty}>No channels in this group.</Text>}
          renderItem={({ item }) => <ChannelCard channel={item} now={now} logos={channelLogos} onPlay={play} onFavorite={favorite} />}
        />
      )}

      {panel ? (
        <>
          <Pressable style={styles.scrim} onPress={() => setPanel(null)} accessibilityLabel="Close" testID="phone-live-scrim" />
          <View style={[styles.popDown, panel === "groups" && styles.popDownGroups]} testID={`phone-live-popdown-${panel}`}>
            {panel === "playlists" ? (
              <>
                <Text style={styles.popTitle}>Playlists</Text>
                {[{ id: "all", label: "All Playlists", count: menu.find((item) => item.id === "all")?.count ?? channels.length },
                  ...playlists.filter((item) => item.enabled).map((item) => ({ id: item.id, label: item.name, count: menu.find((m) => m.id === item.id)?.count ?? item.count }))
                ].map((item) => (
                  <Pressable key={item.id} onPress={() => choosePlaylist(item.id)} style={[styles.popRow, activePlaylist === item.id && styles.popRowOn]} testID={`phone-live-playlist-${item.id}`}>
                    <Text numberOfLines={1} style={styles.popRowText}>{item.label}</Text>
                    <Text style={styles.popRowCount}>{item.count.toLocaleString()}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => { setPanel(null); router.push("/playlists" as any); }} style={[styles.popRow, styles.popAction]} testID="phone-live-manage">
                  <Text style={styles.popActionText}>Manage playlists</Text>
                </Pressable>
                <Pressable onPress={() => { setPanel(null); router.push("/playlists" as any); }} style={[styles.popRow, styles.popAction2]} testID="phone-live-add">
                  <Text style={styles.popActionText}>Add a playlist</Text>
                </Pressable>
              </>
            ) : panel === "groups" ? (
              <>
                <Text style={styles.popTitle}>Channel groups</Text>
                <FlatList
                  data={groupRows}
                  keyExtractor={(item) => item.key}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <Pressable onPress={() => chooseGroup(item.key)} style={[styles.popRow, activeGroup === item.key && styles.popRowOn]} testID={`phone-live-group-${item.key}`}>
                      <Text numberOfLines={1} style={styles.popRowText}>{item.label}</Text>
                      <Text style={styles.popRowCount}>{item.count.toLocaleString()}</Text>
                    </Pressable>
                  )}
                  ListFooterComponent={(
                    <Pressable onPress={() => { setGroup(null); setPanel(null); }} style={[styles.popRow, styles.popAction]} testID="phone-live-all-categories">
                      <Text style={styles.popActionText}>All categories</Text>
                    </Pressable>
                  )}
                />
              </>
            ) : (
              <>
                <Text style={styles.popTitle}>Live TV</Text>
                <Pressable onPress={() => { setPanel(null); void hardRefresh(); }} style={styles.popRow} testID="phone-live-refresh">
                  <Text style={styles.popRowText}>Reload channels and guide</Text>
                  <Ionicons name="refresh-outline" size={16} color="#CFE6FF" />
                </Pressable>
              </>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

const edge = glass.buttonEdge;
const fill = glass.button;
const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 14, paddingTop: 8 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pill: { height: 44, borderRadius: 22, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderWidth: 2, borderColor: edge, backgroundColor: fill },
  playlistPill: { flex: 1, minWidth: 0 },
  playlistIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#E8654A" },
  playlistText: { flex: 1, color: "#fff", fontFamily: fonts.bold, fontSize: 16 },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: edge, backgroundColor: fill },
  searchPill: { marginTop: 8 },
  searchText: { flex: 1, color: "#CDBBEE", fontFamily: fonts.medium, fontSize: 14 },
  switchWrap: { alignSelf: "center", flexDirection: "row", marginTop: 10, borderRadius: 22, borderWidth: 2, borderColor: edge, backgroundColor: fill, padding: 3 },
  switchItem: { minWidth: 120, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  switchOn: { backgroundColor: "rgba(150,90,235,0.85)", borderWidth: 2, borderColor: "#fff" },
  switchText: { color: "#CDBBEE", fontFamily: fonts.bold, fontSize: 15 },
  switchTextOn: { color: "#fff" },
  groupPill: { marginTop: 10, justifyContent: "space-between" },
  groupText: { flex: 1, color: "#fff", fontFamily: fonts.bold, fontSize: 14 },
  groupCount: { color: "#7FD6FF", fontFamily: fonts.bold, fontSize: 13 },
  heading: { color: "#fff", fontFamily: fonts.bold, fontSize: 22, marginTop: 12, marginBottom: 8 },
  list: { paddingBottom: 130, paddingTop: 10 },
  empty: { color: "#CDBBEE", fontFamily: fonts.medium, fontSize: 14, paddingVertical: 24, textAlign: "center" },
  categoryRow: { gap: 12, marginBottom: 12 },
  category: { flex: 1, minHeight: 112, borderRadius: 18, borderWidth: 2, borderColor: edge, overflow: "hidden", padding: 12, justifyContent: "space-between" },
  categoryName: { color: "#fff", fontFamily: fonts.bold, fontSize: 16 },
  categoryCount: { color: "#fff", fontFamily: fonts.medium, fontSize: 14 },
  cardRow: { gap: 10, marginBottom: 10 },
  card: { flex: 1, borderRadius: 16, borderWidth: 2, borderColor: edge, backgroundColor: "rgba(36,16,70,0.55)", overflow: "hidden" },
  cardTile: { height: 76, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  cardNameBig: { color: "#fff", fontFamily: fonts.bold, fontSize: 15, textAlign: "center" },
  cardBody: { padding: 8 },
  cardName: { color: "#fff", fontFamily: fonts.bold, fontSize: 13 },
  cardNext: { color: "#B7A4DD", fontFamily: fonts.medium, fontSize: 11, marginTop: 1 },
  cardProgram: { color: "#D9C8F5", fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  track: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", marginTop: 8, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2, backgroundColor: "#8FA8FF" },
  guideHead: { flexDirection: "row", gap: 8, paddingHorizontal: 4, paddingBottom: 4 },
  guideHeadText: { color: "#E7DCFB", fontFamily: fonts.bold, fontSize: 14 },
  guideRow: { flexDirection: "row", alignItems: "stretch", gap: 8, marginBottom: 8, minHeight: 70 },
  guideTile: { flex: 1.25, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 2, borderColor: edge },
  guideName: { color: "#fff", fontFamily: fonts.bold, fontSize: 14, textAlign: "center" },
  guideNameSmall: { color: "#fff", fontFamily: fonts.bold, fontSize: 11, textAlign: "center", marginTop: 3 },
  guideCell: { borderRadius: 14, padding: 10, borderWidth: 2, borderColor: edge, justifyContent: "center" },
  guideNow: { flex: 2, backgroundColor: "rgba(140,60,90,0.55)" },
  guideNext: { flex: 1.6, backgroundColor: "rgba(80,60,160,0.55)" },
  guideWhen: { color: "#E7DCFB", fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4 },
  guideTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 15, marginTop: 2 },
  focusRing: { borderColor: "#fff", backgroundColor: "rgba(170,110,255,0.45)" },
  scrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(10,4,24,0.45)" },
  popDown: { position: "absolute", left: 12, right: 12, top: 56, borderRadius: 26, borderWidth: 2, borderColor: edge, backgroundColor: phoneGlass.solid[0], padding: 14, gap: 8 },
  popDownGroups: { top: 190, maxHeight: "60%" },
  popTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 20, textAlign: "center", marginBottom: 4 },
  popRow: { minHeight: 48, borderRadius: 16, borderWidth: 2, borderColor: edge, backgroundColor: "rgba(120,70,210,0.30)", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, gap: 10, marginBottom: 6 },
  popRowOn: { backgroundColor: "rgba(150,90,235,0.85)", borderColor: "#fff" },
  popRowText: { flex: 1, color: "#fff", fontFamily: fonts.bold, fontSize: 16 },
  popRowCount: { color: "#D9C8F5", fontFamily: fonts.medium, fontSize: 15 },
  popAction: { justifyContent: "center", backgroundColor: "rgba(150,90,235,0.55)" },
  popAction2: { justifyContent: "center" },
  popActionText: { color: "#fff", fontFamily: fonts.bold, fontSize: 16 },
});
