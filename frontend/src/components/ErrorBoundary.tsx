import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { fonts, glass, glassFocus, spacing } from "@/src/theme";

type Props = {
  children: React.ReactNode;
  // Optional custom fallback; receives a reset() to try re-rendering children.
  fallback?: (reset: () => void) => React.ReactNode;
  onReset?: () => void;
  onError?: (error: unknown) => void;
};

type State = { hasError: boolean; message: string | null };

// Catches JS render/lifecycle errors anywhere in its subtree so a single screen
// (e.g. the player) can never white-screen / take down the whole app.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown) {
    console.warn("[ErrorBoundary] caught", error);
    try {
      this.props.onError?.(error);
    } catch {
      /* ignore listener failures */
    }
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, message: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);
    return (
      <View style={styles.wrap}>
        <LinearGradient pointerEvents="none" colors={["#1B0A3C", "#0E0622", "#220B46"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={styles.card}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.sub}>The screen hit an unexpected error. Try again.</Text>
        {this.state.message ? (
          <Text selectable style={styles.detail} testID="error-boundary-detail">
            {this.state.message}
          </Text>
        ) : null}
        <Pressable
          style={({ focused }: any) => [styles.btn, focused && styles.btnFocused]}
          onPress={this.reset}
          hasTVPreferredFocus
          testID="error-boundary-retry"
        >
          <Text style={styles.btnText}>Try Again</Text>
        </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: glass.page },
  // see-through glass card with a soft light edge
  card: { maxWidth: 640, alignItems: "center", gap: spacing.md, padding: spacing.xl, borderRadius: 20, borderWidth: 1, borderColor: glass.edge, backgroundColor: "rgba(36,14,72,0.40)" },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18 },
  sub: { color: "#E2D3FA", fontFamily: fonts.regular, fontSize: 14, textAlign: "center" },
  detail: { maxWidth: 560, color: "#FFB4D0", fontFamily: fonts.regular, fontSize: 12, textAlign: "center" },
  btn: { backgroundColor: glass.button, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: glass.buttonEdge },
  btnFocused: { ...glassFocus },
  btnText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 15 },
});
