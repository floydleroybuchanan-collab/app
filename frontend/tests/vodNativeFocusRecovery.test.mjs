import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vod = (relative) => readFileSync(resolve(root,
  "android/vod/app/src/main/java/com/streamflixreborn/streamflix/", relative), "utf8");

test("native Streamflix catalog error transfers focus to visible retry button", () => {
  const home = vod("fragments/home/HomeTvFragment.kt");
  const chooser = vod("fragments/providers/ProvidersTvFragment.kt");
  assert.match(home, /binding\.vgvHome\.visibility = View\.GONE[\s\S]*?btnIsLoadingRetry\.post/);
  assert.match(chooser, /binding\.rvProviders\.visibility = View\.GONE[\s\S]*?btnIsLoadingRetry\.post/);
  for (const source of [home, chooser]) {
    assert.match(source, /btnIsLoadingRetry\.isShown/);
    assert.match(source, /btnIsLoadingRetry\.requestFocus\(\)/);
  }
});

test("saved native focus restoration is bounded and has a visible fallback", () => {
  const state = vod("charm/VodFocusMemory.kt");
  assert.match(state, /var focusRestoreAttempts = 0/);
  assert.match(state, /focusRestoreAttempts < 3/);
  assert.match(state, /focusRestoreAttempts >= 8/);
  assert.match(state, /val target = savedTarget/);
  assert.match(state, /root\.getFocusables\(View\.FOCUS_FORWARD\)/);
  assert.match(state, /root\.viewTreeObserver\.removeOnPreDrawListener\(this\)/);
});
