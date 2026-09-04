import React, { forwardRef, useState } from "react";
import { TextInput, type TextInputProps } from "react-native";

/** Keep editable Settings controls visibly selected without changing keyboard behavior. */
export const TvSettingsTextInput = forwardRef<TextInput, TextInputProps>(function TvSettingsTextInput(
  { style, onFocus, onBlur, ...props }, ref,
) {
  const [focused, setFocused] = useState(false);
  return <TextInput {...props} ref={ref}
    onFocus={event => { setFocused(true); onFocus?.(event); }}
    onBlur={event => { setFocused(false); onBlur?.(event); }}
    style={[style, focused && { borderColor: "#fff", borderWidth: 2, backgroundColor: "#32194e" }]} />;
});
