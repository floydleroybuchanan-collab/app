import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FocusGuide } from "./TVFocusGuideView";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";

export type SelectorOption = { key: string; label: string; count?: number };
/** Fixed fields keep long provider names out of a horizontal category conveyor. */
export function GuideSelectors({ playlists, groups, playlist, group, mobile, onPlaylist, onGroup, onOpenChange }: {
  playlists: SelectorOption[]; groups: SelectorOption[]; playlist: string; group: string; mobile: boolean;
  onPlaylist: (key: string) => void; onGroup: (key: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState<"playlist" | "group" | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const cancelFocus = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { onOpenChange?.(open !== null); }, [open, onOpenChange]);
  useEffect(() => () => cancelFocus.current?.(), []);
  const origin = useRef<any>(null);
  const playlistRef = useRef<any>(null), groupRef = useRef<any>(null);
  const list = useRef<FlatList<SelectorOption>>(null);
  const safe = useSafeAreaInsets();
  const options = open === "playlist" ? playlists : groups;
  const filtered = useMemo(() => [...new Map(options.map(item => [item.key, item])).values()].filter(item => item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [options, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 30));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = mobile ? filtered : filtered.slice(currentPage * 30, (currentPage + 1) * 30);
  const close = () => { setOpen(null); cancelFocus.current?.(); if (!mobile) cancelFocus.current = requestNativeFocusWithRetry(() => origin.current); };
  const field = (kind: "playlist" | "group", label: string, value: string, choices: SelectorOption[], ref: React.RefObject<any>) => (
    <Pressable ref={ref} accessibilityRole="button" accessibilityLabel={`${label}: ${choices.find(item => item.key === value)?.label || value}`} accessibilityState={{ expanded: open === kind }}
      onPress={() => { origin.current = ref.current; setQuery(""); setPage(0); setOpen(kind); }} style={({ focused }: any) => [styles.field, !mobile && { minHeight: 42 }, focused && styles.focus]}>
      <Text style={styles.caption}>{label}</Text><Text numberOfLines={1} style={styles.text}>{choices.find(item => item.key === value)?.label || value} ▾</Text>
    </Pressable>
  );
  return <View>
    <View style={styles.fields}>{field("playlist", "Playlist", playlist, playlists, playlistRef)}{field("group", "Group", group, groups, groupRef)}</View>
    <View style={styles.quick}>{["All", "Favorites", "Recent"].map(key => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: group === key }} onPress={() => onGroup(key)} style={({ focused }: any) => [styles.quickButton, group === key && styles.selected, focused && styles.focus]}><Text style={styles.text}>{key}</Text></Pressable>)}</View>
    <Modal visible={open !== null} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior="height" style={[styles.overlay, { paddingTop: safe.top + 12, paddingBottom: safe.bottom + 12, paddingLeft: safe.left + 12, paddingRight: safe.right + 12 }]}>
        <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={[styles.sheet, mobile && { alignSelf: "stretch" }]}>
          <Text style={styles.title}>Choose {open === "playlist" ? "playlist" : "group"}</Text>
          <TextInput accessibilityLabel={`Search ${open || "options"}`} placeholder="Search…" placeholderTextColor="#AAA7BB" value={query} onChangeText={value => { setQuery(value); setPage(0); list.current?.scrollToOffset({ offset: 0, animated: false }); }} style={styles.search} />
          <FlatList ref={list} data={visible} keyExtractor={item => item.key} keyboardShouldPersistTaps="handled" removeClippedSubviews={false}
            initialNumToRender={mobile ? 20 : 30} windowSize={7} style={{ flex: 1 }} getItemLayout={(_, index) => ({ index, length: 56, offset: index * 56 })}
            ListEmptyComponent={<Text style={styles.text}>No matching options</Text>}
            renderItem={({ item, index }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: item.key === (open === "playlist" ? playlist : group) }}
              onFocus={() => list.current?.scrollToIndex({ index, viewPosition: .5, animated: false })}
              onPress={() => { if (open === "playlist") onPlaylist(item.key); else onGroup(item.key); close(); }} style={({ focused }: any) => [styles.option, focused && styles.focus]}>
              <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>{item.label}</Text>{item.count !== undefined && <Text style={styles.caption}>{item.count}</Text>}
            </Pressable>} />
          {!mobile && pageCount > 1 && <View style={styles.quick}>
            <Pressable disabled={currentPage === 0} onPress={() => { setPage(currentPage - 1); list.current?.scrollToOffset({ offset: 0, animated: false }); }} style={({ focused }: any) => [styles.quickButton, focused && styles.focus]}><Text style={styles.text}>Previous</Text></Pressable>
            <Text style={styles.text}>Page {currentPage + 1} of {pageCount}</Text>
            <Pressable disabled={currentPage + 1 === pageCount} onPress={() => { setPage(currentPage + 1); list.current?.scrollToOffset({ offset: 0, animated: false }); }} style={({ focused }: any) => [styles.quickButton, focused && styles.focus]}><Text style={styles.text}>Next</Text></Pressable>
          </View>}
          <Pressable accessibilityRole="button" onPress={close} style={({ focused }: any) => [styles.quickButton, focused && styles.focus]}><Text style={styles.text}>Cancel</Text></Pressable>
        </FocusGuide>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  fields: { flexDirection: "row", gap: 8 }, field: { flex: 1, minWidth: 0, minHeight: 52, justifyContent: "center", paddingHorizontal: 10, borderWidth: 2, borderColor: "transparent", borderRadius: 8, backgroundColor: "#151427" },
  caption: { color: "#AAA7BB", fontSize: 12 }, text: { color: "#fff", fontSize: 14, flexShrink: 1 }, title: { color: "#fff", fontSize: 20, fontWeight: "600" },
  quick: { flexDirection: "row", gap: 6, marginVertical: 4 }, quickButton: { minHeight: 48, paddingHorizontal: 12, justifyContent: "center", borderWidth: 2, borderColor: "transparent", backgroundColor: "#151427", borderRadius: 8 },
  selected: { borderColor: "#A855F7" }, focus: { borderColor: "#fff", backgroundColor: "#3B1768" },
  overlay: { flex: 1, backgroundColor: "#000b", justifyContent: "center", alignItems: "center" }, sheet: { height: "90%", width: "100%", maxWidth: 620, padding: 16, gap: 8, borderRadius: 12, backgroundColor: "#10101E" },
  search: { minHeight: 48, paddingHorizontal: 12, color: "#fff", fontSize: 16, backgroundColor: "#25233A", borderRadius: 8 }, option: { height: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10, borderWidth: 2, borderColor: "transparent", borderRadius: 8 },
});
