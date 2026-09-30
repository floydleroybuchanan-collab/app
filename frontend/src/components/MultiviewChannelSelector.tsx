import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Channel } from "@/src/api";
import { FocusGuide } from "./TVFocusGuideView";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { filterMultiviewChannels, groupName, multiviewPickerGeometry, multiviewPickerOptions, pickerFocusOffset, PICKER_PAGE_SIZE, type PickerFilter, type PickerOption } from "@/src/core/multiviewPicker";

/** A measured modal owns focus; each bounded page is fully mounted inside a clipped scroll region. */
export function MultiviewChannelSelector({ channels, favorites, recent, slot, notice, onSelect, onCancel, inputRef, preferredFocus, onFocusCapture }: {
  inputRef: React.RefObject<any>; preferredFocus: boolean; onFocusCapture: () => void;
  channels: Channel[]; favorites: string[]; recent: { id: string }[]; slot: number; notice: string;
  onSelect: (channel: Channel) => void; onCancel: () => void;
}) {
  const window = useWindowDimensions();
  const safe = useSafeAreaInsets();
  const [viewport, setViewport] = useState({ width: window.width, height: window.height });
  const geometry = multiviewPickerGeometry(viewport.width, viewport.height, window.fontScale, safe);
  const { scale, rowHeight, columns, listHeight } = geometry;
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [filter, setFilter] = useState<PickerFilter>("All");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<"playlist" | "group" | null>(null);
  const [optionQuery, setOptionQuery] = useState("");
  const [optionPage, setOptionPage] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const [optionSearchFocused, setOptionSearchFocused] = useState(false);
  const list = useRef<ScrollView>(null), optionsList = useRef<ScrollView>(null);
  const header = useRef<ScrollView>(null);
  const headerOffset = useRef(0);
  const playlistField = useRef<any>(null), groupField = useRef<any>(null), closeButton = useRef<any>(null);
  const firstOption = useRef<any>(null);
  const cancelFocus = useRef<(() => void) | undefined>(undefined);
  const lastChannel = useRef<string | null>(null);
  const nodes = useRef(new Map<string, any>());
  const [focused, setFocused] = useState<string | null>(null);
  const [dropTop, setDropTop] = useState(0);
  const model = useMemo(() => multiviewPickerOptions(channels, source), [channels, source]);
  const results = useMemo(() => filterMultiviewChannels(model.playable, { source, group, query, filter, favorites, recent }), [model.playable, source, group, query, filter, favorites, recent]);
  const pages = Math.max(1, Math.ceil(results.length / PICKER_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = results.slice(current * PICKER_PAGE_SIZE, (current + 1) * PICKER_PAGE_SIZE);
  const channelRows = Array.from({ length: Math.ceil(rows.length / columns) }, (_, index) => rows.slice(index * columns, (index + 1) * columns));
  const choices = open === "playlist" ? model.sources : model.groups;
  const options = choices.filter(item => item.name.toLocaleLowerCase().includes(optionQuery.trim().toLocaleLowerCase()));
  const optionPages = Math.max(1, Math.ceil(options.length / PICKER_PAGE_SIZE));
  const currentOptionPage = Math.min(optionPage, optionPages - 1);
  const visibleOptions = options.slice(currentOptionPage * PICKER_PAGE_SIZE, (currentOptionPage + 1) * PICKER_PAGE_SIZE);
  const dropWidth = columns === 2 ? Math.floor((geometry.innerWidth - 8) / 2) : geometry.innerWidth;
  const dropdownTop = Math.max(geometry.padding + 36 * scale, Math.min(dropTop, geometry.panelHeight - geometry.padding - 180 * scale));
  const dropdownHeight = geometry.panelHeight - geometry.padding - dropdownTop;
  const optionRowHeight = Math.ceil(46 * scale);
  const optionListHeight = Math.max(optionRowHeight, dropdownHeight - 16 - 40 * scale - 36 * scale - 12);

  const focus = (getNode: () => any) => {
    cancelFocus.current?.();
    cancelFocus.current = requestNativeFocusWithRetry(getNode, [0, 60, 160, 320]);
  };
  useEffect(() => () => cancelFocus.current?.(), []);
  useEffect(() => { setPage(0); list.current?.scrollTo({ y: 0, animated: false }); }, [source, group, query, filter]);
  useEffect(() => {
    if (source !== null && !model.sources.some(item => item.id === source)) { setSource(null); setGroup(null); }
    else if (group !== null && !model.groups.some(item => item.id === group)) setGroup(null);
  }, [source, group, model.sources, model.groups]);
  useEffect(() => {
    const index = rows.findIndex(item => item.id === lastChannel.current);
    if (index >= 0) list.current?.scrollTo({ y: pickerFocusOffset(index, columns, rowHeight, listHeight, rows.length), animated: false });
  }, [columns, rowHeight, listHeight, rows]);
  const closeOptions = () => {
    const origin = open === "playlist" ? playlistField : groupField;
    setOpen(null); focus(() => origin.current);
  };
  const openOptions = (kind: "playlist" | "group") => {
    setDropTop(geometry.padding + 36 * scale + 6 + 40 * scale + 6 + 48 * scale - headerOffset.current + 6);
    setOptionQuery(""); setOptionPage(0); setOpen(kind);
    focus(() => firstOption.current);
  };
  const track = (key: string) => { setFocused(key); onFocusCapture(); };
  const button = (key: string, label: string, press: () => void, disabled = false, ref?: React.RefObject<any>, inDropdown = false) => (
    <Pressable key={key} ref={ref} testID={`multiview-${key}`} focusable={!disabled && (inDropdown || !open)} disabled={disabled || (!inDropdown && !!open)}
      accessibilityRole="button" onFocus={() => track(key)} onBlur={() => setFocused(old => old === key ? null : old)}
      onPress={press} style={[styles.button, { height: 36 * scale }, focused === key && styles.focus, disabled && styles.disabled]}>
      <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.text}>{label}</Text>
    </Pressable>
  );
  const field = (kind: "playlist" | "group", label: string, value: string | null, items: PickerOption[], ref: React.RefObject<any>) => (
    <Pressable ref={ref} testID={`multiview-${kind}-field`} focusable={!open} disabled={!!open} accessibilityRole="button" accessibilityState={{ expanded: open === kind }}
      onFocus={() => track(kind)} onBlur={() => setFocused(old => old === kind ? null : old)} onPress={() => openOptions(kind)}
      style={[styles.field, { height: 48 * scale }, focused === kind && styles.focus]}>
      <Text maxFontSizeMultiplier={1.3} style={styles.caption}>{label}</Text>
      <View style={styles.fieldValue}><Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.text, { flex: 1 }]}>{items.find(item => item.id === value)?.name}</Text><Text style={styles.text}>▾</Text></View>
    </Pressable>
  );
  const changePage = (next: number) => {
    setPage(next); list.current?.scrollTo({ y: 0, animated: false });
    focus(() => inputRef.current);
  };
  return <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => open ? closeOptions() : onCancel()} onShow={() => focus(() => inputRef.current || closeButton.current)}>
    <View style={styles.scrim} onLayout={event => {
      const { width, height } = event.nativeEvent.layout;
      setViewport(old => old.width === width && old.height === height ? old : { width, height });
    }}>
      <View testID="multiview-picker-panel" style={[styles.panel, { width: geometry.panelWidth, height: geometry.panelHeight, marginLeft: safe.left + geometry.margin, marginRight: safe.right + geometry.margin, marginTop: safe.top + geometry.margin, marginBottom: safe.bottom + geometry.margin, padding: geometry.padding }]}>
        <FocusGuide onFocusCapture={onFocusCapture} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.content}>
          <View pointerEvents={open ? "none" : "auto"} accessibilityElementsHidden={!!open} importantForAccessibility={open ? "no-hide-descendants" : "auto"}>
            <ScrollView ref={header} style={{ height: geometry.headerHeight, flexGrow: 0 }} contentContainerStyle={styles.headerContent} keyboardShouldPersistTaps="handled" onScroll={event => { headerOffset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={32}>
              <View style={[styles.line, { height: 36 * scale }]}><Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.title, { flex: 1 }]}>Add channel · Screen {slot + 1}</Text>{button("close", "Close", onCancel, false, closeButton)}</View>
              <TextInput testID="multiview-channel-search" focusable={!open} editable={!open} accessibilityLabel="Search channels" placeholder="Search channels…" placeholderTextColor="#c2b7ce" value={query}
                onChangeText={setQuery} onFocus={() => { setSearchFocused(true); onFocusCapture(); }} onBlur={() => setSearchFocused(false)} maxFontSizeMultiplier={1.3} style={[styles.search, { height: 40 * scale }, searchFocused && styles.focus]} />
              <View style={styles.line}>{field("playlist", "Playlist", source, model.sources, playlistField)}{field("group", "Group", group, model.groups, groupField)}</View>
              <View style={[styles.line, { height: 36 * scale }]}>{(["All", "Favorites", "Recent"] as const).map(item => <Pressable key={item} testID={`multiview-filter-${item}`} disabled={!!open} focusable={!open} accessibilityRole="button" accessibilityState={{ selected: filter === item }}
                onFocus={() => track(item)} onBlur={() => setFocused(old => old === item ? null : old)} onPress={() => setFilter(item)} style={[styles.button, { height: 36 * scale }, filter === item && styles.selected, focused === item && styles.focus]}><Text maxFontSizeMultiplier={1.3} style={styles.text}>{item}</Text></Pressable>)}</View>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.caption, { height: 20 * scale }]}>{results.length} channels · Select a channel for Screen {slot + 1}</Text>
            </ScrollView>
            <View testID="multiview-channel-viewport" style={[styles.viewport, { height: listHeight, marginVertical: 6 }]}>
              <ScrollView ref={list} style={styles.content} keyboardShouldPersistTaps="handled" removeClippedSubviews={false}>
                {!rows.length && <Text style={styles.empty}>No matching channels. Change your search or filters.</Text>}
                {channelRows.map((items, rowIndex) => <View key={items[0].id} style={[styles.line, { height: rowHeight }]}>{items.map((item, column) => {
                  const index = rowIndex * columns + column;
                  return <Pressable key={item.id} ref={node => { if (node) nodes.current.set(item.id, node); else nodes.current.delete(item.id); if (index === 0) inputRef.current = node; }}
                    testID={`multiview-channel-${index}`} accessibilityRole="button" focusable={!open} disabled={!!open} hasTVPreferredFocus={Platform.isTV && preferredFocus && index === 0 && !open}
                    onFocus={() => { lastChannel.current = item.id; track(item.id); list.current?.scrollTo({ y: pickerFocusOffset(index, columns, rowHeight, listHeight, rows.length), animated: false }); }}
                    onBlur={() => setFocused(old => old === item.id ? null : old)} onPress={() => onSelect(item)} style={[styles.row, { height: rowHeight - 6 }, focused === item.id && styles.focus]}>
                    <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.text}>{favorites.includes(item.id) ? "♥ " : ""}{item.name}</Text>
                    <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.caption}>{item.playlist_name || "Playlist 1"} · {groupName(item)}</Text>
                  </Pressable>;
                })}{items.length < columns && <View style={{ flex: 1 }} />}</View>)}
              </ScrollView>
            </View>
            <View testID="multiview-picker-footer" style={{ height: geometry.footerHeight, gap: 4 }}>
              <View style={styles.line}>{button("previous", "Previous", () => changePage(current - 1), current === 0)}<Text maxFontSizeMultiplier={1.3} style={styles.caption}>Page {current + 1} of {pages}</Text>{button("next", "Next", () => changePage(current + 1), current + 1 === pages)}</View>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} accessibilityLiveRegion="polite" style={styles.caption}>{notice || "Choose a channel. Back cancels without changing the playing screens."}</Text>
            </View>
          </View>
          {open && <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight testID="multiview-dropdown" style={[styles.dropdown, { top: dropdownTop - geometry.padding, left: open === "playlist" ? 0 : geometry.innerWidth - dropWidth, width: dropWidth, height: dropdownHeight }]}>
            <TextInput accessibilityLabel={`Search ${open === "playlist" ? "playlists" : "groups"}`} placeholder={`Search ${open === "playlist" ? "playlists" : "groups"}…`} placeholderTextColor="#c2b7ce" value={optionQuery} maxFontSizeMultiplier={1.3}
              onChangeText={value => { setOptionQuery(value); setOptionPage(0); optionsList.current?.scrollTo({ y: 0, animated: false }); }} onFocus={() => setOptionSearchFocused(true)} onBlur={() => setOptionSearchFocused(false)} style={[styles.search, { height: 40 * scale }, optionSearchFocused && styles.focus]} />
            <View style={[styles.viewport, { height: optionListHeight }]}><ScrollView ref={optionsList} style={styles.content} keyboardShouldPersistTaps="handled" removeClippedSubviews={false}>
              {!visibleOptions.length && <Text style={styles.empty}>No matching options</Text>}
              {visibleOptions.map((item, index) => <Pressable key={item.id ?? "all"} ref={index === 0 ? firstOption : undefined} accessibilityRole="button" accessibilityState={{ selected: item.id === (open === "playlist" ? source : group) }}
                onFocus={() => { track(`option-${index}`); optionsList.current?.scrollTo({ y: pickerFocusOffset(index, 1, optionRowHeight, optionListHeight, visibleOptions.length), animated: false }); }} onBlur={() => setFocused(old => old === `option-${index}` ? null : old)}
                onPress={() => { if (open === "playlist") { setSource(item.id); setGroup(null); } else setGroup(item.id); closeOptions(); }} style={[styles.option, { height: optionRowHeight }, item.id === (open === "playlist" ? source : group) && styles.selected, focused === `option-${index}` && styles.focus]}>
                <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.text, { flex: 1 }]}>{item.name}</Text><Text maxFontSizeMultiplier={1.3} style={styles.caption}>{item.count}</Text>
              </Pressable>)}
            </ScrollView></View>
            <View style={styles.line}>{currentOptionPage > 0 && button("options-previous", "‹", () => { setOptionPage(currentOptionPage - 1); optionsList.current?.scrollTo({ y: 0, animated: false }); focus(() => firstOption.current); }, false, undefined, true)}
              {currentOptionPage + 1 < optionPages && button("options-next", "›", () => { setOptionPage(currentOptionPage + 1); optionsList.current?.scrollTo({ y: 0, animated: false }); focus(() => firstOption.current); }, false, undefined, true)}
              {button("options-cancel", "Cancel", closeOptions, false, undefined, true)}
            </View>
          </FocusGuide>}
        </FocusGuide>
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "#05030aaa", alignItems: "flex-end", justifyContent: "center" },
  panel: { backgroundColor: "#140e22", borderRadius: 12, borderWidth: 1, borderColor: "#8053b0", overflow: "hidden" },
  content: { flex: 1, minHeight: 0 }, headerContent: { gap: 6 }, line: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: "#fff", fontSize: 19, fontWeight: "700" }, text: { color: "#fff", fontSize: 15 }, caption: { color: "#cec4db", fontSize: 12 },
  button: { paddingHorizontal: 12, justifyContent: "center", borderWidth: 2, borderColor: "transparent", borderRadius: 8, backgroundColor: "#292035" },
  field: { flex: 1, minWidth: 0, paddingHorizontal: 10, justifyContent: "center", borderWidth: 2, borderColor: "#8053b0", borderRadius: 8, backgroundColor: "#20162e" }, fieldValue: { flexDirection: "row", alignItems: "center", gap: 8 },
  selected: { backgroundColor: "#482071", borderColor: "#ad70ef" }, focus: { borderColor: "#fff", backgroundColor: "#7541D4" }, disabled: { opacity: .35 },
  search: { borderWidth: 2, borderColor: "transparent", color: "#fff", backgroundColor: "#292035", paddingHorizontal: 12, borderRadius: 8, fontSize: 15 },
  viewport: { overflow: "hidden", flexShrink: 0, borderRadius: 8 }, row: { flex: 1, minWidth: 0, justifyContent: "center", paddingHorizontal: 12, borderWidth: 2, borderColor: "transparent", borderRadius: 8, backgroundColor: "#20162e" },
  empty: { padding: 12, color: "#cec4db", fontSize: 15 }, dropdown: { position: "absolute", zIndex: 10, elevation: 20, padding: 8, gap: 6, borderRadius: 10, borderWidth: 1, borderColor: "#ad70ef", backgroundColor: "#21162f" },
  option: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderWidth: 2, borderColor: "transparent", borderRadius: 6 },
});
