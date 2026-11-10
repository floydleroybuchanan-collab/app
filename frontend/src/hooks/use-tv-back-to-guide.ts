import React from "react";
import { BackHandler, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { goToTab } from "@/src/utils/goToTab";

/** Hardware BACK handler is active only while its page is focused. */
export function useTvBackHandler(onBack: () => boolean, enabled = true) {
  useFocusEffect(
    React.useCallback(() => {
      if (!enabled || Platform.OS === "web") return;
      // One press moves one navigation layer. The Guide group drawer remembers
      // its last focused tab; double-press timing used to make this feel stuck.
      const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
      return () => sub.remove();
    }, [enabled, onBack]),
  );
}

// On living-room devices, BACK should feel predictable. In secondary tabs,
// BACK returns to the guide instead of bouncing out of the app.
export function useTvBackToGuide(enabled = true) {
  const router = useRouter();

  useTvBackHandler(
    React.useCallback(() => {
      goToTab(router, "/guide");
      return true;
    }, [router]),
    enabled,
  );
}
