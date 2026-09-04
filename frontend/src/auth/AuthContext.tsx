import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { getCurrentAccount, loginToAccount, logoutAccount, type AccountUser } from "@/src/auth/accountApi";
import { storage } from "@/src/utils/storage";

export const ACCOUNT_SESSION_TOKEN_KEY = "charm_account_session_token_v1";
const SESSION_RECHECK_MS = 5 * 60_000;

type AuthStatus = "restoring" | "signed_out" | "signed_in" | "unavailable";

type AuthContextValue = {
  status: AuthStatus;
  user: AccountUser | null;
  notice: string | null;
  signIn: (username: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  retryRestore: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("restoring");
  const [user, setUser] = useState<AccountUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const validationRef = useRef<Promise<void> | null>(null);
  const lastValidatedAtRef = useRef(0);

  const clearLocalSession = useCallback(async (message?: string) => {
    tokenRef.current = null;
    lastValidatedAtRef.current = 0;
    setUser(null);
    setNotice(message || null);
    setStatus("signed_out");
    await storage.secureRemove(ACCOUNT_SESSION_TOKEN_KEY);
  }, []);

  const validateToken = useCallback(async (token: string, restoring = false) => {
    const result = await getCurrentAccount(token);
    if (result.response?.status === 401) {
      await clearLocalSession("Your session expired or was revoked. Please sign in again.");
      return;
    }
    if (!result.response || !result.response.ok || !result.data.success || !result.data.user) {
      const message = result.data.error || "Unable to verify your account right now.";
      if (restoring) {
        tokenRef.current = token;
        setUser(null);
        setNotice(message);
        setStatus("unavailable");
      } else {
        // A transient refresh failure must not eject a currently authenticated
        // viewer. Only an authoritative 401 clears the secure session.
        setNotice(message);
      }
      return;
    }
    tokenRef.current = token;
    lastValidatedAtRef.current = Date.now();
    setUser(result.data.user);
    setNotice(null);
    setStatus("signed_in");
  }, [clearLocalSession]);

  const restore = useCallback(async () => {
    setStatus("restoring");
    setNotice(null);
    const stored = await storage.secureGet<string | null>(ACCOUNT_SESSION_TOKEN_KEY, null);
    if (!stored) {
      tokenRef.current = null;
      setUser(null);
      setStatus("signed_out");
      return;
    }
    await validateToken(stored, true);
  }, [validateToken]);

  useEffect(() => {
    void restore();
  }, [restore]);

  const revalidate = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || validationRef.current) return validationRef.current || Promise.resolve();
    const run = validateToken(token).finally(() => {
      validationRef.current = null;
    });
    validationRef.current = run;
    return run;
  }, [validateToken]);

  useEffect(() => {
    if (status !== "signed_in") return;
    const interval = setInterval(() => void revalidate(), SESSION_RECHECK_MS);
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      if (Date.now() - lastValidatedAtRef.current < 30_000) return;
      void revalidate();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [revalidate, status]);

  const signIn = useCallback(async (username: string, password: string) => {
    setNotice(null);
    const result = await loginToAccount(username.trim(), password);
    if (!result.response || !result.response.ok || !result.data.success || !result.data.token || !result.data.user) {
      return result.data.error || "Unable to sign in.";
    }
    const saved = await storage.secureSet(ACCOUNT_SESSION_TOKEN_KEY, result.data.token);
    if (!saved) {
      void logoutAccount(result.data.token);
      return "This device could not securely save the session. Please try again.";
    }
    tokenRef.current = result.data.token;
    lastValidatedAtRef.current = Date.now();
    setUser(result.data.user);
    setStatus("signed_in");
    return null;
  }, []);

  const signOut = useCallback(async () => {
    const token = tokenRef.current;
    await clearLocalSession();
    if (token) void logoutAccount(token);
  }, [clearLocalSession]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    notice,
    signIn,
    signOut,
    retryRestore: restore,
  }), [notice, restore, signIn, signOut, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
