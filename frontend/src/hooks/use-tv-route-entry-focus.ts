import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";

const ROUTE_ENTRY_RETRIES_MS = [0, 70, 160, 320, 560];

/**
 * Gives an active TV route one deterministic initial focus owner. The request
 * remains armed until native onFocus confirms it; it is never dropped merely
 * because a slower Android TV box took longer than an arbitrary timer.
 */
export function useTvRouteEntryFocus(enabled = true, focusKey: unknown = "default") {
  const targetRef = useRef<unknown>(null);
  const confirmedRef = useRef(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const [preferredFocus, setPreferredFocus] = useState(enabled);

  useFocusEffect(
    useCallback(() => {
      void focusKey;
      cancelRef.current?.();
      cancelRef.current = null;
      if (!enabled) {
        confirmedRef.current = false;
        setPreferredFocus(false);
        return undefined;
      }
      if (confirmedRef.current) {
        setPreferredFocus(false);
        return () => { confirmedRef.current = false; };
      }
      setPreferredFocus(true);
      const cancel = requestNativeFocusWithRetry(
        () => targetRef.current,
        ROUTE_ENTRY_RETRIES_MS,
        () => confirmedRef.current,
      );
      cancelRef.current = cancel;
      return () => {
        cancel();
        if (cancelRef.current === cancel) cancelRef.current = null;
        confirmedRef.current = false;
      };
    }, [enabled, focusKey]),
  );

  const onFocus = useCallback(() => {
    confirmedRef.current = true;
    cancelRef.current?.();
    cancelRef.current = null;
    setPreferredFocus(false);
  }, []);

  const onBlur = useCallback(() => {
    confirmedRef.current = false;
  }, []);

  const isFocused = useCallback(() => confirmedRef.current, []);
  return { targetRef, preferredFocus, onFocus, onBlur, isFocused };
}
