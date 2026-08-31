import React, { useCallback, useState } from "react";
import { NativeModules, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import { useParentalPin } from "@/src/core/parentalPin";
import { useMultiEpgSources } from "@/src/core/multiEpgSources";
import { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";
import { getPlaylistUrl, movePlaylist, previewPlaylist, removePlaylist, savePersonalPlaylist, updatePlaylist, usePlaylists, readCombinedPlaylists } from "@/src/core/playlistRegistry";
import { reloadPlaylistCatalog } from "@/src/source.native";
import { syncPlaylistEpg } from "@/src/core/playlistEpg";
import type { Channel } from "@/src/api";

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" focusable={!disabled} disabled={disabled} onPress={onPress}
    style={({ focused }: any) => [styles.button, disabled && styles.disabled, focused && styles.focused]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

export default function PlaylistsScreen() {
  const router = useRouter();
  const playlists = usePlaylists();
  const epgs = useMultiEpgSources();
  const legacy = useEpgSourcePreferences();
  const parental = useParentalPin();
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Channel[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeArmed, setRemoveArmed] = useState("");
  const back = useCallback(() => { if (editing !== null) { setEditing(null); setPreview(null); setUrl(""); } else router.replace("/settings" as any); return true; }, [editing, router]);
  useTvBackHandler(back);
  const run = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setMessage("Working…");
    try { await action(); setMessage("Done."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed; check your source."); }
    finally { setBusy(false); }
  };
  const availableEpg = [{ id: "user", name: legacy.userName || "Custom EPG", enabled: legacy.userEnabled }, ...epgs.sources];
  return <PurpleTvShell active="/settings"><FocusGuide trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.page}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Playlists</Text>
      <Text style={styles.help}>Your supplied CharmIPTV services and personal M3U playlists, together in one guide. Five personal playlists; 25,000 enabled channels total in this test build.</Text>
      <Action label={editing === null ? "Back to Settings" : "Cancel — keep current playlist"} onPress={back} disabled={busy} />
      {!parental.ready ? <Text style={styles.text}>Loading settings…</Text> : parental.hasPin && !unlocked ? <View style={styles.card}>
        <Text style={styles.text}>Enter your parental PIN to manage playlists.</Text>
        <TextInput accessibilityLabel="Parental PIN" secureTextEntry keyboardType="number-pad" value={pin} onChangeText={setPin} style={styles.input} />
        <Action label="Unlock playlist settings" onPress={() => { if (parental.verifyPin(pin)) { setUnlocked(true); setPin(""); } else setMessage("Incorrect PIN."); }} />
      </View> : editing !== null ? <View style={styles.card}>
        <Text style={styles.heading}>{editing ? "Edit personal playlist" : "Add personal playlist"}</Text>
        <TextInput accessibilityLabel="Playlist name" placeholder="Playlist name" placeholderTextColor="#a99cbc" value={name} onChangeText={setName} maxLength={60} style={styles.input} editable={!busy} />
        <TextInput accessibilityLabel="M3U URL" placeholder="https://provider.example/playlist.m3u" placeholderTextColor="#a99cbc" value={url} onChangeText={(value) => { setUrl(value); setPreview(null); }} autoCapitalize="none" autoCorrect={false} secureTextEntry style={styles.input} editable={!busy} />
        {!!editing && <Action label="Save name only (no download)" disabled={busy} onPress={() => void run(async () => {
          await updatePlaylist(editing, { name: name.trim().slice(0, 60) || "My playlist" });
          await reloadPlaylistCatalog(); setEditing(null); setPreview(null); setUrl("");
        })} />}
        <Action label="Choose local M3U file / USB" disabled={busy} onPress={() => void run(async () => {
          if (!NativeModules.CharmPlaylistDocument?.pick) throw new Error("Local file picker requires the updated Android app.");
          const chosen = await NativeModules.CharmPlaylistDocument.pick();
          if (chosen) { setUrl(chosen); setPreview(null); }
        })} />
        <Action label="Validate playlist" disabled={busy} onPress={() => void run(async () => { const rows = await previewPlaylist(url.trim()); setPreview(rows); })} />
        {preview && <><Text style={styles.text}>{preview.length.toLocaleString()} channels found. Nothing changes until you choose Save.</Text>
          <Text style={styles.help}>{preview.slice(0, 5).map((channel) => channel.name).join(" · ")}</Text>
          <Action label="Save validated playlist" disabled={busy} onPress={() => void run(async () => { await savePersonalPlaylist(name, url.trim(), preview, editing || undefined); await reloadPlaylistCatalog(); setEditing(null); setUrl(""); setPreview(null); })} /></>}
      </View> : <>
        <Action label="Add M3U playlist" disabled={busy} onPress={() => { setEditing(""); setName("My playlist"); setUrl(""); setPreview(null); }} />
        <Action label="Manage EPG feeds / manual channel assignments" disabled={busy} onPress={() => router.push("/epg-sources" as any)} />
        {playlists.map((source) => <View key={source.id} style={styles.card}>
          <Text style={styles.heading}>{source.name} {source.managed ? "· supplied" : "· personal"}</Text>
          <Text style={styles.help}>{source.enabled ? "Enabled" : "Disabled — saved channels retained"} · {source.count.toLocaleString()} channels · {source.status}</Text>
          <Text style={styles.help}>Last successful update: {source.refreshedAt ? new Date(source.refreshedAt).toLocaleString() : "Never"}</Text>
          <View style={styles.row}>
            <Action label={source.enabled ? "Disable" : "Enable"} disabled={busy} onPress={() => void run(async () => { await updatePlaylist(source.id, { enabled: !source.enabled }); await reloadPlaylistCatalog(); })} />
            <Action label="Refresh this playlist + EPG" disabled={busy || !source.enabled} onPress={() => void run(() => reloadPlaylistCatalog(source.id))} />
            <Action label={`Auto update: ${source.refreshHours ? `${source.refreshHours}h` : "Manual"}`} disabled={busy} onPress={() => void run(async () => { const options = [0, 2, 4, 6, 12, 24]; await updatePlaylist(source.id, { refreshHours: options[(options.indexOf(source.refreshHours) + 1) % options.length] }); })} />
            <Action label="Move up" disabled={busy} onPress={() => void run(async () => { await movePlaylist(source.id, -1); await reloadPlaylistCatalog(); })} />
            <Action label="Move down" disabled={busy} onPress={() => void run(async () => { await movePlaylist(source.id, 1); await reloadPlaylistCatalog(); })} />
          </View>
          {!source.managed && <View style={styles.row}>
            <Action label="Edit name / address" disabled={busy} onPress={() => void run(async () => { setUrl(await getPlaylistUrl(source)); setName(source.name); setPreview(null); setEditing(source.id); })} />
            <Action label={removeArmed === source.id ? "Confirm remove playlist" : "Remove playlist"} disabled={busy} onPress={() => { if (removeArmed !== source.id) { setRemoveArmed(source.id); return; } void run(async () => { await removePlaylist(source.id); await reloadPlaylistCatalog(); setRemoveArmed(""); }); }} />
          </View>}
          {source.id !== "charm-primary" && <>
            <Text style={styles.text}>Associated EPG feeds — select in priority order. Manual channel assignments take priority. Match by exact TVG ID; no guessed stations.</Text>
            <View style={styles.row}>{availableEpg.map((epg) => <Action key={epg.id}
              label={`${source.epgSourceIds.includes(epg.id) ? `${source.epgSourceIds.indexOf(epg.id) + 1}. ` : "+ "}${epg.name}${epg.enabled ? "" : " (disabled)"}`}
              disabled={busy} onPress={() => void run(async () => { const ids = source.epgSourceIds.includes(epg.id) ? source.epgSourceIds.filter((id) => id !== epg.id) : [...source.epgSourceIds, epg.id]; await updatePlaylist(source.id, { epgSourceIds: ids }); await syncPlaylistEpg(await readCombinedPlaylists(), true); await reloadPlaylistCatalog(); })} />)}</View>
          </>}
        </View>)}
      </>}
      {!!message && <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
    </ScrollView>
  </FocusGuide></PurpleTvShell>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#100919" }, content: { padding: 28, paddingBottom: 60, gap: 12 },
  title: { fontSize: 28, fontWeight: "700", color: "#fff" }, heading: { fontSize: 20, fontWeight: "600", color: "#fff" },
  text: { color: "#eee7f8", fontSize: 16, lineHeight: 24 }, help: { color: "#bdb0cd", fontSize: 14, lineHeight: 22 },
  card: { backgroundColor: "#20132e", borderRadius: 12, padding: 18, gap: 12 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  button: { alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, borderWidth: 2, borderColor: "#65427e", backgroundColor: "#342044" },
  focused: { borderColor: "#f6cf70", backgroundColor: "#653997" }, disabled: { opacity: 0.45 }, buttonText: { color: "#fff", fontSize: 15 },
  input: { color: "#fff", fontSize: 18, padding: 14, borderWidth: 2, borderColor: "#826298", borderRadius: 8, minWidth: 300 },
  message: { color: "#f6cf70", fontSize: 16, lineHeight: 24 },
});
