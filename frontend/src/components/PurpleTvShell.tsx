import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Image,
  DeviceEventEmitter,
  findNodeHandle,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, usePathname, useRouter } from "expo-router";
import { goToTab } from "@/src/utils/goToTab";
import { PhoneBackdrop, PhoneBottomBar, PhoneMoreSheet, PhoneSideRail, type PhoneMoreTarget } from "@/src/components/PhoneChrome";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { IDLE_FOR_ROUTE, RailChip, RailEnergy, RailGlassBase, RailGlassOverlay, RailIdle } from "@/src/components/PurpleIconRailGlass";
import * as Haptics from "expo-haptics";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { fonts, glass, glassFocus, radius, spacing, tvColors } from "@/src/theme";
import { combineTvEdgeInsets, getTvSafeInsets, shouldUseTvLayout } from "@/src/utils/tvLayout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { useStore } from "@/src/store";
import { evaluateDrawerBack } from "@/src/core/drawerNavigationPolicy";
import { requestGuideGroupsOnEntry } from "@/src/core/guideEntryIntent";
import { useAuth } from "@/src/auth/AuthContext";
import { isGuideScreenActive, isGuideSurfing } from "@/src/utils/guideSurfGate";
import { useTvCalibration } from "@/src/tvCalibration";
import { addTvKeyListener, prepareIconRailHide, resetRemoteContextIfOwned, setGuideNavigationActive, setRemoteContext } from "@/src/utils/tvRemote";
import { useIconRailPreferences } from "@/src/core/iconRailPreferences";
import { railIdleRemainingMs } from "@/src/core/iconRailPolicy";

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
  /** Glass artwork shared by the rail and the drawer (one decoded bitmap each). */
  art: number;
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
  { route: "/", label: "Live TV", art: require("../../assets/glass/rail_nav_home.png") },
  { route: "/guide", label: "TV Guide", art: require("../../assets/glass/rail_nav_tv.png") },
  { route: "/vod", label: "Video OnDemand", art: require("../../assets/glass/rail_nav_vod.png") },
  { route: "/favorites", label: "Favorites", art: require("../../assets/glass/rail_nav_favorites.png") },
  { route: "/reminders", label: "My Reminders", art: require("../../assets/glass/rail_settings_notifications.png") },
  { route: "/channels", label: "Channels", art: require("../../assets/glass/rail_settings_provider.png") },
  { route: "/movies", label: "Movies", art: require("../../assets/glass/rail_vod_set_playback.png") },
  { route: "/series", label: "Series", art: require("../../assets/glass/rail_nav_series.png") },
  { route: "/search", label: "Search", art: require("../../assets/glass/rail_nav_search.png") },
  { route: "/settings", label: "Settings", art: require("../../assets/glass/rail_settings_gear.png") },
];
const RAIL_CROWN = require("../../assets/medialab/medialab_crown.png");

/** Decorative glass icon: never a remote stop (Android maps Image accessible to focusable). */
function NavArt({ source, size }: { source: number; size: number }) {
  return <Image accessible={false} source={source} fadeDuration={0} resizeMode="contain" style={{ width: size, height: size }} />;
}

// Each route renders its own PurpleTvShell. Keep focus identity outside that
// short-lived component so returning from VOD/Guide preserves the cursor.
let lastMainDrawerRoute: Route | null = null;
let lastMainDrawerGroupName: string | null = null;

export const PURPLE_SIDEBAR_WIDTH = 192;
export const PURPLE_ICON_RAIL_WIDTH = 50;
export const PURPLE_DRAWER_ANIMATION_MS = 180;
// Native forwards only the first press of a held key, so this guards a double
// event and nothing else; quick intentional presses must get through.
const GUIDE_DRAWER_TRANSFER_GUARD_MS = 90;
// Focus resting on the icon rail opens the labelled drawer after this long.
const RAIL_AUTO_OPEN_MS = 420;
// After the drawer hands focus back to the rail, the rail must not immediately
// reopen it; this is long enough for the viewer to step away with Right.
const RAIL_AUTO_OPEN_SUPPRESS_MS = 1400;

export type OpenDrawerOptions = {
  focusTop?: boolean;
  /** Explicit remote/back intent must not be delayed by the Guide surf gate. */
  force?: boolean;
};

export type RailTransfer = { from: number; to: number; token: number };

type DrawerContextValue = {
  drawerOpen: boolean;
  railTransfer: RailTransfer;
  requestRailTransfer: (from: number, to: number) => void;
  /** True while open or sliding closed; a closed drawer is not drawn at all. */
  drawerVisible: boolean;
  drawerProgress: Animated.Value;
  openDrawer: (options?: OpenDrawerOptions) => void;
  closeDrawer: (options?: { force?: boolean }) => void;
  focusIconRail: () => void;
  iconRailEntryTag?: number;
  publishIconRailEntryTag: (owner: object, tag?: number) => void;
  iconRailFocusRequest: number;
  focusDrawerTop: boolean;
  consumeFocusDrawerTop: () => void;
};

const DrawerContext = createContext<DrawerContextValue | null>(null);

type IconRailFocusContextValue = {
  /** Native destination for a single Left press from a page-edge control. */
  iconRailEntryTag?: number;
};

/**
 * Native focus destination published by the currently mounted shell. Pages
 * render the shell themselves, so this value lives in the root drawer provider
 * and is available while those pages are constructing their child controls.
 */
export function useIconRailFocusBoundary(): IconRailFocusContextValue {
  const value = useContext(DrawerContext);
  return { iconRailEntryTag: value?.iconRailEntryTag };
}

