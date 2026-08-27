from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"missing {label} anchor")
    return text.replace(old, new, 1)


# Playback profile index: preserve newer mutations when the initial storage read
# completes, and never persist a partial pre-hydration snapshot.
profile_path = Path("frontend/src/core/playbackProfileIndex.ts")
profile = profile_path.read_text()
profile = replace_once(profile, "let persistChain: Promise<void> = Promise.resolve();\nconst listeners", "let persistChain: Promise<void> = Promise.resolve();\nlet mutationRevision = 0;\nconst listeners", "profile mutation revision")
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
profile = replace_once(profile, '''  cached = { ...cached, [key]: next };
  loaded = true;
  publish();''', '''  mutationRevision += 1;
  cached = { ...cached, [key]: next };
  publish();''', "single profile mutation")
profile = replace_once(profile, '''  cached = prune(next);
  loaded = true;
  publish();''', '''  mutationRevision += 1;
  cached = prune(next);
  publish();''', "batch profile mutation")
profile = replace_once(profile, '''  const { confirmedType: _ignored, ...rest } = cached[key];
  cached = { ...cached, [key]: { ...rest, updatedAt: Date.now() } };
  publish();''', '''  const { confirmedType: _ignored, ...rest } = cached[key];
  mutationRevision += 1;
  cached = { ...cached, [key]: { ...rest, updatedAt: Date.now() } };
  publish();''', "profile invalidation mutation")
profile_path.write_text(profile)

# Player-engine preference: a Settings edit wins over any storage read that was
# already in flight when the user changed Media3/VLC.
engine_path = Path("frontend/src/playerEnginePreference.ts")
engine = engine_path.read_text()
engine = replace_once(engine, "let loadPromise: Promise<PlayerEnginePreference> | null = null;\nconst listeners", "let loadPromise: Promise<PlayerEnginePreference> | null = null;\nlet mutationRevision = 0;\nconst listeners", "engine mutation revision")
old_engine_load = '''async function loadPreference(): Promise<PlayerEnginePreference> {
  if (loaded) return cachedPreference;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const stored = await storage.getItem<string>(PLAYER_ENGINE_KEY, "media3");
    // Older builds used "default". Migrate that deterministically to Media3.
    cachedPreference = stored === "vlc" ? "vlc" : "media3";
    loaded = true;
    return cachedPreference;
  })();'''
new_engine_load = '''async function loadPreference(): Promise<PlayerEnginePreference> {
  if (loaded) return cachedPreference;
  if (loadPromise) return loadPromise;
  const revisionAtStart = mutationRevision;
  loadPromise = (async () => {
    const stored = await storage.getItem<string>(PLAYER_ENGINE_KEY, "media3");
    // Older builds used "default". Migrate that deterministically to Media3.
    if (mutationRevision === revisionAtStart) cachedPreference = stored === "vlc" ? "vlc" : "media3";
    loaded = true;
    return cachedPreference;
  })();'''
engine = replace_once(engine, old_engine_load, new_engine_load, "engine hydration")
engine = replace_once(engine, '''export async function setPlayerEnginePreference(value: PlayerEnginePreference): Promise<void> {
  cachedPreference = value === "vlc" ? "vlc" : "media3";
  loaded = true;''', '''export async function setPlayerEnginePreference(value: PlayerEnginePreference): Promise<void> {
  mutationRevision += 1;
  cachedPreference = value === "vlc" ? "vlc" : "media3";
  loaded = true;''', "engine mutation")
engine_path.write_text(engine)

# VLC option hydration is field-specific: changing hardware decode must not lose
# the stored audio setting, and vice versa.
vlc_path = Path("frontend/src/core/vlcPlaybackPreferences.ts")
vlc = vlc_path.read_text()
vlc = replace_once(vlc, "let loadPromise: Promise<Snapshot> | null = null;\nconst listeners", "let loadPromise: Promise<Snapshot> | null = null;\nlet hardwareMutationRevision = 0;\nlet audioMutationRevision = 0;\nconst listeners", "VLC mutation revisions")
old_vlc_load = '''async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [hardwareDecode, audioOutput] = await Promise.all([
      storage.getItem<boolean>(HW_KEY, true),
      storage.getItem<string>(AUDIO_KEY, "auto"),
    ]);
    cached = {
      hardwareDecode: hardwareDecode !== false,
      audioOutput: normalizeAudio(audioOutput),
    };
    loaded = true;
    return cached;
  })();'''
new_vlc_load = '''async function load(): Promise<Snapshot> {
  if (loaded) return cached;
  if (loadPromise) return loadPromise;
  const hardwareRevisionAtStart = hardwareMutationRevision;
  const audioRevisionAtStart = audioMutationRevision;
  loadPromise = (async () => {
    const [hardwareDecode, audioOutput] = await Promise.all([
      storage.getItem<boolean>(HW_KEY, true),
      storage.getItem<string>(AUDIO_KEY, "auto"),
    ]);
    cached = {
      hardwareDecode: hardwareMutationRevision === hardwareRevisionAtStart ? hardwareDecode !== false : cached.hardwareDecode,
      audioOutput: audioMutationRevision === audioRevisionAtStart ? normalizeAudio(audioOutput) : cached.audioOutput,
    };
    loaded = true;
    return cached;
  })();'''
vlc = replace_once(vlc, old_vlc_load, new_vlc_load, "VLC hydration")
vlc = replace_once(vlc, '''    setHardwareDecode: useCallback((next: boolean) => {
      cached = { ...cached, hardwareDecode: !!next };''', '''    setHardwareDecode: useCallback((next: boolean) => {
      hardwareMutationRevision += 1;
      cached = { ...cached, hardwareDecode: !!next };''', "VLC hardware mutation")
