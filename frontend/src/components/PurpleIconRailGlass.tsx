import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

/**
 * The icon rail's glass: ambient motion for the panel, and per-chip reactions
 * for focus and selection.
 *
 * Everything here animates transform and opacity only, with useNativeDriver, so
 * it runs on the UI thread exactly as the sign-in scene's meteors do. Nothing
 * animates blur, nothing uses Android elevation, and nothing re-renders React
 * per frame. Coloured glow comes from a radial sprite because Android ignores
 * shadowColor/shadowRadius without elevation, and elevation only draws grey.
 */

const GLOW_SPRITE = require("../../assets/login/star_glow.png");

/** Rail breathes on its visual shell only; the focus container must not move. */
export const RAIL_BREATHE_MS = 8000;
export const RAIL_REFLECTION_MS = 15000;

function useLoop(duration: number, enabled: boolean) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) return;
    const anim = Animated.loop(
      Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => { anim.stop(); value.setValue(0); };
  }, [duration, enabled, value]);
  return value;
}

const BUBBLES = [
  { x: 0.16, size: 4, ms: 11000, delay: 0 }, { x: 0.70, size: 3, ms: 9000, delay: 1400 },
  { x: 0.36, size: 2, ms: 13000, delay: 2600 }, { x: 0.82, size: 4, ms: 12000, delay: 4100 },
  { x: 0.24, size: 3, ms: 10000, delay: 5600 }, { x: 0.58, size: 2, ms: 14000, delay: 6900 },
  { x: 0.10, size: 3, ms: 12500, delay: 8300 }, { x: 0.76, size: 2, ms: 9500, delay: 9700 },
];

/** One bubble rising through the glass: a ringed circle, so it reads as a bubble and never as a speck of dirt. */
function Bubble({ x, size, ms, delay, height, running }: {
  x: number; size: number; ms: number; delay: number; height: number; running: boolean;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!running) return;
    const anim = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(t, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }),
    ]));
    anim.start();
    return () => { anim.stop(); t.setValue(0); };
  }, [delay, ms, running, t]);
  return (
    <Animated.View style={{
      position: "absolute", left: x, top: 0, width: size, height: size, borderRadius: size,
      borderWidth: 1, borderColor: "rgba(255,255,255,0.75)", backgroundColor: "rgba(210,180,255,0.25)",
      opacity: t.interpolate({ inputRange: [0, 0.12, 0.85, 1], outputRange: [0, 0.8, 0.6, 0] }),
      transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [height - 30, 60] }) }],
    }} />
  );
}

/**
 * The body of the glass, drawn BELOW the icons: shading, rising bubbles and
 * the travelling reflection. Everything that moves lives here, inside the
 * glass and under the artwork, so it can be bright without ever tinting an
 * icon. Nothing scales, so every edge stays crisp.
 */
