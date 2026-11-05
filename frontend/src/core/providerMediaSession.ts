export type ProviderMedia = { id: string; owner: string; title: string; url: string; image?: string; format?: string; providerLogin?: string; catalogKind?: "movie" | "series"; catalogId?: string };
let pending: { token: string; media: ProviderMedia; expires: number } | null = null;
export function providerStreamAddress(uri: string, headers: Record<string, string>): string {
  const suffix = Object.entries(headers).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  return suffix ? `${uri}|${suffix}` : uri;
}
export function clearProviderMedia(): void { pending = null; }
/** Keep usable provider URLs out of route parameters, navigation history and logs. */
export function stageProviderMedia(media: ProviderMedia): string {
  if (!/^https?:\/\//i.test(media.url)) throw new Error("This provider media address is unsupported.");
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  pending = { token, media: { ...media }, expires: Date.now() + 60_000 };
  return token;
}
export function takeProviderMedia(token: string): ProviderMedia | null {
  if (pending && pending.expires < Date.now()) pending = null;
  if (!pending || pending.token !== token) return null;
  const value = pending.media; pending = null; return value;
}
