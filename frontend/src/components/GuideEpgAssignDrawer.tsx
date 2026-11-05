import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Channel } from "@/src/api";
import { FocusGuide } from "./TVFocusGuideView";
import { useStore } from "@/src/store";
import { useEpgSourcePreferences } from "@/src/core/epgSourcePreferences";
import { assignMultiEpgChannel, clearMultiEpgChannelAssignments, useMultiEpgSources } from "@/src/core/multiEpgSources";
import { createGuideDirectoryOwner, guideEpgSearchTerm, type GuideDirectoryRow } from "@/src/core/guideEpgDirectory";
import { configureNativeUserGuideSources, listNativePrimaryGuideChannels, listNativeSourceGuideChannels, listNativeUserGuideChannels, setNativeGuideChannelBinding, setNativeSourceGuideBinding } from "@/src/nativeEpg";
import { invalidateGuideOwnershipCaches } from "@/src/source";
import { addTvKeyListener, resetRemoteContextIfOwned, setGuideNavigationActive, setRemoteContext } from "@/src/utils/tvRemote";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { fonts, radius, tvColors } from "@/src/theme";

export const GUIDE_EPG_DRAWER_WIDTH = 320;
const PAGE = 40;
type Source = { id: string; name: string };
type Props = {
  channel: Channel | null;
  interactive: boolean;
  onInteractiveChange: (value: boolean) => void;
  onReturnToGuide: () => void;
  onAssigned: () => void;
  onClose: () => void;
};

