// Shared data types. Data is fetched & parsed on-device in `@/src/source`.

export type Program = {
  title: string;
  desc: string;
  category: string;
  start: string;
  stop: string | null;
};

export type Channel = {
  xtream_stream_id?: string;
  archive_days?: number;
  id: string;
  playlist_id?: string;
  playlist_name?: string;
  source_channel_id?: string;
  /** Portal commands are resolved only when playback starts; session tokens are never catalog rows. */
  stalker_id?: string;
  stalker_cmd?: string;
  source_group?: string;
  /** Provider playlist id before XMLTV matching rewrites `tvg_id`. */
  raw_tvg_id?: string;
  tvg_id: string;
  name: string;
  logo: string;
  /** Original #EXTINF tvg-logo from the playlist. */
  playlist_logo?: string;
  /** Matched XMLTV <icon> logo, kept separately for priority/fallback changes. */
  epg_logo?: string;
  group: string;
  url: string;
  stream_type: string;
  programs?: Program[];
};

export type GuideResponse = {
  start: string;
  end: string;
  now: string;
  channels: Channel[];
  /** Normalized programme map keyed by playlist channel id (preferred over channel.programs). */
  programsByChannelId?: Record<string, Program[]>;
  /** Native XMLTV epoch so programme rows never survive a fresh guide swap. */
  guideEpoch?: number;
};

export type SourceStatus = {
  m3u_url: string;
  epg_url: string;
  channel_count: number;
  channels_with_epg: number;
  last_refresh: string | null;
  refreshing: boolean;
  error: string | null;
};
