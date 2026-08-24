import React, { useEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { fonts, radius, tvColors } from "@/src/theme";

export type EpgPickerRow = { id: string; name: string };
export type EpgPickerFilter = "all" | "unassigned";

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  query: string;
  onQueryChange: (value: string) => void;
  filter: EpgPickerFilter;
  onFilterChange: (value: EpgPickerFilter) => void;
  rows: EpgPickerRow[];
  total: number;
  page: number;
  pageCount: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  /** XMLTV ids already bound to some playlist channel in this EPG source — drives the row badge and the Unassigned filter. */
  assignedIds: ReadonlySet<string>;
  /** The XMLTV id currently bound to the channel being edited, if any. */
  currentAssignedId?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  busy?: boolean;
};

/**
 * Full-screen channel picker for assigning a custom XMLTV channel to a
 * playlist channel. Mirrors ProgramModal's overlay idiom (dark backdrop,
 * bottom-sheet card, FocusGuide D-pad trap, hardware BACK closes it) instead
 * of the plain inline scrolling list this replaced — TiViMate-style: a
 * dedicated picker overlay with search-as-you-type over the EPG source's own
 * channel directory, not a page you scroll past other settings to reach.
 */
export function EpgChannelAssignDrawer({
  visible,
  title,
  subtitle,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  rows,
  total,
  page,
  pageCount,
  onPrevPage,
  onNextPage,
  assignedIds,
  currentAssignedId,
  onSelect,
  onClose,
  busy,
}: Props) {
  const [preferSearchFocus, setPreferSearchFocus] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setPreferSearchFocus(true);
    const timer = setTimeout(() => setPreferSearchFocus(false), 220);
    return () => clearTimeout(timer);
  }, [visible]);

  // Close on the hardware / remote BACK button while the sheet is open —
  // same contract as every other overlay in this app (ProgramModal, drawers).
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  const visibleRows = filter === "unassigned" ? rows.filter((row) => !assignedIds.has(row.id)) : rows;

  return (
    <View style={styles.overlay} testID="epg-picker-overlay">
      <Pressable style={styles.backdrop} onPress={onClose} testID="epg-picker-backdrop">
        <Pressable style={styles.card} onPress={() => undefined}>
          <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.cardInner}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text numberOfLines={1} style={styles.title}>{title}</Text>
                {subtitle ? <Text numberOfLines={2} style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <Pressable
                style={({ focused }: any) => [styles.closeBtn, focused && styles.focused]}
                onPress={onClose}
                hitSlop={10}
                testID="epg-picker-close"
              >
                <Ionicons name="close" size={18} color={tvColors.textMuted} />
              </Pressable>
            </View>

            <TextInput
              hasTVPreferredFocus={preferSearchFocus}
              value={query}
              onChangeText={onQueryChange}
              placeholder="Search this EPG's channels…"
              placeholderTextColor={tvColors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              testID="epg-picker-search"
            />

            <View style={styles.filterRow}>
              <Pressable
                onPress={() => onFilterChange("all")}
                style={({ focused }: any) => [styles.filterChip, filter === "all" && styles.filterChipActive, focused && styles.focused]}
                testID="epg-picker-filter-all"
              >
                <Text style={[styles.filterText, filter === "all" && styles.filterTextActive]}>All</Text>
              </Pressable>
              <Pressable
                onPress={() => onFilterChange("unassigned")}
                style={({ focused }: any) => [styles.filterChip, filter === "unassigned" && styles.filterChipActive, focused && styles.focused]}
                testID="epg-picker-filter-unassigned"
              >
                <Text style={[styles.filterText, filter === "unassigned" && styles.filterTextActive]}>Unassigned</Text>
              </Pressable>
              <Text style={styles.count} numberOfLines={1}>{total} channel{total === 1 ? "" : "s"}</Text>
            </View>

            <ScrollView style={styles.list} showsVerticalScrollIndicator={false} nestedScrollEnabled>
              {visibleRows.map((row) => {
                const isCurrent = currentAssignedId === row.id;
                const inUse = assignedIds.has(row.id);
                return (
                  <Pressable
                    key={row.id}
                    disabled={busy}
                    onPress={() => { void Haptics.selectionAsync().catch(() => undefined); onSelect(row.id); }}
                    style={({ focused }: any) => [styles.row, isCurrent && styles.rowCurrent, focused && styles.focused]}
                    testID={`epg-picker-row-${row.id}`}
                  >
                    <View style={styles.rowText}>
                      <Text numberOfLines={1} style={styles.rowName}>{row.name || row.id}</Text>
                      <Text numberOfLines={1} style={styles.rowId}>{row.id}{inUse && !isCurrent ? " · already assigned elsewhere" : ""}</Text>
                    </View>
                    {isCurrent
                      ? <Ionicons name="checkmark-circle" size={18} color={tvColors.purpleBright} />
                      : <Ionicons name="chevron-forward" size={16} color={tvColors.textMuted} />}
                  </Pressable>
                );
              })}
              {!visibleRows.length ? (
                <Text style={styles.empty}>
                  {filter === "unassigned" && rows.length ? "Every channel on this page is already assigned. Try All, or search." : "No channels match this search."}
                </Text>
              ) : null}
            </ScrollView>

            <View style={styles.pager}>
              <Pressable
                disabled={page <= 0}
                onPress={onPrevPage}
                style={({ focused }: any) => [styles.pagerBtn, page <= 0 && styles.disabled, focused && styles.focused]}
                testID="epg-picker-prev"
              >
                <Ionicons name="chevron-up" size={13} color="#fff" />
                <Text style={styles.pagerText}>Previous</Text>
              </Pressable>
              <Text style={styles.pagerLabel}>Page {page + 1} / {Math.max(1, pageCount)}</Text>
              <Pressable
                disabled={page + 1 >= pageCount}
                onPress={onNextPage}
                style={({ focused }: any) => [styles.pagerBtn, page + 1 >= pageCount && styles.disabled, focused && styles.focused]}
                testID="epg-picker-next"
              >
                <Text style={styles.pagerText}>Next</Text>
                <Ionicons name="chevron-down" size={13} color="#fff" />
              </Pressable>
            </View>
          </FocusGuide>
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 1000 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 560, maxHeight: "88%", backgroundColor: tvColors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: tvColors.lineStrong, overflow: "hidden" },
  cardInner: { padding: 16, gap: 10 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 15 },
  subtitle: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9, marginTop: 3, lineHeight: 12.5 },
  closeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  input: { minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.lineStrong, color: "#fff", paddingHorizontal: 10, fontFamily: fonts.regular, fontSize: 11, backgroundColor: tvColors.panelRaised },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  filterChip: { minHeight: 28, justifyContent: "center", paddingHorizontal: 10, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  filterChipActive: { backgroundColor: tvColors.purple },
  filterText: { color: tvColors.textMuted, fontFamily: fonts.semibold, fontSize: 8 },
  filterTextActive: { color: "#fff" },
  count: { marginLeft: "auto", color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  list: { maxHeight: 320 },
  row: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 9, marginBottom: 4, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  rowCurrent: { backgroundColor: "rgba(120,80,210,0.22)", borderColor: "rgba(168,132,245,0.30)" },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { color: "#fff", fontFamily: fonts.medium, fontSize: 10 },
  rowId: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, marginTop: 1 },
  empty: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 9.5, textAlign: "center", paddingVertical: 20 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: tvColors.line },
  pagerBtn: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised },
  pagerText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 8 },
  pagerLabel: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8.5 },
  disabled: { opacity: 0.35 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
});
