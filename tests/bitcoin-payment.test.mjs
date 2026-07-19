import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  BITCOIN_ADDRESS,
  buildBitcoinUri,
  isValidBitcoinAddress,
  normalizePaymentReference,
} from "../business/offers/agent-configuration-repair/payment/payment-core.mjs";

test("configured Bitcoin address and offline BIP21 URI are valid", () => {
  assert.equal(isValidBitcoinAddress(BITCOIN_ADDRESS), true);
  assert.equal(isValidBitcoinAddress(`${BITCOIN_ADDRESS.slice(0, -1)}x`), false);
  const uri = buildBitcoinUri();
  assert.match(uri, new RegExp(`^bitcoin:${BITCOIN_ADDRESS}\\?`));
  assert.equal(uri.includes("amount="), false, "offline page must not imply a stale BTC conversion");
});

test("manual references are normalized but remain explicitly unverified", () => {
  const reference = normalizePaymentReference({
    order_reference: "agr-demo123",
    transaction_id: "A".repeat(64),
  });
  assert.deepEqual(reference, {
    order_reference: "AGR-DEMO123",
    transaction_id: "a".repeat(64),
    network: "bitcoin-mainnet",
    payment_status: "unverified",
  });
  assert.throws(() => normalizePaymentReference({ order_reference: "demo", transaction_id: "a".repeat(64) }), /ORDER_REFERENCE_INVALID/);
  assert.throws(() => normalizePaymentReference({ order_reference: "AGR-DEMO123", transaction_id: "not-a-txid" }), /TRANSACTION_ID_INVALID/);
});

test("generated payment page is self-contained and makes no network requests", () => {
  const html = fs.readFileSync(new URL("../business/offers/agent-configuration-repair/payment/payment.html", import.meta.url), "utf8");
  assert.match(html, new RegExp(BITCOIN_ADDRESS));
  assert.match(html, /payment_status:'unverified'/);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//, "payment page must not load remote HTTP resources");
  assert.doesNotMatch(html, /fetch\s*\(/);
  assert.doesNotMatch(html, /XMLHttpRequest|WebSocket/);
});