/** A sibling of the guide, never a modal backdrop: channel movement keeps it open. */
export function GuideEpgAssignDrawer({ channel, interactive, onInteractiveChange, onReturnToGuide, onAssigned, onClose }: Props) {
  const prefs = useEpgSourcePreferences();
  const multi = useMultiEpgSources();
  const { epgManualRemaps, setEpgManualRemaps } = useStore();
  const sources = useMemo<Source[]>(() => [
    ...(prefs.primaryEnabled ? [{ id: "primary", name: "Playlist 1 EPG" }] : []),
    ...(prefs.userEnabled && prefs.userUrl ? [{ id: "user", name: prefs.userName }] : []),
    ...multi.sources.filter(s => s.enabled && !!s.url).map(s => ({ id: s.id, name: s.name })),
  ], [prefs.primaryEnabled, prefs.userEnabled, prefs.userUrl, prefs.userName, multi.sources]);
  const [sourceId, setSourceId] = useState("primary");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<GuideDirectoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unassigned, setUnassigned] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const closeRef = useRef<any>(null);
  const channelRef = useRef(channel); channelRef.current = channel;
  const owner = useRef(createGuideDirectoryOwner()).current;
  const operation = useRef(false);
  const lastChannel = useRef<string | null>(null);
  const sourceAvailable = sources.some(s => s.id === sourceId);
  const channelId = channel?.id;
  const channelName = channel?.name || "";

  useEffect(() => {
    if (!channel) return;
    if (lastChannel.current !== channel.id) {
      lastChannel.current = channel.id;
      owner.invalidate(); setRows([]); setTotal(0); setPage(0); setMessage(null);
      setQuery(guideEpgSearchTerm(channel.name));
      const extra = multi.sources.find(s => s.enabled && s.overrides[channel.id]);
      const preferred = extra?.id || (prefs.userEnabled && prefs.userOverrides[channel.id] ? "user" : sourceId);
      setSourceId(sources.some(s => s.id === preferred) ? preferred : sources[0]?.id || "");
    } else if (!sources.some(s => s.id === sourceId)) setSourceId(sources[0]?.id || "");
  }, [channel, multi.sources, owner, prefs.userEnabled, prefs.userOverrides, sourceId, sources]);

  useEffect(() => {
    owner.invalidate(); setRows([]); setTotal(0);
    if (!channelId || !sourceId || !sourceAvailable) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => void owner.load(async () => {
      const read = (term: string) => sourceId === "primary" ? listNativePrimaryGuideChannels(term, page * PAGE, PAGE)
        : sourceId === "user" ? listNativeUserGuideChannels(term, page * PAGE, PAGE)
          : listNativeSourceGuideChannels(sourceId, term, page * PAGE, PAGE);
      let result = await read(query);
      // Retargeting suggests the selected channel, but never hides the full directory.
      if (!result.total && page === 0 && query === guideEpgSearchTerm(channelName)) {
        const shorter = query.split(/\s+/)[0];
        if (shorter && shorter !== query) result = await read(shorter);
        if (!result.total) result = await read("");
      }
      return result;
    }, result => { setRows(result.rows || []); setTotal(result.total || 0); setLoading(false); }, () => {
      setLoading(false); setMessage("Could not read this guide directory. Try another source or refresh the EPG in Settings.");
    }), 160);
    return () => { clearTimeout(timer); owner.invalidate(); };
  }, [channelId, channelName, sourceId, sourceAvailable, query, page, owner]);

  const returnToGuide = useCallback(() => { onInteractiveChange(false); onReturnToGuide(); }, [onInteractiveChange, onReturnToGuide]);
  useEffect(() => {
    if (!interactive) return;
    setRemoteContext("modal"); setGuideNavigationActive(false);
    const cancel = requestNativeFocusWithRetry(closeRef.current);
    const removeKey = addTvKeyListener(key => { if (key === "LEFT") returnToGuide(); });
    const back = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => { cancel(); removeKey(); back.remove(); resetRemoteContextIfOwned("modal", "guide"); };
  }, [interactive, onClose, returnToGuide]);

  const assignedIds = useMemo(() => new Set(Object.values(sourceId === "primary" ? epgManualRemaps : sourceId === "user" ? prefs.userOverrides : multi.sources.find(s => s.id === sourceId)?.overrides || {})), [sourceId, epgManualRemaps, prefs.userOverrides, multi.sources]);
  const assigned = channel ? (sourceId === "primary" ? epgManualRemaps[channel.id] : sourceId === "user" ? prefs.userOverrides[channel.id] : multi.sources.find(s => s.id === sourceId)?.overrides[channel.id]) : null;
  const assign = useCallback(async (xmltvId: string | null) => {
    if (!channel || operation.current) return;
    const target = channel.id, targetName = channel.name, source = sourceId;
    operation.current = true; setBusy(true); setMessage(null);
    try {
      if (!xmltvId || source === "primary") {
        // One native transaction clears the old custom owner before using primary matching.
        await setNativeGuideChannelBinding(target, null);
        prefs.setUserOverride(target, null); clearMultiEpgChannelAssignments(target);
        const next = { ...epgManualRemaps }; if (xmltvId) next[target] = xmltvId; else delete next[target];
        setEpgManualRemaps(next);
      } else {
        await configureNativeUserGuideSources(prefs.primaryEnabled, [
          { id: "user", url: prefs.userUrl, enabled: prefs.userEnabled, refreshHours: 12 },
          ...multi.sources.map(s => ({ id: s.id, url: s.url, enabled: s.enabled, refreshHours: s.refreshHours })),
        ]);
        if (source === "user") {
          await setNativeGuideChannelBinding(target, xmltvId); clearMultiEpgChannelAssignments(target); prefs.setUserOverride(target, xmltvId);
        } else {
          await setNativeSourceGuideBinding(source, target, xmltvId); prefs.setUserOverride(target, null); assignMultiEpgChannel(source, target, xmltvId);
        }
        if (epgManualRemaps[target]) { const next = { ...epgManualRemaps }; delete next[target]; setEpgManualRemaps(next); }
      }
      invalidateGuideOwnershipCaches(); onAssigned();
      if (channelRef.current?.id === target) setMessage(xmltvId ? `Assigned to ${targetName}. Keep moving through channels to assign more.` : "Automatic matching restored.");
    } catch { if (channelRef.current?.id === target) setMessage("Could not save this assignment. Please try again."); }
    finally { operation.current = false; setBusy(false); }
  }, [channel, sourceId, prefs, multi.sources, epgManualRemaps, setEpgManualRemaps, onAssigned]);

  return <View style={styles.drawer} testID="guide-persistent-epg" onFocusCapture={() => { if (!interactive) onInteractiveChange(true); }}>
    <FocusGuide style={styles.inner} trapFocusUp trapFocusDown trapFocusRight>
      <View style={styles.heading}><View style={{ flex: 1 }}><Text style={styles.eyebrow}>ASSIGN EPG</Text><Text numberOfLines={2} style={styles.channel}>{channel?.name || "Select a channel"}</Text></View><Pressable ref={closeRef} onPress={onClose} accessibilityLabel="Close EPG assignment" style={({ focused }: any) => [styles.button, focused && styles.focused]}><Ionicons name="close" color={tvColors.text} size={19}/></Pressable></View>
      <Pressable onPress={returnToGuide} style={({ focused }: any) => [styles.button, focused && styles.focused]}><Text style={styles.text}>← Return to guide · keep drawer open</Text></Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sourceList}>{sources.map(source => <Pressable key={source.id} onPress={() => { owner.invalidate(); setSourceId(source.id); setPage(0); }} style={({ focused }: any) => [styles.source, sourceId === source.id && styles.selected, focused && styles.focused]}><Text style={styles.text}>{source.name}</Text></Pressable>)}</ScrollView>
      <TextInput value={query} onChangeText={value => { owner.invalidate(); setQuery(value); setPage(0); }} placeholder="Search guide channels" placeholderTextColor={tvColors.textMuted} autoCorrect={false} autoCapitalize="none" style={styles.search} testID="guide-epg-search" />
      <View style={styles.filters}><Pressable onPress={() => { setQuery(""); setPage(0); }} style={({ focused }: any) => [styles.button, focused && styles.focused]}><Text style={styles.text}>All channels</Text></Pressable><Pressable onPress={() => setUnassigned(v => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: unassigned }} style={({ focused }: any) => [styles.button, focused && styles.focused]}><Text style={styles.text}>{unassigned ? "☑" : "☐"} Unassigned</Text></Pressable></View>
      {loading ? <ActivityIndicator color={tvColors.focus}/> : null}
      <ScrollView style={styles.results} nestedScrollEnabled showsVerticalScrollIndicator={false}>{rows.filter(row => !unassigned || !assignedIds.has(row.id)).map(row => <Pressable key={`${sourceId}:${row.id}`} disabled={busy} onPress={() => void assign(row.id)} style={({ focused }: any) => [styles.row, assigned === row.id && styles.selected, focused && styles.focused]}><View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.text}>{row.name || row.id}</Text><Text numberOfLines={1} style={styles.meta}>{row.id}</Text></View>{assigned === row.id ? <Ionicons name="checkmark" color={tvColors.focus} size={18}/> : assignedIds.has(row.id) ? <Text style={styles.meta}>In use</Text> : null}</Pressable>)}</ScrollView>
      {!loading && !rows.length ? <Text style={styles.meta}>{sources.length ? "No indexed channels. Refresh this EPG in Settings." : "Enable an EPG source in Settings first."}</Text> : null}
      <View style={styles.filters}><Pressable disabled={page === 0 || loading} onPress={() => setPage(p => Math.max(0, p - 1))} style={({ focused }: any) => [styles.button, focused && styles.focused]}><Text style={styles.text}>Previous</Text></Pressable><Text style={styles.meta}>{page + 1} / {Math.max(1, Math.ceil(total / PAGE))}</Text><Pressable disabled={(page + 1) * PAGE >= total || loading} onPress={() => setPage(p => p + 1)} style={({ focused }: any) => [styles.button, focused && styles.focused]}><Text style={styles.text}>Next</Text></Pressable></View>
      <Pressable disabled={busy} onPress={() => void assign(null)} style={({ focused }: any) => [styles.button, focused && styles.focused]}><Text style={styles.text}>Use automatic EPG</Text></Pressable>
      {message ? <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text> : null}
    </FocusGuide>
  </View>;
}
const styles = StyleSheet.create({
  drawer: { width: GUIDE_EPG_DRAWER_WIDTH, maxWidth: "45%", alignSelf: "stretch", backgroundColor: tvColors.panel, borderLeftWidth: 1, borderLeftColor: tvColors.line, padding: 12 },
  inner: { flex: 1, gap: 8 }, heading: { flexDirection: "row", gap: 8, alignItems: "center" }, eyebrow: { color: tvColors.purpleSoft, fontSize: 10, letterSpacing: 1.6 }, channel: { color: tvColors.text, fontFamily: fonts.semibold, fontSize: 17, marginTop: 3 },
  button: { paddingVertical: 9, paddingHorizontal: 8, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent" }, focused: { borderColor: tvColors.focus, backgroundColor: tvColors.purpleDeep }, text: { color: tvColors.text, fontSize: 12 }, meta: { color: tvColors.textMuted, fontSize: 10, marginTop: 3 },
  sourceList: { maxHeight: 44, flexGrow: 0 }, source: { padding: 8, borderRadius: radius.sm, marginRight: 5, borderWidth: 2, borderColor: "transparent" }, selected: { backgroundColor: tvColors.purpleDeep }, search: { color: tvColors.text, backgroundColor: tvColors.canvas, borderWidth: 1, borderColor: tvColors.lineStrong, borderRadius: radius.sm, padding: 9, fontSize: 13 },
  filters: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 }, results: { flex: 1 }, row: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, marginBottom: 3, borderRadius: radius.sm, borderWidth: 2, borderColor: "transparent" }, status: { color: tvColors.textMuted, fontSize: 11 },
});
