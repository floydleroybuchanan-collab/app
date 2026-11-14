import React, { useRef, useState } from "react";
import { GlassIcon } from "@/src/components/GlassIcon";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { fonts, glass, glassFocus } from "@/src/theme";
import {
  TV_CALIBRATION_MAX_OFFSET,
  TV_CALIBRATION_MIN_OFFSET,
  TvCalibration,
  useTvCalibration,
} from "@/src/tvCalibration";

const STEP = 1;
const MIN_ADJUST_INTERVAL_MS = 90;
/** The preview moves an edge this many preview pixels for every real pixel, so small changes stay visible. */
const PREVIEW_SCALE = 1.6;
const PREVIEW_WIDTH = 236;
const PREVIEW_HEIGHT = 133;

type Side = keyof TvCalibration;

const SIDES: { side: Side; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { side: "top", label: "Top", icon: "arrow-up" },
  { side: "bottom", label: "Bottom", icon: "arrow-down" },
  { side: "left", label: "Left", icon: "arrow-back" },
  { side: "right", label: "Right", icon: "arrow-forward" },
];

/** Screen fit: a live miniature of the TV beside one stepper per edge. */
export function TvCalibrationControls() {
  const { draftCalibration, setSide, save, reset, discard, hasChanges } = useTvCalibration();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [active, setActive] = useState<Side | null>(null);
  const savingRef = useRef(false);
  const lastAdjustAt = useRef(0);

  if (!Platform.isTV) {
    return (
      <View style={styles.note}>
        <Text style={styles.noteTitle}>TV screen fit</Text>
        <Text style={styles.hint}>Manual overscan calibration is available on Android TV / Fire TV.</Text>
      </View>
    );
  }

  const adjust = (side: Side, delta: number) => {
    const now = Date.now();
    if (now - lastAdjustAt.current < MIN_ADJUST_INTERVAL_MS) return;
    lastAdjustAt.current = now;
    setSaved(false);
    void Haptics.selectionAsync().catch(() => {});
    const next = Math.max(
      TV_CALIBRATION_MIN_OFFSET,
      Math.min(TV_CALIBRATION_MAX_OFFSET, draftCalibration[side] + delta),
    );
    setSide(side, next);
  };

  const applyChanges = async () => {
    if (!hasChanges || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await save();
      setSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Where each edge of the app sits inside the miniature screen. Minus values push an edge outward.
  const edge = (side: Side) => Math.max(-14, Math.min(26, draftCalibration[side] * PREVIEW_SCALE));
  const frame = { top: 8 + edge("top"), bottom: 8 + edge("bottom"), left: 8 + edge("left"), right: 8 + edge("right") };
  const status = saving ? "Saving…" : saved ? "Applied" : hasChanges ? "Not applied yet" : "No changes";

  return (
    <View style={styles.wrap} testID="settings-tv-calibration">
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.kicker}>DISPLAY</Text>
          <Text style={styles.title}>TV screen fit</Text>
          <Text style={styles.hint}>
            Minus (−) stretches an edge outward to fill the TV. Plus (+) pulls it inward when the TV cuts the picture off.
            Each press moves 1 pixel. Save &amp; Apply works right away, with no restart.
          </Text>
        </View>
        <View style={[styles.state, hasChanges && !saved && styles.stateDirty, saved && styles.stateDone]}>
          <View style={[styles.stateDot, hasChanges && !saved && styles.dotDirty, saved && styles.dotDone]} />
          <Text style={styles.stateText}>{status}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.preview} accessibilityLabel="Screen fit preview">
          <View style={styles.tvScreen}>
            <View style={[styles.appFrame, frame, active && styles.appFrameActive]}>
              <View style={styles.fakeRail} />
              <View style={styles.fakeBody}>
                <View style={styles.fakeTitle} />
                <View style={styles.fakeRow} /><View style={styles.fakeRow} /><View style={[styles.fakeRow, { width: "60%" }]} />
              </View>
              {SIDES.map(({ side }) => (
                <View
                  key={side}
                  pointerEvents="none"
                  style={[
                    styles.edgeMark,
                    side === "top" && styles.markTop, side === "bottom" && styles.markBottom,
                    side === "left" && styles.markLeft, side === "right" && styles.markRight,
                    active === side && styles.markActive,
                  ]}
                />
              ))}
            </View>
          </View>
          <Text style={styles.previewCaption}>Miniature of your TV. The glowing edge is the one you are adjusting.</Text>
        </View>

        <View style={styles.steppers}>
          {SIDES.map(({ side, label, icon }) => (
            <View key={side} style={[styles.row, active === side && styles.rowActive]}>
              <Ionicons name={icon} size={16} color={glass.kicker} />
              <Text style={styles.label}>{label} edge</Text>
              <View style={styles.adjuster}>
                <Pressable
                  onFocus={() => setActive(side)}
                  onPress={() => adjust(side, -STEP)}
                  style={({ focused }: any) => [styles.adjustButton, focused && styles.focused]}
                  testID={`settings-tv-calibration-${side}-minus`}
                >
                  <Ionicons name="remove" size={20} color="#fff" />
                </Pressable>
                <View style={styles.valuePill}><Text style={styles.value}>{draftCalibration[side]} px</Text></View>
                <Pressable
                  onFocus={() => setActive(side)}
                  onPress={() => adjust(side, STEP)}
                  style={({ focused }: any) => [styles.adjustButton, focused && styles.focused]}
                  testID={`settings-tv-calibration-${side}-plus`}
                >
                  <Ionicons name="add" size={20} color="#fff" />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onFocus={() => setActive(null)}
          onPress={() => {
            if (savingRef.current) return;
            setSaved(false);
            void Haptics.selectionAsync().catch(() => {});
            reset();
          }}
          style={({ focused }: any) => [styles.secondaryButton, focused && styles.focused]}
          testID="settings-tv-calibration-reset"
        >
          <GlassIcon name="refresh" size={18} />
          <Text style={styles.secondaryText}>Reset to 0</Text>
        </Pressable>
        <Pressable
          disabled={!hasChanges || saving}
          onFocus={() => setActive(null)}
          onPress={() => {
            if (savingRef.current) return;
            setSaved(false);
            discard();
            void Haptics.selectionAsync().catch(() => {});
          }}
          style={({ focused }: any) => [styles.secondaryButton, (!hasChanges || saving) && styles.disabled, focused && styles.focused]}
          testID="settings-tv-calibration-discard"
        >
          <Text style={styles.secondaryText}>Discard</Text>
        </Pressable>
        <Pressable
          disabled={!hasChanges || saving}
          onFocus={() => setActive(null)}
          onPress={() => void applyChanges()}
          style={({ focused }: any) => [styles.saveButton, (!hasChanges || saving) && styles.disabled, focused && styles.focused]}
          testID="settings-tv-calibration-save"
        >
          {saved ? <Ionicons name="checkmark-circle" size={18} color="#fff" /> : <GlassIcon name="save" size={18} />}
          <Text style={styles.saveText}>{saving ? "Saving…" : saved ? "Applied" : "Save & Apply"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginTop: 8, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: glass.edge, backgroundColor: glass.panel },
  note: { gap: 4, paddingVertical: 6 },
  noteTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 12 },
  headingRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headingCopy: { flex: 1, gap: 2 },
  kicker: { color: glass.kicker, fontFamily: fonts.semibold, fontSize: 8, letterSpacing: 1.4 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 15 },
  hint: { color: "rgba(237,227,255,0.72)", fontFamily: fonts.regular, fontSize: 9.5, lineHeight: 13 },
  state: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: glass.edgeSoft, backgroundColor: glass.button },
  stateDirty: { borderColor: "rgba(255,196,92,0.7)", backgroundColor: "rgba(255,196,92,0.14)" },
  stateDone: { borderColor: "rgba(95,227,161,0.7)", backgroundColor: "rgba(95,227,161,0.14)" },
  stateDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(237,227,255,0.5)" },
  dotDirty: { backgroundColor: "#FFC45C" },
  dotDone: { backgroundColor: "#5FE3A1" },
  stateText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9.5 },
  body: { flexDirection: "row", gap: 14, alignItems: "center" },
  preview: { alignItems: "center", gap: 6, width: PREVIEW_WIDTH },
  tvScreen: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, borderRadius: 12, borderWidth: 4, borderColor: "#05030b", backgroundColor: "#0B0616", overflow: "hidden", shadowColor: glass.glow, elevation: 6 },
  appFrame: { position: "absolute", borderRadius: 6, borderWidth: 1, borderColor: glass.edge, backgroundColor: "rgba(122,62,214,0.30)", flexDirection: "row", overflow: "visible" },
  appFrameActive: { borderColor: glass.selectedEdge },
  fakeRail: { width: 14, backgroundColor: "rgba(26,11,51,0.9)", borderTopLeftRadius: 5, borderBottomLeftRadius: 5 },
  fakeBody: { flex: 1, padding: 7, gap: 5 },
  fakeTitle: { width: "45%", height: 7, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.7)", marginBottom: 3 },
  fakeRow: { width: "90%", height: 9, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.16)" },
  edgeMark: { position: "absolute", backgroundColor: "transparent" },
  markTop: { left: 0, right: 0, top: -1, height: 3 }, markBottom: { left: 0, right: 0, bottom: -1, height: 3 },
  markLeft: { top: 0, bottom: 0, left: -1, width: 3 }, markRight: { top: 0, bottom: 0, right: -1, width: 3 },
  markActive: { backgroundColor: "#7DF0FF", shadowColor: "#7DF0FF", elevation: 8 },
  previewCaption: { color: "rgba(237,227,255,0.6)", fontFamily: fonts.regular, fontSize: 8.5, textAlign: "center" },
  steppers: { flex: 1, gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, borderWidth: 1, borderColor: "transparent", backgroundColor: "rgba(255,255,255,0.04)" },
  rowActive: { borderColor: glass.selectedEdge, backgroundColor: glass.selected },
  label: { flex: 1, color: "#fff", fontFamily: fonts.medium, fontSize: 11 },
  adjuster: { alignItems: "center", flexDirection: "row", gap: 6 },
  adjustButton: { alignItems: "center", backgroundColor: glass.button, borderColor: glass.buttonEdge, borderRadius: 12, borderWidth: 1, height: 34, justifyContent: "center", width: 40 },
  valuePill: { minWidth: 56, paddingVertical: 5, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.28)", borderWidth: 1, borderColor: glass.edgeSoft },
  value: { color: "#fff", fontFamily: fonts.bold, fontSize: 11.5, textAlign: "center" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" },
  secondaryButton: { alignItems: "center", flexDirection: "row", gap: 6, backgroundColor: glass.button, borderColor: glass.buttonEdge, borderRadius: 13, borderWidth: 1, justifyContent: "center", minHeight: 38, paddingHorizontal: 14 },
  secondaryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 11 },
  saveButton: { alignItems: "center", backgroundColor: glass.selected, borderColor: glass.selectedEdge, borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 38, minWidth: 132, paddingHorizontal: 14 },
  saveText: { color: "#fff", fontFamily: fonts.bold, fontSize: 11.5 },
  disabled: { opacity: 0.45 },
  focused: { ...glassFocus },
});
