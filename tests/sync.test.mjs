import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import YAML from "yaml";

import { createSchemaRegistry } from "../src/core/schema-registry.mjs";
import { runCli } from "../src/cli/run-cli.mjs";
import { signApprovalRecord, verifyApprovalRecord } from "../src/security/approval-signatures.mjs";
import { bootstrapHumanAuthority, inspectHumanAuthorityIdentity } from "../src/security/identity-store.mjs";
import { openProjection, projectionConsistency } from "../src/storage/projection.mjs";
import { listRecords, readRecord, writeRecord } from "../src/storage/yaml-record-store.mjs";
import { ensureWorkspace, workspacePaths } from "../src/storage/workspace.mjs";
import { applySync, listSyncEvents, prepareSync, syncStatus } from "../src/sync/sync-store.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function temporaryRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `genesis-sync-${label}-`));
}

function decision(overrides = {}) {
  const value = YAML.parse(fs.readFileSync(path.join(ROOT, "templates/decision-record.yaml"), "utf8"));
  delete value.example_only;
  return {
    ...value,
    id: "team-decision",
    affected_business: "team-business",
    related_records: [],
    immutable_history_refs: ["history://team/decision/v1"],
    ...overrides,
  };
}

function approval(overrides = {}) {
  const value = YAML.parse(fs.readFileSync(path.join(ROOT, "templates/approval-record.yaml"), "utf8"));
  delete value.example_only;
  return {
    ...value,
    id: "team-approval",
    affected_business: "team-business",
    related_records: ["team-decision"],
    immutable_history_refs: ["history://team/approval/v1"],
    ...overrides,
  };
}

async function writeDecision(projectRoot, value = decision()) {
  return writeRecord({ projectRoot, kind: "decision", id: value.id, version: 1, value });
}

function copyEvents(sourceRoot, targetRoot) {
  const source = workspacePaths(sourceRoot).syncEvents;
  const target = ensureWorkspace(targetRoot).syncEvents;
  for (const name of fs.readdirSync(source)) {
    const destination = path.join(target, name);
    if (!fs.existsSync(destination)) fs.copyFileSync(path.join(source, name), destination);
  }
}

