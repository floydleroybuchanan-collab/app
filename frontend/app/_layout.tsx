import { Stack, usePathname, useRouter } from "expo-router";
import { AppUpdateNotice } from "@/src/components/AppUpdateNotice";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect } from "react";
import { LogBox, NativeModules, Platform, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { GuideProvider, useStore } from "@/src/store";
import { ProgramModal } from "@/src/components/ProgramModal";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { PointerOverlay } from "@/src/components/PointerOverlay";
import { PurpleTvDrawerProvider } from "@/src/components/PurpleTvShell";
import { SourceRefreshScheduler } from "@/src/components/SourceRefreshScheduler";
import { TvQuickActionsOverlay } from "@/src/components/TvQuickActionsOverlay";
import { TvCalibrationFrame, TvCalibrationProvider } from "@/src/tvCalibration";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { StartupVersion4 } from "@/src/components/StartupVersion4";
import { startupTarget } from "@/src/core/startDestinations";
import { shouldUseTvLayout } from "@/src/utils/tvLayout";
import { useAppPolicy } from "@/src/core/useAppPolicy";
import { AuthProvider } from "@/src/auth/AuthContext";
import { AccountGate } from "@/src/components/AccountGate";

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

function StartScreenRedirect({ startupComplete }: { startupComplete: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { lastChannelId, loading, startScreen, channels, deviceLayoutMode, startupReady } = useStore();
  const policy = useAppPolicy();
  const done = React.useRef(false);
  useEffect(() => {
    if (done.current || loading || !startupReady || !startupComplete) return;
    done.current = true;
    // An explicit destination already opened during startup takes precedence.
    if (pathname && pathname !== "/" && pathname !== "/index") return;
    const target = startupTarget(startScreen, {
      nativeVod: Platform.OS === "android" && !!NativeModules.CharmVod,
      multiviewAllowed: Platform.OS === "android" && shouldUseTvLayout(deviceLayoutMode) && policy.multiview_max > 0,
      channelIds: channels.map(channel => channel.id), lastChannelId,
    });
    if (target.channelId) openFullscreenPlayer(router, target.channelId);
    else if (target.route !== "/") router.replace(target.route as any);
  }, [startupComplete, startupReady, loading, startScreen, channels, lastChannelId, deviceLayoutMode, pathname, policy.multiview_max, router]);
  return null;
}

function StartupCoordinator() {
  const [complete, setComplete] = React.useState(false);
  const finish = React.useCallback(() => setComplete(true), []);
  return <><StartScreenRedirect startupComplete={complete} /><StartupVersion4 onComplete={finish} /></>;
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
                    <AppUpdateNotice />
                    <ErrorBoundary>
                      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0B0C12" } }}>
                        <Stack.Screen name="(tabs)" />
                        <Stack.Screen name="player" options={{ animation: "none", contentStyle: { backgroundColor: "#000" } }} />
                        <Stack.Screen name="multiview" options={{ animation: "none", contentStyle: { backgroundColor: "#000" } }} />
                      </Stack>
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <ProgramModal />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <TvQuickActionsOverlay />
                    </ErrorBoundary>
                    <PointerOverlay />
                    <StartupCoordinator />
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
