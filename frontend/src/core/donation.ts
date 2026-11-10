export const DONATION_LIGHTNING_ADDRESS = "inclusive-greenfinch@lexe.app";
export const DONATION_DESCRIPTION = "Support Charming MediaLab";
export const DONATION_USD_PRESETS = [2, 5, 10] as const;

export type LnurlPayDetails = {
  callback: string;
  minSendable: number;
  maxSendable: number;
  commentAllowed?: number;
  tag: "payRequest";
};

export function lightningAddressUrl(address = DONATION_LIGHTNING_ADDRESS) {
  const [name, host, extra] = address.trim().split("@");
  if (!name || !host || extra) throw new Error("The donation address is not valid.");
  return `https://${host}/.well-known/lnurlp/${encodeURIComponent(name)}`;
}

export function usdToMillisats(usd: number, bitcoinUsd: number) {
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(bitcoinUsd) || bitcoinUsd <= 0) {
    throw new Error("Enter a valid donation amount.");
  }
  return Math.max(1000, Math.round((usd / bitcoinUsd) * 100_000_000 * 1000));
}

export function validateLnurlDetails(value: unknown): LnurlPayDetails {
  const data = value as Partial<LnurlPayDetails> | null;
  if (!data || data.tag !== "payRequest" || typeof data.callback !== "string" || !data.callback.startsWith("https://") ||
      !Number.isFinite(data.minSendable) || !Number.isFinite(data.maxSendable)) {
    throw new Error("The donation service returned an invalid payment request.");
  }
  return data as LnurlPayDetails;
}

export function validateInvoice(value: unknown) {
  const data = value as { pr?: unknown; status?: unknown; reason?: unknown } | null;
  if (data?.status === "ERROR") throw new Error(typeof data.reason === "string" ? data.reason : "The wallet could not create a payment request.");
  if (!data || typeof data.pr !== "string" || !/^ln(bc|tb|bcrt)[0-9a-z]+$/i.test(data.pr)) {
    throw new Error("The wallet did not return a valid Lightning invoice.");
  }
  return data.pr;
}

export function invoiceCallbackUrl(callback: string, millisats: number) {
  const url = new URL(callback);
  url.searchParams.set("amount", String(Math.round(millisats)));
  return url.toString();
}
