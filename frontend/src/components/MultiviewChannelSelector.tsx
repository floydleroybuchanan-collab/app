import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { Channel } from "@/src/api";
import { FocusGuide } from "./TVFocusGuideView";

const PAGE = 40;
const ROW = 64;
/** Bounded pages keep the next D-pad destination mounted, even in huge playlists. */
export function MultiviewChannelSelector({ channels, favorites, recent, slot, notice, onSelect, onCancel, inputRef, preferredFocus, onFocusCapture }: {
  inputRef: React.RefObject<any>; preferredFocus: boolean; onFocusCapture: () => void;
  channels: Channel[]; favorites: string[]; recent: { id: string }[]; slot: number; notice: string;
  onSelect: (channel: Channel) => void; onCancel: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const compact = width < 700;
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [group, setGroup] = useState("all");
  const [filter, setFilter] = useState("All");
  const [mode, setMode] = useState<"channels" | "sources" | "groups">("channels");
  const [page, setPage] = useState(0);
  const list = useRef<FlatList<any>>(null);
  const search = useRef<TextInput>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const sources = useMemo(() => Array.from(new Map(channels.map(c => [c.playlist_id || "charm-primary", c.playlist_name || "Playlist 1"]))).map(([id, name]) => ({ id, name })), [channels]);
  const groups = useMemo(() => Array.from(new Set(channels.filter(c => source === "all" || (c.playlist_id || "charm-primary") === source).map(c => c.source_group || c.group || "Other"))).sort().map(name => ({ id: name, name })), [channels, source]);
  const results = useMemo(() => {
    const favoriteIds = new Set(favorites), recentIds = new Set(recent.map(c => c.id));
    const text = query.trim().toLowerCase();
    return channels.filter(c => c.url && (source === "all" || (c.playlist_id || "charm-primary") === source)
      && (group === "all" || (c.source_group || c.group || "Other") === group)
      && (filter !== "Favorites" || favoriteIds.has(c.id)) && (filter !== "Recent" || recentIds.has(c.id))
      && (!text || `${c.name} ${c.source_group || c.group || ""}`.toLowerCase().includes(text)));
  }, [channels, source, group, query, filter, favorites, recent]);
  const data = mode === "sources" ? [{ id: "all", name: "All playlists" }, ...sources]
    : mode === "groups" ? [{ id: "all", name: "All groups" }, ...groups] : results;
  const pages = Math.max(1, Math.ceil(data.length / PAGE));
  const current = Math.min(page, pages - 1);
  const rows = data.slice(current * PAGE, (current + 1) * PAGE);
  useEffect(() => { setPage(0); list.current?.scrollToOffset({ offset: 0, animated: false }); }, [source, group, query, filter, mode]);
  const changePage = (next: number) => { setPage(next); list.current?.scrollToOffset({ offset: 0, animated: false }); };
  const button = (label: string, press: () => void, selected = false, disabled = false) => <Pressable key={label} onPress={press} disabled={disabled}
    accessibilityRole="button" accessibilityState={{ selected, disabled }}
    style={({ focused }: any) => [styles.button, selected && styles.selected, focused && styles.focus, disabled && { opacity: .35 }]}><Text style={styles.text}>{label}</Text></Pressable>;
  return <FocusGuide onFocusCapture={onFocusCapture} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={[styles.panel, { width: compact ? "100%" : "86%", padding: height < 450 ? 8 : 16 }]}>
    <View style={styles.line}><Text style={[styles.title, { flex: 1 }]}>Add channel · Screen {slot + 1}</Text>{button("Close", onCancel)}</View>
    <TextInput ref={node => { search.current = node; inputRef.current = node; }} accessibilityLabel="Search channels" placeholder="Search channels or groups" placeholderTextColor="#c2b7ce" value={query}
      onChangeText={setQuery} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} style={[styles.search, searchFocused && styles.focus]} hasTVPreferredFocus={Platform.isTV && preferredFocus} />
    <View style={styles.line}>{["All", "Favorites", "Recent"].map(item => button(item, () => setFilter(item), item === filter))}</View>
    <View style={styles.line}>
      {button("Playlists", () => setMode(mode === "sources" ? "channels" : "sources"), mode === "sources")}
      {button("Groups", () => setMode(mode === "groups" ? "channels" : "groups"), mode === "groups")}
      {mode !== "channels" && button("Channels", () => setMode("channels"))}
    </View>
    <Text numberOfLines={1} style={styles.muted}>{sources.find(item => item.id === source)?.name || "All playlists"} · {group === "all" ? "All groups" : group} · {results.length} channels</Text>
    <FlatList ref={list} style={{ flex: 1, minHeight: 64 }} data={rows} keyExtractor={item => item.id} extraData={mode}
      keyboardShouldPersistTaps="handled" removeClippedSubviews={false} initialNumToRender={PAGE} maxToRenderPerBatch={PAGE}
      getItemLayout={(_, index) => ({ length: ROW, offset: ROW * index, index })}
      ListEmptyComponent={<Text style={styles.text}>No matches. Change your search, playlist, or group.</Text>}
      renderItem={({ item, index }) => <Pressable accessibilityRole="button"
        onFocus={() => list.current?.scrollToIndex({ index, animated: false, viewPosition: .5 })}
        onPress={() => { if (mode === "sources") { setSource(item.id); setGroup("all"); setMode("channels"); }
          else if (mode === "groups") { setGroup(item.id); setMode("channels"); } else onSelect(item as Channel); }}
        style={({ focused }: any) => [styles.row, focused && styles.focus]}>
        <Text numberOfLines={1} style={styles.text}>{item.name}</Text>
        {mode === "channels" && <Text numberOfLines={1} style={styles.muted}>{(item as Channel).playlist_name} · {(item as Channel).source_group || (item as Channel).group}</Text>}
      </Pressable>} />
    <View style={styles.line}>{button("Previous", () => changePage(current - 1), false, current === 0)}
      <Text style={styles.muted}>{current + 1} / {pages}</Text>{button("Next", () => changePage(current + 1), false, current + 1 >= pages)}</View>
    {!!notice && <Text numberOfLines={2} accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text>}
  </FocusGuide>;
}
const styles = StyleSheet.create({
  panel: { position: "absolute", right: 0, top: 0, bottom: 0, backgroundColor: "#140e22", gap: 6 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { color: "#fff", fontSize: 20, fontWeight: "700" }, text: { color: "#fff", fontSize: 16 }, muted: { color: "#cec4db", fontSize: 13 },
  button: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderWidth: 2, borderColor: "transparent", borderRadius: 8, backgroundColor: "#292035" },
  selected: { borderColor: "#9870bb" }, focus: { borderColor: "#e0aaff", backgroundColor: "#513365" },
  search: { borderWidth: 2, borderColor: "transparent", minHeight: 44, color: "#fff", backgroundColor: "#292035", paddingHorizontal: 12, borderRadius: 8, fontSize: 16 },
  row: { height: ROW, justifyContent: "center", paddingHorizontal: 12, borderWidth: 2, borderColor: "transparent", borderRadius: 8 },
});
