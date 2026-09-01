import React, { useCallback, useEffect, useState } from "react";
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
import type { PlaylistPreview } from "@/src/core/playlistRegistry";
import { fonts, radius, tvColors } from "@/src/theme";
import { Ionicons } from "@expo/vector-icons";
import { readPlaylistGuideHealth, refreshOnePlaylistAndGuide, refreshOnePlaylistGuide, refreshOnePlaylistOnly, type PlaylistGuideHealth } from "@/src/core/playlistGuideOperations";

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
  const [preview, setPreview] = useState<PlaylistPreview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeArmed, setRemoveArmed] = useState("");
  const [health, setHealth] = useState<Record<string, PlaylistGuideHealth>>({});
  const loadHealth = useCallback(async () => {
    const rows = await readPlaylistGuideHealth(await readCombinedPlaylists());
    setHealth(Object.fromEntries(rows.map((row) => [row.playlistId, row])));
  }, []);
  useEffect(() => { void loadHealth(); }, [loadHealth, playlists]);
  const back = useCallback(() => { if (editing !== null) { setEditing(null); setPreview(null); setUrl(""); } else router.replace("/settings" as any); return true; }, [editing, router]);
  useTvBackHandler(back);
  const run = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setMessage("Working…");
    try { await action(); setMessage("Done."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed; check your source."); }
    finally { await loadHealth().catch(() => undefined); setBusy(false); }
  };
  const availableEpg = [{ id: "user", name: legacy.userName || "Custom EPG", enabled: legacy.userEnabled }, ...epgs.sources];
  return <PurpleTvShell active="/settings"><View style={styles.page}>
    <View style={styles.header}><View><Text style={styles.kicker}>CONTENT SOURCES</Text><Text style={styles.title}>Playlists</Text></View>
      <Pressable onPress={back} disabled={busy} style={({ focused }: any) => [styles.back, busy && styles.disabled, focused && styles.focused]}><Ionicons name="arrow-back" size={14} color="#fff" /><Text style={styles.backText}>{editing === null ? "All Settings" : "Cancel edit"}</Text></Pressable>
    </View>
    <FocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.scrollWrap}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEnabled nestedScrollEnabled showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="never">
      <Text style={styles.help}>Your supplied CharmIPTV services and personal M3U playlists, together in one guide. Five personal playlists; 25,000 enabled channels total in this test build.</Text>
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
          await syncPlaylistEpg(await readCombinedPlaylists(), true); await reloadPlaylistCatalog(); setEditing(null); setPreview(null); setUrl("");
        })} />}
        <Action label="Choose local M3U file / USB" disabled={busy} onPress={() => void run(async () => {
          if (!NativeModules.CharmPlaylistDocument?.pick) throw new Error("Local file picker requires the updated Android app.");
          const chosen = await NativeModules.CharmPlaylistDocument.pick();
          if (chosen) { setUrl(chosen); setPreview(null); }
        })} />
        <Action label="Validate playlist" disabled={busy} onPress={() => void run(async () => { const rows = await previewPlaylist(url.trim()); setPreview(rows); })} />
        {preview && <><Text style={styles.text}>{preview.length.toLocaleString()} channels found. Nothing changes until you choose Save.</Text>
          <Text style={styles.help}>{preview.epgUrls?.length || 0} EPG URL(s) detected in the playlist header. Save will associate available feeds without replacing manual settings.</Text>
          <Text style={styles.help}>{preview.slice(0, 5).map((channel) => channel.name).join(" · ")}</Text>
          <Action label="Save validated playlist" disabled={busy} onPress={() => void run(async () => { await savePersonalPlaylist(name, url.trim(), preview, editing || undefined); await syncPlaylistEpg(await readCombinedPlaylists(), true); await reloadPlaylistCatalog(); setEditing(null); setUrl(""); setPreview(null); })} /></>}
      </View> : <>
        <Action label="Add M3U playlist" disabled={busy} onPress={() => { setEditing(""); setName("My playlist"); setUrl(""); setPreview(null); }} />
        <Action label="Manage EPG feeds / manual channel assignments" disabled={busy} onPress={() => router.push("/epg-sources" as any)} />
        {playlists.map((source) => <View key={source.id} style={styles.card}>
          <Text style={styles.heading}>{source.name} {source.managed ? "· supplied" : "· personal"}</Text>
          <Text style={styles.help}>{source.enabled ? "Enabled" : "Disabled — saved channels retained"} · {source.count.toLocaleString()} channels · {source.status}</Text>
          <Text style={styles.help}>Last successful update: {source.refreshedAt ? new Date(source.refreshedAt).toLocaleString() : "Never"}</Text>
          {!!source.tombstoneCount && <Text style={styles.help}>{source.tombstoneCount.toLocaleString()} temporarily missing channel record(s) retained so favorites, ordering, groups, and EPG assignments can return if the provider restores them.</Text>}
          {!!source.discoveredEpgUrls?.length && <Text style={styles.help}>{source.discoveredEpgUrls.length} EPG URL(s) found in playlist. {source.epgDiscoveryStatus || "Waiting for EPG discovery."}</Text>}
          <Text style={styles.health}>{health[source.id] ? `${health[source.id].matched.toLocaleString()} matched · ${health[source.id].unmatched.toLocaleString()} unmatched · ${health[source.id].channels.toLocaleString()} total · ${health[source.id].sourceIds.length} active guide source(s)` : "Checking this playlist’s Guide health…"}</Text>
          <Action label={`Playlist EPG detection: ${source.autoEpg === false ? "Off — manual" : "On"}`} disabled={busy} onPress={() => void run(async () => { await updatePlaylist(source.id, { autoEpg: source.autoEpg === false }); await syncPlaylistEpg(await readCombinedPlaylists(), true); await reloadPlaylistCatalog(); })} />
          <View style={styles.row}>
            <Action label={source.enabled ? "Disable" : "Enable"} disabled={busy} onPress={() => void run(async () => { await updatePlaylist(source.id, { enabled: !source.enabled }); await reloadPlaylistCatalog(); })} />
            <Action label="Refresh playlist only" disabled={busy || !source.enabled} onPress={() => void run(() => refreshOnePlaylistOnly(source.id))} />
            <Action label="Refresh EPG only" disabled={busy || !source.enabled} onPress={() => void run(() => refreshOnePlaylistGuide(source.id))} />
            <Action label="Refresh playlist + EPG" disabled={busy || !source.enabled} onPress={() => void run(() => refreshOnePlaylistAndGuide(source.id))} />
            <Action label={`Auto update: ${source.refreshHours ? `${source.refreshHours}h` : "Manual"}`} disabled={busy} onPress={() => void run(async () => { const options = [0, 2, 4, 6, 12, 24]; await updatePlaylist(source.id, { refreshHours: options[(options.indexOf(source.refreshHours) + 1) % options.length] }); })} />
            <Action label="Move up" disabled={busy} onPress={() => void run(async () => { await movePlaylist(source.id, -1); await reloadPlaylistCatalog(); })} />
            <Action label="Move down" disabled={busy} onPress={() => void run(async () => { await movePlaylist(source.id, 1); await reloadPlaylistCatalog(); })} />
          </View>
          {!source.managed && <View style={styles.row}>
            <Action label="Edit name / address" disabled={busy} onPress={() => void run(async () => { setUrl(await getPlaylistUrl(source)); setName(source.name); setPreview(null); setEditing(source.id); })} />
            <Action label={removeArmed === source.id ? "Confirm remove playlist" : "Remove playlist"} disabled={busy} onPress={() => { if (removeArmed !== source.id) { setRemoveArmed(source.id); return; } void run(async () => { await removePlaylist(source.id); await reloadPlaylistCatalog(); setRemoveArmed(""); }); }} />
          </View>}
          {source.id !== "charm-primary" && <>
            <Text style={styles.text}>Associated EPG feeds — the numbered order is the fallback priority. Manual channel assignments always win. Automatic matching uses exact IDs first, then unique names, guarded callsigns, unique logos, and conservative fuzzy matching.</Text>
            {source.epgSourceIds.map((epgId, index) => {
              const epg = availableEpg.find((item) => item.id === epgId);
              if (!epg) return null;
              return <View key={epgId} style={styles.priorityRow}>
                <Text style={styles.priorityLabel}>{index + 1}. {epg.name}{epg.enabled ? "" : " (disabled)"}</Text>
                <Action label="Higher" disabled={busy || index === 0} onPress={() => void run(async () => { const ids = [...source.epgSourceIds]; [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; await updatePlaylist(source.id, { epgSourceIds: ids, autoEpg: false }); await syncPlaylistEpg(await readCombinedPlaylists(), true); await reloadPlaylistCatalog(); })} />
                <Action label="Lower" disabled={busy || index === source.epgSourceIds.length - 1} onPress={() => void run(async () => { const ids = [...source.epgSourceIds]; [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]; await updatePlaylist(source.id, { epgSourceIds: ids, autoEpg: false }); await syncPlaylistEpg(await readCombinedPlaylists(), true); await reloadPlaylistCatalog(); })} />
                <Action label="Remove" disabled={busy} onPress={() => void run(async () => { await updatePlaylist(source.id, { epgSourceIds: source.epgSourceIds.filter((id) => id !== epgId), autoEpg: false }); await syncPlaylistEpg(await readCombinedPlaylists(), true); await reloadPlaylistCatalog(); })} />
              </View>;
            })}
            <View style={styles.row}>{availableEpg.filter((epg) => !source.epgSourceIds.includes(epg.id)).map((epg) => <Action key={epg.id}
              label={`Add ${epg.name}${epg.enabled ? "" : " (disabled)"}`}
              disabled={busy} onPress={() => void run(async () => { await updatePlaylist(source.id, { epgSourceIds: [...source.epgSourceIds, epg.id], autoEpg: false, epgDiscoveryStatus: "Manual EPG choices are preserved; automatic association is off." }); await syncPlaylistEpg(await readCombinedPlaylists(), true); await reloadPlaylistCatalog(); })} />)}</View>
          </>}
        </View>)}
      </>}
      {!!message && <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
    </ScrollView></FocusGuide>
  </View></PurpleTvShell>;
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 14, paddingTop: 8 },
  header: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: tvColors.line },
  kicker: { color: tvColors.purpleSoft, fontFamily: fonts.semibold, fontSize: 7.5, letterSpacing: 1 },
  title: { color: "#fff", fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  back: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 5, borderWidth: 2, borderColor: "transparent", backgroundColor: tvColors.panel },
  backText: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 }, scrollWrap: { flex: 1 }, content: { paddingVertical: 12, paddingBottom: 40, gap: 10 },
  heading: { fontFamily: fonts.semibold, fontSize: 10.5, color: "#fff" },
  text: { color: tvColors.text, fontFamily: fonts.regular, fontSize: 8.5, lineHeight: 13 }, help: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, lineHeight: 11 },
  card: { backgroundColor: tvColors.panelRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: tvColors.line, padding: 11, gap: 7 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  priorityRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, paddingVertical: 3 }, priorityLabel: { minWidth: 180, flex: 1, color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 8.5 },
  button: { alignSelf: "flex-start", minHeight: 34, justifyContent: "center", paddingHorizontal: 12, borderRadius: 5, borderWidth: 2, borderColor: tvColors.line, backgroundColor: tvColors.panel },
  focused: { borderColor: "#fff", backgroundColor: tvColors.purpleDeep }, disabled: { opacity: 0.45 }, buttonText: { color: "#fff", fontFamily: fonts.medium, fontSize: 8.5 },
  input: { minHeight: 40, color: "#fff", fontFamily: fonts.regular, fontSize: 10.5, paddingHorizontal: 10, borderWidth: 1, borderColor: tvColors.line, borderRadius: radius.sm },
  message: { color: tvColors.purpleSoft, fontFamily: fonts.medium, fontSize: 9, lineHeight: 13 },
  health: { color: "#D8C4FF", fontFamily: fonts.semibold, fontSize: 8.5, lineHeight: 13 },
});
