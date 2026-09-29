import React, { useEffect, useRef, useState } from "react";
import { Alert, NativeModules, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { usePurpleTvDrawer } from "./PurpleTvShell";
import { openMediaLibrary } from "@/src/core/mediaLibrary";

type Item = { id: string; title: string; poster?: string; section: string };
/** Uses the same native catalog, account, and watch database as the VOD screens. */
export function MediaLibraryShelf({ kind = "continue", query }: { kind?: "continue" | "favorites"; query?: string }) {
  const focused = useIsFocused(), router = useRouter();
  const { openDrawer } = usePurpleTvDrawer();
  const [items, setItems] = useState<Item[]>([]), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [opening, setOpening] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    if (!focused || Platform.OS !== "android") return;
    let active = true;
    const timer = setTimeout(() => {
      setError("");
      const request = query !== undefined ? NativeModules.CharmVod?.searchLibrary(query) : NativeModules.CharmVod?.libraryItems(kind);
      Promise.resolve(request).then(value => { if (active) setItems(value ? JSON.parse(value) : []); }).catch(() => { if (active) { setItems([]); setError("Catalog unavailable. You can still open your library."); } });
    }, query !== undefined ? 350 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [focused, kind, query, revision]);
  const open = async (section: string) => {
    if (busy.current) return;
    busy.current = true; setOpening(true);
    try {
      const route = await openMediaLibrary(section);
      if (route === "medialab:drawer") openDrawer({ focusTop: true });
      else if (route) router.replace(route as any);
      setRevision(value => value + 1);
    } catch (reason) { Alert.alert("Charming MediaLab", reason instanceof Error ? reason.message : "Unable to open this title."); }
    finally { busy.current = false; setOpening(false); }
  };
  const title = query !== undefined ? "Movies & series" : kind === "favorites" ? "Your movies & series" : "Continue watching";
  return <View style={styles.section}>
    <View style={styles.header}><Text style={styles.heading}>{title}</Text><Pressable disabled={opening} onPress={() => void open(query !== undefined ? `search:${query}` : kind === "favorites" ? "favorites" : "library")} style={({ focused }: any) => [styles.button, focused && styles.focus]}><Text style={styles.text}>{query !== undefined ? "Search catalog" : "Open library"}</Text></Pressable></View>
    {error ? <Text style={styles.muted}>{error}</Text> : null}
    {items.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{items.map(item => <Pressable key={item.section + item.id} disabled={opening} onPress={() => void open(item.section)} style={({ focused }: any) => [styles.card, focused && styles.focus]}>
      {item.poster ? <Image source={{ uri: item.poster }} contentFit="cover" style={styles.poster} /> : <View style={styles.poster} />}
      <Text numberOfLines={2} style={styles.text}>{item.title}</Text>
    </Pressable>)}</ScrollView> : <Text style={styles.muted}>{query !== undefined ? "Search your current catalog alongside live TV." : "Your saved titles and viewing progress appear here."}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: 8, paddingVertical: 8 }, header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }, heading: { color: "#fff", fontSize: 17, fontWeight: "600" }, text: { color: "#fff", fontSize: 14 }, muted: { color: "#AAA7BB", fontSize: 13 }, row: { gap: 10 }, button: { backgroundColor: "#151427", minHeight: 48, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, borderWidth: 2, borderColor: "transparent" }, card: { width: 124, padding: 6, borderRadius: 8, borderWidth: 2, borderColor: "transparent", backgroundColor: "#10101E", gap: 6 }, poster: { width: 108, height: 130, borderRadius: 5, backgroundColor: "#25233A" }, focus: { borderColor: "#B76CFF", backgroundColor: "#3B1768" },
});
