import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, BackHandler, FlatList, Platform, Pressable, requireNativeComponent, ScrollView, StyleSheet, Text, TextInput, View, type ViewProps } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/src/store";
import type { Channel } from "@/src/api";
import { tvColors } from "@/src/theme";
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
import { requestNativeFocus } from "@/src/utils/tvFocus";
import { useAppPolicy } from "@/src/core/useAppPolicy";
import { getAppPolicy } from "@/src/core/appPolicy";

const Surface = Platform.OS === "android" && multiview ? requireNativeComponent<ViewProps & { slot: number; session: string }>("CharmMultiviewSurface") : View;
let sequence = 0;
export default function MultiviewScreen() {
  const router = useRouter();
  const appPolicy = useAppPolicy();
  const params = useLocalSearchParams<{ channelId?: string; returnGuideGroup?: string }>();
  const { channels, addRecent, sleepTimerMinutes, setSleepTimerMinutes } = useStore();
  const catalog = useRef(channels); catalog.current = channels;
  const insets = useSafeAreaInsets();
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
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [states, setStates] = useState<Record<number, MultiviewEvent>>({});
  const active = useRef(false);
  const leaving = useRef(false);
  const sessionGeneration = useRef(0);
  const recordedHistory = useRef(new Map<number,number>());
  const paneNodes = useRef<any[]>([]);
  const priorPicker = useRef<number | null>(null);
  const writePanes = useCallback((next: MultiviewPane[]) => { paneRef.current = next; setPanes(next); }, []);
  const choose = useCallback(async (slot: number, supplied: Channel, refresh = false) => {
    if (!active.current || !multiview) return;
    const revision = ++revisions.current[slot];
    setNotice("Checking channel…");
    try {
      const channel = refresh ? await refreshPlaybackChannel(supplied.id) ?? supplied : supplied;
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
        ? "Your provider last reported all connections in use. Another device may need to stop playback." : "Each pane uses one provider connection. Tap a pane to listen.");
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
        const seed = catalog.current.find(channel => channel.id === params.channelId);
        if (seed) await chooseRef.current(0,seed);
        else setPicker(0);
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
  const exit = useCallback(async (fullscreen = false) => {
    if (leaving.current) return;
    leaving.current = true; active.current = false;
    try {
      await multiview?.end(token);
      await stopFullscreenSession("user-stop");
      const channel = paneRef.current[selected]?.channel;
      if (fullscreen && channel) router.replace({ pathname: "/player", params: { channelId: channel.id, returnToGuide: "1", returnGuideGroup: params.returnGuideGroup } });
      else { if (channel) requestGuideJump({channelId:channel.id,group:params.returnGuideGroup || "All"}); router.replace("/guide" as any); }
    } catch { leaving.current = false; setNotice("A player could not close. Restart CharmIPTV before opening more streams."); }
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
    const nextAudio=nextAudiblePane(next,audibleRef.current);audibleRef.current=nextAudio;setAudible(nextAudio);
    if(nextAudio>=0)multiview?.listen(token,nextAudio);
  },[appPolicy,ready,token,writePanes]);
  useEffect(() => {
    if (picker == null && priorPicker.current != null) requestAnimationFrame(() => requestNativeFocus(paneNodes.current[selected]));
    priorPicker.current=picker;
  }, [picker,selected]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (picker != null) { setPicker(null); setQuery(""); } else void exit();
      return true;
    });
    return () => sub.remove();
  }, [exit, picker]);
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
  const action = (label: string, run: () => void, disabled = false) => <Pressable key={label} disabled={disabled} onPress={run} style={({ focused }: any) => [styles.button, focused && styles.focus, disabled && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>;
  return <View style={[styles.page, {paddingTop: Math.max(insets.top,12), paddingBottom: Math.max(insets.bottom,12)}]}>
    <Text style={styles.title}>Multiview · up to {appPolicy.multiview_max} channels</Text>
    <Text style={styles.notice}>{notice || (ready ? "Choose channels below. Tap a pane to listen." : "Opening multiview…")}</Text>
    <View style={styles.grid}>
      {panes.map((pane, slot) => <Pressable key={slot} ref={node => { paneNodes.current[slot]=node; }} focusable={picker == null} hasTVPreferredFocus={slot === 0 && picker == null} onFocus={() => setSelected(slot)} onPress={() => {
        setSelected(slot);
        if (pane) { multiview?.listen(token,slot); audibleRef.current=slot; setAudible(slot); }
        else if (ready && slot<appPolicy.multiview_max) setPicker(slot);
      }} style={({ focused }: any) => [styles.pane, slot === selected && styles.selected, focused && styles.focus]}>
        <View style={styles.video} pointerEvents="none">{ready && pane && <Surface session={token} slot={slot} style={StyleSheet.absoluteFill} />}</View>
        <Text numberOfLines={1} style={styles.channel}>{audible === slot ? "🔊 " : ""}{pane?.channel.name || (slot<appPolicy.multiview_max?`+ Add channel ${slot+1}`:"Unavailable under current allowance")}</Text>
        {pane && states[slot]?.state !== "playing" && <Text numberOfLines={2} style={styles.status}>{states[slot]?.reason || (states[slot]?.state === "ended" ? "Stream ended" : "Loading…")}</Text>}
      </Pressable>)}
    </View>
    <ScrollView horizontal style={styles.actions} contentContainerStyle={{gap:8}}>
      {action(panes[selected] ? "Change channel" : "Add channel", () => { setQuery(""); setPicker(selected); }, !ready || selected>=appPolicy.multiview_max)}
      {action("Retry", () => { const pane = panes[selected]; if (pane) void choose(selected,pane.channel,true); }, !ready || !panes[selected])}
      {action("Audio", () => { multiview?.listen(token,selected); audibleRef.current=selected; setAudible(selected); multiview?.tracks(token,selected,false); }, !panes[selected])}
      {action("Captions", () => multiview?.tracks(token,selected,true), !panes[selected])}
      {action("Fullscreen", () => void exit(true), !panes[selected])}
      {action("Close pane", remove, !panes[selected])}
      {action("Back to guide", () => void exit())}
    </ScrollView>
    {picker != null && <FocusGuide trapFocusUp trapFocusDown trapFocusLeft trapFocusRight autoFocus style={styles.picker}>
      <Text style={styles.title}>Choose channel for pane {picker+1}</Text>
      <TextInput accessibilityLabel="Search channels" value={query} onChangeText={setQuery} placeholder="Search channels" placeholderTextColor="#a0a0b0" style={styles.search} />
      <FlatList data={channels.filter(channel => channel.url && (!query || `${channel.name} ${channel.group}`.toLowerCase().includes(query.toLowerCase())))} keyExtractor={channel => channel.id}
        keyboardShouldPersistTaps="handled" initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
        renderItem={({item,index}) => <Pressable hasTVPreferredFocus={index===0} onPress={() => void choose(picker,item)} style={({focused}: any) => [styles.row,focused && styles.focus]}><Text style={styles.text}>{item.name}</Text><Text style={styles.notice}>{item.group}</Text></Pressable>} />
      <Text style={styles.notice}>{notice}</Text>
      {action("Cancel", () => { setPicker(null); setQuery(""); })}
    </FocusGuide>}
  </View>;
}
const styles = StyleSheet.create({
  page: {flex:1,backgroundColor:"#070711",paddingHorizontal:16,gap:8},title:{color:"#fff",fontSize:20,fontWeight:"700"},text:{color:"#fff",fontSize:15},notice:{color:"#b8b8cc",fontSize:12},
  grid:{flex:1,flexDirection:"row",flexWrap:"wrap",gap:8},pane:{width:"48%",height:"48%",borderWidth:2,borderColor:"#30304c",backgroundColor:"#000",borderRadius:8,overflow:"hidden"},selected:{borderColor:tvColors.purple},
  video:{flex:1,minHeight:30},channel:{color:"#fff",fontSize:14,padding:6,backgroundColor:"#171729"},status:{color:"#ffcf90",fontSize:12,padding:4},focus:{borderColor:"#fff",borderWidth:2,backgroundColor:"#30274a"},
  actions:{flexGrow:0,maxHeight:56},button:{backgroundColor:"#242039",borderWidth:2,borderColor:"transparent",borderRadius:8,paddingHorizontal:14,paddingVertical:10},disabled:{opacity:0.4},
  picker:{...StyleSheet.absoluteFillObject,backgroundColor:"#0c0c1a",padding:24,gap:12},search:{backgroundColor:"#25253a",color:"#fff",padding:10,borderRadius:8},row:{padding:12,borderWidth:2,borderColor:"transparent",borderRadius:6},
});
