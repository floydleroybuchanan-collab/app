import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, NativeModules } from "react-native";

import {
  generateReferralInvite,
  deleteReferralInviteHistory,
  getCurrentAccount,
  getManagedContentAccess,
  getReferralSummary,
  loginToAccount,
  logoutAccount,
  permanentlyCancelAccount,
  registerAccountWithInvite,
  type AccountUser,
  type ReferralSummary,
} from "@/src/auth/accountApi";
import { clearManagedContentAccess, configureManagedContentAccess } from "@/src/auth/managedContentAccess";
import { storage } from "@/src/utils/storage";
import { forgetRememberedLogin, saveRememberedLogin } from "./rememberedLogin";
import { clearProviderMedia } from "@/src/core/providerMediaSession";

export const ACCOUNT_SESSION_TOKEN_KEY = "charm_account_session_token_v1";
const SESSION_RECHECK_MS = 5 * 60_000;

type AuthStatus = "restoring" | "signed_out" | "signed_in" | "unavailable";

type AuthContextValue = {
  status: AuthStatus;
  user: AccountUser | null;
  notice: string | null;
  signIn: (username: string, password: string, rememberLogin?: boolean) => Promise<string | null>;
  register: (inviteCode: string, username: string, email: string, password: string, challengeToken?: string) => Promise<string | null>;
  loadReferrals: () => Promise<{ data: ReferralSummary | null; error: string | null }>;
  createReferral: () => Promise<{ data: ReferralSummary | null; error: string | null }>;
  deleteReferral: (invitationId: string) => Promise<{ data: ReferralSummary | null; error: string | null }>;
  cancelAccount: (password: string) => Promise<string | null>;
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
  const sessionEpoch = useRef(0);
  const sessionWrites = useRef<Promise<void>>(Promise.resolve());

  // SecureStore writes may finish after logout or a newer login. Keep their
  // order explicit so an older token can never overwrite the newer session.
  const serializeSessionWrite = useCallback((operation: () => Promise<void>) => {
    const next = sessionWrites.current.catch(() => undefined).then(operation);
    sessionWrites.current = next.catch(() => undefined);
    return next;
  }, []);

  const clearLocalSession = useCallback(async (message?: string, forgetLogin = false) => {
    sessionEpoch.current += 1;
    clearProviderMedia();
    tokenRef.current = null;
    NativeModules.CharmVod?.setUsageSession?.(null);
    clearManagedContentAccess();
    lastValidatedAtRef.current = 0;
    setUser(null);
    setNotice(message || null);
    setStatus("signed_out");
    await serializeSessionWrite(async () => {
      await storage.secureRemove(ACCOUNT_SESSION_TOKEN_KEY);
      if (forgetLogin) await forgetRememberedLogin();
    });
  }, [serializeSessionWrite]);

  const validateToken = useCallback(async (token: string, restoring = false) => {
    const epoch = sessionEpoch.current;
    const current = () => sessionEpoch.current === epoch && tokenRef.current === token;
    if (!current()) return;
    const result = await getCurrentAccount(token);
    if (!current()) return;
    if (result.response?.status === 401 || result.response?.status === 403) {
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
    let sourceNotice: string | null = null;
    {
      const content = await getManagedContentAccess(token);
      if (!current()) return;
      if (content.response?.status === 401 || content.response?.status === 403) {
        await clearLocalSession("Your session expired or was revoked. Please sign in again.");
        return;
      }
      if (!content.response?.ok || !content.data.success || !content.data.content || !configureManagedContentAccess(content.data.content)) {
        sourceNotice = "Supplied sources are temporarily unavailable. Your personal playlists remain available in Settings → Playlists.";
      }
    }
    tokenRef.current = token;
    NativeModules.CharmVod?.setUsageSession?.(token);
    lastValidatedAtRef.current = Date.now();
    setUser(result.data.user);
    setNotice(sourceNotice);
    setStatus("signed_in");
  }, [clearLocalSession]);

  const restore = useCallback(async () => {
    const epoch = ++sessionEpoch.current;
    setStatus("restoring");
    setNotice(null);
    await sessionWrites.current;
    if (sessionEpoch.current !== epoch) return;
    const stored = await storage.secureGet<string | null>(ACCOUNT_SESSION_TOKEN_KEY, null);
    if (sessionEpoch.current !== epoch) return;
    if (!stored) {
      tokenRef.current = null;
      setUser(null);
      setStatus("signed_out");
      return;
    }
    tokenRef.current = stored;
    await validateToken(stored, true);
  }, [validateToken]);

  useEffect(() => {
    void restore();
    return () => { sessionEpoch.current += 1; tokenRef.current = null; };
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
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void revalidate();
    }, SESSION_RECHECK_MS);
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

  const acceptAuthenticatedResult = useCallback(async (
    result: Awaited<ReturnType<typeof registerAccountWithInvite>>,
    epoch: number,
    rememberedLogin?: { username: string; password: string; remember: boolean },
  ): Promise<string | null> => {
    const current = () => sessionEpoch.current === epoch;
    const superseded = () => {
      if (result.data.token) void logoutAccount(result.data.token);
      return "This sign-in request is no longer active. Please try again.";
    };
    if (!current()) return superseded();
    if (!result.response || !result.response.ok || !result.data.success || !result.data.token || !result.data.user) {
      return result.data.error || "Unable to sign in.";
    }
    const content = await getManagedContentAccess(result.data.token);
    if (!current()) return superseded();
    if (content.response?.status === 401 || content.response?.status === 403) {
      void logoutAccount(result.data.token);
      return "Your session expired. Please sign in again.";
    }
    let saved = false;
    let remembered = true;
    await serializeSessionWrite(async () => {
      if (!current()) return;
      saved = await storage.secureSet(ACCOUNT_SESSION_TOKEN_KEY, result.data.token);
      if (!current()) {
        if (saved) await storage.secureRemove(ACCOUNT_SESSION_TOKEN_KEY);
        return;
      }
      if (saved && rememberedLogin) {
        remembered = rememberedLogin.remember
          ? await saveRememberedLogin(rememberedLogin.username, rememberedLogin.password)
          : await forgetRememberedLogin();
        if (!current()) {
          await storage.secureRemove(ACCOUNT_SESSION_TOKEN_KEY);
          if (rememberedLogin.remember) await forgetRememberedLogin();
        }
      }
    });
    if (!current()) return superseded();
    if (!saved) {
      void logoutAccount(result.data.token);
      return "This device could not securely save the session. Please try again.";
    }
    if (!content.response?.ok || !content.data.success || !content.data.content || !configureManagedContentAccess(content.data.content)) {
      clearManagedContentAccess();
      setNotice("Supplied sources are temporarily unavailable. You can use your personal playlists.");
    }
    if (!remembered) setNotice("Signed in, but this device could not update the saved login. Your session is still saved.");
    tokenRef.current = result.data.token;
    NativeModules.CharmVod?.setUsageSession?.(result.data.token);
    lastValidatedAtRef.current = Date.now();
    setUser(result.data.user);
    setStatus("signed_in");
    return null;
  }, [serializeSessionWrite]);

  const signIn = useCallback(async (username: string, password: string, rememberLogin = false) => {
    const epoch = ++sessionEpoch.current;
    setNotice(null);
    return acceptAuthenticatedResult(await loginToAccount(username.trim(), password), epoch,
      { username, password, remember: rememberLogin });
  }, [acceptAuthenticatedResult]);

  const register = useCallback(async (inviteCode: string, username: string, email: string, password: string, challengeToken?: string) => {
    const epoch = ++sessionEpoch.current;
    setNotice(null);
    return acceptAuthenticatedResult(await registerAccountWithInvite(inviteCode, username, email, password, challengeToken), epoch);
  }, [acceptAuthenticatedResult]);

  const referralRequest = useCallback(async (action: "load" | "create" | "delete", invitationId?: string) => {
    const token = tokenRef.current;
    const epoch = sessionEpoch.current;
    if (!token) return { data: null, error: "Please sign in again." };
    const result = action === "create"
      ? await generateReferralInvite(token)
      : action === "delete" && invitationId
        ? await deleteReferralInviteHistory(token, invitationId)
        : await getReferralSummary(token);
    if (sessionEpoch.current !== epoch || tokenRef.current !== token) return { data: null, error: "Your session changed. Please try again." };
    if (result.response?.status === 401 || result.response?.status === 403) {
      await clearLocalSession("Your session expired or was revoked. Please sign in again.");
      return { data: null, error: "Your session expired or was revoked." };
    }
    if (!result.response?.ok || !result.data.success || !result.data.referral) {
      return { data: null, error: result.data.error || "Unable to load your invitations." };
    }
    return { data: result.data.referral, error: null };
  }, [clearLocalSession]);

  const cancelAccount = useCallback(async (password: string) => {
    const token = tokenRef.current;
    const epoch = sessionEpoch.current;
    if (!token) return "Please sign in again.";
    const result = await permanentlyCancelAccount(token, password);
    if (sessionEpoch.current !== epoch || tokenRef.current !== token) return "Your session changed. Please check the current account.";
    if (!result.response?.ok || !result.data.success) {
      return result.data.error || "Unable to cancel the account.";
    }
    await clearLocalSession("Your account and personal data were permanently deleted.", true);
    return null;
  }, [clearLocalSession]);

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
    register,
    loadReferrals: () => referralRequest("load"),
    createReferral: () => referralRequest("create"),
    deleteReferral: (invitationId) => referralRequest("delete", invitationId),
    cancelAccount,
    signOut,
    retryRestore: restore,
  }), [cancelAccount, notice, referralRequest, register, restore, signIn, signOut, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
