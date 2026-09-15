import { useTVFocusEntry } from './useTVFocusEntry';
import { MediaLabArt } from "@/src/components/MediaLabBrand";
import { AccountLoginBrand } from "./AccountLoginBrand";
import { FocusGuide } from "./TVFocusGuideView";
import { LinearGradient } from "expo-linear-gradient";
import {AccountSecurityDialog,type SecurityScreen} from './AccountSecurityDialog';
import {securityRequest} from '@/src/auth/securityApi';
import React, { useCallback, useEffect, useState } from "react";
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
import { setGuideNavigationActive, setRemoteContext, setPointerActive } from "@/src/utils/tvRemote";

export function AccountGate({ children }: { children: React.ReactNode }) {
  const { status, user, notice, signIn, register, signOut, retryRestore } = useAuth();
  const { width, height } = useWindowDimensions();
  const wide = width >= 700 && width > height;
  const compact = wide && height < 600;
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [inviteCode, setInviteCode] = useState("");
  const [email, setEmail] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [securityScreen,setSecurityScreen]=useState<SecurityScreen|null>(null);

  const entryFocus = useTVFocusEntry(status !== "signed_in" && status !== "restoring" && !busy && !securityScreen, status + ":" + mode);

  useEffect(() => {
    if (status === "signed_in") return;
    setRemoteContext("default");
    setGuideNavigationActive(false);
    setPointerActive(false);
  }, [status]);

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
      const policy=await securityRequest<{requires_telegram_approval:boolean}>('/auth/registration-policy',{invite_code:inviteCode});
      if(policy.requires_telegram_approval){setSecurityScreen('registration');return;}
      const message = await register(inviteCode, username, email, password);
      if (message) setError(message);
      else {
        setPassword("");
        setConfirmPassword("");
      }
    } catch(e) {
      setError(e instanceof Error?e.message:'Unable to register. Try again.');
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
      <View style={styles.screen} testID="account-session-unavailable" onFocusCapture={entryFocus.onFocusCapture} onLayout={entryFocus.onLayout}>
        <View style={[styles.card, wide && mode === "login" && { width: Math.min(480, width * .46) }, width < 700 && styles.cardCompact]}>
          <View style={styles.brandMark}><Ionicons name="cloud-offline-outline" size={30} color="#fff" /></View>
          <Text style={styles.title}>Account check unavailable</Text>
          <Text style={styles.message}>{notice || "Unable to verify your account right now."}</Text>
          <View style={styles.actions}>
            <Pressable
              ref={entryFocus.entryRef}
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
    <View style={{ flex: 1, backgroundColor: "#0B0912" }}>
    <LinearGradient pointerEvents="none" colors={["#231031", "#100B19", "#0B0912"]} start={{x:0,y:.45}} end={{x:1,y:.7}} style={StyleSheet.absoluteFill} />
    <FocusGuide style={{flex:1}} autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
    <ScrollView focusable={false} removeClippedSubviews={false}
      style={styles.screenScroll}
      contentContainerStyle={[styles.screenContent, wide && styles.screenWide, compact && {paddingVertical:20}]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      testID="account-login-screen"
    >
      <View style={[styles.loginBrand, wide && {width:Math.min(380,width*.34)}]}>
        <AccountLoginBrand size={wide ? Math.min(280, height*.46) : 132} animate={!securityScreen} />
        <Text style={[styles.tagline, !wide && {fontSize:19}]}>Live TV. Movies. Series.</Text>
        <Text style={styles.brandSubtitle}>Your favorites. All in one place.</Text>
      </View>
      <View style={[styles.loginForm, wide && {width:Math.min(396,width*.43)}]} onFocusCapture={entryFocus.onFocusCapture} onLayout={entryFocus.onLayout}>
        <Text style={styles.kicker}>WELCOME TO CHARMING MEDIALAB</Text>
        <Text style={styles.title}>{mode === "login" ? "Welcome back." : "Create your account"}</Text>
        <Text style={[styles.message, compact && {marginBottom:14}]}>
          {mode === "login" ? "Sign in to continue watching." : "Use the invitation supplied by your administrator. There is no open public registration."}
        </Text>

        {mode === "register" ? (
          <>
            <Text style={styles.label}>Invitation code</Text>
            <TextInput
              value={inviteCode}
              onChangeText={setInviteCode}
              editable={!busy}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="CHARM-XXXX-XXXX"
              placeholderTextColor="#6F6B7E"
              style={[styles.input, focusedField === "invite-code" && styles.inputFocused]}
          onFocus={() => setFocusedField("invite-code")}
          onBlur={() => setFocusedField(null)}
              testID="account-invite-code"
            />
          </>
        ) : null}

        <Text style={styles.label}>Username</Text>
        <TextInput
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
          style={[styles.input, focusedField === "username" && styles.inputFocused]}
          onFocus={() => setFocusedField("username")}
          onBlur={() => setFocusedField(null)}
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
              style={[styles.input, focusedField === "email" && styles.inputFocused]}
          onFocus={() => setFocusedField("email")}
          onBlur={() => setFocusedField(null)}
              testID="account-email"
            />
          </>
        ) : null}

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
        <TextInput
          value={password}
          onChangeText={setPassword}
          editable={!busy}
          secureTextEntry={!showPassword}
          textContentType="password"
          autoComplete="password"
          returnKeyType={mode === "register" ? "next" : "done"}
          onSubmitEditing={() => {
            if (mode === "login") void submit();
          }}
          placeholder="Enter password"
          placeholderTextColor="#6F6B7E"
          style={[styles.input, styles.passwordInput, focusedField === "password" && styles.inputFocused]}
          onFocus={() => setFocusedField("password")}
          onBlur={() => setFocusedField(null)}
          testID="account-password"
        />
        <Pressable disabled={busy} onPress={() => setShowPassword(value => !value)}
          accessibilityLabel={showPassword ? "Hide password" : "Show password"}
          accessibilityState={{selected:showPassword}} testID="account-show-password"
          style={({focused}) => [styles.showPassword, focused && styles.focused]}>
          <Text style={styles.secondaryButtonText}>{showPassword ? "Hide" : "Show"}</Text>
        </Pressable>
        </View>

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
              style={[styles.input, focusedField === "confirm-password" && styles.inputFocused]}
          onFocus={() => setFocusedField("confirm-password")}
          onBlur={() => setFocusedField(null)}
              testID="account-confirm-password"
            />
          </>
        ) : null}

        {error || notice ? <Text style={styles.error}>{error || notice}</Text> : null}

        <Pressable
          ref={entryFocus.entryRef}
          focusable={!busy}
          disabled={busy}
          onPress={() => void (mode === "login" ? submit() : submitRegistration())}
          style={({ focused }: any) => [styles.primaryButton, busy && styles.disabled, focused && styles.focused]}
          testID="account-sign-in"
        >
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="log-in-outline" size={18} color="#fff" />}
          <Text style={styles.primaryButtonText}>{busy ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}</Text>
        </Pressable>
        {mode === "login" && <>
          <View style={styles.helpRow}><Pressable disabled={busy} onPress={()=>setSecurityScreen('reset')}
            testID="account-forgot-password" style={({focused})=>[styles.linkButton,focused&&styles.focused]}>
            <Text style={styles.linkText}>Forgot password?</Text>
          </Pressable></View>
          <View style={styles.divider} />
        </>}
        <View style={styles.accountOptions}>
          {mode === "login" && <Pressable disabled={busy} onPress={()=>setSecurityScreen('access')}
            testID="account-request-access" style={({focused})=>[styles.secondaryButton,styles.optionButton,focused&&styles.focused]}>
            <Text style={styles.secondaryButtonText}>Request app access</Text>
          </Pressable>}
          <Pressable disabled={busy} onPress={() => { setError(null); setShowPassword(false); setMode(current => current === "login" ? "register" : "login"); }}
            testID="account-switch-mode" style={({focused})=>[styles.secondaryButton,styles.optionButton,focused&&styles.focused]}>
            <Text style={styles.secondaryButtonText}>{mode === "login" ? "I have an invitation" : "Return to sign in"}</Text>
          </Pressable>
        </View>
        <Pressable disabled={busy} onPress={()=>setSecurityScreen('community')} accessibilityRole="button"
          testID="account-community" style={({focused})=>[styles.linkButton,styles.communityButton,focused&&styles.focused]}>
          <Text style={styles.communityText}>Telegram community ↗</Text>
        </Pressable>
      </View>
    </ScrollView></FocusGuide>{securityScreen&&<AccountSecurityDialog kind={securityScreen} initialLogin={username} registration={{invite_code:inviteCode,username,email}} onApproved={async token=>{const message=await register(inviteCode,username,email,password,token);if(message)throw new Error(message);setPassword('');setConfirmPassword('');setSecurityScreen(null);}} onClose={()=>setSecurityScreen(null)}/>}</View>
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
    paddingHorizontal: 28,
    paddingVertical: 30,
    gap: 28,
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
  screenWide: {flexDirection:"row",gap:44,paddingHorizontal:44,paddingVertical:32},
  loginBrand: {alignItems:"center",justifyContent:"center"},
  loginForm: {width:396,maxWidth:"100%"},
  tagline: {color:"#EEE6FF",fontFamily:fonts.medium,fontSize:23,letterSpacing:-.6,marginTop:22},
  brandSubtitle: {color:"#B3A5C2",fontFamily:fonts.regular,fontSize:13,marginTop:10},
  passwordRow: {flexDirection:"row",alignItems:"stretch",gap:8,marginBottom:15},
  passwordInput: {flex:1,minWidth:0,marginBottom:0},
  showPassword: {minWidth:61,minHeight:46,alignItems:"center",justifyContent:"center",borderWidth:2,borderColor:"#473453",backgroundColor:"#1B1425",borderRadius:11},
  inputFocused: {borderColor:"#EDE3FF",backgroundColor:"#352048"},
  helpRow: {alignItems:"flex-end",marginTop:5,marginBottom:8},
  linkButton: {minHeight:36,justifyContent:"center",paddingHorizontal:8,borderWidth:2,borderColor:"transparent",borderRadius:8},
  linkText: {color:"#CCB4E6",fontFamily:fonts.medium,fontSize:12},
  divider: {height:1,backgroundColor:"#3C2B4B",marginBottom:15},
  accountOptions: {flexDirection:"row",gap:10},
  optionButton: {flex:1,paddingHorizontal:8},
  communityButton: {alignSelf:"center",marginTop:10},
  communityText: {color:"#B8A8CB",fontFamily:fonts.medium,fontSize:11},
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
  kicker: { color: "#C6A4EC", fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 2.1, marginBottom: 10 },
  title: { color: "#F9F7FF", fontFamily: fonts.semibold, fontSize: 30, letterSpacing:-.7, marginBottom: 8 },
  message: { color: "#B7ADC6", fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginBottom: 24 },
  label: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11, marginBottom: 6 },
  input: {
    minHeight: 46,
    color: "#fff",
    fontFamily: fonts.medium,
    fontSize: 15,
    borderWidth: 2,
    borderColor: "#473453",
    borderRadius: 11,
    backgroundColor: "#181220",
    paddingHorizontal: 14,
    marginBottom: 15,
  },
  error: { color: "#FDA4AF", fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, marginBottom: 4 },
  actions: { gap: 10 },
  primaryButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#BD70F0",
    backgroundColor: "#7B32C3",
    marginTop: 0,
  },
  primaryButtonText: { color: "#fff", fontFamily: fonts.bold, fontSize: 13 },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#473453",
    backgroundColor: "#1B1425",
  },
  secondaryButtonText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11 },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep },
  disabled: { opacity: 0.6 },
  loadingText: { color: tvColors.textMuted, fontFamily: fonts.medium, fontSize: 12 },
});
