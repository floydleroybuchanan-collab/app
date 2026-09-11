import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type MultiviewNative = {
  begin(session: string): Promise<void>;
  prepare(session: string, slot: number, revision: number, channel: string, uri: string, headers: Record<string,string>, type: string): Promise<void>;
  listen(session: string, slot: number): void;
  remove(session: string, slot: number, revision: number): void;
  suspend(session: string): void;
  resume(session: string): void;
  end(session: string): Promise<void>;
  tracks(session: string, slot: number, subtitles: boolean): void;
  preferences(session: string, audioLanguage: string, textLanguage: string): void;
};
export const multiview: MultiviewNative | null = Platform.OS === "android" ? NativeModules.CharmMultiview ?? null : null;
export type MultiviewEvent = { session: string; slot: number; revision: number; state: "loading" | "playing" | "error" | "ended"; reason?: string };
export function listenMultiview(listener: (event: MultiviewEvent) => void) {
  const emitter = multiview ? new NativeEventEmitter(NativeModules.CharmMultiview) : null;
  const subscription = emitter?.addListener("CharmMultiviewState", listener);
  return () => subscription?.remove();
}