vlc = replace_once(vlc, '''    setAudioOutput: useCallback((next: VlcAudioOutput) => {
      cached = { ...cached, audioOutput: normalizeAudio(next) };''', '''    setAudioOutput: useCallback((next: VlcAudioOutput) => {
      audioMutationRevision += 1;
      cached = { ...cached, audioOutput: normalizeAudio(next) };''', "VLC audio mutation")
vlc_path.write_text(vlc)

# Populate declared profiles from stream_type values already produced by the M3U
# parser. Preserve the large source file's original newline style byte-for-byte.
source_path = Path("frontend/src/source.native.ts")
source = source_path.read_bytes().decode("utf-8")
nl = "\r\n" if "\r\n" in source else "\n"
profile_import = 'import { indexDeclaredStreamTypes } from "@/src/core/playbackProfileIndex";'
if profile_import not in source:
    anchor = 'import { getEpgSourcePreferences, type EpgSourcePreferences } from "@/src/core/epgSourcePreferences";' + nl
    if anchor not in source: raise SystemExit("missing source.native import anchor")
    source = source.replace(anchor, anchor + profile_import + nl, 1)
old_sync = 'async function syncPlaylistToNative(channels: Channel[], playlistEpoch: number): Promise<void> {' + nl + '  if (!nativeEpgAvailable || !channels.length) return;' + nl + '  const contentFingerprint = playlistNativeContentFingerprint(channels);'
new_sync = 'async function syncPlaylistToNative(channels: Channel[], playlistEpoch: number): Promise<void> {' + nl + '  if (!channels.length) return;' + nl + '  indexDeclaredStreamTypes(channels);' + nl + '  if (!nativeEpgAvailable) return;' + nl + '  const contentFingerprint = playlistNativeContentFingerprint(channels);'
if 'indexDeclaredStreamTypes(channels);' not in source:
    if old_sync not in source: raise SystemExit("missing source.native sync anchor")
    source = source.replace(old_sync, new_sync, 1)
source_path.write_bytes(source.encode("utf-8"))

# Make Settings copy describe the selected-engine architecture truthfully.
settings_path = Path("frontend/app/(tabs)/settings.tsx")
settings = settings_path.read_text()
old_copy = '''                <Text style={styles.settingLabel}>Media3 live TV</Text>
                <Text style={styles.help}>
                  Live TV uses one Android-owned Media3 player. It starts with supported hardware codecs and uses the installed Media3 audio fallback when available; no second engine is started automatically.
                </Text>'''
new_copy = '''                <Text style={styles.settingLabel}>Live TV player</Text>
                <Text style={styles.help}>
                  Media3 is recommended. VLC is a manual compatibility option for streams or devices that need it. Only the selected engine owns the decoder; CharmIPTV never auto-starts the other engine as a fallback.
                </Text>'''
settings = replace_once(settings, old_copy, new_copy, "Player Settings copy")
settings_path.write_text(settings)

# Regression contracts for catalog indexing and all three new preference stores.
test_path = Path("frontend/tests/manualVlcEngine.test.mjs")
test_text = test_path.read_text()
if 'playlist stream types are batch-indexed without probing' not in test_text:
    test_text += '''\n\ntest("playlist stream types are batch-indexed without probing and hydration cannot clobber edits", async () => {
  const [profile, source, engine, vlc] = await Promise.all([read("src/core/playbackProfileIndex.ts"), read("src/source.native.ts"), read("src/playerEnginePreference.ts"), read("src/core/vlcPlaybackPreferences.ts")]);
  assert.match(profile, /let mutationRevision = 0/);
  assert.match(profile, /const revisionAtStart = mutationRevision/);
  assert.match(profile, /prune\\(\\{ \\.\\.\\.storedProfiles, \\.\\.\\.cached \\}\\)/);
  assert.match(profile, /const pendingLoad = loadPromise/);
  assert.match(source, /indexDeclaredStreamTypes\\(channels\\)/);
  assert.match(source, /if \\(!channels\\.length\\) return;[\\s\\S]*indexDeclaredStreamTypes\\(channels\\);[\\s\\S]*if \\(!nativeEpgAvailable\\) return;/);
  assert.match(engine, /const revisionAtStart = mutationRevision/);
  assert.match(engine, /mutationRevision === revisionAtStart/);
  assert.match(vlc, /hardwareMutationRevision === hardwareRevisionAtStart/);
  assert.match(vlc, /audioMutationRevision === audioRevisionAtStart/);
  assert.doesNotMatch(profile, /fetch\\(|XMLHttpRequest|probeStream/);
});\n'''
    test_path.write_text(test_text)

required = {
    "frontend/app/(tabs)/settings.tsx": ['label="Player engine"', 'VLC (recommended for live)', 'Only the selected engine owns the decoder'],
    "frontend/src/components/StreamPlayer.tsx": ['playerEngine === "vlc"', 'stopNativeVlcFullscreen(true)'],
    "frontend/android/app/build.gradle": ['org.videolan.android:libvlc-all:3.7.5', 'libc++_shared.so'],
}
for filename, markers in required.items():
    value = Path(filename).read_text()
    for marker in markers:
        if marker not in value: raise SystemExit(f"missing required wiring marker {marker!r} in {filename}")

print("manual VLC final preference/profile patch applied safely")
