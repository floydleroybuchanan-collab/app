import { Stack, usePathname, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect } from "react";
import { LogBox, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { GuideProvider, useStore, type StartScreen } from "@/src/store";
import { ProgramModal } from "@/src/components/ProgramModal";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { PointerOverlay } from "@/src/components/PointerOverlay";
import { PurpleTvDrawerProvider } from "@/src/components/PurpleTvShell";
import { SourceRefreshScheduler } from "@/src/components/SourceRefreshScheduler";
import { TvQuickActionsOverlay } from "@/src/components/TvQuickActionsOverlay";
import { TvCalibrationFrame, TvCalibrationProvider } from "@/src/tvCalibration";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { StartupVersion4 } from "@/src/components/StartupVersion4";
import { storage } from "@/src/utils/storage";
import { AuthProvider } from "@/src/auth/AuthContext";
import { AccountGate } from "@/src/components/AccountGate";

const START_SCREEN_KEY = "gs_start_screen";

function resolveStartupScreen(value: unknown): StartScreen {
  return value === "guide" || value === "last_channel" || value === "home" ? value : "home";
}

// Keep real errors visible for TV QA; only silence known noisy module warnings.
LogBox.ignoreLogs([
  "SafeAreaView has been deprecated",
  "Require cycle:",
]);
SplashScreen.preventAutoHideAsync();

function NotificationRouter() {
  const router = useRouter();
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const channelId = resp.notification.request.content.data?.channelId as string | undefined;
      if (channelId) {
        openFullscreenPlayer(router, channelId);
      }
    });
    return () => sub.remove();
  }, [router]);
  return null;
}

function ReminderCleanup() {
  const pathname = usePathname();
  const { reminders, removeReminder } = useStore();

  useEffect(() => {
    if (reminders.length === 0 || pathname?.startsWith("/player")) return;
    // Expire due reminders only outside fullscreen playback. OS notification
    // delivery remains independent; this cleanup is maintenance, not playback work.
    // Notification tap handling (NotificationRouter) is the user-driven switch path.
    const check = () => {
      const now = Date.now();
      for (const reminder of reminders) {
        const start = Date.parse(reminder.start);
        const stop = reminder.stop ? Date.parse(reminder.stop) : start + 2 * 60 * 60 * 1000;
        if (!Number.isFinite(start)) continue;
        if (now > stop) {
          removeReminder(reminder.key).catch(() => {});
        }
      }
    };
    check();
    // Slow interval — reminders are sparse; avoid wakeups on weak boxes.
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [pathname, reminders, removeReminder]);

  return null;
}

function StartScreenRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const { lastChannelId, loading, startScreen } = useStore();
  const [startupPreference, setStartupPreference] = React.useState<StartScreen | null>(null);
  const [startupPreferencesReady, setStartupPreferencesReady] = React.useState(false);
  const doneRef = React.useRef(false);
  const persistenceChainRef = React.useRef<Promise<void>>(Promise.resolve());
  const lastQueuedStartScreenRef = React.useRef<StartScreen | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = resolveStartupScreen(await storage.getItem<string>(START_SCREEN_KEY, "home"));
      if (!active) return;
      setStartupPreference(stored);
      setStartupPreferencesReady(true);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // Store hydration reads gs_start_screen before loading can become false.
    // Once hydrated, serialize writes so rapid Settings edits cannot finish out
    // of order. Retry one silent AsyncStorage failure without creating a timer,
    // polling loop, or repeated Guide/EPG/cache work.
    if (loading) return;
    const next = resolveStartupScreen(startScreen);
    if (lastQueuedStartScreenRef.current === next) return;
    lastQueuedStartScreenRef.current = next;
    persistenceChainRef.current = persistenceChainRef.current.then(async () => {
      const saved = await storage.setItem(START_SCREEN_KEY, next);
      if (!saved) await storage.setItem(START_SCREEN_KEY, next);
    });
  }, [loading, startScreen]);

  useEffect(() => {
    if (doneRef.current || !startupPreferencesReady || !startupPreference) return;
    if (pathname && pathname !== "/" && pathname !== "/index") return;

    if (startupPreference === "guide") {
      doneRef.current = true;
      router.replace("/guide" as any);
      return;
    }

    if (startupPreference === "last_channel") {
      // Last-channel playback needs the channel catalog hydrated first. If no
      // remembered channel exists, Guide is the deterministic fallback.
      if (loading) return;
      doneRef.current = true;
      if (lastChannelId) openFullscreenPlayer(router, lastChannelId);
      else router.replace("/guide" as any);
      return;
    }

    doneRef.current = true;
  }, [lastChannelId, loading, pathname, router, startupPreference, startupPreferencesReady]);

  return null;
}

export default function RootLayout() {
  const [iconsLoaded, iconErr] = useIconFonts();
  const [fontsLoaded, fontErr] = useAppFonts();
  const { width, height } = useWindowDimensions();

  const ready = (iconsLoaded || iconErr) && (fontsLoaded || fontErr);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, width, height, overflow: "visible", backgroundColor: "transparent" }}>
      <SafeAreaProvider>
        <StatusBar hidden />
        <AuthProvider>
          <AccountGate>
            <TvCalibrationProvider>
              <TvCalibrationFrame>
                <GuideProvider>
                  <PurpleTvDrawerProvider>
                    <NotificationRouter />
                    <SourceRefreshScheduler />
                    <ReminderCleanup />
                    <StartScreenRedirect />
                    <ErrorBoundary>
                      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#070711" } }}>
                        <Stack.Screen name="(tabs)" />
                        <Stack.Screen name="player" options={{ animation: "none", contentStyle: { backgroundColor: "#000" } }} />
                      </Stack>
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <ProgramModal />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <TvQuickActionsOverlay />
                    </ErrorBoundary>
                    <PointerOverlay />
                    <StartupVersion4 />
                  </PurpleTvDrawerProvider>
                </GuideProvider>
              </TvCalibrationFrame>
            </TvCalibrationProvider>
          </AccountGate>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
