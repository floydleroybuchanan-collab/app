import { isPlaybackGroupLocked } from "@/src/core/parentalPin";
import { useChannelCustomize } from "@/src/core/channelCustomize";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, BackHandler, FlatList, Platform, Pressable, requireNativeComponent, ScrollView, StyleSheet, Text, TextInput, View, type ViewProps } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { goToTab } from "@/src/utils/goToTab";
import { multiviewLayout } from "@/src/core/multiviewLayout";
import { useMultiviewPreferences, loadMultiviewPreferences, getMultiviewPreferences, updateMultiviewPreferences } from "@/src/core/multiviewPreferences";
import { useStore } from "@/src/store";
import type { Channel } from "@/src/api";
import { fonts, glass } from "@/src/theme";
import { multiview, listenMultiview, type MultiviewEvent } from "@/src/multiview";
import { MAX_MULTIVIEW_PANES, multiviewAdmission, nextAudiblePane, type MultiviewPane } from "@/src/core/multiviewPolicy";
import { beginSession, isSessionCurrent, registerSessionStop, stopAllPlaybackSessions, stopFullscreenSession } from "@/src/core/playbackSession";
import { detectStreamKind, isNativeMedia3SupportedStreamKind, media3ContentType, parsePipeHeaders } from "@/src/core/streamPolicy";
import { listPlaylists } from "@/src/core/playlistRegistry";
import { refreshPlaybackChannel } from "@/src/source";
import { setRemoteContext, resetRemoteContextIfOwned } from "@/src/utils/tvRemote";
import { useAudioTrackPreferences } from "@/src/core/audioTrackPreferences";
import { useSubtitlePreferences } from "@/src/core/subtitlePreferences";
import { FocusGuide } from "@/src/components/TVFocusGuideView";
import { requestGuideJump } from "@/src/core/guideSearchJump";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";
import { useAppPolicy } from "@/src/core/useAppPolicy";
import { getAppPolicy } from "@/src/core/appPolicy";

const Surface = Platform.OS === "android" && multiview ? requireNativeComponent<ViewProps & { slot: number; session: string }>("CharmMultiviewSurface") : View;
let sequence = 0;

type ChooserRow = { key: string; label: string; count: number };
// Fixed row heights let FlatList skip measuring thousands of rows while
// scrolling with the D-pad (the old unbounded list measured every row).
const PICKER_ROW_HEIGHT = 56;
const PICKER_ROW_GAP = 4;
const CHOOSER_ROW_HEIGHT = 44;
const CHOOSER_ROW_GAP = 4;
const channelRowLayout = (_: unknown, index: number) => ({ length: PICKER_ROW_HEIGHT + PICKER_ROW_GAP, offset: (PICKER_ROW_HEIGHT + PICKER_ROW_GAP) * index, index });
const chooserRowLayout = (_: unknown, index: number) => ({ length: CHOOSER_ROW_HEIGHT + CHOOSER_ROW_GAP, offset: (CHOOSER_ROW_HEIGHT + CHOOSER_ROW_GAP) * index, index });

const PickerChannelRow = React.memo(function PickerChannelRow({ channel, onChoose }: { channel: Channel; onChoose: (channel: Channel) => void }) {
  return <Pressable onPress={() => onChoose(channel)} style={({ focused }: any) => [styles.row, focused && styles.focus]}>
    <Text numberOfLines={1} style={styles.rowName}>{channel.name}</Text>
    <Text numberOfLines={1} style={styles.rowMeta}>{channel.playlist_name} · {channel.source_group || channel.group}</Text>
  </Pressable>;
});

