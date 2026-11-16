import React from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { fonts, phoneGlass } from "@/src/theme";
import { FocusGuide } from "@/src/components/TVFocusGuideView";

/**
 * Phone look (neon glass): crown behind every screen, a glass bottom bar held
 * upright, and a "More" sheet that rises from the bottom (upright) or slides in
 * from the right (turned). Touch only; the TV layout never renders any of this.
 */

const CROWN = require("../../assets/medialab/crown_backdrop.png");
const ART = {
  home: require("../../assets/glass/nav_home.png"),
  guide: require("../../assets/glass/settings_epg.png"),
  channels: require("../../assets/glass/settings_provider.png"),
  vod: require("../../assets/glass/nav_movies.png"),
  more: require("../../assets/glass/settings_gear.png"),
  favorites: require("../../assets/glass/nav_favorites.png"),
  reminders: require("../../assets/glass/settings_notifications.png"),
  search: require("../../assets/glass/nav_search.png"),
  shows: require("../../assets/glass/nav_shows.png"),
  playlists: require("../../assets/glass/nav_platforms.png"),
  account: require("../../assets/glass/settings_account.png"),
};

export type PhoneRoute = "/" | "/guide" | "/channels" | "/vod";

export const PHONE_TABS: { route: PhoneRoute; label: string; art: number }[] = [
  { route: "/", label: "Live TV", art: ART.home },
  { route: "/guide", label: "Guide", art: ART.guide },
  { route: "/channels", label: "Channels", art: ART.channels },
  { route: "/vod", label: "On Demand", art: ART.vod },
];

export type PhoneMoreTarget =
  | "/favorites" | "/reminders" | "/search" | "/movies" | "/series"
  | "playlists" | "/settings" | "account" | "exit";

export const PHONE_MORE: { target: PhoneMoreTarget; label: string; art?: number }[] = [
  { target: "/favorites", label: "Favorites", art: ART.favorites },
  { target: "/reminders", label: "My Reminders", art: ART.reminders },
  { target: "/search", label: "Search", art: ART.search },
  { target: "/movies", label: "Movies", art: ART.vod },
  { target: "/series", label: "Series", art: ART.shows },
  { target: "playlists", label: "Playlists", art: ART.playlists },
  { target: "/settings", label: "Settings", art: ART.more },
  { target: "account", label: "Account", art: ART.account },
  { target: "exit", label: "Exit" },
];

/** Aurora + crown dead centre, behind every screen on phone and TV. The crown is never rotated, so it stays upright when the phone is turned. */
export function PhoneBackdrop() {
  const { width, height } = useWindowDimensions();
  const crown = Math.min(width, height) * (width > height ? 0.78 : 0.95);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={phoneGlass.pageTop} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.glowPink, { width: width * 0.9, height: width * 0.9, left: -width * 0.25, top: -width * 0.2, borderRadius: width }]} />
      <View style={[styles.glowBlue, { width: width * 0.8, height: width * 0.8, right: -width * 0.3, top: height * 0.18, borderRadius: width }]} />
      <View style={[styles.glowViolet, { width: width * 0.9, height: width * 0.9, left: -width * 0.1, bottom: -width * 0.25, borderRadius: width }]} />
      <View style={[styles.ring, { width: crown * 1.9, height: crown * 1.45, left: (width - crown * 1.9) / 2, top: (height - crown * 1.45) / 2 }]} />
      <View style={[styles.ring, styles.ringInner, { width: crown * 1.3, height: crown * 1.0, left: (width - crown * 1.3) / 2, top: (height - crown * 1.0) / 2 }]} />
      <Image
        source={CROWN}
        resizeMode="contain"
        style={{ position: "absolute", width: crown, height: crown, left: (width - crown) / 2, top: (height - crown) / 2, opacity: 0.68 }}
      />
    </View>
  );
}

const GlassFill = ({ strong, style, children }: { strong?: boolean; style?: any; children?: React.ReactNode }) => (
  <LinearGradient
    colors={strong ? phoneGlass.selectedFill : phoneGlass.fill}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
    style={style}
  >
    {children}
  </LinearGradient>
);

