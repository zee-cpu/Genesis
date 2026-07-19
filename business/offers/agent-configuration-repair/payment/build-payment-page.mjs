import fs from "node:fs";

import QRCode from "qrcode";

import { BITCOIN_ADDRESS, DISPLAY_PRICE_USD, buildBitcoinUri } from "./payment-core.mjs";

const uri = buildBitcoinUri();
const qr = await QRCode.toString(uri, {
  type: "svg",
  errorCorrectionLevel: "M",
  margin: 2,
  color: { dark: "#111827", light: "#ffffff" },
});

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
  <title>Bitcoin payment · Agent Configuration Repair</title>
  <style>
    :root{color-scheme:dark;--bg:#08111f;--card:#111d30;--line:#263650;--text:#f4f7fb;--muted:#9eabc0;--gold:#f59e0b;--green:#34d399}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#172744 0,#08111f 55%);font:16px/1.5 system-ui,sans-serif;color:var(--text)}main{width:min(760px,100%);background:color-mix(in srgb,var(--card) 92%,transparent);border:1px solid var(--line);border-radius:24px;padding:clamp(24px,5vw,48px);box-shadow:0 24px 80px #0008}header{margin-bottom:28px}.eyebrow{color:var(--gold);font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:.75rem}h1{margin:.35rem 0;font-size:clamp(2rem,6vw,3.5rem);line-height:1.05}.sub,.note{color:var(--muted)}.grid{display:grid;grid-template-columns:220px 1fr;gap:28px;align-items:center}.qr{background:#fff;border-radius:18px;padding:12px}.qr svg{display:block;width:100%;height:auto}.amount{font-size:2rem;font-weight:800}.address{display:block;padding:12px;border:1px solid var(--line);border-radius:10px;overflow-wrap:anywhere;background:#08111f;color:var(--green)}button{border:0;border-radius:10px;padding:11px 16px;font:inherit;font-weight:700;cursor:pointer;background:var(--gold);color:#171006;margin-top:10px}hr{border:0;border-top:1px solid var(--line);margin:32px 0}label{display:block;font-weight:700;margin:12px 0 6px}input{width:100%;border:1px solid var(--line);border-radius:10px;padding:12px;background:#08111f;color:var(--text);font:inherit}#result{white-space:pre-wrap;color:var(--green);overflow-wrap:anywhere}.warning{border-left:3px solid var(--gold);padding-left:14px}@media(max-width:620px){.grid{grid-template-columns:1fr}.qr{width:220px;max-width:100%;margin:auto}}
  </style>
</head>
<body>
<main>
  <header><div class="eyebrow">Manual Bitcoin option</div><h1>Agent Configuration Repair</h1><p class="sub">One bounded configuration package · displayed price ${DISPLAY_PRICE_USD} USD</p></header>
  <section class="grid">
    <div class="qr">${qr}</div>
    <div><div class="amount">${DISPLAY_PRICE_USD} USD</div><p class="note">The BTC amount is intentionally not fixed here because this offline page uses no exchange-rate service. Confirm the exact BTC amount before paying.</p><code class="address" id="address">${BITCOIN_ADDRESS}</code><button type="button" id="copy-address">Copy BTC address</button><p><a id="wallet-link" href="${uri}" style="color:var(--gold)">Open in a Bitcoin wallet</a></p></div>
  </section>
  <hr>
  <section><h2>Prepare a manual payment reference</h2><p class="note">This form stays in your browser. It does not contact a server or verify a blockchain payment.</p><form id="reference-form" novalidate><label for="order">Order reference</label><input id="order" autocomplete="off" placeholder="AGR-ABC123" required><label for="txid">Bitcoin transaction ID</label><input id="txid" autocomplete="off" placeholder="64 hexadecimal characters" required><button type="submit">Validate reference</button></form><p id="result" role="status"></p></section>
  <hr>
  <p class="warning">A transaction ID is a payment claim, not proof of payment. The operator must manually verify the receiving address, amount, network, and confirmations before delivery. Never send a private key or seed phrase.</p>
</main>
<script>
  const address=${JSON.stringify(BITCOIN_ADDRESS)};
  document.getElementById('copy-address').addEventListener('click',async()=>{await navigator.clipboard.writeText(address);document.getElementById('copy-address').textContent='Copied';});
  document.getElementById('reference-form').addEventListener('submit',(event)=>{event.preventDefault();const order=document.getElementById('order').value.trim().toUpperCase();const txid=document.getElementById('txid').value.trim().toLowerCase();const result=document.getElementById('result');if(!/^AGR-[A-Z0-9]{6,20}$/.test(order)){result.textContent='Invalid order reference. Expected AGR- followed by 6–20 letters or numbers.';return}if(!/^[a-f0-9]{64}$/.test(txid)){result.textContent='Invalid transaction ID. Expected exactly 64 hexadecimal characters.';return}result.textContent=JSON.stringify({order_reference:order,transaction_id:txid,network:'bitcoin-mainnet',payment_status:'unverified'},null,2);});
</script>
</body>
</html>`;

fs.writeFileSync(new URL("./payment.html", import.meta.url), html, { mode: 0o644 });
console.log(`Built offline payment page: ${uri}`);
