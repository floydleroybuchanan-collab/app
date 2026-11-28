import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useMotionAllowed } from "@/src/components/StartupScene";
import { fonts } from "@/src/theme";

/**
 * "Covert signal detected" — the 2.1 second reveal that plays over the black
 * native splash, before the loading screen.
 *
 * One linear clock drives every phase, so the whole sequence is a single
 * native-driver animation: no JS runs per frame and nothing re-renders. The
 * reveal is a black cover sliding down off the artwork rather than a mask,
 * because masking needs a library this app does not ship.
 *
 * Honours reduce-motion by cutting straight to the final frame.
 */

const BANNER = require("../../assets/medialab/splash_banner.png");
const NOISE = require("../../assets/medialab/signal_noise.png");
const GLOW = require("../../assets/login/star_glow.png");

const SIGNAL_GREEN = "#00FF88";
const SIGNAL_SOFT = "#66FFB2";

/** Total sequence. Phase markers below are fractions of this. */
export const INTRO_MS = 2350;
const at = (ms: number) => ms / INTRO_MS;

const PARTICLES = [
  { x: 0.20, y: 0.60, size: 4, phase: 0.0 }, { x: 0.31, y: 0.78, size: 3, phase: 0.35 },
  { x: 0.40, y: 0.58, size: 5, phase: 0.7 }, { x: 0.49, y: 0.84, size: 2, phase: 0.15 },
  { x: 0.57, y: 0.62, size: 4, phase: 0.5 }, { x: 0.64, y: 0.80, size: 3, phase: 0.85 },
  { x: 0.72, y: 0.57, size: 3, phase: 0.25 }, { x: 0.79, y: 0.76, size: 4, phase: 0.6 },
  { x: 0.26, y: 0.88, size: 2, phase: 0.45 }, { x: 0.85, y: 0.66, size: 3, phase: 0.9 },
];

