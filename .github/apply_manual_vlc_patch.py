from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor for {label}: {old[:100]!r}")
    return text.replace(old, new, 1)

p = Path("frontend/app/(tabs)/settings.tsx")
s = p.read_text()
if 'from "@/src/playerEnginePreference"' not in s:
    s = replace_once(
        s,
        '} from "@/src/core/playbackBufferProfile";\n',
        '} from "@/src/core/playbackBufferProfile";\n'
        'import { usePlayerEnginePreference, type PlayerEnginePreference } from "@/src/playerEnginePreference";\n'
        'import { useVlcPlaybackPreferences, type VlcAudioOutput } from "@/src/core/vlcPlaybackPreferences";\n',
        "settings imports",
    )
if "const [playerEngine, setPlayerEngine]" not in s:
    s = replace_once(
        s,
        '  const [playbackBufferProfile, setPlaybackBufferProfile] = usePlaybackBufferProfile();\n',
        '  const [playbackBufferProfile, setPlaybackBufferProfile] = usePlaybackBufferProfile();\n'
        '  const [playerEngine, setPlayerEngine] = usePlayerEnginePreference();\n'
        '  const vlcPlayback = useVlcPlaybackPreferences();\n',
        "settings hooks",
    )
old = '''                <Text style={styles.settingLabel}>Media3 live TV</Text>\n                <Text style={styles.help}>\n                  Live TV uses one Android-owned Media3 player. It starts with supported hardware codecs and uses the installed Media3 audio fallback when available; no second engine is started automatically.\n                </Text>\n'''
new = '''                <ChoiceRow<PlayerEnginePreference>\n                  label="Player engine"\n                  value={playerEngine}\n                  options={[\n                    { label: "Media3 (recommended)", value: "media3" },\n                    { label: "VLC compatibility", value: "vlc" },\n                  ]}\n                  onChange={setPlayerEngine}\n                />\n                <Text style={styles.help}>\n                  Media3 is the default high-performance engine. VLC is a manual compatibility engine only. Switching engines fully releases the other native player before playback starts, so both decoders are never intentionally active together.\n                </Text>\n                {playerEngine === "vlc" ? (\n                  <>\n                    <ToggleRow\n                      label="VLC hardware decoding"\n                      value={vlcPlayback.hardwareDecode}\n                      onChange={vlcPlayback.setHardwareDecode}\n                    />\n                    <ChoiceRow<VlcAudioOutput>\n                      label="VLC audio output"\n                      value={vlcPlayback.audioOutput}\n                      options={[\n                        { label: "Auto", value: "auto" },\n                        { label: "Stereo compatibility", value: "stereo" },\n                        { label: "Passthrough / encoded", value: "passthrough" },\n                      ]}\n                      onChange={vlcPlayback.setAudioOutput}\n                    />\n                    <Text style={styles.help}>\n                      Hardware decoding is recommended on TV devices. Change the VLC audio output only for device-specific compatibility; Auto leaves Android/VLC device selection untouched.\n                    </Text>\n                  </>\n                ) : null}\n'''
if "label=\"Player engine\"" not in s:
    s = replace_once(s, old, new, "player settings section")
p.write_text(s)

p = Path("frontend/src/core/playbackProfileIndex.ts")
s = p.read_text()
if "export function indexDeclaredStreamTypes" not in s:
    anchor = '''export function rememberDeclaredStreamType(channelKey: string | undefined, rawType: unknown): void {\n  const declaredType = normalizeType(rawType);\n  update(channelKey, (current) => ({ ...current, declaredType, updatedAt: Date.now() }));\n}\n\n'''
    addition = anchor + '''export function indexDeclaredStreamTypes(\n  channels: ReadonlyArray<{ id?: string | null; stream_type?: unknown }>,\n): void {\n  if (!channels.length) return;\n  const now = Date.now();\n  let changed = false;\n  let next = cached;\n  for (const channel of channels) {\n    const key = String(channel.id || "").trim();\n    if (!key) continue;\n    const declaredType = normalizeType(channel.stream_type);\n    const current = next[key] || { declaredType: "unknown" as const, updatedAt: 0 };\n    if (current.declaredType === declaredType) continue;\n    if (!changed) next = { ...cached };\n    next[key] = { ...current, declaredType, updatedAt: now };\n    changed = true;\n  }\n  if (!changed) return;\n  cached = prune(next);\n  loaded = true;\n  publish();\n  persist();\n}\n\n'''
    s = replace_once(s, anchor, addition, "profile batch index")
p.write_text(s)

p = Path("frontend/src/source.native.ts")
s = p.read_text()
if 'from "@/src/core/playbackProfileIndex"' not in s:
    s = replace_once(
        s,
        'import { getLogoPriority, type LogoPriority } from "@/src/core/logoPreferences";\n',
        'import { getLogoPriority, type LogoPriority } from "@/src/core/logoPreferences";\n'
        'import { indexDeclaredStreamTypes } from "@/src/core/playbackProfileIndex";\n',
        "source profile import",
    )
if "indexDeclaredStreamTypes(channels);" not in s:
    s = replace_once(
        s,
        'async function syncPlaylistToNative(channels: Channel[], playlistEpoch: number): Promise<void> {\n  if (!nativeEpgAvailable || !channels.length) return;\n',
        'async function syncPlaylistToNative(channels: Channel[], playlistEpoch: number): Promise<void> {\n  if (!channels.length) return;\n  indexDeclaredStreamTypes(channels);\n  if (!nativeEpgAvailable) return;\n',
        "source batch indexing",
    )
p.write_text(s)

print("manual VLC settings + playback profile index wiring applied")
