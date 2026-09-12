import { MediaLabArt, MediaLabBackdrop } from "@/src/components/MediaLabBrand";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "@/src/auth/AuthContext";
import { fonts, radius, tvColors } from "@/src/theme";

export function AccountGate({ children }: { children: React.ReactNode }) {
  const { status, user, notice, signIn, register, signOut, retryRestore } = useAuth();
  const { width, height } = useWindowDimensions();
  const wide = width >= 800 && width > height;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [inviteCode, setInviteCode] = useState("");
  const [email, setEmail] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const submit = useCallback(async () => {
    const cleanUsername = username.trim();
    if (!cleanUsername || !password || busy) {
      if (!cleanUsername || !password) setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await signIn(cleanUsername, password);
      if (message) setError(message);
      else setPassword("");
    } finally {
      setBusy(false);
    }
  }, [busy, password, signIn, username]);

  const submitRegistration = useCallback(async () => {
    if (busy) return;
    if (!inviteCode.trim() || !username.trim() || !email.trim() || !password) {
      setError("Enter the invitation code, username, email, and password.");
      return;
    }
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await register(inviteCode, username, email, password);
      if (message) setError(message);
      else {
        setPassword("");
        setConfirmPassword("");
      }
    } finally {
      setBusy(false);
    }
  }, [busy, confirmPassword, email, inviteCode, password, register, username]);

  if (status === "signed_in") {
    const expiresAt = user?.expires_at == null ? null : Number(user.expires_at) * (Number(user.expires_at) < 10_000_000_000 ? 1000 : 1);
    const remainingMs = expiresAt == null ? null : expiresAt - Date.now();
    const warningDays = remainingMs == null ? null : Math.max(0, Math.ceil(remainingMs / 86_400_000));
    return (
      <View style={styles.authenticatedScreen}>
        {children}
        {warningDays != null && warningDays <= 14 ? (
          <View style={[styles.expiryNotice, warningDays <= 3 && styles.expiryNoticeUrgent]} testID="account-expiry-warning">
            <Ionicons name="time-outline" size={18} color="#fff" />
            <Text style={styles.expiryNoticeText}>
              {warningDays === 0
                ? "Your account time ends today. Renew now to avoid losing the account."
                : `${warningDays} day${warningDays === 1 ? "" : "s"} of account time remain. Renew as soon as possible.`}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (status === "restoring") {
    return (
      <View style={styles.screen} testID="account-session-restoring">
        <MediaLabArt kind="circle" width={120} /><ActivityIndicator color={tvColors.purpleBright} size="large" />
        <Text style={styles.loadingText}>Checking your Charming MediaLab account…</Text>
      </View>
    );
  }

  if (status === "unavailable") {
    return (
      <View style={styles.screen} testID="account-session-unavailable">
        <View style={[styles.card, wide && mode === "login" && { width: Math.min(480, width * .46) }, width < 700 && styles.cardCompact]}>
          <View style={styles.brandMark}><Ionicons name="cloud-offline-outline" size={30} color="#fff" /></View>
          <Text style={styles.title}>Account check unavailable</Text>
          <Text style={styles.message}>{notice || "Unable to verify your account right now."}</Text>
          <View style={styles.actions}>
            <Pressable
              hasTVPreferredFocus
              onPress={() => void retryRestore()}
              style={({ focused }: any) => [styles.primaryButton, focused && styles.focused]}
              testID="account-retry"
            >
              <Ionicons name="refresh-outline" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </Pressable>
            <Pressable
              onPress={() => void signOut()}
              style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
              testID="account-forget-session"
            >
              <Text style={styles.secondaryButtonText}>Return to Sign In</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}><MediaLabBackdrop />
    <ScrollView
      style={styles.screenScroll}
      contentContainerStyle={[styles.screenContent, wide && mode === "login" && { flexDirection: "row", gap: 32 }]}
      keyboardShouldPersistTaps="handled"
      testID="account-login-screen"
    >
      {wide && mode === "login" && <View style={{ width: Math.min(560, width * .38), alignItems: "center" }}><MediaLabArt width={Math.min(560, width * .38)} /><Text style={styles.kicker}>LIVE TELEVISION  /  VIDEO ON DEMAND</Text></View>}
      <View style={[styles.card, wide && mode === "login" && { width: Math.min(480, width * .46) }, width < 700 && styles.cardCompact]}>
        {(!wide || mode === "register") && <View style={styles.brandRow}><MediaLabArt width={320} /></View>}
        <Text style={styles.kicker}>YOUR ACCOUNT</Text>
        <Text style={styles.title}>{mode === "login" ? "Welcome back" : "Create your account"}</Text>
        <Text style={styles.message}>
          {mode === "login"
            ? "Sign in with your Charming MediaLab username and password."
            : "A valid invitation code is required. There is no open public registration."}
        </Text>

        {mode === "register" ? (
          <>
            <Text style={styles.label}>Invitation code</Text>
            <TextInput
              hasTVPreferredFocus
              value={inviteCode}
              onChangeText={setInviteCode}
              editable={!busy}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="CHARM-XXXX-XXXX"
              placeholderTextColor="#6F6B7E"
              style={styles.input}
              testID="account-invite-code"
            />
          </>
        ) : null}

        <Text style={styles.label}>Username</Text>
        <TextInput
          hasTVPreferredFocus={mode === "login"}
          value={username}
          onChangeText={setUsername}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          autoComplete="username"
          returnKeyType="next"
          placeholder="Enter username"
          placeholderTextColor="#6F6B7E"
          style={styles.input}
          testID="account-username"
        />

        {mode === "register" ? (
          <>
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="Enter email"
              placeholderTextColor="#6F6B7E"
              style={styles.input}
              testID="account-email"
            />
          </>
        ) : null}

        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          editable={!busy}
          secureTextEntry
          textContentType="password"
          autoComplete="password"
          returnKeyType={mode === "register" ? "next" : "done"}
          onSubmitEditing={() => {
            if (mode === "login") void submit();
          }}
          placeholder="Enter password"
          placeholderTextColor="#6F6B7E"
          style={styles.input}
          testID="account-password"
        />

        {mode === "register" ? (
          <>
            <Text style={styles.label}>Confirm password</Text>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              editable={!busy}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={() => void submitRegistration()}
              placeholder="Enter password again"
              placeholderTextColor="#6F6B7E"
              style={styles.input}
              testID="account-confirm-password"
            />
          </>
        ) : null}

        {error || notice ? <Text style={styles.error}>{error || notice}</Text> : null}

        <Pressable
          disabled={busy}
          onPress={() => void (mode === "login" ? submit() : submitRegistration())}
          style={({ focused }: any) => [styles.primaryButton, busy && styles.disabled, focused && styles.focused]}
          testID="account-sign-in"
        >
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="log-in-outline" size={18} color="#fff" />}
          <Text style={styles.primaryButtonText}>{busy ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => {
            setError(null);
            setMode((current) => current === "login" ? "register" : "login");
          }}
          style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
          testID="account-switch-mode"
        >
          <Text style={styles.secondaryButtonText}>
            {mode === "login" ? "Register With Invitation" : "Return to Sign In"}
          </Text>
        </Pressable>
      </View>
    </ScrollView></View>
  );
}

const styles = StyleSheet.create({
  authenticatedScreen: { flex: 1 },
  expiryNotice: {
    position: "absolute",
    top: 10,
    right: 14,
    maxWidth: 360,
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#F0B84A",
    backgroundColor: "rgba(115, 70, 0, 0.96)",
    zIndex: 1000,
  },
  expiryNoticeUrgent: { borderColor: "#FF7272", backgroundColor: "rgba(120, 23, 35, 0.97)" },
  expiryNoticeText: { flex: 1, color: "#fff", fontFamily: fonts.semibold, fontSize: 9, lineHeight: 13 },
  screenScroll: { flex: 1, backgroundColor: "transparent" },
  screenContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  screen: {
    flex: 1,
    backgroundColor: tvColors.canvas,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 14,
  },
  card: {
    width: 480,
    maxWidth: "100%",
    paddingHorizontal: 38,
    paddingVertical: 32,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: tvColors.lineStrong,
    backgroundColor: "rgba(28, 19, 38, .82)",
  },
  cardCompact: { paddingHorizontal: 24, paddingVertical: 24 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 24 },
  brandMark: {
    width: 54,
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tvColors.purple,
    marginBottom: 16,
  },
  brand: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, letterSpacing: 1.2 },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 9, letterSpacing: 1.5, marginTop: 3 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 24, marginBottom: 7 },
  message: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginBottom: 18 },
  label: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11, marginBottom: 6 },
  input: {
    minHeight: 52,
    color: "#fff",
    fontFamily: fonts.medium,
    fontSize: 15,
    borderWidth: 2,
    borderColor: tvColors.lineStrong,
    borderRadius: radius.sm,
    backgroundColor: tvColors.panelRaised,
    paddingHorizontal: 14,
    marginBottom: 15,
  },
  error: { color: "#FDA4AF", fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, marginBottom: 4 },
  actions: { gap: 10 },
  primaryButton: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: tvColors.purple,
    marginTop: 10,
  },
  primaryButtonText: { color: "#fff", fontFamily: fonts.bold, fontSize: 13 },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: tvColors.line,
    backgroundColor: tvColors.panelRaised,
  },
  secondaryButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
  disabled: { opacity: 0.6 },
  loadingText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
});
