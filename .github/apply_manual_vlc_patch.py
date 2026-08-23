from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"missing {label} anchor")
    return text.replace(old, new, 1)


# Fix profile hydration/persistence so an AsyncStorage read that began before a
# user/player mutation can never overwrite the newer in-memory profile.
profile_path = Path("frontend/src/core/playbackProfileIndex.ts")
profile = profile_path.read_text()
profile = replace_once(
    profile,
    "let persistChain: Promise<void> = Promise.resolve();\nconst listeners",
    "let persistChain: Promise<void> = Promise.resolve();\nlet mutationRevision = 0;\nconst listeners",
    "profile mutation revision",
)
old_load = '''async function loadProfiles(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const stored = await storage.getItem<Record<string, ChannelPlaybackProfile>>(STORAGE_KEY, {});
    cached = stored && typeof stored === "object" ? prune(stored) : {};
    loaded = true;
  })();
  try { await loadPromise; } finally { loadPromise = null; }
}'''
new_load = '''async function loadProfiles(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  const revisionAtStart = mutationRevision;
  loadPromise = (async () => {
    const stored = await storage.getItem<Record<string, ChannelPlaybackProfile>>(STORAGE_KEY, {});
    const storedProfiles = stored && typeof stored === "object" ? prune(stored) : {};
    cached = mutationRevision === revisionAtStart
      ? storedProfiles
      : prune({ ...storedProfiles, ...cached });
    loaded = true;
  })();
  try { await loadPromise; } finally { loadPromise = null; }
}'''
profile = replace_once(profile, old_load, new_load, "profile hydration")
old_persist = '''function persist() {
  const snapshot = prune({ ...cached });
  cached = snapshot;
  persistChain = persistChain
    .catch(() => undefined)
    .then(() => storage.setItem(STORAGE_KEY, snapshot))
    .then(() => undefined);
}'''
new_persist = '''function persist() {
  persistChain = persistChain
    .catch(() => undefined)
    .then(async () => {
      const pendingLoad = loadPromise;
      if (pendingLoad) await pendingLoad.catch(() => undefined);
      const snapshot = prune({ ...cached });
      cached = snapshot;
      await storage.setItem(STORAGE_KEY, snapshot);
    })
    .then(() => undefined);
}'''
profile = replace_once(profile, old_persist, new_persist, "profile persistence")
profile = replace_once(
    profile,
    '''  cached = { ...cached, [key]: next };
  loaded = true;
  publish();''',
    '''  mutationRevision += 1;
  cached = { ...cached, [key]: next };
  publish();''',
    "single profile mutation",
)
profile = replace_once(
    profile,
    '''  cached = prune(next);
  loaded = true;
  publish();''',
    '''  mutationRevision += 1;
  cached = prune(next);
  publish();''',
    "batch profile mutation",
)
profile = replace_once(
    profile,
    '''  const { confirmedType: _ignored, ...rest } = cached[key];
  cached = { ...cached, [key]: { ...rest, updatedAt: Date.now() } };
  publish();''',
    '''  const { confirmedType: _ignored, ...rest } = cached[key];
  mutationRevision += 1;
  cached = { ...cached, [key]: { ...rest, updatedAt: Date.now() } };
  publish();''',
    "profile invalidation mutation",
)
profile_path.write_text(profile)

# Populate declared playback profiles from stream_type values the native M3U
# parser already produced. This is deliberately a catalog write only: no HEAD,
# GET, probe, or second playback connection is introduced.
source_path = Path("frontend/src/source.native.ts")
source_bytes = source_path.read_bytes()
source = source_bytes.decode("utf-8")
nl = "\r\n" if "\r\n" in source else "\n"
profile_import = 'import { indexDeclaredStreamTypes } from "@/src/core/playbackProfileIndex";'
if profile_import not in source:
    anchor = 'import { getEpgSourcePreferences, type EpgSourcePreferences } from "@/src/core/epgSourcePreferences";' + nl
    if anchor not in source:
        raise SystemExit("missing source.native import anchor")
    source = source.replace(anchor, anchor + profile_import + nl, 1)
old_sync = (
    'async function syncPlaylistToNative(channels: Channel[], playlistEpoch: number): Promise<void> {' + nl
    + '  if (!nativeEpgAvailable || !channels.length) return;' + nl
    + '  const contentFingerprint = playlistNativeContentFingerprint(channels);'
)
new_sync = (
    'async function syncPlaylistToNative(channels: Channel[], playlistEpoch: number): Promise<void> {' + nl
    + '  if (!channels.length) return;' + nl
    + '  indexDeclaredStreamTypes(channels);' + nl
    + '  if (!nativeEpgAvailable) return;' + nl
    + '  const contentFingerprint = playlistNativeContentFingerprint(channels);'
)
if 'indexDeclaredStreamTypes(channels);' not in source:
    if old_sync not in source:
        raise SystemExit("missing source.native sync anchor")
    source = source.replace(old_sync, new_sync, 1)
source_path.write_bytes(source.encode("utf-8"))

# Add a source-contract regression test for both safety properties.
test_path = Path("frontend/tests/manualVlcEngine.test.mjs")
test_text = test_path.read_text()
if 'playlist stream types are batch-indexed without probing' not in test_text:
    test_text += '''\n\ntest("playlist stream types are batch-indexed without probing and hydration cannot clobber edits", async () => {
  const [profile, source] = await Promise.all([read("src/core/playbackProfileIndex.ts"), read("src/source.native.ts")]);
  assert.match(profile, /let mutationRevision = 0/);
  assert.match(profile, /const revisionAtStart = mutationRevision/);
  assert.match(profile, /prune\\(\\{ \\.\\.\\.storedProfiles, \\.\\.\\.cached \\}\\)/);
  assert.match(profile, /const pendingLoad = loadPromise/);
  assert.match(source, /indexDeclaredStreamTypes\\(channels\\)/);
  assert.match(source, /if \\(!channels\\.length\\) return;[\\s\\S]*indexDeclaredStreamTypes\\(channels\\);[\\s\\S]*if \\(!nativeEpgAvailable\\) return;/);
  assert.doesNotMatch(profile, /fetch\\(|XMLHttpRequest|HEAD request|probeStream/);
});\n'''
    test_path.write_text(test_text)

# Refuse to proceed if the earlier manual engine wiring unexpectedly disappeared.
required = {
    "frontend/app/(tabs)/settings.tsx": ['label="Player engine"', 'VLC compatibility'],
    "frontend/src/components/StreamPlayer.tsx": ['playerEngine === "vlc"', 'stopNativeVlcFullscreen(true)'],
    "frontend/android/app/build.gradle": ['org.videolan.android:libvlc-all:3.7.5', 'libc++_shared.so'],
}
for filename, markers in required.items():
    value = Path(filename).read_text()
    for marker in markers:
        if marker not in value:
            raise SystemExit(f"missing required wiring marker {marker!r} in {filename}")

print("manual VLC profile hydration/indexing patch applied safely")