export function RailGlassBase({ width, height, running }: { width: number; height: number; running: boolean }) {
  const sweep = useLoop(RAIL_REFLECTION_MS, running);
  const sweepY = sweep.interpolate({ inputRange: [0, 1], outputRange: [-120, height] });
  const sweepOpacity = sweep.interpolate({ inputRange: [0, 0.2, 0.5, 0.8, 1], outputRange: [0, 0.3, 0.22, 0.3, 0] });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={["rgba(26,6,84,0.55)", "rgba(190,150,255,0.16)", "rgba(120,70,230,0.04)", "rgba(26,6,84,0.50)"]}
        locations={[0, 0.30, 0.58, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={["rgba(255,255,255,0.20)", "rgba(255,255,255,0)"]}
        style={{ position: "absolute", left: 3, right: 3, top: 3, height: width * 0.9, borderTopLeftRadius: width / 2, borderTopRightRadius: width / 2 }}
      />
      {/* light travelling down through the tube, beneath the icons */}
      <Animated.View style={{
        position: "absolute", left: -width, right: -width, height: 60,
        backgroundColor: "rgba(214,188,255,0.9)", opacity: sweepOpacity,
        transform: [{ translateY: sweepY }, { rotate: "-24deg" }],
      }} />
      {BUBBLES.map((bubble, index) => (
        <Bubble key={index} {...bubble} x={bubble.x * (width - 8) + 2} height={height} running={running} />
      ))}
    </View>
  );
}

const SPARKLES = [
  { side: "left" as const, top: 0.22, delay: 2000 },
  { side: "right" as const, top: 0.47, delay: 8000 },
  { side: "left" as const, top: 0.71, delay: 13500 },
];

/** A brief glint on the rim. They sit on the walls, so they never land on an icon. */
function Sparkle({ side, top, delay, height, running }: {
  side: "left" | "right"; top: number; delay: number; height: number; running: boolean;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!running) return;
    const anim = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(t, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(16000 - delay),
    ]));
    anim.start();
    return () => { anim.stop(); t.setValue(0); };
  }, [delay, running, t]);
  return (
    <Animated.Image
      source={GLOW_SPRITE}
      resizeMode="contain"
      style={{
        position: "absolute", top: height * top, width: 14, height: 14,
        ...(side === "left" ? { left: -3 } : { right: -3 }),
        tintColor: "#FFFFFF", opacity: t,
        transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
      }}
    />
  );
}

/**
 * The part of the glass drawn ABOVE the icons: the rim, two edge speculars and
 * the rim sparkles. All of it hugs the walls, so nothing crosses the artwork.
 */
export function RailGlassOverlay({ width, height, running }: { width: number; height: number; running: boolean }) {
  const breathe = useLoop(RAIL_BREATHE_MS, running);
  const glowOpacity = breathe.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.55, 1, 0.55] });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={{
        position: "absolute", left: 4, top: 46, bottom: 110, width: 2, borderRadius: 2,
        backgroundColor: "rgba(255,255,255,0.55)", opacity: glowOpacity,
      }} />
      <View style={{
        position: "absolute", right: 4.5, top: 140, bottom: 64, width: 1, borderRadius: 1,
        backgroundColor: "rgba(255,255,255,0.28)",
      }} />
      <View style={[StyleSheet.absoluteFill, {
        borderRadius: width / 2, borderWidth: 1.5, borderColor: "rgba(226,204,255,0.9)",
      }]} />
      {SPARKLES.map((sparkle, index) => (
        <Sparkle key={index} {...sparkle} height={height} running={running} />
      ))}
    </View>
  );
}

/**
 * One rail chip. Focus lifts and bulges it, selection presses and ripples, and
 * the active chip keeps a slow glow pulse so the current page stays obvious.
 */
export function RailChip({ focused, active, pressToken, size, children }: {
  focused: boolean;
  active: boolean;
  pressToken: number;
  size: { width: number; height: number };
  children: React.ReactNode;
}) {
  const lift = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const firstToken = useRef(pressToken);

  useEffect(() => {
    Animated.spring(lift, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      damping: 11,
      stiffness: 180,
      mass: 0.6,
    }).start();
    if (!focused) return;
    shimmer.setValue(0);
    Animated.timing(shimmer, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [focused, lift, shimmer]);

  useEffect(() => {
    if (pressToken === firstToken.current) return;
    Animated.sequence([
      Animated.timing(press, { toValue: 0.92, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(press, { toValue: 1.05, duration: 170, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
      Animated.timing(press, { toValue: 1, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
    ripple.setValue(0);
    Animated.timing(ripple, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [pressToken, press, ripple]);

  useEffect(() => {
    if (!active) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => { anim.stop(); pulse.setValue(0); };
  }, [active, pulse]);

  const glowSize = Math.max(size.width, size.height) * 2.0;

  return (
    <View style={{ width: size.width, height: size.height, alignItems: "center", justifyContent: "center" }}>
      {active ? (
        <Animated.Image
          source={GLOW_SPRITE}
          resizeMode="contain"
          style={{
            position: "absolute",
            width: glowSize,
            height: glowSize,
            tintColor: "#C07BFF",
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.46] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) }],
          }}
        />
      ) : null}

      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: size.width,
          height: size.height,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: "rgba(246,233,255,0.95)",
          opacity: ripple.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.6, 0] }),
          transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.6] }) }],
        }}
      />

      <Animated.View
        style={{
          transform: [
            { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) },
            { scale: Animated.multiply(lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }), press) },
          ],
        }}
      >
        {children}
        <Animated.View
          pointerEvents="none"
          style={{
            ...StyleSheet.absoluteFillObject,
            borderRadius: 11,
            overflow: "hidden",
            opacity: shimmer.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }),
          }}
        >
          <Animated.View
            style={{
              position: "absolute",
              top: -size.height,
              bottom: -size.height,
              width: 14,
              backgroundColor: "rgba(255,255,255,0.38)",
              transform: [
                { translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: [-20, size.width + 20] }) },
                { rotate: "18deg" },
              ],
            }}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/* ------------------------------------------------------------------ idles */

