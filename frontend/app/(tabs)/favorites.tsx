import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FocusedTabMount } from "@/src/components/FocusedTabMount";
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { PurpleDrawerButton } from "@/src/components/PurpleDrawerButton";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { fonts, glass, glassFocus, tvColors } from "@/src/theme";
import { GlassPageTitle } from "@/src/components/GlassPageTitle";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { MAX_FOLDER_NAME_LEN, nextNewFolderName } from "@/src/core/favoriteFolders";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { addTvLongPressListener } from "@/src/utils/tvRemote";

function byName(a: Channel, b: Channel) {
  return (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });
}

const FavoriteRow = memo(function FavoriteRow({
  channel,
  number,
  logos,
  now,
  inFolder,
  folderMode,
  onPlay,
  onLongPress,
  onFocusChannel,
}: {
  channel: Channel;
  number: number;
  logos: boolean;
  now: Date;
  inFolder: boolean;
  folderMode: boolean;
  onPlay: (channel: Channel) => void;
  onLongPress: (id: string) => void;
  onFocusChannel: (id: string | null) => void;
}) {
  const programmes = useGuidePrograms(channel.id);
  const current = nowNext(programmes, now).current;
  const isTV = Platform.OS !== "web" && Platform.isTV;
  const progress = current ? progressPct(current, now) : 0;
  return (
    <Pressable
      onFocus={() => onFocusChannel(channel.id)}
      onBlur={() => onFocusChannel(null)}
      onPress={() => onPlay(channel)}
      onLongPress={isTV ? undefined : () => onLongPress(channel.id)}
      delayLongPress={450}
      style={({ focused }: any) => [styles.row, focused && styles.focused]}
    >
      <Text style={styles.number}>{number}</Text>
      <ChannelLogo name={channel.name} logo={channel.logo} disabled={!logos} size={30} />
      <Text numberOfLines={1} style={styles.name}>{channel.name}</Text>
      <View style={styles.programBlock}>
        <Text numberOfLines={1} style={styles.program}>{current?.title || "Live channel"}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
      </View>
      <Text style={styles.time}>{current ? `${fmtTime(current.start)}${current.stop ? ` - ${fmtTime(current.stop)}` : ""}` : "LIVE"}</Text>
      <View style={styles.heart} pointerEvents="none">
        {folderMode ? (
          <Ionicons
            name={inFolder ? "checkmark-circle" : "ellipse-outline"}
            size={17}
            color={inFolder ? tvColors.purpleBright : tvColors.textMuted}
          />
        ) : (
          <Ionicons name="heart" size={17} color={glass.pink} />
        )}
      </View>
    </Pressable>
  );
});