export function SignalIntro({ onDone }: { onDone?: () => void }) {
  const { width, height } = useWindowDimensions();
  const motion = useMotionAllowed();
  const clock = useRef(new Animated.Value(0)).current;
  const [gone, setGone] = useState(false);

  const layout = useMemo(() => {
    const bw = Math.round(width * 0.58);
    const bh = Math.round(bw * 829 / 1600);
    return { bw, bh, bx: (width - bw) / 2, by: Math.round(height * 0.08) };
  }, [width, height]);

  useEffect(() => {
    if (!motion) {
      clock.setValue(at(1900));
      const timer = setTimeout(() => { setGone(true); onDone?.(); }, 650);
      return () => clearTimeout(timer);
    }
    Animated.timing(clock, {
      toValue: 1, duration: INTRO_MS, easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    }).start(({ finished }) => { if (finished) { setGone(true); onDone?.(); } });
  }, [clock, motion, onDone]);

  if (gone) return null;

  const band = (from: number, to: number, out: number[]) =>
    clock.interpolate({ inputRange: [0, at(from), at(to), 1], outputRange: [out[0], out[0], out[1], out[1]] });
  const pulse = (from: number, to: number, peak: number) =>
    clock.interpolate({
      inputRange: [0, at(from), at((from + to) / 2), at(to), 1],
      outputRange: [0, 0, peak, 0, 0],
    });

  const { bw, bh, bx, by } = layout;

  return (
    <View pointerEvents="none" style={styles.root}>
      <View style={{ position: "absolute", left: bx, top: by, width: bw, height: bh }}>
        {/* phase 6 — the logo locks in at full size, no bounce */}
        <Animated.Image
          source={BANNER}
          resizeMode="contain"
          style={{
            width: bw, height: bh,
            transform: [{ scale: band(1200, 1500, [0.98, 1]) }],
          }}
        />

        {/* phase 7 — fragments drifting off the cracked letters */}
        {PARTICLES.map((p, i) => (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              left: bw * p.x, top: bh * p.y,
              width: p.size, height: p.size, borderRadius: p.size,
              backgroundColor: "rgba(190,200,185,1)",
              opacity: pulse(1300 + p.phase * 400, 2350, 0.4),
              transform: [{ translateY: band(1300, 2350, [0, 46]) }],
            }}
          />
        ))}

        {/* phase 4 — the craft powers up: a glow bloom, never a flying saucer */}
        <Animated.Image
          source={GLOW}
          resizeMode="contain"
          style={{
            position: "absolute",
            left: bw * 0.645 - bw * 0.2, top: bh * 0.28 - bw * 0.2,
            width: bw * 0.4, height: bw * 0.4,
            tintColor: SIGNAL_GREEN,
            opacity: pulse(1000, 1450, 0.5),
          }}
        />

        {/* phase 5 — it notices you, without moving */}
        <Animated.Image
          source={GLOW}
          resizeMode="contain"
          style={{
            position: "absolute",
            left: bw * 0.285 - bw * 0.06, top: bh * 0.345 - bw * 0.06,
            width: bw * 0.12, height: bw * 0.12,
            tintColor: SIGNAL_SOFT,
            opacity: pulse(1100, 1450, 0.65),
          }}
        />

        {/* phase 3 — the sensor sweep. A cover sliding down, so the artwork is
            discovered rather than faded in. */}
        <Animated.View
          style={{
            position: "absolute", left: -2, right: -2, top: 0, height: bh + 4,
            backgroundColor: "#000",
            transform: [{ translateY: band(300, 1000, [0, bh + 6]) }],
          }}
        />
        <Animated.View
          style={{
            position: "absolute", left: -width, right: -width, top: -2, height: 4,
            opacity: band(1000, 1040, [1, 0]),
            transform: [{ translateY: band(300, 1000, [0, bh]) }],
          }}
        >
          <View style={styles.scanCore} />
          <Image source={GLOW} resizeMode="stretch" style={styles.scanGlow} />
        </Animated.View>
      </View>

      {/* phase 8 */}
      <Animated.View style={{ position: "absolute", left: 0, right: 0, top: by + bh + 34, opacity: band(1450, 1750, [0, 1]) }}>
        <Text style={styles.tagline}>Something is out there, and we&apos;re tuning in.</Text>
        <Text style={styles.tagline}>Get ready to uncover the unexplained.</Text>
      </Animated.View>

      {/* phase 9 — the last broadcast, once, never looped */}
      <Animated.View style={{ position: "absolute", left: 0, right: 0, top: by + bh + 112, opacity: band(1700, 1900, [0, 1]) }}>
        <Animated.Text style={[styles.soon, { opacity: pulse(1700, 1950, 0.55) }]}>Coming Soon.</Animated.Text>
        <Text style={[styles.soon, styles.soonBase]}>Coming Soon.</Text>
      </Animated.View>

      {/* phase 2 — a classified monitor waking up, not television snow. Drawn
          above the artwork, so the reveal cover never shows as a dark rectangle
          against it. */}
      <Animated.Image
        source={NOISE}
        resizeMode="repeat"
        style={[StyleSheet.absoluteFill, { opacity: pulse(150, 420, 0.06) }]}
      />

      {/* the transmission ends */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: "#000", opacity: band(1950, 2250, [0, 1]) }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 2000, backgroundColor: "#000" },
  scanCore: { position: "absolute", left: 0, right: 0, top: 1, height: 3, backgroundColor: SIGNAL_GREEN },
  scanGlow: { position: "absolute", left: 0, right: 0, top: -14, height: 32, tintColor: SIGNAL_GREEN, opacity: 0.45 },
  tagline: { color: "rgba(255,255,255,0.85)", fontFamily: fonts.medium, fontSize: 19, textAlign: "center", marginBottom: 8 },
  soon: { position: "absolute", left: 0, right: 0, color: SIGNAL_GREEN, fontFamily: fonts.semibold, fontSize: 22, textAlign: "center" },
  soonBase: { position: "relative" },
});
