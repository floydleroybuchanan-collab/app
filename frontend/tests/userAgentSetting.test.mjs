import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_USER_AGENT,
  USER_AGENT_PRESETS,
  cleanUserAgentInput,
  getActiveUserAgent,
  nativeUserAgentValue,
  normalizeUserAgentChoice,
  resolveUserAgent,
  sanitizeUserAgent,
  setActiveUserAgent,
} from "../src/core/userAgent.ts";
import { parsePipeHeaders } from "../src/core/streamPolicy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("the default User-Agent is unchanged and every preset is a legal header value", () => {
  assert.equal(DEFAULT_USER_AGENT, "TiviMate/5.1.6 (Linux; Android TV)");
  assert.deepEqual(resolveUserAgent({ preset: "default", custom: "ignored" }), DEFAULT_USER_AGENT);
  for (const preset of USER_AGENT_PRESETS) assert.equal(sanitizeUserAgent(preset.value), preset.value);
});

test("custom text keeps spaces while typing and is trimmed and made header-safe when sent", () => {
  assert.equal(cleanUserAgentInput("My Player "), "My Player ");
  assert.equal(resolveUserAgent({ preset: "custom", custom: "  My Player/1.0 (Android)  " }), "My Player/1.0 (Android)");
  assert.equal(resolveUserAgent({ preset: "custom", custom: "bad\r\nX-Injected: yes" }), "badX-Injected: yes");
  assert.equal(resolveUserAgent({ preset: "custom", custom: "   " }), DEFAULT_USER_AGENT);
  assert.equal(cleanUserAgentInput("é漢"), "");
  assert.equal(cleanUserAgentInput("a".repeat(500)).length, 200);
});

test("saved choices are normalized and the native copy is blank for the default", () => {
  assert.deepEqual(normalizeUserAgentChoice(null), { preset: "default", custom: "" });
  assert.deepEqual(normalizeUserAgentChoice({ preset: "nope", custom: 5 }), { preset: "default", custom: "" });
  assert.equal(nativeUserAgentValue({ preset: "default", custom: "" }), "");
  assert.equal(nativeUserAgentValue({ preset: "vlc", custom: "" }), USER_AGENT_PRESETS.find((p) => p.id === "vlc").value);
  assert.equal(nativeUserAgentValue({ preset: "custom", custom: "Mine/2" }), "Mine/2");
});

test("streams use the chosen User-Agent unless the playlist supplies its own", () => {
  try {
    setActiveUserAgent("Mine/2");
    assert.equal(getActiveUserAgent(), "Mine/2");
    assert.deepEqual(parsePipeHeaders("https://p.example/live").headers, { "User-Agent": "Mine/2" });
    assert.equal(parsePipeHeaders("https://p.example/live|Referer=x").headers["User-Agent"], "Mine/2");
    assert.equal(parsePipeHeaders("https://p.example/live|User-Agent=Provider").headers["User-Agent"], "Provider");
    assert.deepEqual(parsePipeHeaders("udp://@239.0.0.1:1234").headers, {});
  } finally { setActiveUserAgent(""); }
  assert.equal(getActiveUserAgent(), DEFAULT_USER_AGENT);
});

test("native requests read the saved User-Agent and Settings exposes it", async () => {
  const dir = "android/app/src/main/java/com/charmiptv/app/";
  const [agent, device, playlist, playback, multiview, epg, customEpg, background, settings, runtime, nativeEpg] = await Promise.all([
    source(dir + "CharmUserAgent.kt"), source(dir + "CharmDeviceModule.kt"), source(dir + "NativePlaylistParser.kt"), source(dir + "NativePlaybackManager.kt"),
    source(dir + "NativeMultiview.kt"), source(dir + "EpgNativeModule.kt"), source(dir + "CustomEpgNativeModule.kt"), source(dir + "BackgroundEpgUpdater.kt"),
    source("app/(tabs)/settings.tsx"), source("src/utils/tvRuntime.ts"), source("src/nativeEpg.ts"),
  ]);
  assert.match(agent, /const val DEFAULT = "TiviMate\/5\.1\.6 \(Linux; Android TV\)"/);
  assert.match(agent, /filter \{ it == '.{1,2}t' \|\| it in ' '\.\.'~' \}/);
  assert.match(device, /fun setUserAgent\(value: String\)[\s\S]*?CharmUserAgent\.set\(ctx, value\)/);
  assert.match(device, /putString\("userAgent", CharmUserAgent\.stored\(ctx\)\)/);
  assert.match(playlist, /\.header\("User-Agent", CharmUserAgent\.current\(\)\)/);
  assert.match(playback, /properties\["User-Agent"\] = CharmUserAgent\.current\(context\)/);
  assert.match(playback, /\?: CharmUserAgent\.current\(activity\)/);
  assert.match(multiview, /"User-Agent" to CharmUserAgent\.current\(ctx\)/);
  assert.match(epg, /"User-Agent", CharmUserAgent\.current\(\)/);
  assert.match(customEpg, /"User-Agent", CharmUserAgent\.current\(reactContext\)/);
  assert.match(background, /CharmUserAgent\.overrideOrNull\(context\) \?: "Charming MediaLab\/2 AndroidTV"/);
  assert.doesNotMatch(playlist + playback + multiview + epg + customEpg, /"TiviMate\/5\.1\.6/);
  assert.match(runtime, /setActiveUserAgent\(readProfile\(\)\?\.userAgent\)/);
  assert.match(nativeEpg, /"User-Agent": getActiveUserAgent\(\)/);
  assert.match(settings, /useUserAgentPreference\(\)/);
  assert.match(settings, /<Text style=\{styles\.settingLabel\}>User agent<\/Text>/);
  assert.match(settings, /testID="settings-user-agent"/);
});
