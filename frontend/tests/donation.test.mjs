import test from "node:test";
import assert from "node:assert/strict";
import { invoiceCallbackUrl, lightningAddressUrl, usdToMillisats, validateInvoice, validateLnurlDetails } from "../src/core/donation.ts";

test("donation address resolves through HTTPS without exposing a private key", () => {
  assert.equal(lightningAddressUrl(), "https://lexe.app/.well-known/lnurlp/inclusive-greenfinch");
});
test("USD is converted to whole millisats", () => assert.equal(usdToMillisats(5, 100_000), 5_000_000));
test("LNURL responses and callback are constrained", () => {
  const details=validateLnurlDetails({tag:"payRequest",callback:"https://lexe.app/pay",minSendable:1000,maxSendable:100000000});
  const url=new URL(invoiceCallbackUrl(details.callback,5000));
  assert.equal(url.searchParams.get("amount"),"5000");
  assert.equal(url.searchParams.get("comment"),null);
  assert.throws(()=>validateLnurlDetails({tag:"payRequest",callback:"http://bad.test",minSendable:1,maxSendable:2}));
});
test("only a BOLT11 invoice is accepted", () => {
  assert.equal(validateInvoice({pr:"lnbc10u1ptest"}),"lnbc10u1ptest");
  assert.throws(()=>validateInvoice({status:"ERROR",reason:"expired"}),/expired/);
  assert.throws(()=>validateInvoice({pr:"bitcoin-address"}));
});
