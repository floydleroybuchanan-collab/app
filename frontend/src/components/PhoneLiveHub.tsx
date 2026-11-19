import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
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
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";

/**
 * Phone Live TV: a playlist button, search and a pop-down for choosing playlists and channel groups.
 * Categories first, then channel cards that show what is on now (and next). There is no timeline Guide on
 * a phone; that stays on the TV. Touch only; the TV never renders this.
 */

type Panel = null | "playlists" | "groups" | "more";
type GroupRow = { key: string; label: string; count: number };
type Spacer = { spacer: true; key: string; id: string };

/** Fills the last row of a grid with empty cells, so one card on its own stays one column wide. */
function withSpacers<T>(items: T[], columns: number): (T | Spacer)[] {
  const missing = (columns - (items.length % columns)) % columns;
  if (!missing) return items;
  const out: (T | Spacer)[] = items.slice();
  for (let i = 0; i < missing; i += 1) out.push({ spacer: true, key: `spacer-${i}`, id: `spacer-${i}` });
  return out;
}
const isSpacer = (item: unknown): item is Spacer => !!item && typeof item === "object" && (item as Spacer).spacer === true;

const CARD_COLORS: [string, string][] = [
  ["#8E3B52", "#4B2A7A"], ["#3C4FA8", "#4B2A7A"], ["#2F7A6A", "#3B3A8F"], ["#8A5A2B", "#4B2A7A"],
  ["#7A3FA8", "#3A2A7A"], ["#2E6FA8", "#3A2A7A"], ["#A83F7A", "#3A2A7A"], ["#3F8A4B", "#3A2A7A"],
];
export const cardColorsFor = (text: string): [string, string] =>
  CARD_COLORS[(text.split("").reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) | 0, 7) >>> 0) % CARD_COLORS.length];

/**
 * A channel card: the logo, or the whole channel name when there is no logo, then what is on now, when it
 * ends, what is next and a bar showing how far through it is. Used on the Live TV pages of the phone.
 */