function FavoritesScreenContent() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const {
    channels,
    favorites,
    toggleFavorite,
    addRecent,
    channelLogos,
    favoriteFolders,
    addFavoriteFolder,
    toggleFavoriteFolderChannel,
    renameFavoriteFolder,
    removeFavoriteFolder,
    clock24h,
  } = useStore();
  void clock24h;
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const [folderId, setFolderId] = useState<string | "all">("all");
  const folderMode = folderId !== "all";
  const folderMemberSet = useMemo(() => {
    if (!folderMode) return null;
    const folder = favoriteFolders.find((f) => f.id === folderId);
    return new Set(folder?.channelIds || []);
  }, [favoriteFolders, folderId, folderMode]);

  const items = useMemo(() => {
    // Build only the favorite subset. `[...channels].filter(...)` cloned the
    // whole playlist before discarding nearly all of it on large providers.
    const all: Channel[] = [];
    for (const channel of channels) if (favoriteSet.has(channel.id)) all.push(channel);
    all.sort(byName);
    if (!folderMemberSet) return all;
    all.sort((a, b) => {
      const aIn = folderMemberSet.has(a.id) ? 0 : 1;
      const bIn = folderMemberSet.has(b.id) ? 0 : 1;
      if (aIn !== bIn) return aIn - bIn;
      return byName(a, b);
    });
    return all;
  }, [channels, favoriteSet, folderMemberSet]);
  const [now, setNow] = useState(() => new Date());
  const [preferInitialFocus, setPreferInitialFocus] = useState(true);
  const focusedChannelIdRef = useRef<string | null>(null);
  const isTV = Platform.OS !== "web" && Platform.isTV;

  useEffect(() => {
    if (!isFocused) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [isFocused]);

  useFocusEffect(
    useCallback(() => {
      setPreferInitialFocus(true);
      return () => setPreferInitialFocus(false);
    }, []),
  );

  const play = useCallback((channel: Channel) => {
    void Haptics.selectionAsync().catch(() => undefined);
    addRecent(channel);
    openFullscreenPlayer(router, channel.id);
  }, [addRecent, router]);

  const onLongPress = useCallback((id: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (folderMode) toggleFavoriteFolderChannel(folderId, id);
    else toggleFavorite(id);
  }, [folderId, folderMode, toggleFavorite, toggleFavoriteFolderChannel]);

  const noteChannelFocus = useCallback((id: string | null) => {
    focusedChannelIdRef.current = id;
  }, []);

  useEffect(() => {
    if (!isTV || !isFocused) return;
    return addTvLongPressListener((key) => {
      if (key !== "SELECT") return;
      const id = focusedChannelIdRef.current;
      if (id) onLongPress(id);
    });
  }, [isFocused, isTV, onLongPress]);

  // Folder editing: Rename types a real name; Delete asks once before removing.
  // Only one of the two bars is open at a time and both close on save/cancel.
  const [folderEdit, setFolderEdit] = useState<null | "rename" | "delete">(null);
  const [draftName, setDraftName] = useState("");
  const selectedFolder = folderMode ? favoriteFolders.find((f) => f.id === folderId) : undefined;

  useEffect(() => {
    // Leaving the folder (or it disappearing) closes any open edit bar.
    setFolderEdit(null);
  }, [folderId]);

  const startRename = useCallback(() => {
    if (!selectedFolder) return;
    setDraftName(selectedFolder.name);
    setFolderEdit("rename");
  }, [selectedFolder]);

  const saveRename = useCallback(() => {
    const clean = draftName.trim();
    if (selectedFolder && clean && clean !== selectedFolder.name) {
      renameFavoriteFolder(selectedFolder.id, clean);
      void Haptics.selectionAsync().catch(() => undefined);
    }
    setFolderEdit(null);
  }, [draftName, renameFavoriteFolder, selectedFolder]);

  const confirmDelete = useCallback(() => {
    if (!selectedFolder) return;
    setFolderId("all");
    removeFavoriteFolder(selectedFolder.id);
    setFolderEdit(null);
    void Haptics.selectionAsync().catch(() => undefined);
  }, [removeFavoriteFolder, selectedFolder]);

  const addFolder = useCallback(() => {
    const created = addFavoriteFolder(nextNewFolderName(favoriteFolders));
    if (created) setFolderId(created.id);
  }, [addFavoriteFolder, favoriteFolders]);

  return (
    <PurpleTvShell active="/favorites">
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <PurpleDrawerButton testID="favorites-open-drawer" />
            <View style={styles.headerCopy}>
              <View style={styles.titleRow}>
                <GlassPageTitle page="All Favorites" kicker="My Channels" />
                <Text numberOfLines={2} style={styles.addHint}>
                  {folderMode
                    ? "Long-press a channel to add or remove it from this folder. Rename or Delete the folder with the buttons above the list."
                    : "Long-press removes a favorite. Select a folder, then long-press to assign."}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.count}>
              {folderMode && folderMemberSet
                ? `${folderMemberSet.size} in folder · ${items.length} favorites`
                : `${items.length} favorites`}
            </Text>
            <Pressable
              onPress={() => router.replace("/search" as any)}
              style={({ focused }: any) => [styles.searchHit, focused && styles.focused]}
              testID="favorites-open-search"
            >
              <Ionicons name="search-outline" size={15} color="#fff" />
            </Pressable>
          </View>
        </View>

        <View style={styles.folderRow}>
          <Pressable hasTVPreferredFocus={preferInitialFocus && items.length > 0} onFocus={() => setPreferInitialFocus(false)} onPress={() => setFolderId("all")} style={({ focused }: any) => [styles.folderChip, folderId === "all" && styles.folderActive, focused && styles.focused]}>
            <Text style={styles.folderText}>All</Text>
          </Pressable>
          {favoriteFolders.map((folder) => (
            <Pressable
              key={folder.id}
              onPress={() => setFolderId(folder.id)}
              style={({ focused }: any) => [styles.folderChip, folderId === folder.id && styles.folderActive, focused && styles.focused]}
              testID={`favorites-folder-${folder.id}`}
            >
              <Text style={styles.folderText}>{folder.name}</Text>
            </Pressable>
          ))}
          {folderMode ? (
            <>
              <Pressable onPress={startRename} style={({ focused }: any) => [styles.folderChip, folderEdit === "rename" && styles.folderActive, focused && styles.focused]} testID="favorites-folder-rename">
                <Text style={styles.folderText}>Rename</Text>
              </Pressable>
              <Pressable onPress={() => setFolderEdit("delete")} style={({ focused }: any) => [styles.folderChip, styles.folderDanger, focused && styles.focused]} testID="favorites-folder-delete">
                <Text style={styles.folderText}>Delete</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable onPress={addFolder} style={({ focused }: any) => [styles.folderChip, focused && styles.focused]} testID="favorites-folder-add">
            <Text style={styles.folderText}>+ Folder</Text>
          </Pressable>
        </View>

        {folderEdit === "rename" && selectedFolder ? (
          <View style={styles.editBar}>
            <Text style={styles.editLabel}>Folder name</Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              onSubmitEditing={saveRename}
              autoFocus
              selectTextOnFocus
              maxLength={MAX_FOLDER_NAME_LEN}
              returnKeyType="done"
              placeholder="Folder name"
              placeholderTextColor={tvColors.textMuted}
              style={styles.editInput}
              testID="favorites-folder-name-input"
            />
            <Pressable onPress={saveRename} style={({ focused }: any) => [styles.editButton, styles.editPrimary, focused && styles.focused]} testID="favorites-folder-save">
              <Text style={styles.folderText}>Save</Text>
            </Pressable>
            <Pressable onPress={() => setFolderEdit(null)} style={({ focused }: any) => [styles.editButton, focused && styles.focused]}>
              <Text style={styles.folderText}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
        {folderEdit === "delete" && selectedFolder ? (
          <View style={styles.editBar}>
            <Text numberOfLines={1} style={[styles.editLabel, styles.editQuestion]}>
              Delete folder “{selectedFolder.name}”? Its channels stay in your favorites.
            </Text>
            <Pressable hasTVPreferredFocus onPress={() => setFolderEdit(null)} style={({ focused }: any) => [styles.editButton, focused && styles.focused]} testID="favorites-folder-delete-cancel">
              <Text style={styles.folderText}>Keep</Text>
            </Pressable>
            <Pressable onPress={confirmDelete} style={({ focused }: any) => [styles.editButton, styles.folderDanger, focused && styles.focused]} testID="favorites-folder-delete-confirm">
              <Text style={styles.folderText}>Delete</Text>
            </Pressable>
          </View>
        ) : null}

        {items.length ? (
          // The rounded glass panel lives on a wrapper View. Putting border /
          // radius styling on the FlatList itself made Android (Fabric) draw
          // no rows while the count above still showed them.
          <View style={styles.listPanel}>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews={false}
            style={styles.listFill}
            contentContainerStyle={styles.list}
            renderItem={({ item, index }) => (
              <FavoriteRow
                channel={item}
                number={index + 1}
                logos={isFocused && channelLogos}
                now={now}
                folderMode={folderMode}
                inFolder={!!folderMemberSet?.has(item.id)}
                onPlay={play}
                onLongPress={onLongPress}
                onFocusChannel={noteChannelFocus}
              />
            )}
          />
          </View>
        ) : (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name="heart-outline" size={30} color="#fff" /></View>
            <Text style={styles.emptyTitle}>No favorites yet</Text>
            <Text style={styles.emptyText}>Long-press a channel in the guide or Channels list to add one.</Text>
            <Pressable hasTVPreferredFocus={preferInitialFocus} onFocus={() => setPreferInitialFocus(false)} onPress={() => router.replace("/guide" as any)} style={({ focused }: any) => [styles.guideButton, focused && styles.focused]}>
              <Text style={styles.guideText}>Open TV Guide</Text>
            </Pressable>
          </View>
        )}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14, backgroundColor: glass.page },
  header: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  headerLeft: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 },
  addHint: { flex: 1, maxWidth: 360, color: "#C9B5EE", fontFamily: fonts.regular, fontSize: 7.5, lineHeight: 10.5, marginTop: 2 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  count: { color: "#D9C8F5", fontFamily: fonts.medium, fontSize: 9 },
  searchHit: { width: 34, height: 30, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: glass.buttonEdge, backgroundColor: glass.button },
  folderRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 4, paddingBottom: 8 },
  folderChip: { minHeight: 26, justifyContent: "center", paddingHorizontal: 13, borderRadius: 13, borderWidth: 2, borderColor: glass.buttonEdge, backgroundColor: glass.button },
  folderActive: { borderColor: glass.selectedEdge, backgroundColor: "rgba(140,70,240,0.80)" },
  folderText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
  folderDanger: { borderColor: "rgba(255,150,170,0.55)", backgroundColor: "rgba(150,24,64,0.55)" },
  editBar: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8, padding: 6, borderRadius: 14, borderWidth: 1, borderColor: glass.edge, backgroundColor: glass.panelStrong },
  editLabel: { color: glass.kicker, fontFamily: fonts.semibold, fontSize: 8.5 },
  editQuestion: { flex: 1, minWidth: 0, color: "#fff", fontSize: 9 },
  editInput: { flex: 1, minWidth: 0, height: 32, paddingHorizontal: 10, paddingVertical: 0, borderRadius: 10, borderWidth: 2, borderColor: glass.buttonEdge, backgroundColor: "rgba(20,8,42,0.85)", color: "#fff", fontFamily: fonts.medium, fontSize: 10 },
  editButton: { minHeight: 30, justifyContent: "center", paddingHorizontal: 14, borderRadius: 12, borderWidth: 2, borderColor: glass.buttonEdge, backgroundColor: glass.button },
  editPrimary: { borderColor: glass.selectedEdge, backgroundColor: "rgba(140,70,240,0.80)" },
  // Panel styling on a plain View; the FlatList inside only fills it.
  listPanel: { flex: 1, padding: 4, borderRadius: 16, borderWidth: 1, borderColor: glass.edge, backgroundColor: "rgba(74,32,134,0.22)" },
  listFill: { flex: 1 },
  list: { padding: 2, paddingBottom: 20 },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 8, marginBottom: 5, borderWidth: 2, borderColor: glass.edgeSoft, backgroundColor: "rgba(36,16,70,0.55)", borderRadius: 12 },
  focused: glassFocus,
  number: { width: 22, color: tvColors.textMuted, fontFamily: fonts.semibold, fontSize: 9, textAlign: "right" },
  name: { width: 135, color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  programBlock: { flex: 1, minWidth: 0 },
  program: { color: "rgba(255,255,255,0.9)", fontFamily: fonts.medium, fontSize: 9.5 },
  track: { height: 3, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 2, overflow: "hidden", marginTop: 7 },
  fill: { height: 3, borderRadius: 2, backgroundColor: glass.pink },
  time: { width: 104, color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, textAlign: "right" },
  heart: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  empty: { alignSelf: "center", marginTop: "auto", marginBottom: "auto", width: 380, maxWidth: "100%", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 26, borderRadius: 18, borderWidth: 1, borderColor: glass.edge, backgroundColor: glass.panelStrong },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(124,58,237,0.85)", borderWidth: 1, borderColor: "rgba(255,255,255,0.45)", shadowColor: glass.glow, elevation: 12 },
  emptyTitle: { color: "#fff", fontFamily: fonts.semibold, fontSize: 14 },
  emptyText: { color: "#D9C8F5", fontFamily: fonts.regular, fontSize: 9, textAlign: "center" },
  guideButton: { minHeight: 32, justifyContent: "center", paddingHorizontal: 16, borderRadius: 12, backgroundColor: "rgba(140,70,240,0.80)", borderWidth: 2, borderColor: glass.selectedEdge, marginTop: 4 },
  guideText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 9 },
});

export default function FavoritesScreen() {
  return (
    <FocusedTabMount>
      <FavoritesScreenContent />
    </FocusedTabMount>
  );
}
