import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const element = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
function load(name, mocks, suffix = '', globals = {}) {
  const exports = {};
  const code = ts.transpileModule(read(name) + suffix, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name] || {}, ...globals });
  return exports;
}
const react = { createElement: element, useState: value => [value, () => {}], useRef: value => ({ current: value }) };
react.default = react;
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []; }

test('each TV calibration button changes exactly one pixel on all four edges', () => {
  const changes = [];
  let now = 1000;
  const draft = { left: 0, right: 5, top: -5, bottom: 0 };
  const api = load('src/components/TvCalibrationControls.tsx', {
    react, 'react-native': { Platform: { isTV: true }, StyleSheet: { create: value => value } },
    'expo-haptics': { selectionAsync: async () => {} },
    '@/src/theme': { fonts: {}, radius: {}, spacing: {} },
    '@/src/tvCalibration': { TV_CALIBRATION_MIN_OFFSET: -96, TV_CALIBRATION_MAX_OFFSET: 96,
      useTvCalibration: () => ({ draftCalibration: draft, setSide: (side, value) => changes.push([side, value]) }) },
  }, '', { Date: { now: () => now += 200 } });
  const buttons = nodes(api.TvCalibrationControls());
  for (const side of Object.keys(draft)) {
    for (const [action, delta] of [['minus', -1], ['plus', 1]]) {
      buttons.find(node => node.props.testID === `settings-tv-calibration-${side}-${action}`).props.onPress();
      assert.deepEqual(changes.at(-1), [side, draft[side] + delta]);
    }
  }
  draft.left = -96; draft.right = 96;
  buttons.find(node => node.props.testID === 'settings-tv-calibration-left-minus').props.onPress();
  assert.deepEqual(changes.at(-1), ['left', -96]);
  buttons.find(node => node.props.testID === 'settings-tv-calibration-right-plus').props.onPress();
  assert.deepEqual(changes.at(-1), ['right', 96]);
});

test('playlist actions remain focusable but cannot run while disabled', () => {
  const api = load('app/playlists.tsx', { react,
    'react-native': { StyleSheet: { create: value => value } },
    '@/src/theme': { fonts: {}, radius: {}, tvColors: {} },
  }, '\nexport { Action };');
  let calls = 0;
  for (const disabled of [true, false]) {
    const button = api.Action({ label: 'Refresh', disabled, onPress: () => calls++ });
    assert.equal(button.props.focusable, true);
    assert.notEqual(button.props.disabled, true);
    assert.equal(button.props.accessibilityState.disabled, disabled);
    button.props.onPress();
    assert.equal(calls, disabled ? 0 : 1);
  }
});

test('playlist list and editor use the same complete-page focus boundary as EPG settings', () => {
  const screen = read('app/playlists.tsx');
  assert.doesNotMatch(screen, /<FocusGuide/);
  for (const text of ['removeClippedSubviews={false}', 'focusable={false}', 'ref={scrollRef}',
    'nextFocusLeft={iconRailEntryTag}', 'hasTVPreferredFocus={entryFocus.preferredFocus}', 'All Settings']) assert.ok(screen.includes(text), text);
  assert.match(screen, /useFocusEffect\(useCallback\([\s\S]*?scrollTo\(\{ y: 0, animated: false \}\)[\s\S]*?\[editing\]/);
  assert.match(screen, /if \(operationInFlight.current\) return/);
  assert.doesNotMatch(screen, /<Pressable[^>]*disabled=\{busy\}/);
});

test('host and VOD support API 24 without dropping current framework or HTTP source support', () => {
  const app = JSON.parse(read('app.json')).expo;
  assert.equal(app.plugins.find(p => Array.isArray(p) && p[0] === 'expo-build-properties')[1].android.minSdkVersion, 24);
  assert.match(read('android/gradle.properties'), /android.minSdkVersion=24/);
  assert.match(read('android/vod/app/build.gradle'), /minSdk 24/);
  assert.match(read('android/app/build.gradle'), /coreLibraryDesugaringEnabled true/);
  assert.doesNotMatch(read('android/app/src/main/res/values/styles.xml'), /android:windowSplashScreenBehavior/);
  assert.match(read('android/app/src/main/res/values-v33/styles.xml'), /android:windowSplashScreenBehavior/);
  const audio = read('scripts/build-media3-ffmpeg-audio.sh');
  assert.match(audio, /CHARM_FFMPEG_ANDROID_API:-\$APP_MIN_SDK/);
  assert.match(audio, /ANDROID_API > APP_MIN_SDK/);
  assert.doesNotMatch(audio, /CHARM_FFMPEG_ANDROID_API:-26/);
  const welcome = read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmVodWelcomeView.kt');
  assert.match(welcome, /SDK_INT >= Build.VERSION_CODES.O\) \{\s*ValueAnimator.areAnimatorsEnabled\(\)/);
  assert.match(welcome, /Settings.Global.ANIMATOR_DURATION_SCALE/);
  const settings = read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/settings/SettingsTvFragment.kt');
  for (const kind of ['Backup', 'DatabaseBackup']) {
    assert.match(settings, new RegExp(`private fun export${kind}ToDownloads[^\\n]+\\{\\s*(?://[^\\n]*\\n\\s*)*if \\(Build.VERSION.SDK_INT < Build.VERSION_CODES.Q\\) \\{\\s*export${kind}ToLocalFile\\(fileName\\)`));
  }
  assert.match(read('android/app/src/main/AndroidManifest.xml'), /usesCleartextTraffic="\$\{allowCleartextStreams\}"/);
});

test('launcher and circular VOD welcome use the exact same supplied full-resolution artwork', () => {
  const asset = readFileSync(new URL('../assets/images/charm-living-room.png', import.meta.url));
  const native = readFileSync(new URL('../android/vod/app/src/main/res/drawable-nodpi/charm_living_room.png', import.meta.url));
  assert.equal(createHash('sha256').update(asset).digest('hex'), createHash('sha256').update(native).digest('hex'));
  assert.equal(asset.readUInt32BE(16), 1254);
  assert.equal(asset.readUInt32BE(20), 1254);
  const welcome = read('android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmVodWelcomeView.kt');
  assert.match(welcome, /R.drawable.charm_living_room/);
  assert.match(welcome, /BitmapShader/);
  assert.match(welcome, /canvas.drawCircle\(logoBounds.centerX\(\)/);
  assert.doesNotMatch(welcome, /canvas.drawBitmap\(logo/);
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:icon="@drawable\/charm_launcher"/);
  assert.match(manifest, /android:banner="@drawable\/charm_tv_banner"/);
  for (const name of ['drawable/charm_launcher.xml', 'drawable-v26/charm_launcher.xml', 'drawable/charm_tv_banner.xml'])
    assert.match(read(`android/app/src/main/res/${name}`), /@drawable\/charm_living_room/);
});
