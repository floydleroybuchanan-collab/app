import React, { useEffect, useRef, useState } from "react";
import { Alert, AppState, NativeModules, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { usePurpleTvDrawer } from "./PurpleTvShell";
import { openMediaLibrary } from "@/src/core/mediaLibrary";
import { readVodSnapshot, subscribeVodSnapshot } from "@/src/core/vodRecentSnapshot";
import { useAuth } from "@/src/auth/AuthContext";
import { useProviderLibrary } from "@/src/core/providerLibrary";
import { usePlaylists } from "@/src/core/playlistRegistry";

type Item = { id: string; title: string; poster?: string; section: string };
/** Uses the same native catalog, account, and watch database as the VOD screens. */
export function MediaLibraryShelf({ kind = "continue", query }: { kind?: "continue" | "favorites"; query?: string }) {
  const focused = useIsFocused(), router = useRouter();
  const { user } = useAuth();
  const accountId = user?.id || null;
  const providerLibrary = useProviderLibrary(), playlists = usePlaylists();
  const { openDrawer } = usePurpleTvDrawer();
  const [items, setItems] = useState<Item[]>([]), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [opening, setOpening] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    if (query !== undefined || kind !== "continue") return;
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") setRevision(value => value + 1);
    });
    return () => subscription.remove();
  }, [kind, query]);
  useEffect(() => {
    // Account changes must not display the previous account's stored history.
    setItems([]);
  }, [accountId, kind, query]);

  useEffect(() => {
    if (!focused || Platform.OS !== "android") return;
    let active = true;
    let updated = false;
    const unsubscribe = query === undefined
      ? subscribeVodSnapshot(accountId, kind, next => { if (active) { updated = true; setItems(next); setError(""); } })
      : () => undefined;
    const timer = setTimeout(() => {
      setError("");
      if (query !== undefined) {
        // An explicit user search is allowed to request fresh VOD data.
        Promise.resolve(NativeModules.CharmVod?.searchLibrary(query))
          .then(value => { if (active) setItems(value ? JSON.parse(value) : []); })
          .catch(() => { if (active) { setItems([]); setError("Search unavailable. Open VOD to retry."); } });
      } else {
        // Live TV NEVER calls CharmVod.libraryItems: that IPC can spawn :vod.
        void readVodSnapshot(accountId, kind)
          .then(value => { if (active && !updated) setItems(value); })
          .catch(() => { if (active && !updated) setItems([]); });
      }
    }, query !== undefined ? 350 : 0);
    return () => { active = false; clearTimeout(timer); unsubscribe(); };
  }, [accountId, focused, kind, query, revision]);
  const open = async (section: string) => {
    if (busy.current) return;
    busy.current = true; setOpening(true);
    try {
      const route = await openMediaLibrary(section);
      if (route === "medialab:drawer") openDrawer({ focusTop: true });
      else if (route && ["/", "/guide", "/favorites", "/settings"].includes(route)) router.replace(route as any);
      setRevision(value => value + 1);
    } catch (reason) { Alert.alert("Charming MediaLab", reason instanceof Error ? reason.message : "Unable to open this title."); }
    finally { busy.current = false; setOpening(false); }
  };
  const title = query !== undefined ? "Movies & series" : kind === "favorites" ? "Your movies & series" : "Recently Watched Video On Demand";
  const enabledOwners = new Set(playlists.filter(row => row.enabled && (row.kind === "xtream" || row.kind === "stalker")).map(row => row.id));
  const visibleItems: Item[] = [...items, ...providerLibrary.filter(row => enabledOwners.has(row.owner) &&
    (query !== undefined ? row.title.toLowerCase().includes(query.toLowerCase()) : kind === "favorites" ? row.favorite : row.positionMs > 0 && (!row.durationMs || row.positionMs < row.durationMs - 1000)))
    .map(row => ({ id: `${row.owner}:${row.kind}:${row.catalogId}`, title: row.title, section: `provider:${row.owner}:${row.kind}:${row.catalogId}` }))];
  return <View style={styles.section}>
    <View style={styles.header}><Text style={styles.heading}>{title}</Text><Pressable disabled={opening} onPress={() => void open(query !== undefined ? `search:${query}` : kind === "favorites" ? "favorites" : "home")} style={({ focused }: any) => [styles.button, focused && styles.focus]}><Text style={styles.text}>{query !== undefined ? "Search catalog" : "Open library"}</Text></Pressable></View>
    {error ? <Text style={styles.muted}>{error}</Text> : null}
    {visibleItems.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{visibleItems.map(item => <Pressable key={item.section + item.id} disabled={opening} onPress={() => void open(item.section)} style={({ focused }: any) => [styles.card, focused && styles.focus]}>
      {item.poster ? <Image source={{ uri: item.poster }} contentFit="cover" style={styles.poster} /> : <View style={styles.poster} />}
      <Text numberOfLines={2} style={styles.text}>{item.title}</Text>
    </Pressable>)}</ScrollView> : <Text style={styles.muted}>{query !== undefined ? "Search your current catalog alongside live TV." : "Your recently watched movies and shows will appear here."}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 8, paddingVertical: 8 }, header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }, heading: { color: "#fff", fontSize: 17, fontWeight: "600" }, text: { color: "#fff", fontSize: 14 }, muted: { color: "#AAA7BB", fontSize: 13 }, row: { gap: 10 }, button: { backgroundColor: "#151427", minHeight: 48, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, borderWidth: 2, borderColor: "transparent" }, card: { width: 124, padding: 6, borderRadius: 8, borderWidth: 2, borderColor: "transparent", backgroundColor: "#10101E", gap: 6 }, poster: { width: 108, height: 130, borderRadius: 5, backgroundColor: "#25233A" }, focus: { borderColor: "#B76CFF", backgroundColor: "#3B1768" },
});
