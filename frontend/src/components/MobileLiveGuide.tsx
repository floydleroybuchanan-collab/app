import { GuideSelectors } from "./GuideSelectors";
import { usePlaylists } from "@/src/core/playlistRegistry";
import { buildPlaylistMenu, providerGroupIdentity } from "@/src/core/playlistGuideMenu";
import { useGuideGroupTabPreferences } from "@/src/core/guideGroupTabPersistence";
import { applyGuideGroupOrder } from "@/src/core/guideGroupTabPreferences";
import { playlistOwner } from "@/src/core/playlistCatalog";
import { selectPlaylist, useSelectedPlaylist } from "@/src/core/playlistSelection";
import { useChannelCustomize } from "@/src/core/channelCustomize";
import { filterChannelsByGroup } from "@/src/core/guideGroups";
import { useCustomGuideGroups } from "@/src/core/customGuideGroups";
import { mobileGuideLayout, mobileGuideRestoreOffset } from "@/src/core/mobileGuideLayout";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions, type ViewToken } from "react-native";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useStore } from "@/src/store";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { useParentalPin } from "@/src/core/parentalPin";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { nowNext, progressPct, fmtTime } from "@/src/utils/time";
import { ChannelLogo } from "./ChannelLogo";
import { PurpleTvShell } from "./PurpleTvShell";
import { FocusGuide } from "./TVFocusGuideView";
import type { Channel } from "@/src/api";

