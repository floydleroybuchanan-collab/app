import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FocusGuide } from "./TVFocusGuideView";
import { ICON_RAIL_TIMEOUT_OPTIONS, type IconRailPreferences } from "@/src/core/iconRailPolicy";
import { saveIconRailPreferences, useIconRailPreferences } from "@/src/core/iconRailPreferences";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { resetRemoteContextIfOwned, setRemoteContext } from "@/src/utils/tvRemote";
import { fonts, tvColors } from "@/src/theme";

export function IconRailSettings() {
  const prefs = useIconRailPreferences();
  const [open, setOpen] = useState(false);
  const [preferSelectedFocus, setPreferSelectedFocus] = useState(false);
  const [error, setError] = useState("");
  const opener = useRef<unknown>(null), selected = useRef<unknown>(null);
  const openerFocused = useRef(false);
  const focusCleanup = useRef<(() => void) | null>(null);
  const returnToSetting = useCallback(() => { focusCleanup.current = requestNativeFocusWithRetry(opener.current, [0, 70, 160, 320], () => openerFocused.current); }, []);
  const close = () => { focusCleanup.current?.(); setOpen(false); };
  useEffect(() => {
    if (!open) return;
    setRemoteContext("modal");
    return () => {
      focusCleanup.current?.();
      resetRemoteContextIfOwned("modal", "default");
      returnToSetting();
    };
  }, [open, returnToSetting]);
  useEffect(() => () => focusCleanup.current?.(), []);
  const save = (patch: Partial<IconRailPreferences>) => {
    setError("");
    void saveIconRailPreferences(patch).catch(reason => setError(reason instanceof Error ? reason.message : "Could not save rail preferences."));
  };
  return <View style={styles.section}>
    <Text style={styles.heading}>Navigation icon rail</Text>
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: prefs.enabled }} onPress={() => save({ enabled: !prefs.enabled })}
      style={({ focused }: any) => [styles.row, focused && styles.focused]} testID="settings-icon-rail-enabled">
      <Text style={styles.label}>Show icon rail</Text><Text style={styles.value}>{prefs.enabled ? "On" : "Off"}</Text>
    </Pressable>
    <Pressable ref={opener as any} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { setPreferSelectedFocus(true); setOpen(true); }}
      onFocus={() => { openerFocused.current = true; }} onBlur={() => { openerFocused.current = false; }}
      style={({ focused }: any) => [styles.row, focused && styles.focused]} testID="settings-icon-rail-timeout">
      <Text style={styles.label}>Rail timeout</Text><Text style={styles.value}>{ICON_RAIL_TIMEOUT_OPTIONS.find(option => option.value === prefs.timeoutMinutes)?.label}</Text>
      <Ionicons name="chevron-down" size={14} color="#fff" />
    </Pressable>
    <Text style={styles.help}>The rail hides after this much remote inactivity and the page expands to fit. Left at the page edge brings it back. With the rail off, Left opens the main menu. The TV Guide opens playlists/groups instead.</Text>
    {!!error && <Text style={styles.help}>{error}</Text>}
    <Modal visible={open} transparent animationType="none" onRequestClose={close} onShow={() => {
      focusCleanup.current?.(); focusCleanup.current = requestNativeFocusWithRetry(selected.current);
    }}>
      <View style={styles.overlay}>
        <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.menu}>
          <Text style={styles.heading}>Rail timeout</Text>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 3 }} showsVerticalScrollIndicator={false}>
          {ICON_RAIL_TIMEOUT_OPTIONS.map(option => <Pressable key={option.value}
            ref={option.value === prefs.timeoutMinutes ? selected as any : undefined}
            accessibilityRole="radio" accessibilityState={{ selected: option.value === prefs.timeoutMinutes }}
            hasTVPreferredFocus={preferSelectedFocus && option.value === prefs.timeoutMinutes}
            onFocus={() => setPreferSelectedFocus(false)}
            onPress={() => { save({ timeoutMinutes: option.value }); close(); }}
            style={({ focused }: any) => [styles.option, focused && styles.focused]}>
            <Text style={styles.label}>{option.label}</Text>{option.value === prefs.timeoutMinutes && <Ionicons name="checkmark" size={14} color="#fff" />}
          </Pressable>)}
          </ScrollView>
          <Pressable onPress={close} style={({ focused }: any) => [styles.option, focused && styles.focused]}><Text style={styles.label}>Cancel</Text></Pressable>
        </FocusGuide>
      </View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 6, marginBottom: 10 }, heading: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11, marginBottom: 4 },
  row: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderWidth: 2, borderColor: "transparent", borderRadius: 5, backgroundColor: tvColors.panel },
  label: { color: "#fff", fontFamily: fonts.medium, fontSize: 9, flex: 1 }, value: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 9 },
  focused: { backgroundColor: tvColors.purpleDeep, borderColor: "#fff" }, help: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 8, lineHeight: 12 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.78)" },
  menu: { width: 310, maxWidth: "90%", maxHeight: "90%", padding: 12, gap: 3, borderRadius: 8, backgroundColor: tvColors.panelRaised, borderWidth: 1, borderColor: tvColors.line },
  option: { minHeight: 27, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, borderWidth: 2, borderColor: "transparent", borderRadius: 4 },
});
