import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSchemaRegistry } from "../src/core/schema-registry.mjs";
import { buildApprovalRecord } from "../src/core/record-builders.mjs";
import { signApprovalRecord, verifyApprovalRecord } from "../src/security/approval-signatures.mjs";
import { canonicalDigest, canonicalizeJson } from "../src/security/canonical-json.mjs";
import { bootstrapHumanAuthority, inspectHumanAuthorityIdentity, revokeHumanAuthorityKey } from "../src/security/identity-store.mjs";
import {
  APPROVAL_SIGNATURE_NAMESPACE,
  publicKeyFingerprint,
  publicKeyFromPrivateKey,
  signCanonicalPayload,
  verifyCanonicalPayload,
} from "../src/security/ssh-signatures.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function makeDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genesis-signature-test-"));
}

test("RFC 8785 canonicalization is deterministic and rejects ambiguous values", () => {
  const value = {
    string: "€$\u000f\nA'B\"\\\\\"/",
    literals: [null, true, false],
    numbers: [333333333.3333333, 1e30, 4.5, 0.002, 1e-27],
  };
  assert.equal(
    canonicalizeJson(value),
    "{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27],\"string\":\"€$\\u000f\\nA'B\\\"\\\\\\\\\\\"/\"}",
  );
  assert.equal(canonicalDigest({ b: 2, a: 1 }), canonicalDigest({ a: 1, b: 2 }));
  assert.throws(() => canonicalizeJson({ value: -0 }), (error) => error.code === "CANONICALIZATION_FAILED");
  assert.throws(() => canonicalizeJson({ value: "\ud800" }), (error) => error.code === "CANONICALIZATION_FAILED");
});

test("SSH signatures bind canonical content, principal, namespace, and trusted key", () => {
  const directory = makeDirectory();
  try {
    const keyPath = path.join(directory, "authority-key");
    const generated = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const publicKey = publicKeyFromPrivateKey(keyPath);
    assert.equal(publicKeyFromPrivateKey(`${keyPath}.pub`), publicKey);
    assert.match(publicKeyFingerprint(publicKey), /^SHA256:/);
    const payload = { id: "approval-1", decision: "approved", limits: { cash_usd: 0 } };
    const envelope = signCanonicalPayload({
      payload,
      principalId: "genesis-owner",
      signingKeyPath: keyPath,
      namespace: APPROVAL_SIGNATURE_NAMESPACE,
      signedAt: "2026-07-19T00:00:00Z",
    });
    assert.equal(envelope.principal_id, "genesis-owner");
    assert.equal(verifyCanonicalPayload({ payload, envelope, publicKey }).valid, true);
    assert.deepEqual(
      verifyCanonicalPayload({ payload: { ...payload, decision: "denied" }, envelope, publicKey }),
      { valid: false, code: "SIGNATURE_DIGEST_MISMATCH", message: "The signed record content has changed" },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Human Authority identity bootstrap and revocation form a verified append-only chain", async () => {
  const directory = makeDirectory();
  try {
    const keyPath = path.join(directory, "authority-key");
    const generated = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const registry = createSchemaRegistry(ROOT);
    const clock = () => new Date("2026-07-19T00:00:00Z");

    assert.equal(inspectHumanAuthorityIdentity(directory, registry).configured, false);
    const bootstrap = await bootstrapHumanAuthority({ projectRoot: directory, registry, signingKeyPath: keyPath, clock });
    assert.equal(bootstrap.changed, true);
    const active = inspectHumanAuthorityIdentity(directory, registry);
    assert.equal(active.valid, true);
    assert.equal(active.active_key.fingerprint, bootstrap.fingerprint);
    assert.equal(active.events.length, 1);

    const revoked = await revokeHumanAuthorityKey({
      projectRoot: directory,
      registry,
      signingKeyPath: keyPath,
      reason: "Hardware key was retired",
      clock: () => new Date("2026-07-19T01:00:00Z"),
    });
    assert.equal(revoked.revoked, true);
    const status = inspectHumanAuthorityIdentity(directory, registry);
    assert.equal(status.valid, false);
    assert.equal(status.blocker.code, "IDENTITY_KEY_REVOKED");
    assert.equal(status.events.length, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("approval records require the active physical Human Authority key", async () => {
  const directory = makeDirectory();
  try {
    const keyPath = path.join(directory, "authority-key");
    assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath]).status, 0);
    const registry = createSchemaRegistry(ROOT);
    const clock = () => new Date("2026-07-19T00:00:00Z");
    await bootstrapHumanAuthority({ projectRoot: directory, registry, signingKeyPath: keyPath, clock });
    const approval = buildApprovalRecord({
      id: "security-test-approval",
      affected_business: "security-test",
      status: "active",
      evidence_references: ["evidence://security-test"],
      related_records: ["security-test-experiment"],
      privacy_classification: "internal",
      immutable_history_refs: ["records/approvals/security-test-approval.v0001.yaml"],
      approver_role: "human_authority",
      approver_principal_id: "genesis-owner",
      requester: "lead-developer",
      actor: "operator",
      action_class: "protected_action",
      scope: { actions: ["security_test"], wildcard: false },
      evidence_snapshot: ["evidence://security-test"],
      limits: { cash_usd: 0, labor_hours: 1, duration_days: 1, data_classes: ["internal"], risk_level: "high" },
      decision: "approved",
      rationale: "Verify physical-key approval signing.",
      issued_at: "2026-07-19T00:00:00Z",
      effective_at: "2026-07-19T00:00:00Z",
      expires_at: "2026-07-20T00:00:00Z",
      review_at: "2026-07-19T12:00:00Z",
      revoked: false,
      revocation_reference: null,
    }, clock, { registry });
    assert.equal(verifyApprovalRecord({ projectRoot: directory, registry, record: approval }).code, "APPROVAL_SIGNATURE_MISSING");
    const signed = signApprovalRecord({ projectRoot: directory, registry, record: approval, signingKeyPath: keyPath, clock });
    assert.equal(verifyApprovalRecord({ projectRoot: directory, registry, record: signed }).valid, true);
    assert.equal(verifyApprovalRecord({ projectRoot: directory, registry, record: { ...signed, rationale: "Tampered" } }).valid, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
