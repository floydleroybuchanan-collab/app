import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFile(join(root, path), "utf8");

test("transient grid selection retains the existing preview tune until a settled channel changes it", async () => {
  const [guide, rail] = await Promise.all([source("app/(tabs)/guide.tsx"), source("src/components/GuidePreviewRail.tsx")]);
  assert.match(guide, /const tunedChannel = previewId \? channelById\.get\(previewId\)/);
  assert.doesNotMatch(guide, /previewId === channel\.id/);
  assert.match(rail, /key=\{`guide-preview-\$\{tunedChannel\.id\}-\$\{previewEpoch\}`\}/);
  assert.match(guide, /if \(!settled && guideSessionChannelId !== channel\.id && previewTimer\.current\) \{\s*clearTimeout\(previewTimer\.current\)/);
  assert.match(guide, /if \(settled\) \{\s*rememberGuideGroupChannel\(group, channel\.id\);\s*armPreviewForChannel\(channel\)/);
});

test("Guide serializes Quick Actions PIN and Program Details modal ownership", async () => {
  const [guide, rail, programModal, quick] = await Promise.all([
    source("app/(tabs)/guide.tsx"),
    source("src/components/GuidePreviewRail.tsx"),
    source("src/components/ProgramModal.tsx"),
    source("src/components/TvQuickActionsOverlay.tsx"),
  ]);
  assert.doesNotMatch(rail, /Pressable|onActionsFocusChange|hasTVPreferredFocus/);
  assert.match(guide, /active=\{isFocused && !activeProgram && !pinPromptGroup && !quickActionsOpen && !drawerOpen && !groupDrawerOpen && !assignFocused\}/);
  assert.match(guide, /previewId=\{safePreviewMode === "off" \|\| !!activeProgram \|\| !!pinPromptGroup \|\| quickActionsOpen \|\| !isFocused \? null : previewId\}/);
  assert.match(guide, /const pinModalOwnedRef = useRef\(false\)/);
  assert.match(guide, /const pinReturnToGroupsRef = useRef\(false\)/);
  assert.match(guide, /const openPinPrompt = useCallback/);
  assert.match(guide, /pinModalOwnedRef\.current = true[\s\S]*setGuideNavigationActive\(false\)[\s\S]*setRemoteContext\("modal"\)/);
  assert.match(guide, /if \(returnToGroups\) setGroupDrawerOpen\(false\)/);
  assert.match(guide, /const closePinPrompt = useCallback/);
  assert.match(guide, /setRemoteContext\("guide_groups"\)[\s\S]*setGroupDrawerOpen\(true\)/);
  assert.match(guide, /BackHandler\.addEventListener\("hardwareBackPress"[\s\S]*closePinPrompt\(true\)/);
  assert.match(guide, /openPinPrompt\(next, groupDrawerOpen\)/);
  assert.match(guide, /openPinPrompt\(nextGroup, false\)/);
  assert.match(guide, /zIndex: 120, elevation: 120/);
  assert.match(quick, /if \(nextContext === "guide"\) setGuideNavigationActive\(false\)/);
  assert.match(quick, /if \(restored && restore === "guide"\) setGuideNavigationActive\(true\)/);
  assert.match(programModal, /if \(pathname\?\.startsWith\("\/guide"\)\) setGuideNavigationActive\(false\)/);
  assert.match(programModal, /if \(restored && restore === "guide"\) setGuideNavigationActive\(true\)/);
});
