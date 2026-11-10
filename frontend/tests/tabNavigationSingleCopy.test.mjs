import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");
const TAB_REPLACE = /router\.(?:replace|push)\(\s*"\/(?:guide|vod|settings|channels|movies|series|favorites|reminders|search|epg-sources)?"/;

// A REPLACE/PUSH from a page stacked above (tabs) builds a second copy of every
// tab underneath; those pages must return to the one existing (tabs) navigator.
test("pages stacked above the tabs return to the existing tabs instead of building another copy", async () => {
  for (const page of ["app/player.tsx", "app/multiview.tsx", "app/playlists.tsx", "app/epg-custom.tsx", "app/epg-source.tsx", "app/group-settings.tsx"]) {
    const text = await source(page);
    assert.doesNotMatch(text, TAB_REPLACE, page);
  }
  for (const shared of ["src/components/PurpleTvShell.tsx", "src/components/TvQuickActionsOverlay.tsx", "src/hooks/use-tv-back-to-guide.ts"]) {
    assert.match(await source(shared), /goToTab\(router, /, shared);
  }
  const helper = await source("src/utils/goToTab.ts");
  assert.match(helper, /if \(router\.canDismiss\(\)\) router\.dismissTo\(href as any\);\s*else router\.replace\(href as any\);/);
});

test("a closed drawer's lists can never hold remote focus under the rail", async () => {
  const shell = await source("src/components/PurpleTvShell.tsx");
  const lists = shell.match(/<ScrollView[\s\S]*?>/g) || [];
  assert.equal(lists.length, 2);
  for (const list of lists) assert.match(list, /scrollEnabled=\{drawerOpen\}/);
});

test("the VOD fragment container id can never resolve to a React Native view", async () => {
  const surface = await source("android/app/src/main/java/com/charmiptv/app/CharmVodSurfaceManager.kt");
  const mount = surface.slice(surface.indexOf("private fun mountIfReady"), surface.indexOf("fun restoreNativeFocus"));
  assert.match(mount, /while \(host\.findViewById<View>\(container\.id\) !== container && idTries\+\+ < 64\)/);
  assert.ok(mount.indexOf("findViewById<View>(container.id)") < mount.indexOf(".replace(container.id"), "id is unique before the fragment is placed");
});

test("LEFT to a same-row page neighbour is moved natively, never left to the window-wide search", async () => {
  const activity = await source("android/app/src/main/java/com/charmiptv/app/MainActivity.kt");
  assert.doesNotMatch(activity, /within\(focus, page\) \|\| hasLeftNeighborInRow\(focus, page\)\) return false/);
  assert.equal((activity.match(/if \(hasLeftNeighborInRow\(focus, page\)\) return focusLeftNeighborInRow\(focus, page\)/g) || []).length, 2);
  const helper = activity.slice(activity.indexOf("private fun focusLeftNeighborInRow"), activity.indexOf("private fun hasTaggedAncestor"));
  assert.match(helper, /if \(nativeVodOwnsFocus\(\)\) return false/);
  assert.match(helper, /findNextFocus\(page as\? ViewGroup/);
});

test("VOD Settings buttons pass their section in a param React Navigation keeps", async () => {
  const settings = await source("app/(tabs)/settings.tsx");
  const vod = await source("app/(tabs)/vod.tsx");
  assert.match(settings, /\/vod\?section=settings&pane=\$\{item\.key\}/);
  assert.doesNotMatch(settings, /[?&]screen=/);
  assert.match(vod, /const \{ section, pane \} = useLocalSearchParams/);
});
