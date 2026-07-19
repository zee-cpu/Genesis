export const BITCOIN_ADDRESS = "bc1qk5u409m0qn4h6szk7utuvamz0mv8vj9ej9mw9g";
export const DISPLAY_PRICE_USD = 49;

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values) {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < 5; index += 1) {
      if ((top >>> index) & 1) checksum ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][index];
    }
  }
  return checksum >>> 0;
}

function expandHrp(hrp) {
  return [...hrp].map((character) => character.charCodeAt(0) >>> 5)
    .concat([0], [...hrp].map((character) => character.charCodeAt(0) & 31));
}

export function isValidBitcoinAddress(address) {
  if (typeof address !== "string" || address !== address.toLowerCase() || !address.startsWith("bc1")) return false;
  const separator = address.lastIndexOf("1");
  if (separator < 1 || separator + 7 > address.length || address.length > 90) return false;
  const values = [...address.slice(separator + 1)].map((character) => BECH32_CHARSET.indexOf(character));
  if (values.some((value) => value < 0)) return false;
  return polymod([...expandHrp(address.slice(0, separator)), ...values]) === 1;
}

export function buildBitcoinUri(address = BITCOIN_ADDRESS) {
  if (!isValidBitcoinAddress(address)) throw new Error("BITCOIN_ADDRESS_INVALID");
  const query = new URLSearchParams({
    label: "Agent Configuration Repair",
    message: "Manual payment for one bounded configuration repair",
  });
  return `bitcoin:${address}?${query.toString()}`;
}

export function normalizePaymentReference({ order_reference, transaction_id }) {
  const orderReference = String(order_reference ?? "").trim().toUpperCase();
  const transactionId = String(transaction_id ?? "").trim().toLowerCase();
  if (!/^AGR-[A-Z0-9]{6,20}$/.test(orderReference)) throw new Error("ORDER_REFERENCE_INVALID");
  if (!/^[a-f0-9]{64}$/.test(transactionId)) throw new Error("TRANSACTION_ID_INVALID");
  return {
    order_reference: orderReference,
    transaction_id: transactionId,
    network: "bitcoin-mainnet",
    payment_status: "unverified",
  };
}
