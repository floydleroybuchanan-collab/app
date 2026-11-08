import assert from "node:assert/strict";
import fs from "node:fs";

const store = fs.readFileSync(new URL("../src/store.tsx", import.meta.url), "utf8");
const native = fs.readFileSync(new URL("../android/app/src/main/java/com/charmiptv/app/EpgNativeModule.kt", import.meta.url), "utf8");
assert.match(store, /DEFAULT_GUIDE_WINDOW_HOURS = readGuideWindowHours\(process\.env\.EXPO_PUBLIC_GUIDE_WINDOW_HOURS, 24\)/);
assert.match(store, /n === 6 \|\| n === 8 \|\| n === 12 \|\| n === 24/);
const policy = fs.readFileSync(new URL("../android/app/src/main/java/com/charmiptv/app/EpgWindowPolicy.kt", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("../android/app/src/main/java/com/charmiptv/app/BackgroundEpgUpdater.kt", import.meta.url), "utf8");
const custom = fs.readFileSync(new URL("../android/app/src/main/java/com/charmiptv/app/CustomEpgNativeModule.kt", import.meta.url), "utf8");
assert.match(policy, /FUTURE_MS = 24L \* 60L \* 60L \* 1000L/);
for (const importer of [native, background, custom]) assert.match(importer, /GUIDE_WINDOW_MS\s*=\s*EpgWindowPolicy\.FUTURE_MS/);
assert.doesNotMatch(native, /GUIDE_WINDOW_MS = 72L/);
console.log("guide window policy regression: ok");
