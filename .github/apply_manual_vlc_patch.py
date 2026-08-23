from pathlib import Path
p=Path('frontend/app/(tabs)/settings.tsx'); s=p.read_text()
def add(anchor, text):
 global s
 if text.strip() not in s:
  if anchor not in s: raise SystemExit('missing anchor: '+anchor[:60])
  s=s.replace(anchor, anchor+text, 1)
add('import { usePlaybackBufferProfile } from "@/src/core/playbackBufferProfile";\n','import { usePlayerEnginePreference } from "@/src/playerEnginePreference";\nimport { useVlcPlaybackPreferences } from "@/src/core/vlcPlaybackPreferences";\n')
add('  const [playbackBufferProfile, setPlaybackBufferProfile] = usePlaybackBufferProfile();\n','  const [playerEngine, setPlayerEngine] = usePlayerEnginePreference();\n  const vlcPlayback = useVlcPlaybackPreferences();\n')
row='''          <SelectRow\n            label="Player engine"\n            value={playerEngine === "vlc" ? "VLC compatibility" : "Media3 (recommended)"}\n            options={[{ label: "Media3 (recommended)", value: "media3" }, { label: "VLC compatibility", value: "vlc" }]}\n            onChange={(value) => void setPlayerEngine(value as "media3" | "vlc")}\n            index={14}\n          />\n          {playerEngine === "vlc" ? (\n            <>\n              <SelectRow label="VLC hardware decoding" value={vlcPlayback.hardwareDecode ? "On" : "Off"} options={[{ label: "On", value: "on" }, { label: "Off", value: "off" }]} onChange={(value) => void vlcPlayback.setHardwareDecode(value === "on")} index={15} />\n              <SelectRow label="VLC audio output" value={vlcPlayback.audioOutput} options={[{ label: "Auto", value: "auto" }, { label: "Stereo", value: "stereo" }, { label: "Passthrough", value: "passthrough" }]} onChange={(value) => void vlcPlayback.setAudioOutput(value as "auto" | "stereo" | "passthrough")} index={16} />\n            </>\n          ) : null}\n'''
anchor='          <SelectRow\n            label="Playback buffer"'
if 'label="Player engine"' not in s:
 if anchor not in s: raise SystemExit('missing playback buffer anchor')
 s=s.replace(anchor,row+anchor,1)
p.write_text(s); print('manual VLC settings patch applied')
