import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
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
  const { status, notice, signIn, signOut, retryRestore } = useAuth();
  const { width } = useWindowDimensions();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (status === "signed_in") return <>{children}</>;

  if (status === "restoring") {
    return (
      <View style={styles.screen} testID="account-session-restoring">
        <ActivityIndicator color={tvColors.purpleBright} size="large" />
        <Text style={styles.loadingText}>Checking your CharmIPTV account…</Text>
      </View>
    );
  }

  if (status === "unavailable") {
    return (
      <View style={styles.screen} testID="account-session-unavailable">
        <View style={[styles.card, width < 700 && styles.cardCompact]}>
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
    <View style={styles.screen} testID="account-login-screen">
      <View style={[styles.card, width < 700 && styles.cardCompact]}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Ionicons name="sparkles" size={27} color="#fff" /></View>
          <View>
            <Text style={styles.brand}>CHARM IPTV</Text>
            <Text style={styles.kicker}>ACCOUNT SIGN IN</Text>
          </View>
        </View>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.message}>Sign in with the username and password supplied with your invitation.</Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          hasTVPreferredFocus
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

        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          editable={!busy}
          secureTextEntry
          textContentType="password"
          autoComplete="password"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          placeholder="Enter password"
          placeholderTextColor="#6F6B7E"
          style={styles.input}
          testID="account-password"
        />

        {error || notice ? <Text style={styles.error}>{error || notice}</Text> : null}

        <Pressable
          disabled={busy}
          onPress={() => void submit()}
          style={({ focused }: any) => [styles.primaryButton, busy && styles.disabled, focused && styles.focused]}
          testID="account-sign-in"
        >
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="log-in-outline" size={18} color="#fff" />}
          <Text style={styles.primaryButtonText}>{busy ? "Signing In…" : "Sign In"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: tvColors.panel,
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