export const ChannelCard = memo(function ChannelCard({ channel, now, logos, onPlay, onFavorite, compact }: {
  channel: Channel; now: Date; logos: boolean; onPlay: (channel: Channel) => void; onFavorite?: (id: string) => void; compact?: boolean;
}) {
  const programs = useGuidePrograms(channel.id);
  const { current, next } = nowNext(programs, now);
  const progress = current ? progressPct(current, now) : 0;
  const [from, to] = cardColorsFor(channel.name);
  const hasLogo = !!channel.logo && logos;
  const ends = current?.stop ? fmtTime(current.stop) : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${channel.name}. ${current ? `Now ${current.title}` : "No guide information"}`}
      onPress={() => onPlay(channel)}
      onLongPress={onFavorite ? () => onFavorite(channel.id) : undefined}
      delayLongPress={450}
      style={({ focused }: any) => [styles.card, focused && styles.focusRing]}
      testID={`phone-live-card-${channel.id}`}
    >
      <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.cardTile, compact && styles.cardTileCompact]}>
        {hasLogo ? <ChannelLogo name={channel.name} logo={channel.logo} size={compact ? 40 : 44} /> : (
          // No logo: the whole channel name, so you can tell which channel it is.
          <Text numberOfLines={3} style={styles.cardNameBig}>{channel.name}</Text>
        )}
      </LinearGradient>
      <View style={styles.cardBody}>
        {hasLogo ? <Text numberOfLines={1} style={styles.cardName}>{channel.name}</Text> : null}
        <Text numberOfLines={1} style={styles.cardProgram}>{current ? current.title : "No guide information"}</Text>
        <Text numberOfLines={1} style={styles.cardWhen}>{current && ends ? `until ${ends}` : ""}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
        {next ? (
          <View style={styles.nextRow}>
            <Text style={styles.nextLabel}>What&rsquo;s Next</Text>
            <Text numberOfLines={1} style={styles.nextTitle}>{next.title}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

export function PhoneLiveHub() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  // A tab that was just left stays mounted for a while: it must not take Back or load data while hidden.
  const isFocused = useIsFocused();
  const { channels, favorites, toggleFavorite, addRecent, channelLogos, hardRefresh, patchProgramsForChannelIds, retainGuideSlidingCache } = useStore();
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
  const groupRows = useMemo<GroupRow[]>(() => section?.groups || [], [section]);
  const categories = useMemo(() => groupRows.filter((row) => row.key !== "All" && row.key !== "Favorites"), [groupRows]);
  const activeGroup = group ?? "All";
  const groupLabel = groupRows.find((row) => row.key === activeGroup)?.label || "All Channels";
  const groupCount = groupRows.find((row) => row.key === activeGroup)?.count ?? 0;

  // A group from another playlist (the playlist was changed elsewhere) goes back to the categories.
  useEffect(() => {
    if (group !== null && groupRows.length > 0 && !groupRows.some((row) => row.key === group)) setGroup(null);
  }, [group, groupRows]);

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
  const retainRef = useRef(retainGuideSlidingCache);
  retainRef.current = retainGuideSlidingCache;
  const loadAround = useCallback((first: number, last: number) => {
    const list = shownRef.current;
    const ids = list.slice(Math.max(0, first - 12), Math.min(list.length, last + 30)).map((channel) => channel.id);
    if (!ids.length) return;
    // The rows on screen are the ones kept, so the programme data that arrives for them is applied.
    retainRef.current(ids);
    void patchRef.current(ids, list.slice(Math.max(0, first), last + 1).map((channel) => channel.id));
  }, []);
  useEffect(() => {
    // The categories page shows no channels, so nothing is asked for until a group is open.
    if (isFocused && group !== null) loadAround(0, 18);
  }, [shown, group, isFocused, loadAround]);
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
  const categoryColumns = landscape ? 4 : 2;
  const cardColumns = landscape ? 5 : 3;
  const categoryData = useMemo(() => withSpacers(categories, categoryColumns), [categories, categoryColumns]);
  const cardData = useMemo(() => withSpacers(shown, cardColumns), [shown, cardColumns]);

  // Back closes the pop-down first, then returns from a group to the categories.
  useEffect(() => {
    if (!isFocused) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (panel) { setPanel(null); return true; }
      if (group !== null) { setGroup(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [panel, group, isFocused]);

  const searchPill = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search channels and programs"
      onPress={() => router.replace("/search" as any)}
      style={({ focused }: any) => [styles.pill, landscape ? styles.searchPillInline : styles.searchPill, focused && styles.focusRing]}
      testID="phone-live-search"
    >
      <Ionicons name="search" size={18} color="#CDBBEE" />
      <Text numberOfLines={1} style={styles.searchText}>Search channels and programs</Text>
    </Pressable>
  );
  const groupTop = landscape ? 110 : 168;
  const popMax = Math.max(160, height - (panel === "groups" ? groupTop : 60) - (landscape ? 16 : 120));

  return (
    <View style={styles.page} testID="phone-live-hub">
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playlist ${playlistName}. Change playlist`}
          onPress={() => setPanel(panel === "playlists" ? null : "playlists")}
          // A touch-first screen still has to give a connected remote/keyboard's D-pad
          // somewhere to land: without this, nothing was ever focused here to move from.
          hasTVPreferredFocus
          style={({ focused }: any) => [styles.pill, styles.playlistPill, focused && styles.focusRing]}
          testID="phone-live-playlist"
        >
          <View style={styles.playlistIcon}><Ionicons name="tv-outline" size={16} color="#fff" /></View>
          <Text numberOfLines={1} style={styles.playlistText}>{playlistName}</Text>
          <Ionicons name={panel === "playlists" ? "chevron-up" : "chevron-down"} size={18} color="#CFE6FF" />
        </Pressable>
        {landscape ? searchPill : null}
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
      {landscape ? null : searchPill}
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
          key={landscape ? "categories-l" : "categories"}
          data={categoryData}
          numColumns={categoryColumns}
          keyExtractor={(item) => item.key}
          ListHeaderComponent={<Text style={styles.heading}>Categories</Text>}
          ListEmptyComponent={<Text style={styles.empty}>No channels loaded yet. Use Reload in the menu above.</Text>}
          columnWrapperStyle={styles.categoryRow}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            if (isSpacer(item)) return <View style={styles.spacerCell} />;
            const [from, to] = cardColorsFor(item.label);
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
          key={landscape ? "cards-l" : "cards"}
          data={cardData}
          numColumns={cardColumns}
          keyExtractor={(item) => item.id}
          columnWrapperStyle={styles.cardRow}
          contentContainerStyle={styles.list}
          onViewableItemsChanged={viewableRef.current}
          viewabilityConfig={viewabilityRef.current}
          initialNumToRender={landscape ? 10 : 12}
          maxToRenderPerBatch={9}
          windowSize={7}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<Text style={styles.empty}>No channels in this group.</Text>}
          renderItem={({ item }) => isSpacer(item) ? <View style={styles.spacerCell} /> : <ChannelCard channel={item} now={now} logos={channelLogos} onPlay={play} onFavorite={favorite} compact={landscape} />}
        />
      )}

      {panel ? (
        <>
          <Pressable style={styles.scrim} onPress={() => setPanel(null)} accessibilityLabel="Close" testID="phone-live-scrim" />
          <View style={[styles.popDown, panel === "groups" ? { top: groupTop } : null, { maxHeight: popMax }]} testID={`phone-live-popdown-${panel}`}>
            {panel === "playlists" ? (
              <FlatList
                style={styles.popList}
                data={[{ id: "all", label: "All Playlists", count: menu.find((item) => item.id === "all")?.count ?? channels.length },
                  ...playlists.filter((item) => item.enabled).map((item) => ({ id: item.id, label: item.name, count: menu.find((m) => m.id === item.id)?.count ?? item.count }))]}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={<Text style={styles.popTitle}>Playlists</Text>}
                renderItem={({ item }) => (
                  <Pressable onPress={() => choosePlaylist(item.id)} style={[styles.popRow, activePlaylist === item.id && styles.popRowOn]} testID={`phone-live-playlist-${item.id}`}>
                    <Text numberOfLines={1} style={styles.popRowText}>{item.label}</Text>
                    <Text style={styles.popRowCount}>{item.count.toLocaleString()}</Text>
                  </Pressable>
                )}
                ListFooterComponent={(
                  <View style={landscape ? styles.popActionsRow : null}>
                    <Pressable onPress={() => { setPanel(null); router.push("/playlists" as any); }} style={[styles.popRow, styles.popAction, landscape && styles.popActionHalf]} testID="phone-live-manage">
                      <Text style={styles.popActionText}>Manage playlists</Text>
                    </Pressable>
                    <Pressable onPress={() => { setPanel(null); router.push("/playlists" as any); }} style={[styles.popRow, styles.popAction2, landscape && styles.popActionHalf]} testID="phone-live-add">
                      <Text style={styles.popActionText}>Add a playlist</Text>
                    </Pressable>
                  </View>
                )}
              />
            ) : panel === "groups" ? (
              <FlatList
                style={styles.popList}
                data={groupRows}
                keyExtractor={(item) => item.key}
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={<Text style={styles.popTitle}>Channel groups</Text>}
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
  playlistPill: { flex: 1.2, minWidth: 0 },
  playlistIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#E8654A" },
  playlistText: { flex: 1, color: "#fff", fontFamily: fonts.bold, fontSize: 16 },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: edge, backgroundColor: fill },
  searchPill: { marginTop: 8 },
  searchPillInline: { flex: 1, minWidth: 0 },
  searchText: { flex: 1, color: "#CDBBEE", fontFamily: fonts.medium, fontSize: 14 },
  groupPill: { marginTop: 10, justifyContent: "space-between" },
  groupText: { flex: 1, color: "#fff", fontFamily: fonts.bold, fontSize: 14 },
  groupCount: { color: "#7FD6FF", fontFamily: fonts.bold, fontSize: 13 },
  heading: { color: "#fff", fontFamily: fonts.bold, fontSize: 22, marginTop: 12, marginBottom: 8 },
  list: { paddingBottom: 24, paddingTop: 10 },
  empty: { color: "#CDBBEE", fontFamily: fonts.medium, fontSize: 14, paddingVertical: 24, textAlign: "center" },
  categoryRow: { gap: 12, marginBottom: 12 },
  category: { flex: 1, minHeight: 104, borderRadius: 18, borderWidth: 2, borderColor: edge, overflow: "hidden", padding: 12, justifyContent: "space-between" },
  categoryName: { color: "#fff", fontFamily: fonts.bold, fontSize: 16 },
  categoryCount: { color: "#fff", fontFamily: fonts.medium, fontSize: 14 },
  spacerCell: { flex: 1 },
  cardRow: { gap: 10, marginBottom: 10 },
  card: { flex: 1, borderRadius: 16, borderWidth: 2, borderColor: edge, backgroundColor: "rgba(36,16,70,0.55)", overflow: "hidden" },
  cardTile: { height: 76, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  cardTileCompact: { height: 66 },
  cardNameBig: { color: "#fff", fontFamily: fonts.bold, fontSize: 15, textAlign: "center" },
  cardBody: { padding: 8 },
  cardName: { color: "#D9C8F5", fontFamily: fonts.medium, fontSize: 12 },
  cardProgram: { color: "#fff", fontFamily: fonts.bold, fontSize: 13, marginTop: 2 },
  cardWhen: { color: "#B7A4DD", fontFamily: fonts.medium, fontSize: 11, marginTop: 1, minHeight: 13 },
  nextRow: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.14)" },
  nextLabel: { color: "#8FA8FF", fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.5 },
  nextTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12, marginTop: 1 },
  track: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", marginTop: 8, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2, backgroundColor: "#8FA8FF" },
  focusRing: { borderColor: "#fff", backgroundColor: "rgba(170,110,255,0.45)" },
  scrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(10,4,24,0.45)" },
  popDown: { position: "absolute", left: 12, right: 12, top: 56, borderRadius: 26, borderWidth: 2, borderColor: edge, backgroundColor: phoneGlass.solid[0], padding: 14 },
  popList: { flexGrow: 0 },
  popTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 20, textAlign: "center", marginBottom: 8 },
  popRow: { minHeight: 48, borderRadius: 16, borderWidth: 2, borderColor: edge, backgroundColor: "rgba(120,70,210,0.30)", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, gap: 10, marginBottom: 6 },
  popRowOn: { backgroundColor: "rgba(150,90,235,0.85)", borderColor: "#fff" },
  popRowText: { flex: 1, color: "#fff", fontFamily: fonts.bold, fontSize: 16 },
  popRowCount: { color: "#D9C8F5", fontFamily: fonts.medium, fontSize: 15 },
  popAction: { justifyContent: "center", backgroundColor: "rgba(150,90,235,0.55)" },
  popAction2: { justifyContent: "center" },
  popActionsRow: { flexDirection: "row", gap: 8 },
  popActionHalf: { flex: 1 },
  popActionText: { color: "#fff", fontFamily: fonts.bold, fontSize: 16 },
});
