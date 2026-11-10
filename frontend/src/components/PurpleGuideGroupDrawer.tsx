import React, { useEffect, useRef, useState } from "react";
import { DeviceEventEmitter, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import type { PurpleGuideGroup } from "@/src/components/PurpleTvShell";
import { fonts, radius, tvColors } from "@/src/theme";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { addTvKeyListener, addTvLongPressListener, resetRemoteContextIfOwned, setGuideNavigationActive, setRemoteContext } from "@/src/utils/tvRemote";

export const GUIDE_GROUP_DRAWER_WIDTH = 232;

// The drawer opens with the rows the remote can reach right away. The rest are
// appended below them after the transition, so nothing shifts under the cursor.
const FIRST_PAINT_MIN_ROWS = 40;
const FIRST_PAINT_ROWS_PAST_TARGET = 16;
const REMAINING_ROWS_DELAY_MS = 260;

// This drawer is conditionally mounted and unmounted on every guide handoff.
// Keep only its last small identity token across mounts, never a View reference.
let lastFocusedGuideGroupName: string | null = null;

export function PurpleGuideGroupDrawer({
  open,
  groups,
  onCloseToGuide,
  onFocusIconRail,
  onOpenMainDrawer,
}: {
  open: boolean;
  groups: PurpleGuideGroup[];
  onCloseToGuide: () => void;
  onFocusIconRail: () => void;
  onOpenMainDrawer: () => void;
}) {
  const refs = useRef(new Map<string, unknown>());
  const activeNameRef = useRef<string | null>(null);
  const focusedNameRef = useRef<string | null>(null);
  const focusTargetNameRef = useRef<string | null>(null);
  const focusConfirmedRef = useRef(false);
  const emptyRef = useRef<unknown>(null);
  const groupsRef = useRef(groups);
  const closeToGuideRef = useRef(onCloseToGuide);
  const focusIconRailRef = useRef(onFocusIconRail);
  const openMainDrawerRef = useRef(onOpenMainDrawer);
  const [preferActiveFocus, setPreferActiveFocus] = useState(false);
  const [allRowsReady, setAllRowsReady] = useState(false);

  // Keep the latest callbacks/data available to the single open-scoped remote
  // listeners without tearing them down on every Guide render. Group counts and
  // EPG refreshes can update frequently while this drawer is open; they must
  // never launch another focus-retry sequence under the user's cursor.
  activeNameRef.current = groups.find((item) => item.active)?.name || groups[0]?.name || null;
  groupsRef.current = groups;
  closeToGuideRef.current = onCloseToGuide;
  focusIconRailRef.current = onFocusIconRail;
  openMainDrawerRef.current = onOpenMainDrawer;

  useEffect(() => {
    if (!open) return;
    // BACK and LEFT enter the immediately adjacent main drawer. Neither
    // should skip directly to the icon rail when coming from guide groups.
    // Up/Down and OK stay with Android native focus.
    setGuideNavigationActive(false);
    setRemoteContext("guide_groups");
    setPreferActiveFocus(true);
    focusConfirmedRef.current = false;
    const offKey = addTvKeyListener((key) => {
      if (key === "BACK") {
        openMainDrawerRef.current();
        return;
      }
      if (key === "LEFT") {
        openMainDrawerRef.current();
        return;
      }
      if (key === "RIGHT") closeToGuideRef.current();
    });
    const offLongPress = addTvLongPressListener((key) => {
      if (key !== "SELECT") return;
      const focusedName = focusedNameRef.current || activeNameRef.current;
      if (!focusedName) return;
      groupsRef.current.find((item) => item.name === focusedName)?.onLongPress?.();
    });

    // Claim focus once per drawer entry. After this, Android owns vertical focus
    // movement until the drawer closes; active-group/count updates cannot yank it.
    // BACK and guide-edge LEFT both reopen onto the group that actually
    // entered the active Guide, not a neighboring row merely browsed in
    // the drawer before closing it.
    const selectedName = activeNameRef.current;
    const targetName = selectedName && groupsRef.current.some((item) => item.name === selectedName)
      ? selectedName : (lastFocusedGuideGroupName || groupsRef.current[0]?.name || null);
    focusTargetNameRef.current = targetName;
    const node = targetName ? refs.current.get(targetName) : emptyRef.current;
    const cancelFocus = requestNativeFocusWithRetry(node, [0, 34, 100, 200, 560], () => focusConfirmedRef.current);
    const remainingRowsTimer = setTimeout(() => setAllRowsReady(true), REMAINING_ROWS_DELAY_MS);
    return () => {
      clearTimeout(remainingRowsTimer);
      offKey();
      offLongPress();
      cancelFocus?.();
      focusConfirmedRef.current = false;
      setPreferActiveFocus(false);
      // Preserve the actual cursor across close/reopen and playlist changes.
      // Do not let this outgoing drawer cleanup overwrite a main drawer that
      // already claimed the same physical key transition.
      if (resetRemoteContextIfOwned("guide_groups", "guide")) {
        setGuideNavigationActive(true);
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const sub = DeviceEventEmitter.addListener("CharmGuideGroupsRequestClose", () => closeToGuideRef.current());
    return () => sub.remove();
  }, [open]);

  if (!open) return null;

  const firstPaintCount = Math.max(
    FIRST_PAINT_MIN_ROWS,
    groups.findIndex((item) => item.name === activeNameRef.current) + FIRST_PAINT_ROWS_PAST_TARGET,
  );
  const renderedGroups = allRowsReady ? groups : groups.slice(0, firstPaintCount);

  return (
    <View style={styles.overlay} testID="phase9-guide-groups-drawer">
      <FocusGuide style={styles.drawer} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {!groups.length && <Pressable ref={emptyRef as any} hasTVPreferredFocus={preferActiveFocus}
            onFocus={() => { focusConfirmedRef.current = true; setPreferActiveFocus(false); setRemoteContext("guide_groups"); }}
            onPress={onOpenMainDrawer} style={({ focused }: any) => [styles.row, focused && styles.focused]}>
            <Text style={styles.name}>No enabled playlists · Open main menu</Text>
          </Pressable>}
          {renderedGroups.map((item) => (
            <Pressable
              key={item.name}
              ref={(node) => {
                if (node) refs.current.set(item.name, node);
                else refs.current.delete(item.name);
              }}
              focusable
              hasTVPreferredFocus={preferActiveFocus && item.name === focusTargetNameRef.current}
              onFocus={() => {
                focusConfirmedRef.current = true;
                setPreferActiveFocus(false);
                focusedNameRef.current = item.name;
                lastFocusedGuideGroupName = item.name;
                setGuideNavigationActive(false);
                setRemoteContext("guide_groups");
              }}
              onPress={item.onPress}
              onLongPress={Platform.isTV ? undefined : item.onLongPress}
              delayLongPress={420}
              style={({ focused }: any) => [
                styles.row,
                item.active && styles.activeRow,
                item.pinned && styles.pinnedRow,
                item.kind === "playlist" && styles.playlistRow,
                item.kind === "group" && styles.groupRow,
                focused && styles.focused,
              ]}
              testID={`phase9-group-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <View style={styles.rowLabel}>
                {item.kind === "playlist" ? (
                  <Ionicons
                    name={item.expanded ? "chevron-up" : "chevron-down"}
                    size={15}
                    color={item.active ? "#fff" : tvColors.purpleSoft}
                  />
                ) : null}
                <Text numberOfLines={1} style={[styles.name, item.active && styles.activeName]}>{item.label || item.name}</Text>
              </View>
              {item.count != null ? <Text style={styles.count}>{item.count}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      </FocusGuide>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    width: GUIDE_GROUP_DRAWER_WIDTH,
    height: "100%",
    flexShrink: 0,
    backgroundColor: "rgba(12,7,26,0.98)",
    borderRightWidth: 1,
    borderRightColor: tvColors.line,
  },
  drawer: { flex: 1, paddingHorizontal: 12, paddingVertical: 10 },
  list: { gap: 3, paddingBottom: 18 },
  row: {
    minHeight: 34,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "transparent",
  },
  playlistRow: { borderBottomColor: tvColors.line, marginBottom: 4 },
  groupRow: { paddingLeft: 28 },
  activeRow: { backgroundColor: "rgba(115,70,195,0.23)" },
  pinnedRow: { borderColor: "rgba(168,132,245,0.22)" },
  focused: { borderColor: tvColors.purpleBright, backgroundColor: "rgba(126,84,218,0.36)" },
  rowLabel: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 },
  name: { flex: 1, color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 11 },
  activeName: { color: "#fff" },
  count: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9, marginLeft: 6 },
});
