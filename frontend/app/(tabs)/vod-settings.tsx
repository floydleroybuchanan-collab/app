import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { MediaLabVodContent } from "@/src/components/MediaLabVodContent";
import { tvColors } from "@/src/theme";

export default function VodSettingsScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const [choosingProvider, setChoosingProvider] = useState(false);
  useEffect(() => { setChoosingProvider(false); }, [section]);
  const settingsSection = section === "accounts" ? "accounts" : "settings";
  return <PurpleTvShell active="/settings">
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.heading}>Video on Demand Settings</Text>
      <Pressable testID="vod-settings-provider" accessibilityRole="button"
        onPress={() => setChoosingProvider(current => !current)}
        style={({ focused }: any) => [styles.action, focused && styles.focused]}>
        <Text style={styles.label}>{choosingProvider ? "Back to VOD settings" : "Change provider"}</Text>
      </Pressable>
    </View>
    <MediaLabVodContent initialSection={choosingProvider ? "sources" : settingsSection} settings />
  </PurpleTvShell>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  heading: { color: tvColors.text, fontSize: 20, fontWeight: "700", flexShrink: 1 },
  action: { borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panelRaised, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  focused: { borderColor: tvColors.focus, backgroundColor: tvColors.purpleDeep },
  label: { color: tvColors.text, fontSize: 15, fontWeight: "600" },
});