const saved = { group: "All", query: "", channel: "", offset: 0, columns: 0, rowHeight: 0 };
const Card = memo(function Card({ channel, width, height, now, favorite, locked, onPlay }: { channel: Channel; width: number; height: number; now: Date; favorite: boolean; locked: boolean; onPlay: (channel: Channel) => void }) {
  const programs = useGuidePrograms(channel.id);
  const { current, next } = nowNext(programs, now);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${channel.name}${locked ? ", locked" : ""}`} onPress={() => onPlay(channel)} style={({ focused }: any) => [styles.card, { width, height }, focused && styles.focus]}>
    <View style={styles.brand}><ChannelLogo name={channel.name} logo={channel.logo} size={38} /><Text numberOfLines={2} style={styles.name}>{channel.name}{favorite ? " ★" : ""}</Text></View>
    <Text numberOfLines={2} style={styles.program}>{locked ? "Locked channel · Tap to unlock" : current?.title || "Live TV"}</Text>
    {!locked && <><Text style={styles.muted}>{current ? `${fmtTime(current.start)}${current.stop ? ` – ${fmtTime(current.stop)}` : ""}` : "Program information unavailable"}</Text>
    <View style={styles.track}><View style={[styles.fill, { width: `${current ? progressPct(current, now) : 0}%` }]} /></View>
    <Text numberOfLines={2} style={styles.muted}>Next: {next?.title || "No listing"}</Text></>}
  </Pressable>;
});

/** Phone guide: bounded visible-row programme loading, no background preview decoder. */
export function MobileLiveGuide() {
  const router = useRouter(), focused = useIsFocused();
  const { width, fontScale } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(width);

  const { channels, favorites, recent, recentIds, addRecent, patchProgramsForChannelIds, retainGuideSlidingCache, releaseGuideSlidingCache, loading, error, hardRefresh, hiddenGroups } = useStore();
  const tabPrefs = useGuideGroupTabPreferences();
  const parental = useParentalPin();
  const playlists = usePlaylists();
  const playlist = useSelectedPlaylist();
  const customization = useChannelCustomize();
  const hiddenIds = useMemo(() => new Set(customization.hiddenIds), [customization.hiddenIds]);
  const customGroups = useCustomGuideGroups();
  const [group, setGroup] = useState(saved.group), [query, setQuery] = useState(saved.query);
  const [now, setNow] = useState(() => new Date());
  const [lockedChannel, setLockedChannel] = useState<Channel | null>(null), [pin, setPin] = useState(""), [pinError, setPinError] = useState("");
  const list = useRef<FlatList<Channel>>(null);
  const { columns, cardWidth, rowHeight } = mobileGuideLayout(availableWidth, fontScale);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const menu = useMemo(() => buildPlaylistMenu(playlists, channels, favoriteSet, hiddenIds, new Set([...hiddenGroups, ...tabPrefs.hidden])).map(section => {
    const byId = new Map(section.groups.slice(2).map(item => [providerGroupIdentity(item.key), item]));
    return { ...section, groups: [...section.groups.slice(0, 2), ...applyGuideGroupOrder([...byId.keys()], tabPrefs.order).map(id => ({ ...byId.get(id)!, label: tabPrefs.aliases[id] || byId.get(id)!.label }))] };
  }), [playlists, channels, favoriteSet, hiddenIds, hiddenGroups, tabPrefs.hidden, tabPrefs.order, tabPrefs.aliases]);
  const groups = useMemo(() => [...(menu.find(item => item.id === playlist)?.groups || []), { key: "Recent", label: "Recent" }, ...customGroups.groups.map(item => ({ key: item.name, label: item.name }))], [menu, playlist, customGroups.groups]);
  const rows = useMemo(() => filterChannelsByGroup(channels.filter(c => playlist === "all" || playlistOwner(c) === playlist), group, {
    favoriteSet, recent, recentIds: new Set(recentIds), hiddenIds: hiddenIds, customOrder: customization.customOrder, customGroups: customGroups.byName, hasEpgMatch: () => true, isFailed: () => false,
  }).filter(c => c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [channels, playlist, group, favoriteSet, recent, recentIds, hiddenIds, customization.customOrder, customGroups.byName, query]);
  const latest = useRef({ focused, patchProgramsForChannelIds, retainGuideSlidingCache });
  latest.current = { focused, patchProgramsForChannelIds, retainGuideSlidingCache };
  const viewability = useRef({ itemVisiblePercentThreshold: 20 }).current;
  const visible = useRef(({ viewableItems }: { viewableItems: ViewToken<Channel>[] }) => {
    if (!latest.current.focused) return;
    const ids = viewableItems.map(v => v.item.id).slice(0, 48);
    if (!ids.length) return;
    latest.current.retainGuideSlidingCache(ids);
    void latest.current.patchProgramsForChannelIds(ids, ids.slice(0, 3));
  }).current;
  useEffect(() => { saved.group = group; saved.query = query; }, [group, query]);
  useEffect(() => {
    if (!focused) return;
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => { clearInterval(timer); releaseGuideSlidingCache(); };
  }, [focused, releaseGuideSlidingCache]);
  const restored = useRef("");
  useEffect(() => {
    if (!rows.length || restored.current === `${columns}:${rowHeight}`) return;
    restored.current = `${columns}:${rowHeight}`;
    const index = rows.findIndex(c => c.id === saved.channel);
    const offset = mobileGuideRestoreOffset(saved, columns, rowHeight, index);
    requestAnimationFrame(() => list.current?.scrollToOffset({ offset, animated: false }));
  }, [rows, columns, rowHeight]);
  const play = useCallback((channel: Channel) => {
    if (!parental.ready) return;
    if (parental.isGroupLocked(channel.group) || parental.isGroupLocked(channel.source_group || "")) { setLockedChannel(channel); setPin(""); setPinError(""); return; }
    saved.channel = channel.id; addRecent(channel); openFullscreenPlayer(router, channel.id);
  }, [parental, addRecent, router]);
  return <PurpleTvShell active="/guide"><View style={styles.page} onLayout={event => setAvailableWidth(event.nativeEvent.layout.width)}>
    <TextInput accessibilityLabel="Search live channels" placeholder="Search live channels" placeholderTextColor="#AAA7BB" value={query} onChangeText={value => { saved.offset = 0; setQuery(value); list.current?.scrollToOffset({ offset: 0, animated: false }); }} style={styles.search} />
    <GuideSelectors mobile playlists={menu.map(item => ({ key: item.id, label: item.label, count: item.count }))} groups={groups} playlist={playlist} group={group}
      onPlaylist={id => { selectPlaylist(id); setGroup("All"); saved.offset = 0; list.current?.scrollToOffset({ offset: 0, animated: false }); }}
      onGroup={key => { setGroup(key); saved.offset = 0; list.current?.scrollToOffset({ offset: 0, animated: false }); }} />
    <FlatList key={columns} ref={list} data={rows} numColumns={columns} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" removeClippedSubviews={false} initialNumToRender={columns * 4} maxToRenderPerBatch={columns * 3} windowSize={5} onViewableItemsChanged={visible} viewabilityConfig={viewability} columnWrapperStyle={columns > 1 ? { gap: 8 } : undefined} getItemLayout={(_, index) => ({ length: rowHeight, offset: index * rowHeight, index })} onScroll={event => { saved.offset = event.nativeEvent.contentOffset.y; saved.columns = columns; saved.rowHeight = rowHeight; }} scrollEventThrottle={100}
      renderItem={({ item }) => <Card channel={item} width={cardWidth} height={rowHeight - 8} now={now} favorite={favoriteSet.has(item.id)} locked={parental.isGroupLocked(item.group) || parental.isGroupLocked(item.source_group || "")} onPlay={play} />}
      ListEmptyComponent={<View style={{ padding: 20, gap: 12 }}><Text style={styles.text}>{loading ? "Loading channels…" : error || "No matching channels"}</Text><Pressable style={styles.chip} onPress={() => void hardRefresh()}><Text style={styles.text}>Reload channels</Text></Pressable></View>} />
    <Modal visible={!!lockedChannel} transparent onRequestClose={() => setLockedChannel(null)}><View style={styles.overlay}><FocusGuide trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.dialog}><Text style={styles.name}>Unlock channel group</Text><TextInput accessibilityLabel="Parental PIN" secureTextEntry keyboardType="number-pad" value={pin} onChangeText={setPin} style={styles.search} /><Text style={styles.muted}>{pinError}</Text><Pressable style={styles.chip} onPress={() => { if (!parental.verifyPin(pin)) { setPinError("Incorrect PIN"); return; } if (lockedChannel) { parental.unlockGroup(lockedChannel.group); parental.unlockGroup(lockedChannel.source_group || ""); saved.channel = lockedChannel.id; addRecent(lockedChannel); openFullscreenPlayer(router, lockedChannel.id); } setLockedChannel(null); }}><Text style={styles.text}>Unlock and watch</Text></Pressable><Pressable style={styles.chip} onPress={() => setLockedChannel(null)}><Text style={styles.text}>Cancel</Text></Pressable></FocusGuide></View></Modal>
  </View></PurpleTvShell>;
}
const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 12, gap: 8 }, search: { minHeight: 48, paddingHorizontal: 12, color: "#fff", backgroundColor: "#151427", borderRadius: 8, fontSize: 16 }, groups: { gap: 8, paddingVertical: 4 }, chip: { minHeight: 48, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#151427", borderWidth: 2, borderColor: "transparent" }, selected: { borderColor: "#B76CFF", backgroundColor: "#3B1768" }, focus: { borderColor: "#fff", backgroundColor: "#3B1768" }, card: { height: 184, marginBottom: 8, padding: 10, gap: 5, borderRadius: 10, backgroundColor: "#10101E", borderWidth: 2, borderColor: "transparent" }, brand: { flexDirection: "row", gap: 8, alignItems: "center" }, name: { flexShrink: 1, fontSize: 15, fontWeight: "600", color: "#fff" }, program: { fontSize: 14, color: "#fff" }, muted: { fontSize: 12, color: "#AAA7BB" }, text: { color: "#fff", fontSize: 14 }, track: { height: 3, backgroundColor: "#25233A", marginVertical: 3 }, fill: { height: 3, backgroundColor: "#A855F7" }, overlay: { flex: 1, backgroundColor: "#000b", justifyContent: "center", padding: 20 }, dialog: { padding: 16, backgroundColor: "#10101E", borderRadius: 12, gap: 10, maxWidth: 440, width: "100%", alignSelf: "center" },
});

