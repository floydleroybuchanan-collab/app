import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { requestNativeFocusWithRetry } from '@/src/utils/tvFocus';

/** Establish a real control as focus owner after layout, transitions and resume. */
export function useTVFocusEntry(enabled: boolean, revision: unknown) {
  const entryRef = useRef<any>(null);
  const fallbackRef = useRef<any>(null);
  const lastTarget = useRef<number | null>(null);
  const confirmed = useRef(false);
  const active = useRef(enabled);
  const cancel = useRef<(() => void) | undefined>(undefined);
  const previousRevision = useRef(revision);
  active.current = enabled;
  const claim = useCallback(() => {
    if (!active.current || (Platform.OS !== 'android' && !Platform.isTV) || confirmed.current) return;
    cancel.current?.();
    let attempt = 0;
    cancel.current = requestNativeFocusWithRetry(
      () => (++attempt <= 2 ? lastTarget.current : null) ?? entryRef.current ?? fallbackRef.current,
      [0, 40, 120, 300, 650, 1200],
      () => !active.current || confirmed.current,
    );
  }, []);
  useEffect(() => {
    if (previousRevision.current !== revision) lastTarget.current = null;
    previousRevision.current = revision;
    confirmed.current = false;
    claim();
    return () => cancel.current?.();
  }, [enabled, revision, claim]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { confirmed.current = false; claim(); }
      else cancel.current?.();
    });
    return () => { subscription.remove(); cancel.current?.(); };
  }, [claim]);
  const onFocusCapture = useCallback((event: any) => {
    const target = event.nativeEvent?.target;
    if (typeof target === 'number') lastTarget.current = target;
    confirmed.current = true;
    cancel.current?.();
  }, []);
  return { entryRef, fallbackRef, onFocusCapture, onLayout: claim };
}
