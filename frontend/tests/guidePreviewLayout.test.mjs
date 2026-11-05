import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { guidePreviewLayout } from "../src/core/guidePreviewLayout.ts";

test("TV drawers move the guide without resizing an otherwise fitting 16:9 preview", () => {
  const full = guidePreviewLayout(1480);
  const nestedDrawers = guidePreviewLayout(1480 - 192 - 232);
  assert.equal(full.previewWidth, nestedDrawers.previewWidth);
  assert.equal(nestedDrawers.previewWidth / nestedDrawers.previewHeight, 16 / 9);
  assert.equal(nestedDrawers.informationWidth + nestedDrawers.previewWidth, 1056);
});

test("narrow and invalid guide surfaces never overflow or produce negative geometry", () => {
  for (const available of [0, 160, 240, 320, 480, 1024, -20, NaN]) {
    const layout = guidePreviewLayout(available);
    const width = Number.isFinite(available) ? Math.max(0, available) : 0;
    assert.ok(layout.previewWidth >= 0 && layout.informationWidth >= 0);
    assert.equal(layout.previewWidth + layout.informationWidth, width);
    assert.equal(layout.previewHeight, layout.previewWidth * 9 / 16);
    if (width >= 320) assert.ok(layout.informationWidth >= 147);
  }
});

function preferences(saved) {
  const files = new Map(Object.entries(saved || {}));
  const source = readFileSync(new URL("../src/core/guideUiPreferences.ts", import.meta.url), "utf8") + "\nexport { load as testLoad };";
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    if (name === "react") return { useCallback() {}, useEffect() {}, useState() {} };
    if (name.includes("guideGroupTabPersistence")) return { useGuideGroupTabPreferences() {} };
    if (name.includes("storage")) return { storage: {
      getItem: async (key, fallback) => files.has(key) ? files.get(key) : fallback,
      setItem: async (key, value) => { files.set(key, value); return true; },
    } };
    throw Error(name);
  } });
  return { api: exports, files };
}

test("new installations have audible preview while explicit saved mute remains respected", async () => {
  assert.equal((await preferences().api.testLoad()).mutePreview, false);
  assert.equal((await preferences({ gs_guide_mute_preview: true }).api.testLoad()).mutePreview, true);
  assert.equal((await preferences({ gs_guide_mute_preview: false }).api.testLoad()).mutePreview, false);
  const h = preferences(); await h.api.setMuteGuidePreview(true);
  assert.equal(h.files.get("gs_guide_mute_preview"), true);
  assert.equal((await h.api.testLoad()).mutePreview, true);
});
