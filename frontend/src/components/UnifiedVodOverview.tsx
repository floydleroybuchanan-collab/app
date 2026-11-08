import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useIsFocused } from "@react-navigation/native";
import { useAuth } from "@/src/auth/AuthContext";
import { readVodSnapshot, subscribeVodSnapshot } from "@/src/core/vodRecentSnapshot";
import { useProviderLibrary } from "@/src/core/providerLibrary";
import { usePlaylists } from "@/src/core/playlistRegistry";
import { tvColors } from "@/src/theme";
import type { VodSnapshotItem } from "@/src/core/vodRecentSnapshotCore";

type Preview = { id: string; title: string; poster?: string; section: string; source: string };

const SOURCE_ACTIONS = [
  { id: "home", label: "Streamflix", detail: "Movies, series, and linked debrid playback" },
  { id: "provider-xtream", label: "Xtream", detail: "Movies and series from your Xtream playlists" },
  { id: "provider-stalker", label: "Stalker", detail: "Movies and series from your Stalker portals" },
] as const;

/**
 * Unified, cached VOD landing view. No native library IPC or full provider
 * catalog request happens here. Real provider catalogs load on source selection.
 */
export function UnifiedVodOverview({ onOpen }: { onOpen: (section: string) => void }) {
  const { user } = useAuth();
  const accountId = user?.id || null;
  const focused = useIsFocused();
  const playlists = usePlaylists();
  const library = useProviderLibrary();
  const [nativeRecent, setNativeRecent] = useState<VodSnapshotItem[]>([]);

  useEffect(() => {
    let current = true, updated = false;
    setNativeRecent([]);
    if (!focused) return () => { current = false; };
    const unsub = subscribeVodSnapshot(accountId, "continue", next => {
      if (current) { updated = true; setNativeRecent(next); }
    });
    void readVodSnapshot(accountId, "continue").then(rows => {
      if (current && !updated) setNativeRecent(rows);
    }).catch(() => undefined);
    return () => { current = false; unsub(); };
  }, [accountId, focused]);

  const enabled = useMemo(() => new Map(playlists.filter(row =>
    row.enabled && (row.kind === "xtream" || row.kind === "stalker")).map(row => [row.id, row])), [playlists]);
  const previews = useMemo((): Preview[] => {
    const fromNative = nativeRecent.map(row => ({
      id: "streamflix:" + row.section, title: row.title, poster: row.poster,
      section: row.section, source: "Streamflix",
    }));
    const fromProvider = library
      .filter(row => enabled.has(row.owner) && row.mediaId && row.updatedAt > 0)
      .slice(0, 30).map(row => ({
        id: row.owner + ":" + row.kind + ":" + row.catalogId,
        title: row.title, section: `provider:${row.owner}:${row.kind}:${row.catalogId}`,
        source: enabled.get(row.owner)?.kind === "stalker" ? "Stalker" : "Xtream",
      }));
    return [...fromNative, ...fromProvider].slice(0, 40);
  }, [enabled, library, nativeRecent]);

  return <View style={styles.root}>
    <Text style={styles.heading}>Your VOD library</Text>
    <Text style={styles.secondary}>All three sources in one place. Open a source when you want its full catalog.</Text>
    <View style={styles.sources}>
      {SOURCE_ACTIONS.map((source, index) =>
        <Pressable key={source.id} hasTVPreferredFocus={index === 0} accessibilityRole="button"
          onPress={() => onOpen(source.id)} style={({ focused: f }: any) => [styles.source, f && styles.focused]}>
          <Text style={styles.sourceTitle}>{source.label}</Text>
          <Text style={styles.secondary}>{source.detail}</Text>
        </Pressable>)}
    </View>
    <Text style={styles.sectionTitle}>Recently Watched Video On Demand</Text>
    <FlatList data={previews} horizontal keyExtractor={item => item.id}
      initialNumToRender={8} maxToRenderPerBatch={8} windowSize={3}
      removeClippedSubviews
      contentContainerStyle={styles.row}
      showsHorizontalScrollIndicator={false}
      ListEmptyComponent={<Text style={styles.secondary}>Your recently watched movies and shows will appear here.</Text>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => onOpen(item.section)}
          style={({ focused: f }: any) => [styles.card, f && styles.focused]}>
        {item.poster ? <Image source={{ uri: item.poster }} contentFit="contain" style={styles.poster}
            cachePolicy="memory-disk" /> : <View style={styles.poster} />}
        <Text style={styles.sourceBadge}>{item.source}</Text>
        <Text style={styles.name} numberOfLines={2}>{item.title}</Text>
      </Pressable>} />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tvColors.canvas, padding: 16, gap: 14 },
  heading: { fontSize: 25, fontWeight: "700", color: "#fff" },
  secondary: { color: tvColors.textMuted, fontSize: 13 },
  sources: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  source: { flex: 1, minWidth: 190, minHeight: 96, padding: 14,
    backgroundColor: tvColors.panelRaised, borderWidth: 2, borderColor: "transparent", borderRadius: 10, gap: 7 },
  sourceTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  sectionTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },
  row: { gap: 10, minHeight: 190, paddingVertical: 4 },
  card: { width: 138, backgroundColor: tvColors.panelRaised, borderRadius: 9, padding: 6,
    borderWidth: 2, borderColor: "transparent", gap: 5 },
  poster: { height: 116, width: 122, backgroundColor: "#272137", borderRadius: 5 },
  sourceBadge: { color: tvColors.purpleBright, fontSize: 11, fontWeight: "700" },
  name: { color: "#fff", fontSize: 13 },
  focused: { borderColor: tvColors.focus, backgroundColor: tvColors.purpleDeep },
});