export function PurpleTvDrawerProvider({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusDrawerTop, setFocusDrawerTop] = useState(false);
  const [iconRailFocusRequest, setIconRailFocusRequest] = useState(0);
  const [iconRailEntryTag, setIconRailEntryTag] = useState<number | undefined>();
  const iconRailPublisherRef = useRef<object | null>(null);
  const drawerProgress = useRef(new Animated.Value(0)).current;
  const drawerOpenRef = useRef(false);
  const openedAtRef = useRef(0);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const drawerVisibleRef = useRef(false);
  // Each route mounts its own shell, so a rail-owned animation would be torn
  // down the instant navigation starts. The provider outlives that.
  const [railTransfer, setRailTransfer] = useState<RailTransfer>({ from: -1, to: -1, token: 0 });
  const requestRailTransfer = useCallback((from: number, to: number) => {
    setRailTransfer((current) => ({ from, to, token: current.token + 1 }));
  }, []);

  const openDrawer = useCallback((options?: OpenDrawerOptions) => {
    if (isGuideScreenActive() && isGuideSurfing() && !options?.force) return;
    if (drawerOpenRef.current) return;
    drawerOpenRef.current = true;
    openedAtRef.current = Date.now();
    // A drawer that is drawn fresh starts fully closed, never from a stale
    // animated value left by another page's drawer.
    if (!drawerVisibleRef.current) drawerProgress.setValue(0);
    drawerVisibleRef.current = true;
    setDrawerVisible(true);
    setFocusDrawerTop(!!options?.focusTop);
    setDrawerOpen(true);
  }, [drawerProgress]);

  const closeDrawer = useCallback((options?: { force?: boolean }) => {
    if (!drawerOpenRef.current) return;
    // Allow an intentional close while the native-driver animation is running.
    // Animated.timing cancels/reverses cleanly; ignoring the key causes lag and
    // lets a second D-pad event travel into a different focus tree.
    drawerOpenRef.current = false;
    setFocusDrawerTop(false);
    setDrawerOpen(false);
  }, []);

  const consumeFocusDrawerTop = useCallback(() => setFocusDrawerTop(false), []);
  const focusIconRail = useCallback(() => setIconRailFocusRequest((value) => value + 1), []);
  const publishIconRailEntryTag = useCallback((owner: object, tag?: number) => {
    if (tag) {
      iconRailPublisherRef.current = owner;
      setIconRailEntryTag((current) => current === tag ? current : tag);
      return;
    }
    // A retained/closing route may clean up after the next shell has already
    // published its rail. Only the shell that owns the current tag can clear it.
    if (iconRailPublisherRef.current !== owner) return;
    iconRailPublisherRef.current = null;
    setIconRailEntryTag(undefined);
  }, []);

  useEffect(() => {
    const animation = Animated.timing(drawerProgress, {
      toValue: drawerOpen ? 1 : 0,
      duration: PURPLE_DRAWER_ANIMATION_MS,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      // Remove the drawer once it has slid away. Every page used to keep its own
      // closed drawer laid out under the rail: it could be drawn open from a
      // stale animated value after a page change (stuck open, no focusable row)
      // and it competed for LEFT focus.
      if (finished && !drawerOpenRef.current) {
        drawerVisibleRef.current = false;
        setDrawerVisible(false);
      }
    });
    return () => animation.stop();
  }, [drawerOpen, drawerProgress]);

  const value = useMemo(
    () => ({
      drawerOpen,
      drawerVisible,
      drawerProgress,
      railTransfer,
      requestRailTransfer,
      openDrawer,
      closeDrawer,
      focusIconRail,
      iconRailEntryTag,
      publishIconRailEntryTag,
      iconRailFocusRequest,
      focusDrawerTop,
      consumeFocusDrawerTop,
    }),
    [closeDrawer, consumeFocusDrawerTop, drawerOpen, drawerProgress, drawerVisible, focusDrawerTop, focusIconRail, iconRailEntryTag, iconRailFocusRequest, openDrawer, publishIconRailEntryTag, railTransfer, requestRailTransfer],
  );

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

export function usePurpleTvDrawer(): DrawerContextValue {
  const value = useContext(DrawerContext);
  if (!value) throw new Error("usePurpleTvDrawer must be used inside PurpleTvDrawerProvider");
  return value;
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
  immersiveContent = false,
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
  /** Native VOD player temporarily occupies the full 10-foot canvas. */
  immersiveContent?: boolean;
  onIconRailNavigate?: () => void;
  onIconRailOpenMainDrawer?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const isFocused = useIsFocused();
  const railPreferences = useIconRailPreferences();
  const [railTimedOut, setRailTimedOut] = useState(false);
  const [railFocusNonce, setRailFocusNonce] = useState(0);
  const lastRailInteractionRef = useRef(Date.now());
  const railRevealPendingRef = useRef(false);
  const {
    drawerOpen,
    drawerVisible,
    drawerProgress,
    openDrawer,
    closeDrawer,
    focusIconRail,
    publishIconRailEntryTag,
    iconRailFocusRequest,
    focusDrawerTop,
    consumeFocusDrawerTop,
    railTransfer,
    requestRailTransfer,
  } = usePurpleTvDrawer();
  const { width, height } = useWindowDimensions();
  const { deviceLayoutMode, activeProgram } = useStore();
  const insets = useSafeAreaInsets();
  // A phone or tablet used by touch: it keeps the camera cutout clear, never hides the rail by itself, and held
  // upright it swaps the side rail for a bottom bar (the rail would take a third of a 390 dp wide screen).
  const phone = !shouldUseTvLayout(deviceLayoutMode);
  const bottomBar = phone && height > width && !immersiveContent;
  // Guide uses its own channel-column → playlist-groups boundary. The compact
  // menu belongs beside its open groups drawer, not beside the Guide grid.
  const railAllowed = phone ? !bottomBar : railPreferences.ready && railPreferences.enabled && !railTimedOut;
  const showIconRail = isFocused && railAllowed && !drawerOpen && !immersiveContent && (active !== "/guide" || Boolean(secondaryDrawer));
  const lastIconRailFocusRequestRef = useRef(iconRailFocusRequest);
  const { calibration } = useTvCalibration();
  const edges = useMemo(() => {
    const safe = getTvSafeInsets(width, height, deviceLayoutMode);
    return combineTvEdgeInsets(safe, calibration);
  }, [calibration, deviceLayoutMode, height, width]);
  // The groups drawer takes a column of its own in the shell row, beside the
  // rail. The page is laid out in the width that is left, so opening the drawer
  // moves the preview, description and grid over rather than covering them.
  const railHeight = Math.max(240, height - edges.padding.top - edges.padding.bottom - 12);
  const secondaryDrawerVisible = !phone && isFocused && !drawerOpen && !!secondaryDrawer;


  const navRefs = useRef(new Map<Route, unknown>());
  const iconRailRefs = useRef(new Map<Route, unknown>());
  const iconRailFocusOwnerRef = useRef<Route | "power" | null>(null);
  const railAutoOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [railPressToken, setRailPressToken] = useState(0);
  const [railFocusedRoute, setRailFocusedRoute] = useState<Route | "power" | null>(null);
  const suppressRailAutoOpenUntilRef = useRef(0);
  const shellRef = useRef<View | null>(null);
  const iconRailPublisher = useRef<object>({}).current;
  const [contentReturnTag, setContentReturnTag] = useState<number | undefined>();
  const onIconRailNavigateRef = useRef(onIconRailNavigate);
  const onIconRailOpenMainDrawerRef = useRef(onIconRailOpenMainDrawer);
  const guideGroupRefs = useRef(new Map<string, unknown>());
  const lastGuideDrawerTransferRef = useRef(0);
  const deferredDrawerCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isWatching = !!watchingChannelId;
  const [drawerAutoFocus, setDrawerAutoFocus] = useState(drawerOpen);
  const drawerFocusConfirmedRef = useRef(false);
  const drawerTargetRouteRef = useRef<Route | null>(null);
  const drawerTargetReachedRef = useRef(true);
  const [drawerPreferredRoute, setDrawerPreferredRoute] = useState<Route | null>(drawerOpen ? active : null);
  const activeGuideGroupName = useMemo(
    () => guideGroups?.find((item) => item.active)?.name || null,
    [guideGroups],
  );
  // Keep latest group identities for the next drawer entry without restarting
  // an in-flight focus restoration when the EPG refreshes or groups rerender.
  const guideDrawerFocusSnapshotRef = useRef({ guideGroups, activeGuideGroupName });
  useEffect(() => {
    guideDrawerFocusSnapshotRef.current = { guideGroups, activeGuideGroupName };
  }, [guideGroups, activeGuideGroupName]);
  onIconRailNavigateRef.current = onIconRailNavigate;
  onIconRailOpenMainDrawerRef.current = onIconRailOpenMainDrawer;

  const revealRail = useCallback(() => {
    lastRailInteractionRef.current = Date.now();
    if (!railPreferences.enabled) {
      onIconRailOpenMainDrawerRef.current?.();
      openDrawer();
      return;
    }
    railRevealPendingRef.current = true;
    setRailTimedOut(false);
    setRailFocusNonce(value => value + 1);
  }, [openDrawer, railPreferences.enabled]);

  useEffect(() => {
    lastRailInteractionRef.current = Date.now();
    setRailTimedOut(false);
  }, [pathname, railPreferences.enabled, railPreferences.timeoutMinutes]);

  useEffect(() => {
    if (!isFocused) return;
    const ownsTag = (tag: string) => !!shellRef.current && Number(tag) === findNodeHandle(shellRef.current);
    const activity = DeviceEventEmitter.addListener("CharmShellInteraction", (tag: string) => {
      if (ownsTag(tag)) lastRailInteractionRef.current = Date.now();
    });
    const reveal = DeviceEventEmitter.addListener("CharmIconRailReveal", (tag: string) => { if (ownsTag(tag)) revealRail(); });
    return () => { activity.remove(); reveal.remove(); };
  }, [isFocused, revealRail]);

  useEffect(() => {
    if (!isFocused || !showIconRail || railPreferences.timeoutMinutes === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const remaining = railIdleRemainingMs(railPreferences.timeoutMinutes, lastRailInteractionRef.current, Date.now());
      if (remaining == null || cancelled) return;
      if (remaining > 0) { timer = setTimeout(() => void check(), remaining); return; }
      const observedActivity = lastRailInteractionRef.current;
      const tag = shellRef.current ? findNodeHandle(shellRef.current) : null;
      const safeToHide = tag ? await prepareIconRailHide(tag) : false;
      if (cancelled) return;
      if (safeToHide && observedActivity === lastRailInteractionRef.current) setRailTimedOut(true);
      else timer = setTimeout(() => void check(), 1000);
    };
    timer = setTimeout(() => void check(), railPreferences.timeoutMinutes * 60_000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isFocused, railPreferences.timeoutMinutes, showIconRail]);

  useEffect(() => {
    if (!isFocused) {
      lastIconRailFocusRequestRef.current = iconRailFocusRequest;
      railRevealPendingRef.current = false;
      return;
    }
    if (iconRailFocusRequest === lastIconRailFocusRequestRef.current && !railRevealPendingRef.current) return;
    if (!showIconRail) {
      if (iconRailFocusRequest !== lastIconRailFocusRequestRef.current) {
        lastIconRailFocusRequestRef.current = iconRailFocusRequest;
        revealRail();
      }
      return;
    }
    railRevealPendingRef.current = false;
    lastIconRailFocusRequestRef.current = iconRailFocusRequest;
    const node = iconRailRefs.current.get(active) || iconRailRefs.current.get(NAV[0].route);
    const cancelFocus = requestNativeFocusWithRetry(node, [0, 34, 100, 180], () => iconRailFocusOwnerRef.current !== null);
    return () => cancelFocus?.();
  }, [active, isFocused, showIconRail, iconRailFocusRequest, railFocusNonce, revealRail]);

  useEffect(() => {
    if (!isFocused || !showIconRail) {
      publishIconRailEntryTag(iconRailPublisher, undefined);
      return;
    }
    const node = iconRailRefs.current.get(active) || iconRailRefs.current.get(NAV[0].route);
    const tag = node ? findNodeHandle(node as any) : null;
    const published = tag || undefined;
    publishIconRailEntryTag(iconRailPublisher, published);
    return () => publishIconRailEntryTag(iconRailPublisher, undefined);
  }, [active, isFocused, showIconRail, iconRailPublisher, publishIconRailEntryTag]);

  useEffect(() => {
    if (!isFocused) return;
    const subscription = DeviceEventEmitter.addListener("CharmIconRailOpenMain", (tag: string) => {
      if (!shellRef.current || Number(tag) !== findNodeHandle(shellRef.current)) return;
      iconRailFocusOwnerRef.current = null;
      resetRemoteContextIfOwned("icon_rail", "default");
      onIconRailOpenMainDrawerRef.current?.();
      openDrawer();
    });
    return () => subscription.remove();
  }, [isFocused, openDrawer]);

  useEffect(() => addTvKeyListener((key) => {
    if (!isFocused || !iconRailFocusOwnerRef.current) return;
    // LEFT is the universal rail-to-drawer boundary. BACK remains supported
    // for the earlier compact-rail shortcut. RIGHT deliberately remains a
    // native focus transition, optionally pinned to the last page control via
    // nextFocusRight below; no stale JavaScript ref can strand focus off-screen.
    if (key !== "LEFT" && key !== "BACK") return;
    iconRailFocusOwnerRef.current = null;
    resetRemoteContextIfOwned("icon_rail", "default");
    onIconRailOpenMainDrawerRef.current?.();
    openDrawer();
  }), [isFocused, openDrawer]);

  // A rail removed while it held focus (route change, drawer, idle hide) never
  // reports blur. Drop its remote claim with it, or LEFT/BACK stay routed to it.
  const activeRouteRef = useRef(active);
  activeRouteRef.current = active;
  useEffect(() => {
    if (!showIconRail) return;
    return () => {
      if (iconRailFocusOwnerRef.current === null) return;
      iconRailFocusOwnerRef.current = null;
      const onGuide = activeRouteRef.current === "/guide";
      if (resetRemoteContextIfOwned("icon_rail", onGuide ? "guide" : "default") && onGuide) setGuideNavigationActive(true);
    };
  }, [showIconRail]);

  const railCanTakeFocusRef = useRef(false);
  railCanTakeFocusRef.current = active !== "/guide" && railPreferences.ready && railPreferences.enabled && !railTimedOut && !immersiveContent;

  useEffect(() => {
    if (!isFocused || !drawerOpen) return;
    setRemoteContext("main_drawer");
    if (active === "/guide") setGuideNavigationActive(false);
    const handleEdge = (key: string) => {
      if (key === "LEFT") {
        // The Guide has no rail here, and closing onto nothing would strand focus.
        if (!railCanTakeFocusRef.current) return;
        // The rail returns as soon as the drawer closes, so it can take focus.
        // This is a deliberate exit from the drawer: hold off the rail's own
        // auto-open, or the drawer would spring straight back.
        suppressRailAutoOpenUntilRef.current = Date.now() + RAIL_AUTO_OPEN_SUPPRESS_MS;
        closeDrawer({ force: true });
        requestAnimationFrame(() => focusIconRail());
        return;
      }
      if (key !== "RIGHT") return;
      if (active !== "/guide") {
        // MainActivity moves focus onto the page once the drawer has released it.
        closeDrawer({ force: true });
        return;
      }
          const now = Date.now();
          if (now - lastGuideDrawerTransferRef.current < GUIDE_DRAWER_TRANSFER_GUARD_MS) return;
          lastGuideDrawerTransferRef.current = now;
          // This is an intentional drawer-to-drawer boundary transition, not an
          // accidental close during animation. Main must be gone before Groups
          // becomes remote owner or both focus trees can be live at once.
          closeDrawer({ force: true });
          requestAnimationFrame(() => DeviceEventEmitter.emit("CharmGuideGroupsRequestOpen"));
    };
    const offKey = addTvKeyListener(handleEdge);
    const edge = DeviceEventEmitter.addListener("CharmDrawerEdge", handleEdge);
    // Android can move focus while the rail and drawer swap, so allow that moment.
    const openedAt = Date.now();
    const left = DeviceEventEmitter.addListener("CharmDrawerFocusLeft", () => {
      if (Date.now() - openedAt >= 700) closeDrawer({ force: true });
    });
    const off = () => { offKey(); edge.remove(); left.remove(); };
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
  }, [active, isFocused, closeDrawer, drawerOpen, focusIconRail]);

  useEffect(() => {
    if (!isFocused || !drawerOpen) {
      drawerFocusConfirmedRef.current = false;
      setDrawerAutoFocus(false);
      setDrawerPreferredRoute(null);
      return;
    }

    const { guideGroups: availableGuideGroups, activeGuideGroupName: currentGuideGroupName } =
      guideDrawerFocusSnapshotRef.current;
    const preferredGuideGroupName = !focusDrawerTop && active === "/guide"
      ? (availableGuideGroups?.some((item) => item.name === lastMainDrawerGroupName)
          ? lastMainDrawerGroupName : currentGuideGroupName)
      : null;
    const preferredRoute: Route | null = preferredGuideGroupName
      ? null : focusDrawerTop ? NAV[0].route : (lastMainDrawerRoute || active);
    if (focusDrawerTop) consumeFocusDrawerTop();
    setDrawerPreferredRoute(preferredRoute);
    setDrawerAutoFocus(true);
    drawerFocusConfirmedRef.current = false;
    // Android first drops focus on whichever drawer row is nearest the old
    // focus (over VOD that is Exit, bottom-left). Keep handing focus to the
    // intended row until it has really held focus once.
    drawerTargetRouteRef.current = preferredRoute;
    drawerTargetReachedRef.current = preferredRoute === null;
    const preferredNode = preferredGuideGroupName
      ? guideGroupRefs.current.get(preferredGuideGroupName)
      : preferredRoute
        ? navRefs.current.get(preferredRoute)
        : null;
    const cancelFocus = requestNativeFocusWithRetry(preferredNode, [0, 34, 100, PURPLE_DRAWER_ANIMATION_MS + 20, 380, 560], () => drawerFocusConfirmedRef.current && drawerTargetReachedRef.current);
    return () => {
      cancelFocus?.();
    };
  }, [active, isFocused, consumeFocusDrawerTop, drawerOpen, focusDrawerTop]);

  // Focus that leaves the drawer by any route closes it, so it can never sit
  // open behind a page or a second drawer that already owns the remote.
  const drawerBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDrawerBlurTimer = useCallback(() => {
    if (drawerBlurTimerRef.current) clearTimeout(drawerBlurTimerRef.current);
    drawerBlurTimerRef.current = null;
  }, []);
  useEffect(() => clearDrawerBlurTimer, [clearDrawerBlurTimer, drawerOpen]);

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
      const fromIndex = NAV.findIndex((item) => item.route === active);
      const toIndex = NAV.findIndex((item) => item.route === route);
      if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) requestRailTransfer(fromIndex, toIndex);
      if (route === "/guide") requestGuideGroupsOnEntry();

      requestAnimationFrame(() => {
        if (route === "/settings") DeviceEventEmitter.emit("CharmShowAllSettings");
        goToTab(router, route);
        // Guide opens onto its playlists so a group can be chosen before the
        // grid loads. requestGuideGroupsOnEntry covers the usual path; this
        // repeats the request once Guide is actually on screen, for the case
        // where its first focus ran before it could consume the flag.
        if (route === "/guide") {
          requestAnimationFrame(() => DeviceEventEmitter.emit("CharmGuideGroupsRequestOpen"));
        }
      });
    },
    [active, closeDrawer, pathname, requestRailTransfer, router],
  );

  useEffect(() => () => {
    if (deferredDrawerCloseTimer.current) clearTimeout(deferredDrawerCloseTimer.current);
  }, []);

  const exit = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (Platform.OS !== "web") BackHandler.exitApp();
  }, []);
  const pickPhoneMore = useCallback((target: PhoneMoreTarget) => {
    if (target === "exit") { closeDrawer({ force: true }); exit(); return; }
    if (target === "playlists") { closeDrawer({ force: true }); requestAnimationFrame(() => router.push("/playlists" as any)); return; }
    if (target === "account") {
      closeDrawer({ force: true });
      requestAnimationFrame(() => router.replace({ pathname: "/settings", params: { section: "account" } } as any));
      return;
    }
    navigate(target);
  }, [closeDrawer, exit, navigate, router]);
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

  // The icons alone do not tell a new viewer what each destination is, so
  // arriving on the rail opens the labelled main drawer by itself. The short
  // delay keeps a deliberate Right straight back into the page working, and the
  // suppression window stops the drawer's own Left-to-rail exit from bouncing
  // the drawer open again.
  const cancelRailAutoOpen = useCallback(() => {
    if (railAutoOpenTimerRef.current) clearTimeout(railAutoOpenTimerRef.current);
    railAutoOpenTimerRef.current = null;
  }, []);
  useEffect(() => cancelRailAutoOpen, [cancelRailAutoOpen]);

  const claimIconRail = useCallback((owner: Route | "power") => {
    iconRailFocusOwnerRef.current = owner;
    setRemoteContext("icon_rail");
    if (active === "/guide") setGuideNavigationActive(false);
    cancelRailAutoOpen();
    if (Date.now() < suppressRailAutoOpenUntilRef.current) return;
    railAutoOpenTimerRef.current = setTimeout(() => {
      railAutoOpenTimerRef.current = null;
      if (!iconRailFocusOwnerRef.current) return;
      iconRailFocusOwnerRef.current = null;
      resetRemoteContextIfOwned("icon_rail", "default");
      onIconRailOpenMainDrawerRef.current?.();
      openDrawer();
    }, RAIL_AUTO_OPEN_MS);
  }, [active, cancelRailAutoOpen, openDrawer]);

  const releaseIconRail = useCallback((owner: Route | "power") => {
    // Moving between rail items can report the new focus before the old blur,
    // so only the item that still owns the rail may cancel the pending open.
    if (iconRailFocusOwnerRef.current !== owner) return;
    cancelRailAutoOpen();
    iconRailFocusOwnerRef.current = null;
    if (resetRemoteContextIfOwned("icon_rail", active === "/guide" ? "guide" : "default") && active === "/guide") {
      setGuideNavigationActive(true);
    }
  }, [active, cancelRailAutoOpen]);

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
        onFocus={() => {
          if (!drawerOpen) return;
          if (item.route === drawerTargetRouteRef.current) drawerTargetReachedRef.current = true;
          // Only the viewer's own moves are remembered, never Android's stray first pick.
          if (drawerTargetReachedRef.current) lastMainDrawerRoute = item.route;
        }}
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
          <NavArt source={item.art} size={26} />
          {showWatching ? <WatchingDot testID="purple-nav-live-watching" /> : null}
        </View>
        <Text numberOfLines={1} style={[styles.navText, selected && styles.navTextSelected]}>{item.label}</Text>
        {selected ? <View style={styles.navCurrentDot} /> : null}
      </Pressable>
    );
  };

  return (
    <View
      testID="purple-tv-shell"
      ref={shellRef}
      collapsable={false}
      onTouchStart={() => { lastRailInteractionRef.current = Date.now(); }}
      style={[
        styles.root,
        styles.rootPhone,
        immersiveContent && { backgroundColor: "#000" },
        bottomBar && { flexDirection: "column" },
        {
          paddingTop: edges.padding.top + (phone && !immersiveContent ? insets.top : 0),
          paddingBottom: edges.padding.bottom + (phone && !immersiveContent ? insets.bottom : 0),
          paddingLeft: edges.padding.left + (phone && !immersiveContent ? insets.left : 0),
          paddingRight: edges.padding.right + (phone && !immersiveContent ? insets.right : 0),
          marginTop: edges.margin.top,
          marginBottom: edges.margin.bottom,
          marginLeft: edges.margin.left,
          marginRight: edges.margin.right,
        },
      ]}
    >
      {/* The crown background sits behind every screen, on a phone and on a TV. */}
      <PhoneBackdrop />
      {phone && isFocused && (drawerOpen || drawerVisible) ? (
        <View style={styles.phoneMoreLayer} pointerEvents={drawerOpen ? "auto" : "none"}>
          <PhoneMoreSheet progress={drawerProgress} onClose={() => closeDrawer({ force: true })} onPick={pickPhoneMore} />
        </View>
      ) : null}
      {!phone && isFocused && (drawerOpen || drawerVisible) ? <View style={styles.sidebarColumn}>
      <Animated.View
        pointerEvents={drawerOpen ? "auto" : "none"}
        style={[styles.sidebarOverlay, { transform: [{ translateX: drawerTranslateX }] }]}
      >
        <FocusGuide style={styles.sidebar} testID="purple-main-drawer" trapFocusUp trapFocusDown trapFocusLeft trapFocusRight={active !== "/vod"} onBlurCapture={() => {
          clearDrawerBlurTimer();
          if (!drawerOpen) return;
          drawerBlurTimerRef.current = setTimeout(() => closeDrawer({ force: true }), 160);
        }} onFocusCapture={() => {
          clearDrawerBlurTimer();
          if (!isFocused || !drawerOpen) return;
          // Android can restore a drawer child after Player changes the remote
          // owner. Reconcile real focus, otherwise Right is never sent to JS.
          iconRailFocusOwnerRef.current = null;
          setRemoteContext("main_drawer");
          if (active === "/guide") setGuideNavigationActive(false);
          drawerFocusConfirmedRef.current = true;
          setDrawerAutoFocus(false);
          setDrawerPreferredRoute(null);
        }}>

          <View style={styles.brand} pointerEvents="none">
            <View style={styles.brandMark}>
              <Image accessible={false} source={RAIL_CROWN} fadeDuration={0} resizeMode="contain" style={{ width: 20, height: 20 }} />
            </View>
            <View>
              <Text style={styles.brandTop}>CHARMING</Text>
              <Text style={styles.brandBottom}>MEDIALAB</Text>
            </View>
          </View>

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
                // Android ScrollView takes focus itself once its rows are unfocusable.
                // The closed drawer still lays out under the rail, and its traps then
                // hold every arrow key on an invisible list. scrollEnabled drives the
                // native focusable flag, so a closed drawer can never be a focus target.
                scrollEnabled={drawerOpen}
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
                    hasTVPreferredFocus={drawerAutoFocus && drawerPreferredRoute === null && item.name === (lastMainDrawerGroupName || activeGuideGroupName)}
                    onFocus={() => { if (drawerOpen) lastMainDrawerGroupName = item.name; }}
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
                scrollEnabled={drawerOpen}
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
            {/* Who is signed in. Only in the labelled drawer: the icon rail has
                no room for text and is meant to be glanceable. */}
            {user?.username ? (
              <View style={styles.signedInPill} testID="purple-nav-signed-in">
                <View style={styles.onlineDot} />
                <Text numberOfLines={1} style={styles.signedInName}>{user.username}</Text>
              </View>
            ) : null}
          </View>
        </FocusGuide>
      </Animated.View>
      </View> : null}
      {phone && !bottomBar && isFocused && !immersiveContent ? (
        <PhoneSideRail active={active} moreOpen={drawerOpen} onNavigate={(route) => navigate(route)} onMore={() => openDrawer({ force: true })} />
      ) : null}
      {!phone && showIconRail ? (
        <FocusGuide
          style={[styles.iconRail, active === "/guide" && !secondaryDrawerVisible && [styles.guideDrawerLayer, { left: edges.padding.left, top: edges.padding.top, bottom: edges.padding.bottom }]]}
          trapFocusUp
          trapFocusDown
          trapFocusLeft
          testID="purple-icon-rail"
        >
          <View style={styles.iconRailGlass} pointerEvents="none">
            <LinearGradient colors={["#5A22D6", "#2A0E86"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
          </View>
          <RailGlassBase width={PURPLE_ICON_RAIL_WIDTH} height={railHeight} running={showIconRail} />
          <View style={styles.iconRailBrand} pointerEvents="none">
            <Image accessible={false} accessibilityLabel="Charming MediaLab" source={RAIL_CROWN} fadeDuration={0} resizeMode="contain" style={styles.iconRailCrown} />
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
                  nativeID={selected ? "purple-icon-rail-selected" : undefined}
                  nextFocusRight={active === "/vod" ? undefined : contentReturnTag}
                  onFocus={() => { setRailFocusedRoute(item.route); claimIconRail(item.route); }}
                  onBlur={() => { setRailFocusedRoute((current) => current === item.route ? null : current); releaseIconRail(item.route); }}
                  onPress={() => { setRailPressToken((value) => value + 1); navigate(item.route, "rail"); }}
                  style={({ focused }: any) => [
                    styles.iconRailItem,
                    selected && styles.iconRailItemSelected,
                    focused && styles.iconRailItemFocused,
                  ]}
                  testID={`purple-icon-rail-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <RailChip
                    focused={railFocusedRoute === item.route}
                    active={selected}
                    pressToken={railPressToken}
                    size={{ width: 42, height: 40 }}
                  >
                    <RailIdle
                      kind={IDLE_FOR_ROUTE[item.route] ?? "none"}
                      running={showIconRail}
                      size={{ width: 42, height: 40 }}
                    >
                      <NavArt source={item.art} size={28} />
                    </RailIdle>
                  </RailChip>
                  {item.route === "/" && isWatching ? <WatchingDot /> : null}
                </Pressable>
              );
            })}
          </View>
          <Pressable
            focusable
            accessibilityLabel="Exit"
            nextFocusRight={active === "/vod" ? undefined : contentReturnTag}
            onFocus={() => claimIconRail("power")}
            onBlur={() => releaseIconRail("power")}
            onPress={promptHoldToExit}
            onLongPress={exit}
            delayLongPress={650}
            style={({ focused }: any) => [styles.iconRailPower, focused && styles.iconRailItemFocused]}
            testID="purple-icon-rail-power"
          >
            <Ionicons name="power-outline" size={22} color={tvColors.textMuted} />
          </Pressable>
          <RailEnergy
            fromIndex={railTransfer.from}
            toIndex={railTransfer.to}
            token={railTransfer.token}
            top={70}
            step={43}
            width={PURPLE_ICON_RAIL_WIDTH}
          />
          <RailGlassOverlay width={PURPLE_ICON_RAIL_WIDTH} height={railHeight} running={showIconRail} />
        </FocusGuide>
      ) : null}
      {secondaryDrawerVisible ? (
        <View style={styles.secondaryDrawerColumn}>{secondaryDrawer}</View>
      ) : null}
      {phone && isFocused && !drawerOpen && secondaryDrawer ? (
        <View style={[styles.guideDrawerLayer, { left: edges.padding.left, top: edges.padding.top, bottom: edges.padding.bottom }]}>
          {secondaryDrawer}
        </View>
      ) : null}
      <FocusGuide
        testID={active === "/guide" ? "purple-tv-guide-page" : "purple-tv-page"}
        style={[styles.content, phone && styles.contentPhone, contentStyle]}
        autoFocus={!drawerOpen && !secondaryDrawer && active !== "/guide" && active !== "/vod" && !immersiveContent}
        trapFocusUp={!drawerOpen && !secondaryDrawer && active !== "/guide" && active !== "/vod" && !immersiveContent}
        // Held upright on a phone the bottom bar is below the page, so Down must be allowed to reach it.
        trapFocusDown={!bottomBar && !drawerOpen && !secondaryDrawer && active !== "/guide" && active !== "/vod" && !immersiveContent}
        trapFocusRight={!drawerOpen && !secondaryDrawer && active !== "/guide" && active !== "/vod" && !immersiveContent}
        onFocusCapture={(event: any) => {
          const tag = Number(event?.nativeEvent?.target || event?.target || 0);
          if (tag > 0) setContentReturnTag((current) => current === tag ? current : tag);
        }}
      >
        {children}
      </FocusGuide>
      {bottomBar && isFocused ? (
        <PhoneBottomBar active={active} moreOpen={drawerOpen} onNavigate={(route) => navigate(route)} onMore={() => openDrawer({ force: true })} />
      ) : null}
      {!immersiveContent && headerRight ? <View style={styles.headerRight}>{headerRight}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: glass.page, overflow: "hidden" },
  rootPhone: { backgroundColor: "#0B0420" },
  phoneMoreLayer: { ...StyleSheet.absoluteFillObject, zIndex: 30 },
  // The column reserves the drawer's width in the shell row, so the page moves
  // over instead of being covered; the panel inside it slides on a transform.
  sidebarColumn: { width: PURPLE_SIDEBAR_WIDTH, flexShrink: 0, alignSelf: "stretch" },
  sidebarOverlay: { position: "absolute", left: 0, top: 0, bottom: 0, width: PURPLE_SIDEBAR_WIDTH, zIndex: 20 },
  guideDrawerLayer: { position: "absolute", zIndex: 15 },
  // In flow beside the rail: its width comes out of the page, not over it.
  secondaryDrawerColumn: { flexShrink: 0, alignSelf: "stretch", justifyContent: "center", marginLeft: 6, marginVertical: 6 },
  // A floating rounded violet glass bar with a lit edge (as in the approved design), not a flat near-black strip.
  iconRail: {
    width: PURPLE_ICON_RAIL_WIDTH,
    alignSelf: "stretch",
    flexShrink: 0,
    alignItems: "center",
    backgroundColor: "#2F1770",
    borderWidth: 2,
    borderColor: "rgba(235,205,255,0.45)",
    borderRadius: 28,
    overflow: "hidden",
    marginVertical: 6,
    marginLeft: 6,
    paddingTop: 10,
    paddingBottom: 8,
    shadowColor: glass.glow,
    elevation: 0,
  },
  iconRailCrown: { width: 38, height: 43 },
  // Treatment C: a gradient body, a lit line just inside the top edge and a
  // rim light down the left side. Four static layers, no blur, no shadow.
  iconRailGlass: { ...StyleSheet.absoluteFillObject, borderRadius: 26 },
  // Everything below is painted ABOVE the icons: that is what makes them read
  // as sitting behind the glass rather than printed on it.
  iconRailSheen: { position: "absolute", left: 0, right: 0, top: 0, height: "52%" },
  iconRailStreak: {
    position: "absolute",
    left: -40,
    right: -40,
    top: 120,
    height: 44,
    backgroundColor: "rgba(255,255,255,0.13)",
    transform: [{ rotate: "-18deg" }],
  },
  iconRailCap: {
    position: "absolute",
    left: 4,
    right: 4,
    top: 3,
    height: 14,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  iconRailInnerEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: "rgba(16,4,44,0.42)",
  },
  iconRailTopSheen: {
    position: "absolute",
    left: 11,
    right: 11,
    top: 5,
    height: 2,
    borderRadius: 2,
    backgroundColor: "rgba(255,245,255,0.55)",
  },
  iconRailRimLight: {
    position: "absolute",
    left: 1,
    top: 46,
    bottom: 46,
    width: 2,
    borderRadius: 2,
    backgroundColor: "rgba(226,196,255,0.34)",
  },
  iconRailBrand: {
    width: 42,
    height: 48,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    marginBottom: 4,
  },
  iconRailItems: { flex: 1, minHeight: 0, alignItems: "center", gap: 3 },
  iconRailItem: {
    width: 42,
    minHeight: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    // No fill and no border when unselected: the icons float in the glass
    // instead of sitting in little purple boxes.
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  iconRailItemSelected: { backgroundColor: "rgba(20,4,70,0.55)", borderColor: "rgba(255,255,255,0.95)" },
  iconRailItemFocused: glassFocus,
  iconRailPower: {
    width: 42,
    minHeight: 40,
    borderRadius: 10,
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
    backgroundColor: glass.drawer,
    // A solid violet drawer with a lit edge and rounded outer corners, like the More sheet.
    borderWidth: 2,
    borderLeftWidth: 0,
    borderColor: "rgba(235,205,255,0.45)",
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
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
  navListContent: { gap: 3, paddingBottom: 2 },
  navRow: {
    minHeight: 35,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(235,205,255,0.26)",
    backgroundColor: "rgba(190,140,255,0.14)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 9,
    marginBottom: 3,
  },
  navRowSelected: { backgroundColor: glass.selected, borderColor: glass.selectedEdge },
  navRowActiveMark: { borderWidth: 1 },
  navRowFocused: glassFocus,
  navIconWrap: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  navCurrentDot: { width: 5, height: 5, borderRadius: 3, marginLeft: "auto", backgroundColor: glass.pink, shadowColor: glass.glow, elevation: 0 },
  watchingDot: {
    position: "absolute",
    top: -1,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tvColors.purpleBright,
  },
  navText: { color: "#E9DCFF", fontFamily: fonts.medium, fontSize: 11.5 },
  navTextSelected: { color: "#fff", fontFamily: fonts.semibold },
  sidebarFooter: {
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: glass.edgeSoft,
    paddingTop: 6,
    backgroundColor: glass.drawer,
  },
  sidebarFooterRow: { flexDirection: "row", gap: 4 },
  power: {
    minHeight: 30,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: glass.buttonEdge,
    backgroundColor: glass.button,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 9,
  },
  powerText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 9.5 },
  // Same glass as the rest of the drawer: a translucent violet capsule with a
  // lit edge, and a live dot so it reads as "signed in", not just a label.
  signedInPill: {
    marginTop: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: glass.edgeSoft,
    backgroundColor: "rgba(190,140,255,0.13)",
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#34D399",
    borderWidth: 1,
    borderColor: "rgba(190,255,225,0.75)",
  },
  signedInName: { flex: 1, minWidth: 0, color: "#E9DCFF", fontFamily: fonts.medium, fontSize: 9.5 },
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
  content: { flex: 1, backgroundColor: glass.page },
  contentPhone: { backgroundColor: "transparent" },
  drawerScrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 19, backgroundColor: "rgba(4,1,12,0.55)" },
  phoneBar: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 58,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
    backgroundColor: glass.rail,
    borderTopWidth: 1,
    borderTopColor: glass.edgeSoft,
  },
  phoneBarItem: { flex: 1, minWidth: 0, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 2, borderWidth: 1, borderColor: "transparent" },
  phoneBarItemSelected: { backgroundColor: "rgba(140,70,240,0.55)", borderColor: glass.selectedEdge },
  phoneBarLabel: { color: "#CDBFE6", fontFamily: fonts.medium, fontSize: 10 },
  phoneBarLabelSelected: { color: "#fff", fontFamily: fonts.semibold },
  headerRight: { position: "absolute", top: 10, right: spacing.lg },
});