/** Scrollable playlist / group list for the pop-up box; opens on the current entry. */
function ChooserList({ rows, current, focusRef, onPick }: { rows: ChooserRow[]; current: string; focusRef: React.MutableRefObject<any>; onPick: (key: string) => void }) {
  const selectedIndex = Math.max(0, rows.findIndex(row => row.key === current));
  return <FlatList data={rows} keyExtractor={row => row.key} style={styles.chooserList}
    getItemLayout={chooserRowLayout} initialScrollIndex={selectedIndex > 2 ? selectedIndex - 2 : undefined}
    initialNumToRender={14} maxToRenderPerBatch={10} windowSize={5}
    renderItem={({ item, index }) => <Pressable ref={index === selectedIndex ? focusRef : undefined} hasTVPreferredFocus={index === selectedIndex}
      onPress={() => onPick(item.key)} style={({ focused }: any) => [styles.chooserRow, item.key === current && styles.chooserCurrent, focused && styles.focus]}>
      <Text numberOfLines={1} style={styles.chooserText}>{item.key === current ? "✓ " : ""}{item.label}</Text>
      <Text style={styles.chooserCount}>{item.count}</Text>
    </Pressable>} />;
}
export default function MultiviewScreen() {
  const router = useRouter();
  const appPolicy = useAppPolicy();
  const { hiddenIds } = useChannelCustomize();
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const hiddenRef = useRef(hidden); hiddenRef.current = hidden;
  const params = useLocalSearchParams<{ channelId?: string; returnGuideGroup?: string }>();
  const { channels, favorites, recent, addRecent, sleepTimerMinutes, setSleepTimerMinutes } = useStore();
  const catalog = useRef(channels); catalog.current = channels;
  const preferences = useMultiviewPreferences();
  const [menu, setMenu] = useState(false);
  const [enlarged, setEnlarged] = useState<number | null>(null);
  const [order, setOrder] = useState([0,1,2,3]);
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [labels, setLabels] = useState(true);
  const [filter, setFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const audioPreferences = useAudioTrackPreferences();
  const subtitlePreferences = useSubtitlePreferences();
  const token = useRef(`multiview-${Date.now()}-${++sequence}`).current;
  const [ready, setReady] = useState(false);
  const [panes, setPanes] = useState<MultiviewPane[]>(Array(MAX_MULTIVIEW_PANES).fill(null));
  const paneRef = useRef(panes);
  const revisions = useRef([0,0,0,0]);
  const [selected, setSelected] = useState(0);
  const [audible, setAudible] = useState(-1);
  const audibleRef = useRef(-1);
  const [picker, setPicker] = useState<number | null>(null);
  const pickerRef = useRef<number | null>(null); pickerRef.current = picker;
  // Playlist / group pop-up list inside the channel picker. Selecting a
  // playlist opens its groups next; selecting a group returns to the channels.
  const [chooser, setChooser] = useState<null | "playlist" | "group">(null);
  const [chooserReturn, setChooserReturn] = useState<null | "playlist" | "group">(null);
  const chooserFocus = useRef<any>(null);
  const playlistButton = useRef<any>(null);
  const groupButton = useRef<any>(null);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [notice, setNotice] = useState("");
  const [states, setStates] = useState<Record<number, MultiviewEvent>>({});
  const active = useRef(false);
  const leaving = useRef(false);
  const sessionGeneration = useRef(0);
  const recordedHistory = useRef(new Map<number,number>());
  const paneNodes = useRef<any[]>([]);
  const focusConfirmed = useRef(false);
  const firstPicker = useRef<any>(null);
  const [preferOverlayFocus, setPreferOverlayFocus] = useState(false);
  const writePanes = useCallback((next: MultiviewPane[]) => { paneRef.current = next; setPanes(next); }, []);
  const choose = useCallback(async (slot: number, supplied: Channel, refresh = false) => {
    if (!active.current || !multiview) return;
    const revision = ++revisions.current[slot];
    setNotice("Checking channel…");
    try {
      const channel = refresh ? await refreshPlaybackChannel(supplied.id) ?? supplied : supplied;
      if (hiddenRef.current.has(channel.id)) { setNotice("This channel is hidden. Unhide it in Settings → Channels first."); return; }
      if (await isPlaybackGroupLocked([channel.group || "", channel.source_group || ""])) { setNotice("This channel group is locked. Unlock it in the TV Guide first."); return; }
      const playlists = await listPlaylists();
      if (!active.current || revisions.current[slot] !== revision) return;
      const record = playlists.find(row => row.id === channel.playlist_id);
      const policy=getAppPolicy();
      if(slot>=policy.multiview_max) {setNotice(policy.multiview_max===0?"Multiview is disabled by the administrator.":`Your multiview allowance is ${policy.multiview_max} panes.`);return;}
      const reason = multiviewAdmission(paneRef.current, slot, channel, policy.provider_limits[channel.playlist_id||"charm-primary"] || record?.account?.maxConnections);
      if (reason) { setNotice(reason); return; }
      const source = parsePipeHeaders(channel.url);
      const kind = detectStreamKind(source.uri, channel.stream_type);
      if (!isNativeMedia3SupportedStreamKind(kind)) { setNotice("This channel's stream protocol is not supported by the player."); return; }
      const next = [...paneRef.current]; next[slot] = { channel, revision }; writePanes(next);
      setStates(current => ({ ...current, [slot]: { session: token, slot, revision, state: "loading" } }));
      await multiview.prepare(token, slot, revision, channel.id, source.uri, source.headers, media3ContentType(kind));
      if (!active.current || revisions.current[slot] !== revision) return;
      multiview.listen(token,slot); audibleRef.current = slot; setAudible(slot); setSelected(slot); setPicker(null); setQuery("");
      setNotice(record?.account?.activeConnections && record.account.maxConnections && record.account.activeConnections >= record.account.maxConnections
        ? "Your provider last reported all connections in use. Another device may need to stop playback." : "Each pane uses one provider connection. Press OK on a pane for options.");
    } catch { if (active.current && revisions.current[slot] === revision) {
      const reason = "Could not open this channel. Check your connection or try another channel.";
      setNotice(reason);
      if (paneRef.current[slot]?.revision === revision) setStates(current => ({...current, [slot]: {session:token,slot,revision,state:"error",reason}}));
    } }
  }, [token, writePanes]);
  const chooseRef = useRef(choose); chooseRef.current = choose;
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    let unregister = () => {};
    leaving.current = false;
    setRemoteContext("default");
    void (async () => {
      try {
        if (!multiview) throw new Error();
        await stopAllPlaybackSessions("superseded");
        if (cancelled) return;
        sessionGeneration.current = beginSession("fullscreen");
        unregister = registerSessionStop("fullscreen", sessionGeneration.current, () => {
          active.current = false;
          return multiview!.end(token);
        });
        await multiview.begin(token);
        if (cancelled) { await multiview.end(token); return; }
        active.current = true; setReady(true);
        await loadMultiviewPreferences();
        if (cancelled) return;
        const saved = getMultiviewPreferences();
        const ids = saved.remember && saved.channelIds.length ? saved.channelIds : [params.channelId];
        let slot = 0;
        for (const id of ids.slice(0, getAppPolicy().multiview_max)) {
          if (cancelled) return;
          const seed = catalog.current.find(channel => channel.id === id);
          if (seed) await chooseRef.current(slot++, seed);
        }
        if (!slot) setPicker(0);
      } catch { if (!cancelled) setNotice("Multiview could not start. Close playback and try again."); }
    })();
    return () => {
      cancelled = true; active.current = false;
      // Keep the registered native close in the ownership barrier until it settles.
      if (isSessionCurrent("fullscreen", sessionGeneration.current)) void stopFullscreenSession("superseded");
      else void multiview?.end(token).catch(() => {});
      unregister();
      resetRemoteContextIfOwned("default", "default");
    };
  }, [params.channelId, token]));
  useEffect(() => listenMultiview(event => {
    if (!active.current || event.session !== token || paneRef.current[event.slot]?.revision !== event.revision) return;
    setStates(current => ({...current, [event.slot]: event}));
    if (event.state === "playing") {
      const channel = paneRef.current[event.slot]?.channel;
      if (channel && recordedHistory.current.get(event.slot) !== event.revision) { recordedHistory.current.set(event.slot,event.revision); addRecent(channel); }
    }
  }), [addRecent, token]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => {
      if (!active.current) return;
      if (state === "active") multiview?.resume(token); else multiview?.suspend(token);
    });
    return () => sub.remove();
  }, [token]);
  useEffect(() => {
    if (!ready || !active.current) return;
    const ids = new Set(channels.map(c=>c.id));
    let changed = false;
    const next = paneRef.current.map((pane,slot) => {
      if (!pane || ids.has(pane.channel.id)) return pane;
      changed = true; multiview?.remove(token,slot,++revisions.current[slot]); return null;
    });
    if (changed) {
      writePanes(next);setEnlarged(null);setNotice("A channel is no longer enabled. Choose another channel.");
      const slot = nextAudiblePane(next,audibleRef.current);audibleRef.current=slot;setAudible(slot);if(slot>=0)multiview?.listen(token,slot);
    }
  }, [channels, ready, token, writePanes]);
  const exit = useCallback(async (fullscreen = false) => {
    if (leaving.current) return;
    leaving.current = true; active.current = false;
    try {
      await multiview?.end(token);
      await stopFullscreenSession("user-stop");
      const channel = paneRef.current[selected]?.channel;
      if (fullscreen && channel) router.replace({ pathname: "/player", params: { channelId: channel.id, returnToGuide: "1", returnGuideGroup: params.returnGuideGroup } });
      else { if (channel) requestGuideJump({channelId:channel.id,group:params.returnGuideGroup || "All"}); goToTab(router, "/guide"); }
    } catch { leaving.current = false; setNotice("A player could not close. Restart Charming MediaLab before opening more streams."); }
  }, [params.returnGuideGroup, router, selected, token]);
  const exitRef = useRef(exit); exitRef.current = exit;
  useEffect(() => {
    if(!ready) return;
    if(appPolicy.multiview_max===0) {void exitRef.current();return;}
    const used: Record<string,number>={};
    const next=paneRef.current.map((pane,slot)=>{
      if(!pane)return null;
      const owner=pane.channel.playlist_id||"charm-primary";
      used[owner]=(used[owner]||0)+1;
      if(slot>=appPolicy.multiview_max || (appPolicy.provider_limits[owner]>0&&used[owner]>appPolicy.provider_limits[owner])) {
        multiview?.remove(token,slot,++revisions.current[slot]);return null;
      }
      return pane;
    });
    writePanes(next);
    if (next.every(p=>!p)) setEnlarged(null);
    else setEnlarged(old=>old != null && !next[old] ? null : old);
    setSelected(old => old >= appPolicy.multiview_max ? 0 : old);
    const nextAudio=nextAudiblePane(next,audibleRef.current);audibleRef.current=nextAudio;setAudible(nextAudio);
    if(nextAudio>=0)multiview?.listen(token,nextAudio);
  },[appPolicy,ready,token,writePanes]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (chooser) { setChooserReturn(chooser); setChooser(null); }
      else if (picker != null) { setPicker(null); setQuery(""); setMenu(true); }
      else if (menu) setMenu(false);
      else if (swapFrom != null) setSwapFrom(null);
      else if (enlarged != null) setEnlarged(null);
      else void exit();
      return true;
    });
    return () => sub.remove();
  }, [chooser, exit, picker, menu, swapFrom, enlarged]);
  useEffect(() => {
    if (!sleepTimerMinutes || sleepTimerMinutes <= 0) return;
    const timer = setTimeout(() => { setSleepTimerMinutes(0); void exitRef.current(); }, sleepTimerMinutes * 60_000);
    return () => clearTimeout(timer);
  }, [setSleepTimerMinutes, sleepTimerMinutes]);
  useEffect(() => {
    if (ready) multiview?.preferences(token, audioPreferences.defaultLanguage, subtitlePreferences.defaultLanguage);
  }, [ready, token, audioPreferences.defaultLanguage, subtitlePreferences.defaultLanguage]);
  const remove = () => {
    ++revisions.current[selected]; multiview?.remove(token, selected, revisions.current[selected]);
    const next = [...paneRef.current]; next[selected] = null; writePanes(next);
    const nextAudio = nextAudiblePane(next, audibleRef.current); audibleRef.current = nextAudio; setAudible(nextAudio);
    if (nextAudio >= 0) multiview?.listen(token,nextAudio);
  };
  const overlay = menu || picker != null;
  const firstMenu = useRef<any>(null);
  useEffect(() => {
    focusConfirmed.current = false;
    setPreferOverlayFocus(menu || picker != null);
    // Only the visible owner may request focus. Resolve refs at retry time:
    // the new picker/menu may not have mounted on the first frame.
    return requestNativeFocusWithRetry(
      () => picker != null
        ? chooser ? chooserFocus.current
          : chooserReturn === "group" ? groupButton.current
          : chooserReturn === "playlist" ? playlistButton.current
          : firstPicker.current
        : menu ? firstMenu.current : paneNodes.current[selected],
      [0, 80, 160, 300, 560], () => focusConfirmed.current,
    );
  }, [menu, picker, chooser, chooserReturn, enlarged, selected, ready]);
  useEffect(() => { if (picker == null) { setChooser(null); setChooserReturn(null); } }, [picker]);
  const openChooser = (kind: "playlist" | "group") => { setChooserReturn(null); setChooser(kind); };
  const pickChooser = (key: string) => {
    if (chooser === "playlist") {
      setSourceFilter(key); setGroupFilter("all");
      // Same flow as the player's guide: playlist first, then its groups.
      setChooser("group");
    } else {
      setGroupFilter(key);
      setChooserReturn("group"); setChooser(null);
    }
  };
  const chooseRow = useCallback((item: Channel) => {
    const slot = pickerRef.current;
    if (slot != null) void choose(slot, item);
  }, [choose]);
  const confirmOverlayFocus = () => { focusConfirmed.current = true; setPreferOverlayFocus(false); };
  useEffect(() => {
    setLabels(true);
    if (overlay || !preferences.hideLabels) return;
    const timer = setTimeout(() => setLabels(false), 5000);
    return () => clearTimeout(timer);
  }, [selected, overlay, notice, preferences.hideLabels]);
  useEffect(() => {
    if (!ready || !preferences.remember) return;
    const ids = order.flatMap(slot => panes[slot] ? [panes[slot]!.channel.id] : []);
    if (!ids.length) return;
    const timer = setTimeout(() => updateMultiviewPreferences({channelIds:ids}), 1000);
    return () => clearTimeout(timer);
  }, [panes, order, ready, preferences.remember]);
  const occupied = order.filter(slot => panes[slot]);
  const visible = preferences.automaticLayout && occupied.length ? occupied : order.filter(slot => slot < appPolicy.multiview_max);
  const positions = multiviewLayout(visible, enlarged);
  const favoriteIds = useMemo(() => new Set(favorites), [favorites]);
  const recentIds = useMemo(() => new Set(recent.map(item => item.id)), [recent]);
  // One pass each, no per-channel tuple arrays (playlists hold thousands).
  const playlistRows = useMemo<ChooserRow[]>(() => {
    const names = new Map<string, string>();
    const counts = new Map<string, number>();
    let total = 0;
    for (const c of channels) {
      if (!c.url || hidden.has(c.id)) continue;
      const id = c.playlist_id || "charm-primary";
      if (!names.has(id)) names.set(id, c.playlist_name || "Playlist 1");
      counts.set(id, (counts.get(id) || 0) + 1);
      total++;
    }
    const rows: ChooserRow[] = [{ key: "all", label: "All playlists", count: total }];
    names.forEach((label, key) => rows.push({ key, label, count: counts.get(key) || 0 }));
    return rows;
  }, [channels, hidden]);
  const groupRows = useMemo<ChooserRow[]>(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const c of channels) {
      if (!c.url || hidden.has(c.id)) continue;
      if (sourceFilter !== "all" && (c.playlist_id || "charm-primary") !== sourceFilter) continue;
      const group = c.source_group || c.group || "Other";
      counts.set(group, (counts.get(group) || 0) + 1);
      total++;
    }
    const rows: ChooserRow[] = [];
    counts.forEach((count, key) => rows.push({ key, label: key, count }));
    rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
    return [{ key: "all", label: "All groups", count: total }, ...rows];
  }, [channels, hidden, sourceFilter]);
  const playlistLabel = playlistRows.find(row => row.key === sourceFilter)?.label || "All playlists";
  const groupLabel = groupFilter === "all" ? "All groups" : groupFilter;
  const results = useMemo(() => channels.filter(c => c.url && !hidden.has(c.id) &&
    (sourceFilter === "all" || (c.playlist_id || "charm-primary") === sourceFilter) &&
    (groupFilter === "all" || (c.source_group || c.group || "Other") === groupFilter) &&
    (filter !== "Favorites" || favoriteIds.has(c.id)) && (filter !== "Recent" || recentIds.has(c.id)) &&
    (!query || `${c.name} ${c.source_group || c.group}`.toLowerCase().includes(query.toLowerCase()))),
    [channels, sourceFilter, groupFilter, filter, favoriteIds, recentIds, query, hidden]);
  const listen = (slot: number) => { if (!paneRef.current[slot]) return; multiview?.listen(token, slot); audibleRef.current=slot; setAudible(slot); };
  // A pending destination is not the selected playback screen. Cancel keeps
  // the original pane's menu/actions; choose() selects the destination on success.
  const openPicker = (slot: number) => { setMenu(false); setQuery(""); setPicker(slot); };
  const action = (label: string, run: () => void, disabled = false, pickerEntry = false, controlKey = label) => {
    const menuEntry = label === "Change channel" || label === "Add channel";
    return <Pressable key={pickerEntry ? "picker-entry" : controlKey} ref={pickerEntry ? firstPicker : menuEntry ? firstMenu : undefined}
      focusable={!disabled} hasTVPreferredFocus={preferOverlayFocus && ((pickerEntry && !chooserReturn) || (picker == null && menuEntry))}
      disabled={disabled} onPress={run} style={({ focused }: any) => [styles.button, focused && styles.focus, disabled && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>;
  };
  return <View style={styles.page}>
    <View style={styles.grid}>
      {panes.map((pane, slot) => {
        const box = positions[slot] || {left:-200,top:0,width:50,height:50};
        const shown = visible.includes(slot) && (enlarged == null || enlarged === slot);
        return <Pressable key={slot} ref={node => { paneNodes.current[slot]=node; }}
          accessibilityLabel={`${pane?.channel.name || "Empty pane"}. Press to open options.`}
          focusable={shown && !overlay} accessible={shown && !overlay} hasTVPreferredFocus={slot === selected && shown && !overlay}
          onFocus={() => { if (overlay) return; focusConfirmed.current = true; setSelected(slot); if (preferences.audioFollowsFocus && swapFrom == null) listen(slot); }}
          onPress={() => {
            setSelected(slot); setLabels(true);
            if (swapFrom != null) { setOrder(old => old.map(id => id === slot ? swapFrom : id === swapFrom ? slot : id)); setSwapFrom(null); }
            else if (pane) setMenu(true);
            else if (ready && slot < appPolicy.multiview_max) openPicker(slot);
          }} style={[styles.pane, {left:`${box.left}%`,top:`${box.top}%`,width:`${box.width}%`,height:`${box.height}%`}]}>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">{ready && pane && <Surface session={token} slot={slot} style={StyleSheet.absoluteFill} />}</View>
          {shown && selected === slot && <View pointerEvents="none" style={styles.outline} />}
          {(labels || !pane || swapFrom != null) && <Text numberOfLines={1} style={styles.channel}>{audible === slot ? "🔊 " : ""}{pane?.channel.name || `+ Add channel ${slot+1}`} · OK for options</Text>}
          {pane && states[slot]?.state !== "playing" && <Text style={styles.status}>{states[slot]?.reason || "Loading…"}</Text>}
        </Pressable>;
      })}
    </View>
    {labels && !overlay && <Text pointerEvents="none" numberOfLines={2} style={styles.hint}>{swapFrom != null ? "Select another pane to swap. Back cancels." : notice || "Press OK on a pane for options. Back returns to the guide."}</Text>}
    {menu && picker == null && <FocusGuide key="pane-menu" trapFocusUp trapFocusDown trapFocusLeft trapFocusRight onFocusCapture={confirmOverlayFocus} style={styles.menu}>
      <Text style={styles.title}>{panes[selected]?.channel.name || "Multiview"}</Text>
      <ScrollView>
      {action(panes[selected] ? "Change channel" : "Add channel", () => openPicker(selected), !ready)}
      {action("Add another channel", () => { const slot=panes.findIndex((p,i)=>!p && i<appPolicy.multiview_max); if(slot>=0) openPicker(slot); }, occupied.length>=appPolicy.multiview_max)}
      {action("Listen to this screen", () => {listen(selected);setMenu(false);}, !panes[selected])}
      {action("Audio", () => { listen(selected); multiview?.tracks(token,selected,false); }, !panes[selected])}
      {action("Captions", () => multiview?.tracks(token,selected,true), !panes[selected])}
      {action(enlarged == null ? "Enlarge" : "Return to grid", () => {setEnlarged(enlarged == null ? selected : null);setMenu(false);}, !panes[selected])}
      {action("Swap position", () => {setEnlarged(null);setSwapFrom(selected);setMenu(false);}, occupied.length<2)}
      {action("Retry", () => {const pane=panes[selected];if(pane) void choose(selected,pane.channel,true);setMenu(false);}, !panes[selected])}
      {action("Close screen", () => {remove();setEnlarged(null);setMenu(false);const next=panes.findIndex((p,i)=>!!p&&i!==selected);setSelected(next<0?0:next);}, !panes[selected])}
      {action("Close menu", () => setMenu(false))}
      {action("Return to TV Guide", () => void exit())}
      </ScrollView>
    </FocusGuide>}
    {picker != null && !chooser && <FocusGuide key="channel-picker" trapFocusUp trapFocusDown trapFocusLeft trapFocusRight onFocusCapture={confirmOverlayFocus} style={styles.picker}>
      <Text style={styles.title}>Channel for screen {picker+1}</Text>
      <TextInput accessibilityLabel="Search channels" value={query} onChangeText={setQuery} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} placeholder="Search channels or groups" placeholderTextColor="#b8b8cc" style={[styles.search,searchFocused && styles.focus]} />
      <View style={styles.filterRow}>{["All","Favorites","Recent"].map(name => action(`${filter===name?"✓ ":""}${name}`,()=>setFilter(name),false,name === "All",name))}</View>
      {/* Drop-down buttons: OK opens a scrollable list instead of cycling. */}
      <View style={styles.dropRow}>
        <Pressable ref={playlistButton} hasTVPreferredFocus={preferOverlayFocus && chooserReturn === "playlist"} onPress={() => openChooser("playlist")}
          style={({ focused }: any) => [styles.button, styles.dropPlaylist, focused && styles.focus]} testID="multiview-playlist-dropdown">
          <Text numberOfLines={1} style={styles.dropText}>▤ {playlistLabel} ▾</Text>
        </Pressable>
        <Pressable ref={groupButton} hasTVPreferredFocus={preferOverlayFocus && chooserReturn === "group"} onPress={() => openChooser("group")}
          style={({ focused }: any) => [styles.button, styles.dropGroup, focused && styles.focus]} testID="multiview-group-dropdown">
          <Text numberOfLines={1} style={styles.dropText}>☰ {groupLabel} ▾</Text>
        </Pressable>
      </View>
      <Text style={styles.notice}>{results.length} channels · Each screen uses a provider connection</Text>
      {/* Bounded list (flex:1 inside the panel): the last channel ends at the
          panel bottom, and only the visible rows plus a small window mount. */}
      <FlatList data={results} keyExtractor={channel => channel.id} keyboardShouldPersistTaps="handled"
        style={styles.pickerList} getItemLayout={channelRowLayout}
        initialNumToRender={9} maxToRenderPerBatch={8} updateCellsBatchingPeriod={40} windowSize={5}
        ListEmptyComponent={<Text style={styles.text}>No matching channels. Try All or another playlist.</Text>}
        renderItem={({item}) => <PickerChannelRow channel={item} onChoose={chooseRow} />} />
      {!!notice && <Text numberOfLines={1} style={styles.notice}>{notice}</Text>}
      {action("Cancel", () => {setPicker(null);setQuery("");setMenu(true);})}
    </FocusGuide>}
    {picker != null && chooser && <FocusGuide key={`chooser-${chooser}`} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight onFocusCapture={confirmOverlayFocus} style={styles.chooser}>
      <Text style={styles.title}>{chooser === "playlist" ? "Choose a playlist" : `${playlistLabel} · Channel groups`}</Text>
      <ChooserList rows={chooser === "playlist" ? playlistRows : groupRows} current={chooser === "playlist" ? sourceFilter : groupFilter}
        focusRef={chooserFocus} onPick={pickChooser} />
      <Text style={styles.notice}>Back returns to the channel list</Text>
    </FocusGuide>}
  </View>;
}
const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:"#000"},grid:{flex:1,overflow:"hidden"},pane:{position:"absolute",backgroundColor:"#000",overflow:"hidden"},
  // Neon-glass overlays; pane geometry is unchanged.
  outline:{...StyleSheet.absoluteFillObject,borderWidth:3,borderColor:"#F6E9FF",zIndex:2},
  channel:{position:"absolute",left:0,right:0,top:0,color:"#fff",fontSize:16,fontFamily:fonts.semibold,padding:8,backgroundColor:"rgba(26,11,51,0.82)"},
  status:{position:"absolute",left:12,right:12,top:"40%",color:"#F0ABFC",fontSize:16,backgroundColor:"rgba(26,11,51,0.90)",padding:12,borderRadius:12},
  title:{color:"#fff",fontSize:22,fontFamily:fonts.bold,marginBottom:8},text:{color:"#fff",fontSize:17,fontFamily:fonts.medium},notice:{color:"#D9C8F5",fontSize:14},
  hint:{position:"absolute",bottom:8,left:12,right:12,color:"#fff",fontSize:14,padding:8,borderRadius:12,borderWidth:1,borderColor:glass.edge,backgroundColor:"rgba(26,11,51,0.86)"},
  menu:{position:"absolute",right:12,top:12,bottom:12,width:"40%",maxWidth:440,minWidth:260,padding:16,backgroundColor:"rgba(30,12,60,0.97)",borderRadius:18,borderColor:glass.edge,borderWidth:1},
  picker:{position:"absolute",right:0,top:0,bottom:0,width:"46%",minWidth:300,maxWidth:640,padding:16,gap:8,backgroundColor:"rgba(30,12,60,0.98)",borderTopLeftRadius:18,borderBottomLeftRadius:18,borderLeftWidth:1,borderColor:glass.edge},
  filterRow:{flexDirection:"row",flexWrap:"wrap",gap:4},
  button:{paddingHorizontal:12,paddingVertical:10,borderWidth:2,borderColor:glass.edgeSoft,borderRadius:12,marginBottom:4,backgroundColor:"rgba(40,18,78,0.70)"},
  focus:{borderColor:"#FFFFFF",backgroundColor:glass.focus,shadowColor:glass.glow,elevation:12},disabled:{opacity:.4},
  search:{backgroundColor:"rgba(20,8,42,0.80)",color:"#fff",padding:12,borderWidth:2,borderColor:glass.edge,borderRadius:12,fontSize:17},
  row:{height:PICKER_ROW_HEIGHT,marginBottom:PICKER_ROW_GAP,paddingHorizontal:12,justifyContent:"center",borderWidth:2,borderColor:glass.edgeSoft,borderRadius:12,backgroundColor:"rgba(36,16,70,0.55)"},
  rowName:{color:"#fff",fontSize:16,fontFamily:fonts.medium},rowMeta:{color:"#D9C8F5",fontSize:12,marginTop:2},
  pickerList:{flex:1,minHeight:0},
  dropRow:{flexDirection:"row",gap:6},
  dropPlaylist:{flex:2,minWidth:0,marginBottom:0},dropGroup:{flex:3,minWidth:0,marginBottom:0},
  dropText:{color:"#fff",fontSize:15,fontFamily:fonts.semibold},
  // Pop-up list box: glass panel at 70% opacity over the video, bounded top
  // and bottom so the last entry ends inside the box, never off-screen.
  chooser:{position:"absolute",left:"20%",right:"20%",top:"7%",bottom:"7%",padding:16,borderRadius:18,borderWidth:1,borderColor:glass.edge,backgroundColor:"rgba(30,12,60,0.70)"},
  chooserList:{flex:1,minHeight:0,marginBottom:8},
  chooserRow:{height:CHOOSER_ROW_HEIGHT,marginBottom:CHOOSER_ROW_GAP,flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:14,borderWidth:2,borderColor:glass.edgeSoft,borderRadius:12,backgroundColor:"rgba(40,18,78,0.62)"},
  chooserCurrent:{borderColor:glass.selectedEdge,backgroundColor:"rgba(140,70,240,0.55)"},
  chooserText:{flex:1,minWidth:0,color:"#fff",fontSize:16,fontFamily:fonts.medium},chooserCount:{color:"#D9C8F5",fontSize:13,marginLeft:10},
});
