import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { TvSettingsTextInput as TextInput } from "@/src/components/TvSettingsTextInput";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PurpleTvShell, useIconRailFocusBoundary } from "@/src/components/PurpleTvShell";
import { EpgChannelAssignDrawer, type EpgPickerFilter } from "@/src/components/EpgChannelAssignDrawer";
import { useTvBackHandler } from "@/src/hooks/use-tv-back-to-guide";
import { useStore } from "@/src/store";
import { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";
import { assignMultiEpgChannel, isManagedEpgSourceId, updateMultiEpgRefreshStatus, type CustomEpgSourceRecord, useMultiEpgSources } from "@/src/core/multiEpgSources";
import {
  clearNativeSourceGuide, configureNativeUserGuideSources, listNativeSourceGuideChannels,
  refreshNativeSourceGuide, setNativeSourceGuideBinding,
} from "@/src/nativeEpg";
import { invalidateGuideOwnershipCaches } from "@/src/source";
import { formatRelativeAge } from "@/src/utils/time";
import { useGuideTimingPreferences } from "@/src/core/guideTimingPreferences";
import { fonts, radius, tvColors } from "@/src/theme";
import { useTvRouteEntryFocus } from "@/src/hooks/use-tv-route-entry-focus";

const PAGE = 50;
const REFRESH_VALUES: CustomEpgSourceRecord["refreshHours"][] = [0, 2, 4, 6, 12, 24];
type XmltvRow = { id: string; name: string };

export default function EpgSourceScreen() {
  const router = useRouter();
  const { iconRailEntryTag } = useIconRailFocusBoundary();
  const params = useLocalSearchParams<{ sourceId?: string; create?: string }>();
  const sourceId = String(params.sourceId || "").trim();
  const suppliedSource = isManagedEpgSourceId(sourceId);
  const { channels } = useStore();
  const primary = useEpgSourcePreferences();
  const registry = useMultiEpgSources();
  const timing = useGuideTimingPreferences(`user:${sourceId}`);
  const saved = registry.sources.find((item) => item.id === sourceId);
  const [draft, setDraft] = useState<CustomEpgSourceRecord>(() => saved || {
    id: sourceId, name: "Custom EPG", url: "", enabled: false, refreshHours: 12,
    lastRefreshAt: 0, lastStatus: "Never updated", overrides: {},
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [channelQuery, setChannelQuery] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [xmltvQuery, setXmltvQuery] = useState("");
  const [xmltvRows, setXmltvRows] = useState<XmltvRow[]>([]);
  const [xmltvTotal, setXmltvTotal] = useState(0);
  const [xmltvPage, setXmltvPage] = useState(0);
  const [xmltvFilter, setXmltvFilter] = useState<EpgPickerFilter>("all");
  const [assignDrawerOpen, setAssignDrawerOpen] = useState(false);
  const queryGeneration = useRef(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const entryFocus = useTvRouteEntryFocus(true, `epg-source:${sourceId || "new"}`);

  useEffect(() => { if (saved) setDraft(saved); }, [saved]);
  useEffect(() => {
    const topTimer = setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: false }), 0);
    return () => clearTimeout(topTimer);
  }, []);
  useTvBackHandler(useCallback(() => { router.replace("/epg-sources" as any); return true; }, [router]));

  const nativeSources = useCallback((nextExtras: CustomEpgSourceRecord[]) => [
    { id: "user", url: primary.userUrl, enabled: primary.userEnabled, refreshHours: 12 },
    ...nextExtras.map((item) => ({ id: item.id, url: item.url, enabled: item.enabled, refreshHours: item.refreshHours })),
  ], [primary.userEnabled, primary.userUrl]);

  const persist = useCallback(async (next: CustomEpgSourceRecord, status: string) => {
    if (registry.sources.some((item) => item.id !== next.id && item.url.trim() === next.url.trim())) {
      throw new Error("This EPG address is already saved. Associate its existing entry with your playlist instead of adding it again.");
    }
    const extras = registry.sources.filter((item) => item.id !== next.id).concat(next);
    registry.save(next);
    await configureNativeUserGuideSources(primary.primaryEnabled, nativeSources(extras));
    invalidateGuideOwnershipCaches();
    setDraft(next); setMessage(status);
  }, [nativeSources, primary.primaryEnabled, registry]);

  const save = useCallback(async () => {
    if (busy || !/^https?:\/\/\S+$/i.test(draft.url.trim())) { setMessage("Enter a valid http:// or https:// XMLTV URL."); return; }
    setBusy(true);
    try { await persist({ ...draft, url: draft.url.trim() }, "EPG source saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save EPG source."); }
    finally { setBusy(false); }
  }, [busy, draft, persist]);

  const refresh = useCallback(async () => {
    if (busy || !/^https?:\/\/\S+$/i.test(draft.url.trim())) { setMessage("Save a valid XMLTV URL first."); return; }
    setBusy(true); setMessage("Downloading and indexing this EPG source…");
    try {
      const enabled = { ...draft, enabled: true, url: draft.url.trim() };
      await persist(enabled, "Source enabled.");
      const result = await refreshNativeSourceGuide(sourceId, enabled.url);
      const count = Math.max(0, Math.round(result.count || 0));
      const status = result.programmeSwapSucceeded === false ? `No usable new programme rows; kept last-good data (${count}).` : `Indexed ${count} programmes.`;
      updateMultiEpgRefreshStatus(sourceId, enabled.url, { ...(result.programmeSwapSucceeded === false ? {} : { lastRefreshAt: Date.now() }), lastStatus: status });
      setMessage(status); invalidateGuideOwnershipCaches();
    } catch (error) { setMessage(error instanceof Error ? error.message : "EPG refresh failed."); }
    finally { setBusy(false); }
  }, [busy, draft, persist, sourceId]);

  const filteredChannels = useMemo(() => {
    const query = channelQuery.trim().toLowerCase();
    return channels.filter((channel) => !query || `${channel.name} ${channel.group || ""} ${channel.raw_tvg_id || channel.tvg_id || ""}`.toLowerCase().includes(query)).slice(0, PAGE);
  }, [channelQuery, channels]);
  const selectedChannel = channels.find((item) => item.id === selectedChannelId);
  const xmltvPageCount = Math.max(1, Math.ceil(xmltvTotal / PAGE));
  const assignedXmltvIds = useMemo(() => new Set(Object.values(draft.overrides)), [draft.overrides]);

  const loadDirectory = useCallback(async () => {
    const generation = ++queryGeneration.current;
    try {
      const result = await listNativeSourceGuideChannels(sourceId, xmltvQuery, xmltvPage * PAGE, PAGE);
      if (generation !== queryGeneration.current) return;
      setXmltvRows(result.rows || []); setXmltvTotal(Math.max(0, Number(result.total) || 0));
    } catch (error) { if (generation === queryGeneration.current) setMessage(error instanceof Error ? error.message : "Could not read EPG channels."); }
  }, [sourceId, xmltvPage, xmltvQuery]);
  // Only queries the native EPG channel directory while the picker is open — reopening re-runs it immediately (assignDrawerOpen flips the deps), so the list is never stale, and nothing fires or lingers while the drawer is closed.
  useEffect(() => { if (!assignDrawerOpen) return; const timer = setTimeout(() => void loadDirectory(), 180); return () => clearTimeout(timer); }, [loadDirectory, assignDrawerOpen]);

  const assign = useCallback(async (xmltvId: string) => {
    if (!selectedChannel || busy) return;
    setBusy(true);
    try {
      await setNativeSourceGuideBinding(sourceId, selectedChannel.id, xmltvId);
      assignMultiEpgChannel(sourceId, selectedChannel.id, xmltvId);
      const next = { ...draft, overrides: { ...draft.overrides, [selectedChannel.id]: xmltvId } }; setDraft(next);
      invalidateGuideOwnershipCaches(); setAssignDrawerOpen(false); setMessage(`${selectedChannel.name} assigned to ${xmltvId}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not assign EPG channel."); }
    finally { setBusy(false); }
  }, [busy, draft, selectedChannel, sourceId]);

  const clearData = useCallback(async () => {
    if (busy) return; setBusy(true);
    try { await clearNativeSourceGuide(sourceId); updateMultiEpgRefreshStatus(sourceId, draft.url, { lastRefreshAt: 0, lastStatus: "EPG data cleared" }); setXmltvRows([]); setXmltvTotal(0); invalidateGuideOwnershipCaches(); setMessage("Programme data cleared; source and assignments kept."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not clear EPG data."); }
    finally { setBusy(false); }
  }, [busy, draft.url, sourceId]);

  const remove = useCallback(async () => {
    if (busy) return; setBusy(true);
    try {
      await clearNativeSourceGuide(sourceId);
      const extras = registry.sources.filter((item) => item.id !== sourceId); registry.remove(sourceId);
      await configureNativeUserGuideSources(primary.primaryEnabled, nativeSources(extras)); invalidateGuideOwnershipCaches(); router.replace("/epg-sources" as any);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove EPG source."); setBusy(false); }
  }, [busy, nativeSources, primary.primaryEnabled, registry, router, sourceId]);

  const refreshIndex = Math.max(0, REFRESH_VALUES.indexOf(draft.refreshHours));
  const cycleOffset = (value: number) => {
    const choices = [-120, -60, -30, 0, 30, 60, 120];
    return choices[(Math.max(0, choices.indexOf(value)) + 1) % choices.length];
  };
  return <PurpleTvShell active="/settings"><View style={styles.page}>
    <View style={styles.header}><Text style={styles.title}>Saved EPG source</Text><Pressable ref={entryFocus.targetRef as any} hasTVPreferredFocus={entryFocus.preferredFocus} nextFocusLeft={iconRailEntryTag} onFocus={entryFocus.onFocus} onBlur={entryFocus.onBlur} onPress={() => router.replace("/epg-sources" as any)} style={({ focused }: any) => [styles.button, focused && styles.focused]}><Text style={styles.text}>Back</Text></Pressable></View>
    <View style={styles.scrollWrap}>
      <ScrollView ref={scrollRef} removeClippedSubviews={false} focusable={false} scrollEnabled nestedScrollEnabled showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.content}>
      <View style={styles.card}><Text style={styles.cardTitle}>Source settings</Text>
        <TextInput value={draft.name} onChangeText={(name) => setDraft((value) => ({ ...value, name }))} placeholder="Source name" placeholderTextColor={tvColors.textMuted} style={styles.input} />
        <TextInput secureTextEntry editable={!suppliedSource} value={suppliedSource ? "Supplied by Charming MediaLab" : draft.url} onChangeText={(url) => setDraft((value) => ({ ...value, url }))} placeholder="https://server/guide.xml.gz" placeholderTextColor={tvColors.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.input} />
        <Row label="Enabled" value={draft.enabled ? "On" : "Off"} onPress={() => setDraft((value) => ({ ...value, enabled: !value.enabled }))} />
        <Row label="Update interval" value={draft.refreshHours === 0 ? "Manual only" : `${draft.refreshHours} hours`} onPress={() => setDraft((value) => ({ ...value, refreshHours: REFRESH_VALUES[(refreshIndex + 1) % REFRESH_VALUES.length] }))} />
        <Row label="Source / server time offset" value={`${timing.source.serverOffsetMinutes > 0 ? "+" : ""}${timing.source.serverOffsetMinutes} minutes`} onPress={() => timing.setServerOffsetMinutes(cycleOffset(timing.source.serverOffsetMinutes))} />
        <Row label="Playlist time offset" value={`${timing.source.playlistOffsetMinutes > 0 ? "+" : ""}${timing.source.playlistOffsetMinutes} minutes`} onPress={() => timing.setPlaylistOffsetMinutes(cycleOffset(timing.source.playlistOffsetMinutes))} />
        <Text style={styles.help}>Latest update: {draft.lastRefreshAt ? formatRelativeAge(draft.lastRefreshAt) : "Never"} · {draft.lastStatus}</Text>
        <View style={styles.actions}><Button label="Save" onPress={save} disabled={busy} /><Button label="Update EPG" onPress={refresh} disabled={busy} /><Button label="Clear EPG data" onPress={clearData} disabled={busy} /><Button label="Remove source" onPress={remove} disabled={busy || suppliedSource} /></View>
      </View>
      <View style={styles.card}><Text style={styles.cardTitle}>Assign channels</Text><Text style={styles.help}>A channel can have one custom EPG owner. Assigning it here automatically removes an older custom-source assignment.</Text>
        <TextInput value={channelQuery} onChangeText={setChannelQuery} placeholder="Search playlist channels" placeholderTextColor={tvColors.textMuted} style={styles.input} />
        {filteredChannels.map((channel) => <Row key={channel.id} label={channel.name} value={draft.overrides[channel.id] ? "Assigned" : channel.group || "Live TV"} selected={selectedChannelId === channel.id} onPress={() => { setSelectedChannelId(channel.id); setAssignDrawerOpen(true); }} />)}
      </View>
      {selectedChannel ? <View style={styles.card}><Text style={styles.cardTitle}>EPG channel for {selectedChannel.name}</Text>
        <Text style={styles.help}>Current: {draft.overrides[selectedChannel.id] ? `Assigned · ${draft.overrides[selectedChannel.id]}` : "Not assigned"}</Text>
        <Row label="Channel time offset" value={`${(timing.source.channelOffsets[selectedChannel.id] || 0) > 0 ? "+" : ""}${timing.source.channelOffsets[selectedChannel.id] || 0} minutes`} onPress={() => timing.setChannelOffsetMinutes(selectedChannel.id, cycleOffset(timing.source.channelOffsets[selectedChannel.id] || 0))} />
        <View style={styles.actions}><Button label={draft.overrides[selectedChannel.id] ? "Change assignment" : "Choose from list"} onPress={() => setAssignDrawerOpen(true)} /></View>
      </View> : null}
      {message ? <Text style={styles.status}>{message}</Text> : null}
      </ScrollView>
    </View>
  </View>
  {selectedChannel ? (
    <EpgChannelAssignDrawer
      returnFocusRef={entryFocus.targetRef}
      returnFocusConfirmed={entryFocus.isFocused}
      visible={assignDrawerOpen}
      title={`Assign XMLTV channel to ${selectedChannel.name}`}
      subtitle="Search this EPG source's own channel list, then pick one to bind it to this playlist channel."
      query={xmltvQuery}
      onQueryChange={(value) => { setXmltvQuery(value); setXmltvPage(0); }}
      filter={xmltvFilter}
      onFilterChange={setXmltvFilter}
      rows={xmltvRows}
      total={xmltvTotal}
      page={xmltvPage}
      pageCount={xmltvPageCount}
      onPrevPage={() => setXmltvPage((value) => Math.max(0, value - 1))}
      onNextPage={() => setXmltvPage((value) => Math.min(xmltvPageCount - 1, value + 1))}
      assignedIds={assignedXmltvIds}
      currentAssignedId={draft.overrides[selectedChannel.id] || null}
      onSelect={(id) => void assign(id)}
      onClose={() => setAssignDrawerOpen(false)}
      busy={busy}
    />
  ) : null}
  </PurpleTvShell>;
}

function Row({ label, value, onPress, selected = false }: { label: string; value: string; onPress: () => void; selected?: boolean }) { return <Pressable onPress={onPress} style={({ focused }: any) => [styles.row, selected && styles.selected, focused && styles.focused]}><Text numberOfLines={1} style={styles.rowText}>{label}</Text><Text numberOfLines={1} style={styles.value}>{value}</Text></Pressable>; }
function Button({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable disabled={disabled} onPress={onPress} style={({ focused }: any) => [styles.button, disabled && styles.disabled, focused && styles.focused]}><Text style={styles.text}>{label}</Text></Pressable>; }
const styles = StyleSheet.create({ page:{flex:1,backgroundColor:tvColors.canvas,padding:18},scrollWrap:{flex:1},header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:12},title:{color:tvColors.text,fontFamily:fonts.bold,fontSize:22},content:{gap:12,paddingBottom:50},card:{backgroundColor:tvColors.panel,borderWidth:1,borderColor:tvColors.line,borderRadius:radius.md,padding:12,gap:7},cardTitle:{color:tvColors.text,fontFamily:fonts.bold,fontSize:14},help:{color:tvColors.textMuted,fontFamily:fonts.regular,fontSize:10,lineHeight:15},input:{minHeight:40,borderRadius:radius.sm,borderWidth:1,borderColor:tvColors.line,color:tvColors.text,paddingHorizontal:10,fontFamily:fonts.regular,fontSize:10.5},row:{minHeight:42,paddingHorizontal:10,borderRadius:radius.sm,borderWidth:1,borderColor:"transparent",flexDirection:"row",alignItems:"center",gap:10},rowText:{color:tvColors.text,fontFamily:fonts.medium,fontSize:10.5,flex:1},value:{color:tvColors.purpleSoft,fontFamily:fonts.medium,fontSize:9.5,maxWidth:250},selected:{backgroundColor:"rgba(120,80,210,0.22)",borderColor:"rgba(168,132,245,0.30)"},focused:{borderColor:tvColors.purpleBright,backgroundColor:"rgba(126,84,218,0.32)"},actions:{flexDirection:"row",flexWrap:"wrap",gap:7},button:{minHeight:36,paddingHorizontal:12,alignItems:"center",justifyContent:"center",borderRadius:radius.sm,borderWidth:1,borderColor:tvColors.line},text:{color:"#fff",fontFamily:fonts.medium,fontSize:9.5},disabled:{opacity:0.35},status:{color:tvColors.purpleSoft,fontFamily:fonts.medium,fontSize:10.5} });
