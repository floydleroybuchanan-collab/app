import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  DeviceEventEmitter,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { fonts, radius, spacing, tvColors } from "@/src/theme";
import { combineTvEdgeInsets, getTvSafeInsets } from "@/src/utils/tvLayout";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { useStore } from "@/src/store";
import { evaluateDrawerBack } from "@/src/core/drawerNavigationPolicy";
import { requestGuideGroupsOnEntry } from "@/src/core/guideEntryIntent";
import { isGuideScreenActive, isGuideSurfing } from "@/src/utils/guideSurfGate";
import { useTvCalibration } from "@/src/tvCalibration";
import { addTvKeyListener, resetRemoteContextIfOwned, setGuideNavigationActive, setRemoteContext } from "@/src/utils/tvRemote";

type Route =
  | "/"
  | "/guide"
  | "/vod"
  | "/channels"
  | "/movies"
  | "/series"
  | "/favorites"
  | "/reminders"
  | "/search"
  | "/settings";

type NavItem = {
  route: Route;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
};

type FooterAction = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
};

export type PurpleContextAction = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  testID?: string;
};

export type PurpleGuideGroup = {
  name: string;
  label?: string;
  kind?: "playlist" | "group";
  expanded?: boolean;
  count?: number;
  active?: boolean;
  pinned?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

const NAV: NavItem[] = [
  { route: "/", label: "Live TV", icon: "tv-outline" },
  { route: "/guide", label: "TV Guide", icon: "calendar-outline" },
  { route: "/vod", label: "Video OnDemand", icon: "play-circle-outline" },
  { route: "/favorites", label: "Favorites", icon: "heart-outline" },
  { route: "/reminders", label: "My Reminders", icon: "notifications-outline" },
  { route: "/channels", label: "Channels", icon: "list-outline" },
  { route: "/movies", label: "Movies", icon: "film-outline" },
  { route: "/series", label: "Series", icon: "albums-outline" },
  { route: "/search", label: "Search", icon: "search-outline" },
  { route: "/settings", label: "Settings", icon: "settings-outline" },
];

export const PURPLE_SIDEBAR_WIDTH = 192;
export const PURPLE_ICON_RAIL_WIDTH = 52;
export const PURPLE_DRAWER_ANIMATION_MS = 180;

export type OpenDrawerOptions = {
  focusTop?: boolean;
};

type DrawerContextValue = {
  drawerOpen: boolean;
  drawerProgress: Animated.Value;
  openDrawer: (options?: OpenDrawerOptions) => void;
  closeDrawer: (options?: { force?: boolean }) => void;
  focusIconRail: (returnTarget?: unknown) => void;
  getIconRailReturnTarget: () => unknown;
  iconRailFocusRequest: number;
  focusDrawerTop: boolean;
  consumeFocusDrawerTop: () => void;
};

const DrawerContext = createContext<DrawerContextValue | null>(null);

export function PurpleTvDrawerProvider({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusDrawerTop, setFocusDrawerTop] = useState(false);
  const [iconRailFocusRequest, setIconRailFocusRequest] = useState(0);
  const iconRailReturnTargetRef = useRef<unknown>(null);
  const drawerProgress = useRef(new Animated.Value(0)).current;
  const drawerOpenRef = useRef(false);
  const openedAtRef = useRef(0);

  const openDrawer = useCallback((options?: OpenDrawerOptions) => {
    if (isGuideScreenActive() && isGuideSurfing()) return;
    if (drawerOpenRef.current) return;
    drawerOpenRef.current = true;
    openedAtRef.current = Date.now();
    setFocusDrawerTop(!!options?.focusTop);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback((options?: { force?: boolean }) => {
    if (!drawerOpenRef.current) return;
    if (!options?.force && Date.now() - openedAtRef.current < PURPLE_DRAWER_ANIMATION_MS + 70) return;
    drawerOpenRef.current = false;
    setFocusDrawerTop(false);
    setDrawerOpen(false);
  }, []);

  const consumeFocusDrawerTop = useCallback(() => setFocusDrawerTop(false), []);
  const focusIconRail = useCallback((returnTarget?: unknown) => {
    if (returnTarget) iconRailReturnTargetRef.current = returnTarget;
    setIconRailFocusRequest((value) => value + 1);
  }, []);
  const getIconRailReturnTarget = useCallback(() => iconRailReturnTargetRef.current, []);

  useEffect(() => {
    const animation = Animated.timing(drawerProgress, {
      toValue: drawerOpen ? 1 : 0,
      duration: PURPLE_DRAWER_ANIMATION_MS,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [drawerOpen, drawerProgress]);

  const value = useMemo(
    () => ({
      drawerOpen,
      drawerProgress,
      openDrawer,
      closeDrawer,
      focusIconRail,
      getIconRailReturnTarget,
      iconRailFocusRequest,
      focusDrawerTop,
      consumeFocusDrawerTop,
    }),
    [closeDrawer, consumeFocusDrawerTop, drawerOpen, drawerProgress, focusDrawerTop, focusIconRail, getIconRailReturnTarget, iconRailFocusRequest, openDrawer],
  );

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

export function usePurpleTvDrawer(): DrawerContextValue {
  const value = useContext(DrawerContext);
  if (!value) throw new Error("usePurpleTvDrawer must be used inside PurpleTvDrawerProvider");
  return value;
}

function SmallBrand() {
  return (
    <View style={styles.brand} pointerEvents="none">
      <View style={styles.brandMark}>
        <Ionicons name="sparkles" size={13} color={tvColors.purpleSoft} />
      </View>
      <View>
        <Text style={styles.brandTop}>CHARM</Text>
        <Text style={styles.brandBottom}>IPTV</Text>
      </View>
    </View>
  );
}

function WatchingDot({ testID }: { testID?: string }) {
  return <View style={styles.watchingDot} testID={testID} />;
}

export function PurpleTvShell({
  active,
  children,
  headerRight,
  contentStyle,
  footerAction,
  contextActions,
  guideGroups,
  watchingChannelId,
  secondaryDrawer,
  onIconRailNavigate,
  onIconRailOpenMainDrawer,
}: {
  active: Route;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  contentStyle?: any;
  footerAction?: FooterAction;
  contextActions?: PurpleContextAction[];
  guideGroups?: PurpleGuideGroup[];
  watchingChannelId?: string | null;
  secondaryDrawer?: React.ReactNode;
  onIconRailNavigate?: () => void;
  onIconRailOpenMainDrawer?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    drawerOpen,
    drawerProgress,
    openDrawer,
    closeDrawer,
    iconRailFocusRequest,
    focusDrawerTop,
    consumeFocusDrawerTop,
    getIconRailReturnTarget,
  } = usePurpleTvDrawer();
  const { width, height } = useWindowDimensions();
  const { deviceLayoutMode, activeProgram } = useStore();
  const { calibration } = useTvCalibration();
  const edges = useMemo(() => {
    const safe = getTvSafeInsets(width, height, deviceLayoutMode);
    return combineTvEdgeInsets(safe, calibration);
  }, [calibration, deviceLayoutMode, height, width]);

  const navRefs = useRef(new Map<Route, unknown>());
  const iconRailRefs = useRef(new Map<Route, unknown>());
  const iconRailFocusOwnerRef = useRef<Route | "power" | null>(null);
  const onIconRailNavigateRef = useRef(onIconRailNavigate);
  const onIconRailOpenMainDrawerRef = useRef(onIconRailOpenMainDrawer);
  const guideGroupRefs = useRef(new Map<string, unknown>());
  const deferredDrawerCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isWatching = !!watchingChannelId;
  const [drawerAutoFocus, setDrawerAutoFocus] = useState(drawerOpen);
  const [drawerPreferredRoute, setDrawerPreferredRoute] = useState<Route | null>(drawerOpen ? active : null);
  const activeGuideGroupName = useMemo(
    () => guideGroups?.find((item) => item.active)?.name || null,
    [guideGroups],
  );
  onIconRailNavigateRef.current = onIconRailNavigate;
  onIconRailOpenMainDrawerRef.current = onIconRailOpenMainDrawer;

  useEffect(() => {
    if (!iconRailFocusRequest || drawerOpen) return;
    const node = iconRailRefs.current.get(active) || iconRailRefs.current.get(NAV[0].route);
    const cancelFocus = requestNativeFocusWithRetry(node, [0, 70, 150]);
    return () => cancelFocus?.();
  }, [active, drawerOpen, iconRailFocusRequest]);

  useEffect(() => addTvKeyListener((key) => {
    if (!iconRailFocusOwnerRef.current) return;
    if (key === "RIGHT") {
      const returnTarget = getIconRailReturnTarget();
      if (returnTarget) requestNativeFocusWithRetry(returnTarget, [0, 60, 140]);
      return;
    }
    // LEFT is the universal rail-to-drawer boundary. BACK remains supported
    // for the earlier compact-rail shortcut, but neither key is allowed to
    // fall through to Android's focus search and strand focus off-screen.
    if (key !== "LEFT" && key !== "BACK") return;
    iconRailFocusOwnerRef.current = null;
    resetRemoteContextIfOwned("icon_rail", "default");
    onIconRailOpenMainDrawerRef.current?.();
    openDrawer();
  }), [getIconRailReturnTarget, openDrawer]);

  useEffect(() => {
    if (!drawerOpen) return;
    setRemoteContext("main_drawer");
    if (active === "/guide") setGuideNavigationActive(false);
    const off = active === "/guide"
      ? addTvKeyListener((key) => {
          if (key !== "RIGHT") return;
          // This is an intentional drawer-to-drawer boundary transition, not an
          // accidental close during animation. Main must be gone before Groups
          // becomes remote owner or both focus trees can be live at once.
          closeDrawer({ force: true });
          requestAnimationFrame(() => DeviceEventEmitter.emit("CharmGuideGroupsRequestOpen"));
        })
      : () => undefined;
    return () => {
      off();
      if (active === "/guide") {
        // A Right transition can let the Groups drawer claim ownership before
        // this outgoing effect cleans up. Never re-enable the native Guide or
        // replace that newer owner from stale main-drawer cleanup.
        if (resetRemoteContextIfOwned("main_drawer", "guide")) {
          setGuideNavigationActive(true);
        }
      } else {
        resetRemoteContextIfOwned("main_drawer", "default");
      }
    };
  }, [active, closeDrawer, drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) {
      setDrawerAutoFocus(false);
      setDrawerPreferredRoute(null);
      return;
    }

    const preferredGuideGroupName =
      !focusDrawerTop && active === "/guide" ? activeGuideGroupName : null;
    const preferredRoute: Route | null = preferredGuideGroupName ? null : focusDrawerTop ? NAV[0].route : active;
    if (focusDrawerTop) consumeFocusDrawerTop();
    setDrawerPreferredRoute(preferredRoute);
    setDrawerAutoFocus(true);

    const clearPreferred = setTimeout(() => {
      setDrawerAutoFocus(false);
      setDrawerPreferredRoute(null);
    }, 220);
    const preferredNode = preferredGuideGroupName
      ? guideGroupRefs.current.get(preferredGuideGroupName)
      : preferredRoute
        ? navRefs.current.get(preferredRoute)
        : null;
    const cancelFocus = requestNativeFocusWithRetry(preferredNode, [0, PURPLE_DRAWER_ANIMATION_MS + 20]);
    return () => {
      clearTimeout(clearPreferred);
      cancelFocus?.();
    };
  }, [active, activeGuideGroupName, consumeFocusDrawerTop, drawerOpen, focusDrawerTop]);

  const reopenArmedAtRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === "web") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (active === "/guide" && !drawerOpen && !activeProgram) {
          reopenArmedAtRef.current = 0;
          // Guide owns closed-guide Back so it can enter the dedicated Groups
          // drawer first. The shell never opens a closed drawer from Back.
          return false;
        }
        const decision = evaluateDrawerBack({
          drawerOpen,
          blockingOverlayOpen: !!activeProgram,
          reopenArmedAt: reopenArmedAtRef.current,
        });
        if (decision === "pass-through") {
          reopenArmedAtRef.current = 0;
          return false;
        }
        if (decision === "arm-reopen") {
          reopenArmedAtRef.current = Date.now();
          return true;
        }
        if (decision === "open-drawer") {
          reopenArmedAtRef.current = 0;
          openDrawer({ focusTop: true });
          return true;
        }
        if (decision === "close-drawer") {
          reopenArmedAtRef.current = 0;
          closeDrawer();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [active, activeProgram, closeDrawer, drawerOpen, openDrawer]),
  );

  const navigate = useCallback(
    (route: Route, source: "drawer" | "rail" = "drawer") => {
      void Haptics.selectionAsync().catch(() => undefined);
      if (deferredDrawerCloseTimer.current) {
        clearTimeout(deferredDrawerCloseTimer.current);
        deferredDrawerCloseTimer.current = null;
      }

      // TiviMate-style focus ownership: the drawer must fully relinquish the
      // remote/focus tree before a different route mounts and claims focus.
      // A normal close can be rejected by the anti-bounce opening guard, which
      // previously allowed two live focus owners during rapid drawer selection.
      closeDrawer({ force: true });
      if (source === "rail") onIconRailNavigateRef.current?.();
      if (route === active && pathname === route) {
        if (route === "/guide" && source === "drawer") {
          requestAnimationFrame(() => DeviceEventEmitter.emit("CharmGuideGroupsRequestOpen"));
        }
        return;
      }
      if (route === "/guide") requestGuideGroupsOnEntry();

      requestAnimationFrame(() => {
        if (route === "/settings") DeviceEventEmitter.emit("CharmShowAllSettings");
        router.replace(route as any);
      });
    },
    [active, closeDrawer, pathname, router],
  );

  useEffect(() => () => {
    if (deferredDrawerCloseTimer.current) clearTimeout(deferredDrawerCloseTimer.current);
  }, []);

  const exit = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (Platform.OS !== "web") BackHandler.exitApp();
  }, []);
  const [exitHint, setExitHint] = useState(false);
  const exitHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptHoldToExit = useCallback(() => {
    setExitHint(true);
    if (exitHintTimer.current) clearTimeout(exitHintTimer.current);
    exitHintTimer.current = setTimeout(() => setExitHint(false), 1600);
  }, []);
  useEffect(() => () => {
    if (exitHintTimer.current) clearTimeout(exitHintTimer.current);
  }, []);

  const drawerTranslateX = drawerProgress.interpolate({ inputRange: [0, 1], outputRange: [-PURPLE_SIDEBAR_WIDTH, 0] });

  const claimIconRail = useCallback((owner: Route | "power") => {
    iconRailFocusOwnerRef.current = owner;
    setRemoteContext("icon_rail");
    if (active === "/guide") setGuideNavigationActive(false);
  }, [active]);

  const releaseIconRail = useCallback((owner: Route | "power") => {
    if (iconRailFocusOwnerRef.current !== owner) return;
    iconRailFocusOwnerRef.current = null;
    if (resetRemoteContextIfOwned("icon_rail", active === "/guide" ? "guide" : "default") && active === "/guide") {
      setGuideNavigationActive(true);
    }
  }, [active]);

  const renderNavItem = (item: NavItem) => {
    const selected = item.route === active;
    const showWatching = item.route === "/" && isWatching;
    return (
      <Pressable
        key={item.route}
        ref={(node) => {
          if (node) navRefs.current.set(item.route, node);
          else navRefs.current.delete(item.route);
        }}
        focusable={drawerOpen}
        hasTVPreferredFocus={drawerAutoFocus && drawerPreferredRoute === item.route}
        onPress={() => navigate(item.route)}
        style={({ focused }: any) => [
          styles.navRow,
          selected && styles.navRowSelected,
          selected && styles.navRowActiveMark,
          focused && styles.navRowFocused,
        ]}
        testID={`purple-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <View style={styles.navIconWrap}>
          <Ionicons
            name={selected ? (item.icon.replace("-outline", "") as any) : item.icon}
            size={15}
            color={selected ? "#fff" : tvColors.textMuted}
          />
          {showWatching ? <WatchingDot testID="purple-nav-live-watching" /> : null}
        </View>
        <Text numberOfLines={1} style={[styles.navText, selected && styles.navTextSelected]}>{item.label}</Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: edges.padding.top,
          paddingBottom: edges.padding.bottom,
          paddingLeft: edges.padding.left,
          paddingRight: edges.padding.right,
          marginTop: edges.margin.top,
          marginBottom: edges.margin.bottom,
          marginLeft: edges.margin.left,
          marginRight: edges.margin.right,
        },
      ]}
    >
      <Animated.View
        pointerEvents={drawerOpen ? "auto" : "none"}
        style={[styles.sidebarOverlay, { transform: [{ translateX: drawerTranslateX }] }]}
      >
        <FocusGuide style={styles.sidebar} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <SmallBrand />

          {contextActions?.length ? (
            <View style={styles.contextActions}>
              {contextActions.map((action) => (
                <Pressable
                  key={action.label}
                  focusable={drawerOpen}
                  onPress={action.onPress}
                  style={({ focused }: any) => [styles.contextActionRow, focused && styles.navRowFocused]}
                  testID={action.testID}
                >
                  <Ionicons name={action.icon} size={13} color={tvColors.purpleSoft} />
                  <Text numberOfLines={1} style={styles.contextActionText}>{action.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {active === "/guide" && guideGroups?.length ? (
            <View style={styles.guideGroupSection}>
              <Text style={styles.guideGroupLabel}>{guideGroups.some((item) => item.kind === "playlist") ? "Playlists" : "Groups"}</Text>
              <ScrollView
                style={styles.guideGroupList}
                contentContainerStyle={styles.guideGroupListContent}
                showsVerticalScrollIndicator={false}
              >
                {guideGroups.map((item) => (
                  <Pressable
                    key={item.name}
                    ref={(node) => {
                      if (node) guideGroupRefs.current.set(item.name, node);
                      else guideGroupRefs.current.delete(item.name);
                    }}
                    focusable={drawerOpen}
                    hasTVPreferredFocus={drawerAutoFocus && drawerPreferredRoute === null && !!item.active}
                    onPress={item.onPress}
                    onLongPress={item.onLongPress}
                    delayLongPress={420}
                    style={({ focused }: any) => [
                      styles.guideGroupRow,
                      item.active && styles.guideGroupRowActive,
                      item.pinned && styles.guideGroupRowPinned,
                      focused && styles.navRowFocused,
                    ]}
                    testID={`purple-guide-group-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Text numberOfLines={1} style={[styles.guideGroupText, item.active && styles.guideGroupTextActive]}>{item.kind === "playlist" ? (item.expanded ? "▾ " : "▸ ") : "    "}{item.label || item.name}</Text>
                    {item.count ? <Text style={styles.guideGroupCount}>{item.count}</Text> : null}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.navSections} testID="purple-nav-bounded-sections">
            <View style={styles.primaryNavSection}>
              <ScrollView
                style={styles.primaryNavList}
                contentContainerStyle={styles.navListContent}
                showsVerticalScrollIndicator={false}
              >
                {NAV.map(renderNavItem)}
              </ScrollView>
            </View>
          </View>

          <View style={[styles.sidebarFooter, footerAction && styles.sidebarFooterRow]} testID="purple-nav-pinned-footer">
            {footerAction ? (
              <Pressable
                focusable={drawerOpen}
                disabled={footerAction.disabled}
                onPress={footerAction.onPress}
                style={({ focused }: any) => [
                  styles.footerCompact,
                  footerAction.disabled && styles.footerDisabled,
                  focused && styles.navRowFocused,
                ]}
                testID={footerAction.testID}
              >
                <Ionicons name={footerAction.icon} size={13} color={tvColors.textMuted} />
                <Text numberOfLines={1} style={styles.footerCompactText}>{footerAction.label}</Text>
              </Pressable>
            ) : null}
            <Pressable
              focusable={drawerOpen}
              onPress={promptHoldToExit}
              onLongPress={exit}
              delayLongPress={650}
              style={({ focused }: any) => [footerAction ? styles.footerCompact : styles.power, focused && styles.navRowFocused]}
              testID="purple-nav-power"
            >
              <Ionicons name="power-outline" size={14} color={tvColors.textMuted} />
              <Text numberOfLines={1} style={footerAction ? styles.footerCompactText : styles.powerText}>
                {exitHint ? "Hold Exit" : "Exit"}
              </Text>
            </Pressable>
          </View>
        </FocusGuide>
      </Animated.View>

      {drawerOpen ? <View style={styles.sidebarSpacer} /> : null}
      {!drawerOpen ? (
        <FocusGuide style={styles.iconRail} trapFocusUp trapFocusDown trapFocusLeft testID="purple-icon-rail">
          <View style={styles.iconRailBrand}>
            <Ionicons name="sparkles" size={18} color={tvColors.purpleSoft} />
          </View>
          <View style={styles.iconRailItems}>
            {NAV.map((item) => {
              const selected = item.route === active;
              return (
                <Pressable
                  key={item.route}
                  ref={(node) => {
                    if (node) iconRailRefs.current.set(item.route, node);
                    else iconRailRefs.current.delete(item.route);
                  }}
                  focusable
                  accessibilityLabel={item.label}
                  onFocus={() => claimIconRail(item.route)}
                  onBlur={() => releaseIconRail(item.route)}
                  onPress={() => navigate(item.route, "rail")}
                  style={({ focused }: any) => [
                    styles.iconRailItem,
                    selected && styles.iconRailItemSelected,
                    focused && styles.iconRailItemFocused,
                  ]}
                  testID={`purple-icon-rail-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Ionicons
                    name={selected ? (item.icon.replace("-outline", "") as any) : item.icon}
                    size={17}
                    color={selected ? "#fff" : tvColors.textMuted}
                  />
                  {item.route === "/" && isWatching ? <WatchingDot /> : null}
                </Pressable>
              );
            })}
          </View>
          <Pressable
            focusable
            accessibilityLabel="Exit"
            onFocus={() => claimIconRail("power")}
            onBlur={() => releaseIconRail("power")}
            onPress={promptHoldToExit}
            onLongPress={exit}
            delayLongPress={650}
            style={({ focused }: any) => [styles.iconRailPower, focused && styles.iconRailItemFocused]}
            testID="purple-icon-rail-power"
          >
            <Ionicons name="power-outline" size={17} color={tvColors.textMuted} />
          </Pressable>
        </FocusGuide>
      ) : null}
      {!drawerOpen && secondaryDrawer ? secondaryDrawer : null}
      <FocusGuide
        style={[styles.content, contentStyle]}
        autoFocus={!drawerOpen && !secondaryDrawer && active !== "/guide"}
        trapFocusUp={!drawerOpen && !secondaryDrawer && active !== "/guide"}
        trapFocusDown={!drawerOpen && !secondaryDrawer && active !== "/guide"}
        trapFocusRight={!drawerOpen && !secondaryDrawer && active !== "/guide"}
      >
        {children}
      </FocusGuide>
      {headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: tvColors.canvas, overflow: "hidden" },
  sidebarOverlay: { position: "absolute", left: 0, top: 0, bottom: 0, width: PURPLE_SIDEBAR_WIDTH, zIndex: 20 },
  sidebarSpacer: { width: PURPLE_SIDEBAR_WIDTH, height: "100%" },
  iconRail: {
    width: PURPLE_ICON_RAIL_WIDTH,
    height: "100%",
    flexShrink: 0,
    alignItems: "center",
    backgroundColor: "#0A0916",
    borderRightWidth: 1,
    borderRightColor: tvColors.line,
    paddingTop: 10,
    paddingBottom: 8,
  },
  iconRailBrand: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tvColors.purpleDeep,
    marginBottom: 7,
  },
  iconRailItems: { flex: 1, minHeight: 0, alignItems: "center", gap: 2 },
  iconRailItem: {
    width: 36,
    minHeight: 31,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  iconRailItemSelected: { backgroundColor: tvColors.purple, borderLeftColor: tvColors.purpleBright },
  iconRailItemFocused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
  iconRailPower: {
    width: 36,
    minHeight: 31,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
    borderTopWidth: 1,
    borderTopColor: tvColors.line,
  },
  sidebar: {
    width: PURPLE_SIDEBAR_WIDTH,
    height: "100%",
    backgroundColor: "#0A0916",
    borderRightWidth: 1,
    borderRightColor: tvColors.line,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 8,
    overflow: "hidden",
  },
  brand: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6, marginBottom: 8 },
  brandMark: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: tvColors.lineStrong,
    backgroundColor: tvColors.purpleDeep,
  },
  brandTop: { color: "#fff", fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8 },
  brandBottom: { color: tvColors.purpleSoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1.4 },
  contextActions: { gap: 2, marginBottom: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: tvColors.line },
  contextActionRow: {
    minHeight: 30,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 9,
  },
  contextActionText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 10, flex: 1 },
  guideGroupSection: {
    maxHeight: "34%",
    minHeight: 0,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: tvColors.line,
    overflow: "hidden",
  },
  guideGroupLabel: {
    color: tvColors.textMuted,
    fontFamily: fonts.semibold,
    fontSize: 8,
    letterSpacing: 0.6,
    paddingHorizontal: 6,
    paddingBottom: 4,
    textTransform: "uppercase",
  },
  guideGroupList: { minHeight: 0, maxHeight: 190 },
  guideGroupListContent: { gap: 2 },
  guideGroupRow: {
    minHeight: 30,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
  },
  guideGroupRowActive: { backgroundColor: tvColors.purple },
  guideGroupRowPinned: { borderLeftColor: tvColors.purpleBright },
  guideGroupText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 10, flex: 1 },
  guideGroupTextActive: { color: "#fff", fontFamily: fonts.semibold },
  guideGroupCount: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  navSections: { flex: 1, minHeight: 0, overflow: "hidden" },
  primaryNavSection: { flex: 1, minHeight: 0, overflow: "hidden" },
  primaryNavList: { flex: 1, minHeight: 0 },
  navListContent: { gap: 2, paddingBottom: 2 },
  navRow: {
    minHeight: 34,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 9,
  },
  navRowSelected: { backgroundColor: tvColors.purple },
  navRowActiveMark: { borderLeftWidth: 3, borderLeftColor: tvColors.purpleBright, paddingLeft: 6 },
  navRowFocused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
  navIconWrap: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  watchingDot: {
    position: "absolute",
    top: -1,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tvColors.purpleBright,
  },
  navText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 10.5 },
  navTextSelected: { color: "#fff", fontFamily: fonts.semibold },
  sidebarFooter: {
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: tvColors.line,
    paddingTop: 6,
    backgroundColor: "#0A0916",
  },
  sidebarFooterRow: { flexDirection: "row", gap: 4 },
  power: {
    minHeight: 30,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 9,
  },
  powerText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9.5 },
  footerCompact: {
    flex: 1,
    minWidth: 0,
    minHeight: 30,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
  },
  footerCompactText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 8 },
  footerDisabled: { opacity: 0.5 },
  content: { flex: 1, backgroundColor: tvColors.canvas },
  headerRight: { position: "absolute", top: 10, right: spacing.lg },
});