export type IdleKind =
  | "pulse" | "scan" | "playPulse" | "heartbeat" | "sway"
  | "sequence" | "progress" | "flash" | "glint" | "spin" | "none";

/** Which idle belongs to which rail destination. */
export const IDLE_FOR_ROUTE: Record<string, IdleKind> = {
  "/": "pulse",
  "/guide": "scan",
  "/vod": "pulse",
  "/favorites": "heartbeat",
  "/reminders": "sway",
  "/channels": "sequence",
  "/movies": "progress",
  "/series": "glint",
  "/search": "glint",
  "/settings": "spin",
};

const IDLE_MS: Record<IdleKind, number> = {
  pulse: 6000, scan: 5000, playPulse: 4000, heartbeat: 5000, sway: 10000,
  sequence: 4200, progress: 5200, flash: 7000, glint: 6500, spin: 20000, none: 0,
};

/**
 * One looping idle per rail icon. Every kind is a transform or an opacity on a
 * single animated value, so ten of them running at once is ten UI-thread
 * animations and no React work. Idles stop when the rail is hidden.
 */
export function RailIdle({ kind, running, size, children }: {
  kind: IdleKind; running: boolean; size: { width: number; height: number }; children: React.ReactNode;
}) {
  const t = useRef(new Animated.Value(0)).current;
  const duration = IDLE_MS[kind];

  useEffect(() => {
    if (!running || kind === "none" || !duration) return;
    const anim = Animated.loop(
      Animated.timing(t, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => { anim.stop(); t.setValue(0); };
  }, [duration, kind, running, t]);

  if (kind === "none" || !running) return <>{children}</>;

  // A short active window inside a long loop keeps most idles mostly still.
  const beat = (a: number, b: number, out: number[]) =>
    t.interpolate({ inputRange: [0, a, (a + b) / 2, b, 1], outputRange: [out[0], out[0], out[1], out[0], out[0]] });

  if (kind === "spin") {
    return (
      <Animated.View style={{ transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>
        {children}
      </Animated.View>
    );
  }
  if (kind === "pulse") {
    return <Animated.View style={{ transform: [{ scale: beat(0.74, 0.94, [1, 1.05]) }] }}>{children}</Animated.View>;
  }
  if (kind === "heartbeat") {
    // Two beats close together, then a long rest, like a real pulse.
    const scale = t.interpolate({
      inputRange: [0, 0.80, 0.845, 0.875, 0.92, 0.95, 1],
      outputRange: [1, 1, 1.12, 1.02, 1.09, 1, 1],
    });
    return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
  }
  if (kind === "sway") {
    const rotate = t.interpolate({
      inputRange: [0, 0.86, 0.90, 0.94, 0.98, 1],
      outputRange: ["0deg", "0deg", "-2deg", "2deg", "0deg", "0deg"],
    });
    return <Animated.View style={{ transform: [{ rotate }] }}>{children}</Animated.View>;
  }

  // The rest paint a small highlight over the artwork rather than deform it.
  const overlay = (() => {
    if (kind === "scan") {
      return (
        <Animated.View style={{
          position: "absolute", left: 0, right: 0, height: 3, top: 4,
          backgroundColor: "rgba(150,230,255,0.85)",
          opacity: beat(0.70, 0.90, [0, 0.9]),
          transform: [{ translateY: beat(0.70, 0.90, [0, size.height - 12]) }],
        }} />
      );
    }
    if (kind === "playPulse" || kind === "flash") {
      return (
        <Animated.View style={{
          ...StyleSheet.absoluteFillObject, borderRadius: 11,
          backgroundColor: kind === "flash" ? "rgba(255,255,255,0.5)" : "rgba(240,171,252,0.45)",
          opacity: beat(0.76, 0.92, [0, kind === "flash" ? 0.3 : 0.4]),
        }} />
      );
    }
    if (kind === "progress") {
      return (
        <Animated.View style={{
          position: "absolute", left: 6, bottom: 5, height: 2, borderRadius: 2,
          backgroundColor: "rgba(240,171,252,0.95)",
          width: size.width - 12,
          opacity: beat(0.0, 1.0, [0.25, 0.8]),
          transform: [{ scaleX: t }, { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-(size.width - 12) / 2, 0] }) }],
        }} />
      );
    }
    if (kind === "sequence") {
      return (
        <Animated.View style={{
          position: "absolute", left: 8, right: 8, height: 1.5, borderRadius: 1,
          backgroundColor: "rgba(255,255,255,0.9)",
          opacity: beat(0.60, 0.95, [0, 0.75]),
          transform: [{
            translateY: t.interpolate({
              inputRange: [0, 0.60, 0.72, 0.84, 0.95, 1],
              outputRange: [6, 6, 6, size.height / 2, size.height - 10, size.height - 10],
            }),
          }],
        }} />
      );
    }
    // glint: a small specular dot crossing the lens
    return (
      <Animated.View style={{
        position: "absolute", top: size.height * 0.3, width: 5, height: 5, borderRadius: 3,
        backgroundColor: "#FFFFFF",
        opacity: beat(0.80, 0.94, [0, 0.95]),
        transform: [{ translateX: beat(0.80, 0.94, [6, size.width - 10]) }],
      }} />
    );
  })();

  return (
    <View style={{ width: size.width, height: size.height, alignItems: "center", justifyContent: "center" }}>
      {children}
      {/* only the overlay is clipped; clipping the wrapper would cut the focus
          lift and the 1.08 scale off at the chip edge */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 13, overflow: "hidden" }]}>{overlay}</View>
    </View>
  );
}

/**
 * The neon blob that travels the rail when the section changes. It is driven
 * from the drawer provider, not the shell, because each route mounts its own
 * shell: a blob owned by the rail would die the moment navigation started.
 */
export function RailEnergy({ fromIndex, toIndex, token, top, step, width }: {
  fromIndex: number; toIndex: number; token: number; top: number; step: number; width: number;
}) {
  const t = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  const seen = useRef(-1);

  useEffect(() => {
    if (token === seen.current || fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    seen.current = token;
    setVisible(true);
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })
      .start(({ finished }) => { if (finished) setVisible(false); });
  }, [fromIndex, toIndex, token, t]);

  if (!visible) return null;
  const size = width * 0.7;
  return (
    <Animated.Image
      source={GLOW_SPRITE}
      resizeMode="contain"
      style={{
        position: "absolute",
        left: (width - size) / 2,
        width: size,
        height: size,
        tintColor: "#D08CFF",
        opacity: t.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 0.85, 0.85, 0] }),
        transform: [{
          translateY: t.interpolate({
            inputRange: [0, 1],
            outputRange: [top + fromIndex * step - size / 2 + step / 2, top + toIndex * step - size / 2 + step / 2],
          }),
        }],
      }}
    />
  );
}
