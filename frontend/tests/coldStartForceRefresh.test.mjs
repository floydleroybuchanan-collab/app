import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const prefs = fs.readFileSync(new URL("../src/core/sourceRefreshPreferences.ts", import.meta.url), "utf8");
const scheduler = fs.readFileSync(new URL("../src/components/SourceRefreshScheduler.tsx", import.meta.url), "utf8");

test("cold-start forced refresh is opt-in", () => {
  assert.match(
    prefs,
    /updateEpgOnAppStart:\s*false/,
    "cold-start refresh must default off",
  );
  assert.match(
    prefs,
    /updateEpgOnAppStart:\s*updateEpgOnAppStart\s*===\s*true/,
    "only an explicit persisted true may enable cold-start force refresh",
  );
  assert.match(
    scheduler,
    /if \(isInitialCheck && prefs\.updateEpgOnAppStart\)/,
    "forcing a startup update requires opt-in; ordinary due-only checks still run",
  );
  assert.match(
    scheduler,
    /if \(isInitialCheck && prefs\.updateEpgOnAppStart\) \{\s*await refreshEpgOnly\(true, screenIsSafe\);/s,
    "the EPG startup option refreshes guides without also forcing playlist downloads",
  );
});
