import React from "react";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts, glass } from "@/src/theme";

const SEARCH_ART = require("../../assets/glass/nav_search.png");

type Props = {
  /** The group being shown, for example "AM | USA | ENTERTAINMENT". */
  label: string;
  onBack: () => void;
  onGroups: () => void;
  onMore: () => void;
  onSearch: () => void;
};

/**
 * The top row of the approved Guide design: back button, group dropdown, "..." button and a search pill.
 * Held upright the search pill drops to a second row; turned sideways everything sits on one row.
 */
export function GuideTopBar({ label, onBack, onGroups, onMore, onSearch }: Props) {
  const { width, height } = useWindowDimensions();
  const upright = height > width;
  const back = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to Live TV"
      onPress={onBack}
      style={({ focused }: any) => [styles.circle, focused && styles.focused]}
      testID="guide-top-back"
    >
      <Ionicons name="arrow-back" size={22} color="#fff" />
    </Pressable>
  );
  const groups = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Group ${label}. Change group`}
      onPress={onGroups}
      style={({ focused }: any) => [styles.pill, styles.groupPill, focused && styles.focused]}
      testID="guide-top-group"
    >
      <Text numberOfLines={1} style={styles.groupText}>{label}</Text>
      <Ionicons name="chevron-down" size={18} color="#CFE6FF" />
    </Pressable>
  );
  const more = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="More guide actions"
      onPress={onMore}
      style={({ focused }: any) => [styles.circle, focused && styles.focused]}
      testID="guide-top-more"
    >
      <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
    </Pressable>
  );
  const search = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search by program name"
      onPress={onSearch}
      style={({ focused }: any) => [styles.pill, styles.searchPill, focused && styles.focused]}
      testID="guide-top-search"
    >
      <Image source={SEARCH_ART} style={styles.searchArt} />
      <Text numberOfLines={1} style={styles.searchText}>Search by program name</Text>
    </Pressable>
  );
  return (
    <View style={styles.wrap} testID="guide-top-bar">
      {upright ? (
        <>
          <View style={styles.row}>{back}{groups}{more}</View>
          <View style={styles.row}>{search}</View>
        </>
      ) : (
        <View style={styles.row}>{back}{groups}{more}{search}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  circle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: glass.buttonEdge,
    backgroundColor: glass.button,
  },
  pill: {
    height: 42,
    borderRadius: 21,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 8,
    borderWidth: 2,
    borderColor: glass.buttonEdge,
    backgroundColor: glass.button,
  },
  groupPill: { flex: 1, minWidth: 0, justifyContent: "space-between" },
  searchPill: { flex: 1, minWidth: 0 },
  groupText: { flex: 1, color: "#fff", fontFamily: fonts.bold, fontSize: 13 },
  searchText: { flex: 1, color: "#CDBBEE", fontFamily: fonts.medium, fontSize: 13 },
  searchArt: { width: 26, height: 26, resizeMode: "contain" },
  focused: { borderColor: "#fff", backgroundColor: glass.focus },
});
