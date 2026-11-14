import React, { forwardRef, useState } from "react";
import { StyleSheet, TextInput, type TextInputProps } from "react-native";
import { fonts, glass } from "@/src/theme";

/**
 * Glass text field for Settings: rounded, translucent, white text.
 * Selected, it fills with the app's violet and gets the white focus edge and glow.
 * Layout (size, margins) still comes from the caller; colors come from here.
 */
export const TvSettingsTextInput = forwardRef<TextInput, TextInputProps>(function TvSettingsTextInput(
  { style, onFocus, onBlur, placeholderTextColor, selectionColor, ...props }, ref,
) {
  const [focused, setFocused] = useState(false);
  return <TextInput {...props} ref={ref}
    placeholderTextColor={placeholderTextColor ?? "rgba(237,227,255,0.5)"}
    selectionColor={selectionColor ?? glass.glow}
    onFocus={event => { setFocused(true); onFocus?.(event); }}
    onBlur={event => { setFocused(false); onBlur?.(event); }}
    style={[style, styles.field, focused && styles.focused]} />;
});

const styles = StyleSheet.create({
  field: { color: "#fff", fontFamily: fonts.medium, backgroundColor: glass.button, borderColor: glass.buttonEdge, borderWidth: 1, borderRadius: 12 },
  focused: { backgroundColor: glass.focus, borderColor: glass.focusEdge, borderWidth: 2, shadowColor: glass.glow, elevation: 14 },
});
