# Agent Configuration Repair

Status: internal offer draft — not approved for publication or customer commitments

## The offer

We repair and validate one bounded AI-agent configuration package for **$49 USD**.

This is for developers who already have a prompt, JSON Schema, or tool definition that is malformed, rejected by a validator, inconsistent with its stated behavior, or difficult to integrate.

## What the buyer submits

- one configuration package containing at most five related JSON files;
- the intended behavior in plain language;
- the validator, runtime, or API format it must satisfy;
- one failing example or error message, when available; and
- confirmation that the submitted material contains no credentials, personal data, proprietary source code, or regulated data.

We do not request private keys, access tokens, production access, customer datasets, or repository write access.

## What the buyer receives

- corrected, formatted JSON files;
- JSON syntax verification;
- JSON Schema validation when a schema is supplied or included in scope;
- a concise change report explaining each material repair;
- one valid example payload where applicable;
- one invalid example showing a rejected case where applicable; and
- a local verification command or Node.js validation script.

## Delivery boundary

- Scope: one package, maximum five related JSON files.
- Target turnaround hypothesis: two business days after receiving complete inputs.
- Included correction: one correction round for defects against the agreed acceptance checks.
- Excluded: production deployment, remote-system access, prompt-performance guarantees, security certification, legal compliance certification, ongoing support, and work involving secrets or sensitive data.

The turnaround and correction language are draft commercial terms. They require Human Authority review before publication or sale.

## Acceptance checks

Delivery is complete only when:

1. every delivered JSON file parses successfully;
2. every schema-backed file passes the agreed validator;
3. the documented valid example passes;
4. the documented invalid example fails where applicable;
5. no secret or sensitive-data material is retained; and
6. the buyer can reproduce validation using the supplied command.

## Price and risk boundary

The validation hypothesis is a fixed **$49 USD** price. No payment link or financial authority is configured yet. Before accepting payment, the operator must establish approved payment, refund, accounting, privacy, and customer-communication controls.

### Sandboxed Bitcoin option

An offline payment-page prototype is available under `payment/payment.html`. It uses the public receiving address `bc1qk5u409m0qn4h6szk7utuvamz0mv8vj9ej9mw9g`, embeds a local BIP21 QR code, and validates the shape of a manually supplied order reference and transaction ID.

Build it locally with:

```bash
npm run offer:payment:build
```

The prototype does not set a BTC amount, call an exchange-rate or blockchain API, verify payment, access wallet keys, submit form data, issue refunds, or authorize delivery. A human operator must quote the BTC amount and separately verify the address, amount, network, and confirmations. It is not approved for publication by its implementation authorization.

Proposed customer-friendly correction/refund boundary for later legal review:

- fix reproducible defects against the written acceptance checks once at no additional charge;
- if the agreed checks still cannot be met, offer a full refund;
- do not promise outcomes outside the written checks.

## Proof required before treating this as a business

This document is an offer hypothesis, not evidence of demand. Advance only after recording:

- at least 10 qualified problem conversations or equivalent first-party responses;
- the number who confirm the problem is current and costly;
- the number who ask for delivery or accept the price;
- objections and counterevidence, including preference for self-service tools;
- actual delivery time and rework from any approved pilot; and
- at least one completed paid transaction before calling demand validated.
