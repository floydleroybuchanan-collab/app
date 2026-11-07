import { useCallback, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import {
  normalizeParentalPin,
  setParentalPinMemory,
  verifyParentalPin as verifyParentalPinCore,
} from "./parentalPinCore";

const PIN_KEY = "gs_parental_pin";
const LOCKED_GROUPS_KEY = "gs_parental_locked_groups";

/** Session unlocks — cleared when app process dies. */
const sessionUnlocked = new Set<string>();

type Snapshot = {
  pin: string | null;
  lockedGroups: string[];
};

let cached: Snapshot = { pin: null, lockedGroups: [] };
let loaded = false;
let loadPromise: Promise<Snapshot> | null = null;
let mutationEpoch = 0;
const listeners = new Set<(value: Snapshot) => void>();
let writeQueue: Promise<void> = Promise.resolve();

function serializeWrite(action: () => Promise<void>): Promise<void> {
  const next = writeQueue.catch(() => undefined).then(action);
  writeQueue = next.catch(() => undefined);
  return next;
}

function emit() {
  for (const listener of Array.from(listeners)) {
    try {
      listener(cached);
    } catch {}
  }
}

async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const loadEpoch = mutationEpoch;
  loadPromise = (async () => {
    const securePin = normalizeParentalPin(await storage.secureGet<string>(PIN_KEY, ""));
    const plainPin = normalizeParentalPin(await storage.getItem<string>(PIN_KEY, ""));
    const locked = await storage.getItem<string[]>(LOCKED_GROUPS_KEY, []);
    const pin = securePin || plainPin;
    const next: Snapshot = {
      pin,
      lockedGroups: Array.isArray(locked) ? locked.filter((item) => typeof item === "string").slice(0, 40) : [],
    };
    if (loaded || loadEpoch !== mutationEpoch) return cached;
    setParentalPinMemory(pin);
    cached = next;
    loaded = true;
    return cached;
  })();
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export function verifyParentalPin(candidate: string): boolean {
  return verifyParentalPinCore(candidate);
}

export function setParentalPin(pin: string | null): Promise<void> {
  return serializeWrite(async () => {
    await load();
    const next = normalizeParentalPin(pin);
    if (pin !== null && !next) throw new Error("PIN must contain 4–8 digits.");
    if (next) {
      if (!await storage.secureSet(PIN_KEY, next)) throw new Error("The PIN could not be saved securely. Please try again.");
      await storage.removeItem(PIN_KEY);
    } else {
      if (!await storage.removeItem(PIN_KEY) || !await storage.secureRemove(PIN_KEY)) throw new Error("The PIN could not be cleared. Please try again.");
    }
    mutationEpoch += 1;
    setParentalPinMemory(next);
    cached = { ...cached, pin: next };
    loaded = true;
    sessionUnlocked.clear();
    emit();
  });
}

export function setLockedGroups(groups: string[]): Promise<void> {
  return serializeWrite(async () => {
    await load();
    const next = Array.from(new Set(groups.filter(group => typeof group === "string" && !!group))).slice(0, 40);
    if (!await storage.setItem(LOCKED_GROUPS_KEY, next)) throw new Error("Locked groups could not be saved. Please try again.");
    mutationEpoch += 1;
    cached = { ...cached, lockedGroups: next };
    loaded = true;
    for (const group of sessionUnlocked) if (!next.includes(group)) sessionUnlocked.delete(group);
    emit();
  });
}

export function useParentalPin() {
  const [value, setValue] = useState(cached);
  const [, setTick] = useState(0);
  useEffect(() => {
    let mounted = true;
    void load().then((next) => {
      if (mounted) setValue(next);
    });
    const listener = (next: Snapshot) => {
      if (mounted) {
        setValue(next);
        setTick((n) => n + 1);
      }
    };
    listeners.add(listener);
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  return {
    ready: loaded,
    hasPin: !!value.pin,
    lockedGroups: value.lockedGroups,
    isGroupLocked: useCallback(
      (group: string) => {
        if (!value.pin) return false;
        if (!value.lockedGroups.includes(group)) return false;
        return !sessionUnlocked.has(group);
      },
      [value.lockedGroups, value.pin],
    ),
    setPin: useCallback((pin: string | null) => setParentalPin(pin), []),
    setLockedGroups: useCallback((groups: string[]) => setLockedGroups(groups), []),
    unlockGroup: useCallback((group: string) => {
      if (cached.lockedGroups.includes(group)) sessionUnlocked.add(group);
      setTick((n) => n + 1);
      emit();
    }, []),
    verifyPin: verifyParentalPin,
    lockSession: useCallback(() => {
      sessionUnlocked.clear();
      setTick((n) => n + 1);
      emit();
    }, []),
  };
}

/** Used by alternate playback entry points before opening a channel. */
export async function isPlaybackGroupLocked(groups: string[]): Promise<boolean> {
  const state = await load();
  return !!state.pin && groups.some(group => state.lockedGroups.includes(group) && !sessionUnlocked.has(group));
}
