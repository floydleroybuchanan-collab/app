import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { NativePlaybackOwner, NativePlaybackTrack } from "@/src/nativePlayback";
import type { VlcAudioOutput } from "@/src/core/vlcPlaybackPreferences";

export type NativeVlcPlaybackState = "loading" | "playing" | "error";
export type NativeVlcPlaybackEventIdentity = {
  owner: NativePlaybackOwner;
  generation: number;
  channelKey: string;
};

export type NativeVlcPlaybackStateEvent = NativeVlcPlaybackEventIdentity & {
  state: NativeVlcPlaybackState;
  reason?: string | null;
};

export type NativeVlcPlaybackTracksEvent = NativeVlcPlaybackEventIdentity & {
  audio: NativePlaybackTrack[];
  text: NativePlaybackTrack[];
};

type NativeVlcPlaybackModuleShape = {
  prepareFullscreen(
    generation: number,
    channelKey: string,
    uri: string,
    headers: Record<string, string>,
    hardwareDecode: boolean,
    audioOutput: VlcAudioOutput,
    bufferProfile: string,
  ): void;
  preparePreview(
    generation: number,
    channelKey: string,
    uri: string,
    headers: Record<string, string>,
    hardwareDecode: boolean,
    audioOutput: VlcAudioOutput,
    bufferProfile: string,
  ): void;
  setResizeMode(mode?: string | null): void;
  pause(): void;
  resume(): void;
  setMuted(muted: boolean): void;
  selectAudio(trackId: number): void;
  selectSubtitle(trackId: number): void;
  subtitlesOff(): void;
  stopPreview(releasePlayer: boolean): Promise<void>;
  stopFullscreen(releasePlayer: boolean): Promise<void>;
  getOwner(): Promise<NativePlaybackOwner>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const native: NativeVlcPlaybackModuleShape | null =
  Platform.OS === "android" ? (NativeModules.NativeVlcPlayback as NativeVlcPlaybackModuleShape | undefined) ?? null : null;
const emitter = native ? new NativeEventEmitter(NativeModules.NativeVlcPlayback) : null;

export function nativeVlcPlaybackAvailable(): boolean { return !!native; }

export function prepareNativeVlcFullscreen(
  generation: number,
  channelKey: string,
  uri: string,
  headers: Record<string, string>,
  hardwareDecode: boolean,
  audioOutput: VlcAudioOutput,
  bufferProfile: string,
): void {
  native?.prepareFullscreen(generation, channelKey, uri, headers, hardwareDecode, audioOutput, bufferProfile);
}

export function prepareNativeVlcPreview(
  generation: number,
  channelKey: string,
  uri: string,
  headers: Record<string, string>,
  hardwareDecode: boolean,
  audioOutput: VlcAudioOutput,
  bufferProfile: string,
): void {
  native?.preparePreview(generation, channelKey, uri, headers, hardwareDecode, audioOutput, bufferProfile);
}

export function setNativeVlcResizeMode(mode: "fit" | "zoom" | "stretch"): void { native?.setResizeMode(mode); }
export function pauseNativeVlcPlayback(): void { native?.pause(); }
export function resumeNativeVlcPlayback(): void { native?.resume(); }
export function setNativeVlcMuted(muted: boolean): void { native?.setMuted(muted); }
export function selectNativeVlcAudio(track?: NativePlaybackTrack | null): void {
  if (!track) return;
  native?.selectAudio(Number(track.id));
}
export function selectNativeVlcSubtitle(track?: NativePlaybackTrack | null): void {
  if (track) native?.selectSubtitle(Number(track.id)); else native?.subtitlesOff();
}
export async function stopNativeVlcPreview(releasePlayer = false): Promise<void> { await native?.stopPreview(releasePlayer); }
export async function stopNativeVlcFullscreen(releasePlayer = true): Promise<void> { await native?.stopFullscreen(releasePlayer); }
export async function getNativeVlcOwner(): Promise<NativePlaybackOwner> { return (await native?.getOwner()) ?? "none"; }

export function addNativeVlcStateListener(listener: (event: NativeVlcPlaybackStateEvent) => void): () => void {
  const sub = emitter?.addListener("NativeVlcPlaybackState", listener);
  return () => sub?.remove();
}
export function addNativeVlcTracksListener(listener: (event: NativeVlcPlaybackTracksEvent) => void): () => void {
  const sub = emitter?.addListener("NativeVlcPlaybackTracks", listener);
  return () => sub?.remove();
}