export function PhoneBottomBar({
  active,
  moreOpen,
  onNavigate,
  onMore,
}: {
  active: string;
  moreOpen: boolean;
  onNavigate: (route: PhoneRoute) => void;
  onMore: () => void;
}) {
  return (
    <View style={styles.barWrap} testID="purple-phone-bar">
      <GlassFill style={styles.bar}>
        {PHONE_TABS.map((tab) => {
          const selected = !moreOpen && tab.route === active;
          return (
            <Pressable
              key={tab.route}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              onPress={() => onNavigate(tab.route)}
              style={({ focused }: any) => [styles.tab, focused && styles.focusRing]}
              testID={`purple-phone-bar-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {selected ? <GlassFill strong style={styles.tabPill} /> : null}
              <Image source={tab.art} style={styles.tabArt} />
              <Text numberOfLines={1} style={[styles.tabLabel, selected && styles.tabLabelOn]}>{tab.label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More"
          onPress={onMore}
          style={({ focused }: any) => [styles.tab, focused && styles.focusRing]}
          testID="purple-phone-bar-more"
        >
          {moreOpen ? <GlassFill strong style={styles.tabPill} /> : null}
          <Image source={ART.more} style={styles.tabArt} />
          <Text numberOfLines={1} style={[styles.tabLabel, moreOpen && styles.tabLabelOn]}>More</Text>
        </Pressable>
      </GlassFill>
    </View>
  );
}

/** Turned sideways: the same five places as a glass bar down the left edge. */
export function PhoneSideRail({
  active,
  moreOpen,
  onNavigate,
  onMore,
}: {
  active: string;
  moreOpen: boolean;
  onNavigate: (route: PhoneRoute) => void;
  onMore: () => void;
}) {
  const items = [
    ...PHONE_TABS.map((tab) => ({ key: tab.route, label: tab.label, art: tab.art, on: !moreOpen && tab.route === active, press: () => onNavigate(tab.route) })),
    { key: "more", label: "More", art: ART.more, on: moreOpen, press: onMore },
  ];
  return (
    <View style={styles.railWrap} testID="purple-phone-rail">
      <GlassFill style={styles.rail}>
        {items.map((item) => (
          <Pressable
            key={item.key}
              accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={item.press}
            style={({ focused }: any) => [styles.railItem, focused && styles.focusRing]}
            testID={`purple-phone-rail-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {item.on ? <GlassFill strong style={styles.railPill} /> : null}
            <Image source={item.art} style={styles.tabArt} />
            <Text numberOfLines={1} style={[styles.tabLabel, item.on && styles.tabLabelOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </GlassFill>
    </View>
  );
}

export function PhoneMoreSheet({
  progress,
  onClose,
  onPick,
}: {
  progress: Animated.Value;
  onClose: () => void;
  onPick: (target: PhoneMoreTarget) => void;
}) {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const panelW = landscape ? Math.min(width * 0.48, 460) : width;
  const sheetH = landscape ? height : Math.min(height * 0.6, 560);
  const slide = progress.interpolate({ inputRange: [0, 1], outputRange: [landscape ? panelW : sheetH, 0] });
  const tileW = (panelW - 24 - 20 * 2 - 12 * 2) / 3 + 0;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="purple-phone-more">
      <Pressable accessible={false} focusable={false} onPress={onClose} style={styles.scrim} testID="purple-drawer-scrim" />
      <Animated.View
        style={[
          landscape ? styles.panelRight : styles.panelBottom,
          landscape ? { width: panelW, transform: [{ translateX: slide }] } : { height: sheetH, transform: [{ translateY: slide }] },
        ]}
      >
        <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={{ flex: 1 }}>
        <LinearGradient colors={phoneGlass.solid} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.panel, landscape ? styles.panelRadiusRight : styles.panelRadiusBottom]}>
          {!landscape ? <View style={styles.handle} /> : null}
          <Text style={styles.sheetTitle}>More</Text>
          <View style={styles.grid}>
            {PHONE_MORE.map((item, index) => (
              <Pressable
                key={item.target}
                  accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => onPick(item.target)}
                hasTVPreferredFocus={index === 0}
                style={({ focused }: any) => [styles.tile, { width: tileW }, focused && styles.tileFocus]}
                testID={`purple-phone-more-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <GlassFill style={styles.tileFill}>
                  {item.art ? <Image source={item.art} style={styles.tileArt} /> : <Ionicons name="power" size={40} color="#fff" />}
                  <Text numberOfLines={1} style={styles.tileLabel}>{item.label}</Text>
                </GlassFill>
              </Pressable>
            ))}
          </View>
        </LinearGradient>
        </FocusGuide>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  glowPink: { position: "absolute", backgroundColor: "rgba(255,60,214,0.22)" },
  glowBlue: { position: "absolute", backgroundColor: "rgba(40,170,255,0.18)" },
  glowViolet: { position: "absolute", backgroundColor: "rgba(130,60,255,0.26)" },
  ring: { position: "absolute", borderRadius: 9999, borderWidth: 1.5, borderColor: "rgba(255,120,230,0.32)" },
  ringInner: { borderColor: "rgba(90,215,255,0.28)" },
  barWrap: { paddingHorizontal: 10, paddingTop: 4, paddingBottom: 6 },
  bar: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 64,
    borderRadius: 32,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderWidth: 2,
    borderColor: phoneGlass.edge,
    shadowColor: phoneGlass.glow,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  tab: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 1 },
  tabPill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
    borderWidth: 2.5,
    borderColor: "#fff",
    shadowColor: phoneGlass.glow,
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 6,
  },
  tabArt: { width: 28, height: 28, resizeMode: "contain" },
  tabLabel: { color: "#D9CCF5", fontFamily: fonts.semibold, fontSize: 10.5 },
  tabLabelOn: { color: "#FF9BE8", fontFamily: fonts.bold },
  railWrap: { width: 84, paddingLeft: 8, paddingVertical: 8 },
  rail: {
    flex: 1,
    borderRadius: 36,
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: "space-between",
    borderWidth: 2,
    borderColor: phoneGlass.edge,
    shadowColor: phoneGlass.glow,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  railItem: { flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", gap: 1 },
  railPill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 30,
    borderWidth: 2.5,
    borderColor: "#fff",
    shadowColor: phoneGlass.glow,
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 6,
  },
  focusRing: { borderRadius: 28, borderWidth: 2.5, borderColor: "#fff", backgroundColor: "rgba(224,77,255,0.35)" },
  tileFocus: { transform: [{ scale: 1.04 }] },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: phoneGlass.scrim },
  panelBottom: { position: "absolute", left: 0, right: 0, bottom: 0 },
  panelRight: { position: "absolute", top: 0, bottom: 0, right: 0 },
  panel: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderWidth: 2,
    borderColor: phoneGlass.edge,
    shadowColor: phoneGlass.glow,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 10,
  },
  panelRadiusBottom: { borderTopLeftRadius: 36, borderTopRightRadius: 36, borderBottomWidth: 0 },
  panelRadiusRight: { borderTopLeftRadius: 32, borderBottomLeftRadius: 32, borderRightWidth: 0 },
  handle: { alignSelf: "center", width: 38, height: 5, borderRadius: 3, backgroundColor: "#7D63AA", marginBottom: 6 },
  sheetTitle: { color: "#fff", fontFamily: fonts.display, fontSize: 22, textAlign: "center", marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 8 },
  tile: { aspectRatio: 1.08, borderRadius: 22 },
  tileFill: {
    flex: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 2.5,
    borderColor: "rgba(255,235,250,0.95)",
    shadowColor: phoneGlass.glow,
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 6,
  },
  tileArt: { width: 46, height: 46, resizeMode: "contain" },
  tileLabel: { color: "#fff", fontFamily: fonts.bold, fontSize: 12.5 },
});
