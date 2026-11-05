import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, FlatList, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { getPlaylistUrl, listPlaylists, usePlaylists } from "@/src/core/playlistRegistry";
import { decodeXtream, encodeXtream, loadXtreamCatalog, loadXtreamDetails, xtreamMediaUrl, type XtreamLogin, type XtreamTitle, type XtreamDetails } from "@/src/core/xtream";
import { decodeStalker, encodeStalker, type StalkerLogin } from "@/src/core/stalker";
import { listStalkerCatalog, loadStalkerDetails, resolveStalkerMedia } from "@/src/core/stalkerMedia";
import { providerStreamAddress, stageProviderMedia } from "@/src/core/providerMediaSession";
import { updateProviderLibrary, useProviderLibrary } from "@/src/core/providerLibrary";
import { providerPlaybackId } from "@/src/core/providerLibraryCore";
import { tvColors } from "@/src/theme";

type ProviderLogin = { protocol: "xtream"; value: XtreamLogin } | { protocol: "stalker"; value: StalkerLogin };
type ProviderTitle = XtreamTitle & { command?: string };
type ProviderDetails = Omit<XtreamDetails, "episodes"> & { command?: string; episodes: (XtreamDetails["episodes"][number] & { command?: string; seriesNumber?: number })[] };

/** Clone-derived provider categories, movies, title details, seasons and episodes. */
export function XtreamProviderBrowser({ onClose, initialKind = "movie", initialTitle }: {
  onClose: () => void;
  initialKind?: "movie" | "series";
  initialTitle?: { owner: string; kind: "movie" | "series"; catalogId: string };
}) {
  const router = useRouter(), playlists = usePlaylists();
  const focused = useIsFocused();
  const providers = playlists.filter(row => row.enabled && (row.kind === "xtream" || row.kind === "stalker"));
  const [owner, setOwner] = useState(initialTitle?.owner || ""), [kind, setKind] = useState(initialTitle?.kind || initialKind);
  const requestedTitle = useRef(initialTitle);
  const [catalog, setCatalog] = useState<{ source: (typeof playlists)[number]; kind: typeof kind; login: ProviderLogin; rows: ProviderTitle[] } | null>(null);
  const [selected, setSelected] = useState<ProviderTitle | null>(null), [details, setDetails] = useState<ProviderDetails | null>(null);
  const [category, setCategory] = useState(""), [query, setQuery] = useState(""), [season, setSeason] = useState("");
  const library = useProviderLibrary();
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const activeSource = providers.find(row => row.id === owner);
  const activeCatalog = catalog?.source === activeSource && catalog?.kind === kind ? catalog : null;
  const login = activeCatalog?.login || null;
  const rows = useMemo(() => activeCatalog?.rows || [], [activeCatalog]);
  const [playRequest] = useState(() => ({ current: null as symbol | null }));
  useEffect(() => {
    setOpening(false);
    return () => { playRequest.current = null; };
  }, [playRequest, selected, activeSource, focused]);
  useEffect(() => { if (providers.length && !providers.some(row => row.id === owner)) setOwner(providers[0].id); }, [owner, providers]);
  useEffect(() => {
    let alive = true;
    setCatalog(null); setSelected(null); setDetails(null); setCategory(""); setError(null);
    if (!activeSource) { setLoadingCatalog(false); return; }
    setLoadingCatalog(true);
    void (async () => {
      const row = (await listPlaylists()).find(item => item.id === owner && item.enabled);
      if (!row) throw Error();
      const secret = await getPlaylistUrl(row);
      const xtream = row.kind === "xtream" ? decodeXtream(secret) : null;
      const stalker = row.kind === "stalker" ? decodeStalker(secret) : null;
      const credentials: ProviderLogin | null = xtream ? { protocol: "xtream", value: xtream } : stalker ? { protocol: "stalker", value: stalker } : null;
      if (!credentials) throw Error();
      const rows = credentials.protocol === "xtream" ? await loadXtreamCatalog(credentials.value, kind) : await listStalkerCatalog(credentials.value, kind);
      if (!alive) return;
      setCatalog({ source: activeSource, kind, login: credentials, rows });
      const target = requestedTitle.current;
      if (target?.owner === owner && target.kind === kind) {
        requestedTitle.current = undefined;
        const item = rows.find(value => value.id === target.catalogId);
        if (item) setSelected(item);
        else setError("This title is no longer in the provider library.");
      }
    })().catch(() => { if (alive) setError("Could not load this provider library. Check the account in Settings → Playlists."); })
      .finally(() => { if (alive) setLoadingCatalog(false); });
    return () => { alive = false; };
  }, [activeSource, kind, owner]);
  useEffect(() => {
    if (!selected || !login || !activeSource) {
      setLoadingDetails(false);
      return;
    }
    let alive = true;
    setDetails(null);
    setError(null);
    setLoadingDetails(true);
    setSeason("");
    const request = login.protocol === "xtream" ? loadXtreamDetails(login.value, selected.kind, selected.id) : loadStalkerDetails(login.value, selected.kind, selected.id);
    void request.then(value => { if (alive) { setDetails(value); setSeason(value.episodes[0]?.season || ""); } })
      .catch(() => { if (alive) setError("Could not load this title's details. Try another title."); }).finally(() => { if (alive) setLoadingDetails(false); });
    return () => { alive = false; };
  }, [activeSource, login, selected]);
  useEffect(() => {
    if (!focused) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => { if (selected) setSelected(null); else onClose(); return true; });
    return () => back.remove();
  }, [focused, onClose, selected]);
  const categories = useMemo(() => Array.from(new Set(rows.map(row => row.category))).sort(), [rows]);
  const favorites = useMemo(() => library.filter(row => row.favorite).map(row => `${row.owner}:${row.kind}:${row.catalogId}`), [library]);
  const favoriteKey = (title: XtreamTitle) => `${owner}:${title.kind}:${title.id}`;
  const savedTitle = selected && library.find(row => row.owner === owner && row.kind === selected.kind && row.catalogId === selected.id);
  const resumeEpisode = savedTitle && savedTitle.positionMs > 0 ? details?.episodes.find(row => providerPlaybackId("series", row.id, row.seriesNumber) === savedTitle.mediaId) : undefined;
  const visible = useMemo(() => rows.filter(row => (!category || row.category === category) && (!query || row.name.toLowerCase().includes(query.toLowerCase())) && (!onlyFavorites || favorites.includes(`${owner}:${row.kind}:${row.id}`))), [category, favorites, onlyFavorites, owner, query, rows]);
  const play = (id: string, title: string, format: string, image?: string, command?: string, seriesNumber?: number) => {
    if (!focused || !activeSource || !login || !selected || playRequest.current) return;
    const request = Symbol();
    playRequest.current = request;
    setOpening(true);
    setError(null);
    void (async () => {
      const url = login.protocol === "xtream" ? xtreamMediaUrl(login.value, kind, id, format) : await resolveStalkerMedia(login.value, kind, id, command, seriesNumber).then(link => providerStreamAddress(link.uri, link.headers));
      if (playRequest.current !== request) return;
      const providerLogin = login.protocol === "xtream" ? encodeXtream(login.value) : encodeStalker(login.value);
      const token = stageProviderMedia({ id: providerPlaybackId(kind, id, seriesNumber), owner, title, image, format, providerLogin, catalogKind: kind, catalogId: selected.id, url });
      router.push({ pathname: "/provider-player", params: { token } } as any);
    })().catch(() => { if (playRequest.current === request) setError("Could not open this title. Check the provider or try again."); })
      .finally(() => {
        if (playRequest.current === request) { playRequest.current = null; setOpening(false); }
      });
  };
  const button = (label: string, press: () => void, active = false, key = label) => <Pressable key={key} onPress={press} style={({ focused }: any) => ({ padding: 10, margin: 3, borderRadius: 6, borderWidth: 2, borderColor: focused ? "#fff" : "transparent", backgroundColor: active ? tvColors.purpleDeep : tvColors.panelRaised })}><Text style={{ color: "#fff" }}>{label}</Text></Pressable>;
  return <View style={{ flex: 1, padding: 12, gap: 8, backgroundColor: tvColors.canvas }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{button(selected ? "Back to titles" : "Back to library", () => selected ? setSelected(null) : onClose())}
      {!selected && <>{button("Movies", () => setKind("movie"), kind === "movie")}{button("Series", () => setKind("series"), kind === "series")}{button("My list", () => setOnlyFavorites(value => !value), onlyFavorites)}</>}
    </View>
    {!selected ? <>
      <ScrollView horizontal style={{ maxHeight: 50 }}>{providers.map(row => button(row.name, () => setOwner(row.id), owner === row.id, row.id))}</ScrollView>
      {!providers.length ? <Text style={{ color: "#fff" }}>Add an Xtream account or Stalker portal in Settings → Playlists to browse its movies and series.</Text> : null}
      <TextInput value={query} onChangeText={setQuery} placeholder="Search provider titles" placeholderTextColor={tvColors.textMuted} style={{ color: "#fff", padding: 10, backgroundColor: tvColors.panelRaised, borderRadius: 6 }} />
      <ScrollView horizontal style={{ maxHeight: 50 }}>{button("All categories", () => setCategory(""), !category)}{categories.map(name => button(name, () => setCategory(name), category === name))}</ScrollView>
      <FlatList data={visible} keyExtractor={item => item.id} numColumns={4} initialNumToRender={12} windowSize={5} maxToRenderPerBatch={12} renderItem={({ item }) => <Pressable onPress={() => setSelected(item)} style={({ focused }: any) => ({ width: "24%", margin: "0.5%", padding: 8, borderWidth: 2, borderColor: focused ? "#fff" : "transparent", backgroundColor: tvColors.panelRaised, borderRadius: 6 })}>
        {item.image ? <Image source={{ uri: item.image }} style={{ width: "100%", aspectRatio: 2 / 3 }} resizeMode="contain" /> : null}<Text numberOfLines={2} style={{ color: "#fff", paddingTop: 6 }}>{item.name}</Text>
      </Pressable>} />
    </> : <ScrollView><Text style={{ color: "#fff", fontSize: 24 }}>{selected.name}</Text>
      <View style={{ flexDirection: "row" }}>{button(favorites.includes(favoriteKey(selected)) ? "Remove from My list" : "Add to My list", () => {
        void updateProviderLibrary({ owner, kind: selected.kind, catalogId: selected.id, title: selected.name,
          favorite: !favorites.includes(favoriteKey(selected)), updatedAt: Date.now() }).catch(() => setError("Could not save this title."));
      })}</View>
      {details ? <><Text style={{ color: tvColors.textMuted, marginVertical: 10 }}>{[details.genre, details.released, details.director].filter(Boolean).join(" · ")}</Text><Text style={{ color: "#fff", fontSize: 16 }}>{details.plot}</Text>
        {kind === "movie" ? button(savedTitle && savedTitle.positionMs > 0 ? "Resume movie" : "Play movie", () => play(selected.id, selected.name, details.extension, selected.image, details.command || selected.command)) : <>
          {resumeEpisode ? button("Resume episode", () => play(resumeEpisode.id, `${selected.name} · ${resumeEpisode.title}`, resumeEpisode.extension, resumeEpisode.image || selected.image, resumeEpisode.command || details.command, resumeEpisode.seriesNumber)) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{Array.from(new Set(details.episodes.map(row => row.season))).map(value => button(`Season ${value}`, () => setSeason(value), season === value))}</View>
          {details.episodes.filter(row => row.season === season).map(row => button(row.title || `Episode ${row.id}`, () => play(row.id, `${selected.name} · ${row.title}`, row.extension, row.image || selected.image, row.command || details.command, row.seriesNumber), false, providerPlaybackId("series", row.id, row.seriesNumber)))}
        </>}
      </> : null}
    </ScrollView>}
    {loadingCatalog || loadingDetails || opening ? <ActivityIndicator color={tvColors.purpleBright} /> : null}{error ? <Text accessibilityRole="alert" style={{ color: "#FB7185" }}>{error}</Text> : null}
  </View>;
}
