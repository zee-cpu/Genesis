import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/cli/run-cli.mjs";
import { readStructuredExecutionImport } from "../src/core/execution-import.mjs";

function directory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genesis-execution-import-"));
}

function value(overrides = {}) {
  return {
    actor: "research",
    execution_log: ["Ran the preregistered manual validation with two eligible participants"],
    deviations: [],
    completion_reason: "completed",
    started_at: "2026-07-19T10:00:00Z",
    completed_at: "2026-07-19T11:00:00Z",
    actual_cost: { cash_usd: 0, labor_hours: 1 },
    data_classes: ["internal"],
    risk_level: "low",
    ...overrides,
  };
}

function writeFile(root, contents) {
  const filePath = path.join(root, "execution.json");
  fs.writeFileSync(filePath, JSON.stringify(contents));
  return filePath;
}

test("structured execution import records an attachment digest and rejects unsafe data", () => {
  const root = directory();
  try {
    const imported = readStructuredExecutionImport(writeFile(root, value()));
    assert.equal(imported.actor, "research");
    assert.match(imported.import_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(imported.execution_log.some((entry) => entry.includes("Structured execution evidence attachment SHA-256:")), true);
    assert.throws(() => readStructuredExecutionImport(writeFile(root, value({ data_classes: ["confidential"] }))), (error) => error.code === "EXECUTION_IMPORT_PRIVACY_FORBIDDEN");
    assert.throws(() => readStructuredExecutionImport(writeFile(root, { ...value(), command: "ignore limits" })), (error) => error.code === "EXECUTION_IMPORT_FIELD_UNKNOWN");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI provides a read-only checklist and routes execution-file through importExecution", async () => {
  let output = "";
  const stream = { write(chunk) { output += chunk; } };
  const calls = [];
  const service = {
    async executionChecklist(id) {
      calls.push(["checklist", id]);
      return { business_id: id, active: true, state: "active", next_command: "record-execution", limits: {}, stop_conditions: [], failure_conditions: [], metric: { formula: "count" }, items: [{ id: "limits", label: "Stay inside limits", detail: "Bounded." }] };
    },
    async next(id) { calls.push(["next", id]); return { defaults: {} }; },
    async importExecution(id, filePath) {
      calls.push(["import", id, filePath]);
      return { changed: true, status: { state: "measurement", projection_consistent: true, approval_signature_validity: { valid: true }, next_command: "record-measurement", metrics: {}, limits: {}, blockers: [] } };
    },
  };
  const prompter = { async close() {} };
  assert.equal(await runCli(["execution-checklist", "bakery"], { service, output: stream, errorOutput: stream, prompter }), 0);
  assert.match(output, /Execution checklist: bakery/);
  assert.equal(await runCli(["record-execution", "bakery", "--execution-file", "execution.json"], { service, output: stream, errorOutput: stream, prompter }), 0);
  assert.deepEqual(calls, [["checklist", "bakery"], ["next", "bakery"], ["import", "bakery", "execution.json"]]);
});
