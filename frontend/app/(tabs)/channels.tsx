import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { FocusedTabMount } from "@/src/components/FocusedTabMount";
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { PurpleTvShell } from "@/src/components/PurpleTvShell";
import { PurpleDrawerButton } from "@/src/components/PurpleDrawerButton";
import { ChannelLogo } from "@/src/components/ChannelLogo";
import { Channel } from "@/src/api";
import { useStore } from "@/src/store";
import { useGuidePrograms } from "@/src/core/guideProgramsStore";
import { useChannelCustomize } from "@/src/core/channelCustomize";
import { fonts, glass, glassFocus, tvColors } from "@/src/theme";
import { GlassPageTitle } from "@/src/components/GlassPageTitle";
import { fmtTime, nowNext, progressPct } from "@/src/utils/time";
import { openFullscreenPlayer } from "@/src/utils/openFullscreenPlayer";
import { addTvLongPressListener } from "@/src/utils/tvRemote";

const ChannelListRow = memo(function ChannelListRow({
  channel,
  number,
  favorite,
  logos,
  now,
  editMode,
  canMoveUp,
  canMoveDown,
  onPlay,
  onFavorite,
  onMove,
  onFocusChannel,
  preferredFocus,
}: {
  channel: Channel;
  number: number;
  favorite: boolean;
  logos: boolean;
  now: Date;
  editMode: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPlay: (channel: Channel) => void;
  onFavorite: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onFocusChannel: (id: string) => void;
  preferredFocus?: boolean;
}) {
  const programs = useGuidePrograms(channel.id);
  const current = nowNext(programs, now).current;
  const progress = current ? progressPct(current, now) : 0;
  return (
    <View style={styles.rowShell}>
      <Pressable
        hasTVPreferredFocus={preferredFocus}
        onFocus={() => onFocusChannel(channel.id)}
        onPress={() => { if (!editMode) onPlay(channel); }}
        onLongPress={Platform.isTV ? undefined : () => { if (!editMode) onFavorite(channel.id); }}
        delayLongPress={450}
        style={({ focused }: any) => [styles.row, editMode && styles.rowEditing, focused && styles.focused]}
        testID={`purple-channel-${channel.id}`}
      >
        <Text style={styles.number}>{number}</Text>
        <ChannelLogo name={channel.name} logo={channel.logo} disabled={!logos} size={31} />
        <View style={styles.nameBlock}>
          <Text numberOfLines={1} style={styles.channelName}>{channel.name}</Text>
          <Text numberOfLines={1} style={styles.group}>{channel.group || "Live TV"}</Text>
        </View>
        <View style={styles.programBlock}>
          <Text numberOfLines={1} style={styles.program}>{current?.title || "Live channel"}</Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
        </View>
        <Text style={styles.time}>
          {current ? `${fmtTime(current.start)}${current.stop ? ` - ${fmtTime(current.stop)}` : ""}` : "LIVE"}
        </Text>
        <View style={styles.heart} pointerEvents="none">
          <Ionicons name={favorite ? "heart" : "heart-outline"} size={17} color={favorite ? glass.pink : "#C9B5EE"} />
        </View>
      </Pressable>
      {editMode ? (
        <View style={styles.orderActions}>
          <Pressable
            disabled={!canMoveUp}
            onPress={() => onMove(channel.id, -1)}
            style={({ focused }: any) => [styles.orderButton, !canMoveUp && styles.disabled, focused && styles.focused]}
            testID={`channel-order-up-${channel.id}`}
          >
            <Ionicons name="chevron-up" size={15} color="#fff" />
            <Text style={styles.orderText}>Up</Text>
          </Pressable>
          <Pressable
            disabled={!canMoveDown}
            onPress={() => onMove(channel.id, 1)}
            style={({ focused }: any) => [styles.orderButton, !canMoveDown && styles.disabled, focused && styles.focused]}
            testID={`channel-order-down-${channel.id}`}
          >
            <Ionicons name="chevron-down" size={15} color="#fff" />
            <Text style={styles.orderText}>Down</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

function ChannelsScreenContent() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { channels, favorites, toggleFavorite, addRecent, channelLogos, hardRefresh, loading, refreshing, error, clock24h } = useStore();
  void clock24h;
  const customize = useChannelCustomize();
  // Native source/cache rows are already name-sorted. Reuse the authoritative
  // array instead of cloning/sorting 6k+ channels every Channels-screen render.
  const alphabetical = channels;
  const alphabeticalIds = useMemo(() => channels.map((channel) => channel.id), [channels]);
  const ordered = useMemo(() => {
    if (!customize.customOrder.length) return alphabetical;
    // Build directly instead of channels.map(...)->Map, avoiding a full tuple
    // array while arranging playlists with thousands of channels.
    const byId = new Map<string, Channel>();
    for (const channel of channels) byId.set(channel.id, channel);
    const result: Channel[] = [];
    const seen = new Set<string>();
    for (const id of customize.customOrder) {
      const channel = byId.get(id);
      if (!channel || seen.has(id)) continue;
      seen.add(id);
      result.push(channel);
    }
    for (const channel of alphabetical) {
      if (seen.has(channel.id)) continue;
      seen.add(channel.id);
      result.push(channel);
    }
    return result;
  }, [alphabetical, channels, customize.customOrder]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const [now, setNow] = useState(() => new Date());
  const [preferInitialFocus, setPreferInitialFocus] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [focusedChannelId, setFocusedChannelId] = useState<string | null>(null);

  useEffect(() => {
    if (!isFocused) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [isFocused]);

  // Channels is a persistent tab route. Re-arm preferred focus every time it
  // becomes active so returning from Search/player cannot leave focus detached.
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

  const favorite = useCallback((id: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    toggleFavorite(id);
  }, [toggleFavorite]);

  const noteChannelFocus = useCallback((id: string) => {
    // Initial preferred focus is only an entry bootstrap. Once Android has a
    // real focused row, user D-pad movement owns focus and must never be pulled
    // back by a still-armed hasTVPreferredFocus flag.
    setPreferInitialFocus(false);
    setFocusedChannelId(id);
  }, []);

  useEffect(() => {
    if (!isFocused || editMode || !Platform.isTV) return;
    return addTvLongPressListener((key) => {
      if (key !== "SELECT") return;
      const id = focusedChannelId;
      if (id) favorite(id);
    });
  }, [editMode, favorite, focusedChannelId, isFocused]);

  const toggleEditMode = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    setEditMode((current) => {
      const next = !current;
      if (next) customize.initializeCustomOrder(alphabeticalIds);
      return next;
    });
  }, [alphabeticalIds, customize]);

  const move = useCallback((id: string, direction: -1 | 1) => {
    void Haptics.selectionAsync().catch(() => undefined);
    customize.moveInCustomOrder(id, direction);
  }, [customize]);

  const listExtraData = useMemo(
    () => ({ favorites, editMode, order: customize.customOrder }),
    [customize.customOrder, editMode, favorites],
  );

  const clearOrder = useCallback(() => {
    void Haptics.selectionAsync().catch(() => undefined);
    customize.clearCustomOrder();
    setEditMode(false);
  }, [customize]);

  return (
    <PurpleTvShell active="/channels">
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <PurpleDrawerButton testID="channels-open-drawer" />
            <GlassPageTitle page={editMode ? "Arrange Guide Channels" : "Channels"} kicker="Live TV" />
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.count}>{ordered.length} channels</Text>
            <Pressable
              onPress={toggleEditMode}
              style={({ focused }: any) => [styles.headerAction, editMode && styles.headerActionActive, focused && styles.focused]}
              testID="channels-toggle-order"
            >
              <Ionicons name="swap-vertical-outline" size={15} color="#fff" />
              <Text style={styles.headerActionText}>{editMode ? "Done" : "Arrange"}</Text>
            </Pressable>
            {customize.customOrder.length ? (
              <Pressable
                onPress={clearOrder}
                style={({ focused }: any) => [styles.headerAction, focused && styles.focused]}
                testID="channels-reset-order"
              >
                <Ionicons name="refresh-outline" size={15} color="#fff" />
                <Text style={styles.headerActionText}>Reset</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => router.replace("/search" as any)}
              style={({ focused }: any) => [styles.searchHit, focused && styles.focused]}
              testID="channels-open-search"
            >
              <Ionicons name="search-outline" size={15} color="#fff" />
            </Pressable>
          </View>
        </View>
        {editMode ? (
          <Text style={styles.editHint}>Move through the full virtualized channel list and use Up/Down to set the order used by the Guide. Only visible rows are mounted, even with thousands of channels.</Text>
        ) : null}
        {ordered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No channels loaded</Text>
            <Text style={styles.emptyMessage}>
              {error || "Reload your playlist or open Search once channels are available."}
            </Text>
            <Pressable
              hasTVPreferredFocus={preferInitialFocus}
              onFocus={() => setPreferInitialFocus(false)}
              onPress={() => void hardRefresh()}
              disabled={loading || refreshing}
              style={({ focused }: any) => [styles.retryButton, focused && styles.focused]}
              testID="channels-retry-load"
            >
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.retryText}>{refreshing || loading ? "Loading…" : "Retry load"}</Text>
            </Pressable>
          </View>
        ) : (
          // Rounded glass panel on a wrapper View: border/radius styling on the
          // FlatList itself made Android (Fabric) draw no rows.
          <View style={styles.listPanel}>
          <FlatList
            data={ordered}
            keyExtractor={(item) => item.id}
            extraData={listExtraData}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews={false}
            showsVerticalScrollIndicator={false}
            style={styles.listFill}
            contentContainerStyle={styles.list}
            renderItem={({ item, index }) => (
              <ChannelListRow
                channel={item}
                number={index + 1}
                favorite={favoriteSet.has(item.id)}
                logos={isFocused && channelLogos}
                now={now}
                editMode={editMode}
                canMoveUp={index > 0}
                canMoveDown={index < ordered.length - 1}
                onPlay={play}
                onFavorite={favorite}
                onMove={move}
                onFocusChannel={noteChannelFocus}
                preferredFocus={preferInitialFocus && index === 0}
              />
            )}
          />
          </View>
        )}
      </View>
    </PurpleTvShell>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 14, backgroundColor: glass.page },
  header: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 8 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1, minWidth: 0 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  count: { color: "#D9C8F5", fontFamily: fonts.medium, fontSize: 9 },
  headerAction: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: 12, borderWidth: 2, borderColor: glass.buttonEdge, backgroundColor: glass.button },
  headerActionActive: { backgroundColor: "rgba(140,70,240,0.80)", borderColor: glass.selectedEdge },
  headerActionText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 8.5 },
  searchHit: { width: 34, height: 30, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: glass.buttonEdge, backgroundColor: glass.button },
  editHint: { color: glass.kicker, fontFamily: fonts.medium, fontSize: 8, lineHeight: 11, paddingVertical: 6 },
  empty: { flex: 1, alignItems: "flex-start", justifyContent: "center", gap: 8, paddingHorizontal: 4 },
  emptyTitle: { color: "#fff", fontFamily: fonts.bold, fontSize: 14 },
  emptyMessage: { color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 10, maxWidth: 420 },
  retryButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "rgba(140,70,240,0.80)", borderWidth: 2, borderColor: glass.selectedEdge, marginTop: 6 },
  retryText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  // Glass rows inside one panel; still a plain FlatList, nothing extra per row.
  listPanel: { flex: 1, padding: 4, borderRadius: 16, borderWidth: 1, borderColor: glass.edge, backgroundColor: "rgba(74,32,134,0.22)" },
  listFill: { flex: 1 },
  list: { padding: 2, paddingBottom: 20 },
  rowShell: { flexDirection: "row", alignItems: "stretch", gap: 6, marginBottom: 5 },
  row: { flex: 1, minWidth: 0, minHeight: 50, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 2, borderColor: glass.edgeSoft, backgroundColor: "rgba(36,16,70,0.55)", paddingHorizontal: 8, borderRadius: 12 },
  rowEditing: { backgroundColor: "rgba(124,58,237,0.16)" },
  orderActions: { width: 130, flexDirection: "row", gap: 5 },
  orderButton: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 12, borderWidth: 2, borderColor: glass.buttonEdge, backgroundColor: glass.button },
  orderText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 7.5 },
  disabled: { opacity: 0.35 },
  focused: glassFocus,
  number: { width: 24, color: tvColors.textMuted, fontFamily: fonts.semibold, fontSize: 9.5, textAlign: "right" },
  nameBlock: { width: 138, minWidth: 0 },
  channelName: { color: "#fff", fontFamily: fonts.semibold, fontSize: 10 },
  group: { color: "#C9B5EE", fontFamily: fonts.medium, fontSize: 7.5, letterSpacing: 0.4, marginTop: 2 },
  programBlock: { flex: 1, minWidth: 0, paddingHorizontal: 5 },
  program: { color: "rgba(255,255,255,0.90)", fontFamily: fonts.medium, fontSize: 9.5 },
  progressTrack: { height: 3, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 2, marginTop: 7, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: glass.pink },
  time: { width: 102, color: tvColors.textMuted, fontFamily: fonts.regular, fontSize: 7.5, textAlign: "right" },
  heart: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
});

export default function ChannelsScreen() {
  return (
    <FocusedTabMount>
      <ChannelsScreenContent />
    </FocusedTabMount>
  );
}
