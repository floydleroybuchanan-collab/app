from pathlib import Path
p=Path('frontend/app/(tabs)/settings.tsx'); s=p.read_text()
def add(anchor, text):
 global s
 if text.strip() not in s:
  if anchor not in s: raise SystemExit('missing anchor: '+anchor[:60])
  s=s.replace(anchor, anchor+text, 1)
add('} from "@/src/core/playbackBufferProfile";\n','import { usePlayerEnginePreference } from "@/src/playerEnginePreference";\nimport { useVlcPlaybackPreferences } from "@/src/core/vlcPlaybackPreferences";\n')
add('  const [playbackBufferProfile, setPlaybackBufferProfile] = usePlaybackBufferProfile();\n','  const [playerEngine, setPlayerEngine] = usePlayerEnginePreference();\n  const vlcPlayback = useVlcPlaybackPreferences();\n')
row='''                <ChoiceRow<"media3" | "vlc">\n                  label="Player engine"\n                  value={playerEngine}\n                  options={[{ label: "Media3 (recommended)", value: "media3" }, { label: "VLC compatibility", value: "vlc" }]}\n                  onChange={setPlayerEngine}\n                />\n                {playerEngine === "vlc" ? (\n                  <>\n                    <ToggleRow label="VLC hardware decoding" value={vlcPlayback.hardwareDecode} onChange={vlcPlayback.setHardwareDecode} />\n                    <ChoiceRow<"auto" | "stereo" | "passthrough">\n                      label="VLC audio output"\n                      value={vlcPlayback.audioOutput}\n                      options={[{ label: "Auto", value: "auto" }, { label: "Stereo", value: "stereo" }, { label: "Passthrough", value: "passthrough" }]}\n                      onChange={vlcPlayback.setAudioOutput}\n                    />\n                  </>\n                ) : null}\n'''
anchor='                <ChoiceRow<PlaybackBufferProfile>\n                  label="Playback buffer"'
if 'label="Player engine"' not in s:
 if anchor not in s: raise SystemExit('missing playback buffer anchor')
 s=s.replace(anchor,row+anchor,1)
p.write_text(s); print('manual VLC settings patch applied')