test("content-addressed sync preparation is deterministic and idempotent", async () => {
  const projectRoot = temporaryRoot("prepare");
  try {
    const registry = createSchemaRegistry(ROOT);
    await writeDecision(projectRoot);
    const first = prepareSync(projectRoot, registry);
    const second = prepareSync(projectRoot, registry);
    assert.equal(first.events_created, 1);
    assert.equal(second.events_created, 0);
    assert.equal(second.missing_events, 0);
    assert.equal(listSyncEvents(projectRoot, registry).length, 1);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("peers converge by set union and rebuild SQLite only after validation", async () => {
  const left = temporaryRoot("left");
  const right = temporaryRoot("right");
  try {
    const registry = createSchemaRegistry(ROOT);
    await writeDecision(left);
    prepareSync(left, registry);
    copyEvents(left, right);
    assert.equal(syncStatus(right, registry).pending_resources, 1);
    const applied = applySync(right, registry);
    assert.equal(applied.resources_applied, 1);
    assert.equal(applied.projection_consistent, true);
    assert.deepEqual(readRecord(listRecords(right)[0].absolutePath), decision());
    const db = openProjection(workspacePaths(right).db);
    try {
      assert.equal(projectionConsistency(db, listRecords(right)).consistent, true);
    } finally {
      db.close();
    }
    copyEvents(right, left);
    assert.equal(applySync(left, registry).resources_applied, 0);
  } finally {
    fs.rmSync(left, { recursive: true, force: true });
    fs.rmSync(right, { recursive: true, force: true });
  }
});

test("divergent concurrent immutable versions are preserved and block materialization", async () => {
  const left = temporaryRoot("conflict-left");
  const right = temporaryRoot("conflict-right");
  try {
    const registry = createSchemaRegistry(ROOT);
    await writeDecision(left, decision({ hypothesis: "Left hypothesis" }));
    await writeDecision(right, decision({ hypothesis: "Right hypothesis" }));
    prepareSync(left, registry);
    prepareSync(right, registry);
    copyEvents(right, left);
    const status = syncStatus(left, registry);
    assert.equal(status.conflicts.length, 1);
    assert.equal(status.conflicts[0].reason, "concurrent_versions");
    assert.throws(() => applySync(left, registry), (error) => error.code === "SYNC_CONFLICT");
    assert.equal(readRecord(listRecords(left)[0].absolutePath).hypothesis, "Left hypothesis");
    assert.equal(listSyncEvents(left, registry).length, 2);
  } finally {
    fs.rmSync(left, { recursive: true, force: true });
    fs.rmSync(right, { recursive: true, force: true });
  }
});

test("tampered event content is rejected before canonical records change", async () => {
  const projectRoot = temporaryRoot("tamper");
  try {
    const registry = createSchemaRegistry(ROOT);
    await writeDecision(projectRoot);
    prepareSync(projectRoot, registry);
    const [eventPath] = fs.readdirSync(workspacePaths(projectRoot).syncEvents)
      .map((name) => path.join(workspacePaths(projectRoot).syncEvents, name));
    const event = YAML.parse(fs.readFileSync(eventPath, "utf8"));
    event.payload.hypothesis = "Changed after addressing";
    fs.writeFileSync(eventPath, YAML.stringify(event));
    assert.throws(() => syncStatus(projectRoot, registry), (error) => error.code === "SYNC_CONTENT_TAMPERED");
    assert.equal(readRecord(listRecords(projectRoot)[0].absolutePath).hypothesis, decision().hypothesis);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("signed Human Authority identity and approvals verify after peer transfer", async () => {
  const left = temporaryRoot("signed-left");
  const right = temporaryRoot("signed-right");
  const keyDirectory = temporaryRoot("key");
  try {
    const keyPath = path.join(keyDirectory, "authority");
    assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath]).status, 0);
    const registry = createSchemaRegistry(ROOT);
    const clock = () => new Date("2026-07-19T00:00:00Z");
    await bootstrapHumanAuthority({ projectRoot: left, registry, signingKeyPath: keyPath, clock });
    await writeDecision(left);
    const signed = signApprovalRecord({ projectRoot: left, registry, record: approval(), signingKeyPath: keyPath, clock });
    await writeRecord({ projectRoot: left, kind: "approval", id: signed.id, version: 1, value: signed });
    prepareSync(left, registry);
    copyEvents(left, right);
    const applied = applySync(right, registry);
    assert.equal(applied.resources_applied, 3);
    assert.equal(inspectHumanAuthorityIdentity(right, registry).valid, true);
    const syncedApproval = readRecord(listRecords(right).find(({ kind }) => kind === "approval").absolutePath);
    assert.equal(verifyApprovalRecord({ projectRoot: right, registry, record: syncedApproval }).valid, true);
  } finally {
    fs.rmSync(left, { recursive: true, force: true });
    fs.rmSync(right, { recursive: true, force: true });
    fs.rmSync(keyDirectory, { recursive: true, force: true });
  }
});

test("CLI explains and confirms preparation in plain language", async () => {
  const projectRoot = temporaryRoot("cli");
  try {
    await writeDecision(projectRoot);
    const output = { value: "", write(text) { this.value += text; } };
    const prompter = {
      async confirm(question) { output.write(question); return true; },
      async close() {},
    };
    assert.equal(await runCli(["sync", "prepare"], { projectRoot, repoRoot: ROOT, output, errorOutput: output, prompter }), 0);
    assert.match(output.value, /Create 1 immutable sync event/);
    assert.match(output.value, /Git-ready directory: \.genesis\/sync\/events/);
    assert.match(output.value, /did not run git, contact a network, or push/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
