import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("sign-in uses the animated space scene, and the invitation button is called Setup Account", async () => {
  const [gate, scene] = await Promise.all([source("src/components/AccountGate.tsx"), source("src/components/LoginScene.tsx")]);
  assert.match(gate, /<LoginScene animate=\{!securityScreen\} \/>/);
  // Same handler as before: it switches between sign in and the invitation flow.
  assert.match(gate, /testID="account-switch-mode"[\s\S]*?mode === "login" \? "Setup Account" : "Return to sign in"/);
  assert.doesNotMatch(gate, /I have an invitation/);
  assert.match(gate, /Request app access/);
  // Decorative, never focusable, and still when reduce-motion is on or the app is in the background.
  assert.match(scene, /pointerEvents="none"/);
  assert.match(scene, /isReduceMotionEnabled/);
  assert.match(scene, /AppState/);
  assert.match(scene, /useNativeDriver: true/);
  // A still crown-in-the-clouds background (wordmark baked in) with the same shapes
  // repeated as a transparent foreground cutout, so the meteors below can genuinely
  // pass behind the crown/logo; shown only on wide screens.
  assert.match(scene, /scene_bg\.webp/);
  assert.match(scene, /scene_foreground\.webp/);
  assert.match(scene, /const sceneVisible = showAngel && width > height/);
  assert.match(scene, /const METEORS: Meteor\[\] = \[/);
  assert.match(scene, /const PULSE_STARS: PulseStar\[\] = \[/);
  assert.match(scene, /function JewelPulse/);
});

test("the sign-in artwork ships with the app", async () => {
  for (const file of ["assets/login/scene_bg.webp", "assets/login/scene_foreground.webp"]) assert.ok((await readFile(join(root, file))).length > 10_000, file);
});

test("the loading screen keeps the approved live effects over the looping artwork", async () => {
  const [startup, scene, effects] = await Promise.all([source("src/components/StartupVersion4.tsx"), source("src/components/StartupScene.tsx"), source("src/components/StartupEffects.tsx")]);
  assert.match(startup, /<StartupScene growth=\{growth\} \/>/);
  assert.match(startup, /Loading Charming MediaLab/);
  assert.match(startup, /TV guide and library/);
  assert.match(startup, /rgba\(14,8,34,\.25\)/);
  assert.match(startup, /<TypedTask/);
  // fades in, and out when ready
  assert.match(startup, /FADE_IN_MS/);
  assert.match(startup, /FADE_OUT_MS/);
  // puddles spread with progress; bars have shimmer, edge glow and a falling paint drop; text types in
  assert.match(effects, /export function PuddleLayer/);
  assert.match(effects, /outputRange: \[1, 1\.78\]/);
  assert.match(effects, /sheen/);
  assert.match(effects, /drip/);
  assert.match(effects, /export function TypedTask/);
  assert.match(effects, /export function BloomLayer/);
  assert.match(scene, /pointerEvents="none"/);
  assert.match(scene, /isReduceMotionEnabled/);
  assert.match(scene, /AppState/);
  for (const file of ["startup_back.webp", "startup_move.webp", "startup_back_still.jpg", "startup_art.png", "startup_bloom.png"]) assert.ok((await readFile(join(root, "assets/login", file))).length > 10_000, file);
});
