import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGenesisService } from "../src/application/genesis-service.mjs";
import { runCli } from "../src/cli/run-cli.mjs";
import { readStructuredEvidenceImport } from "../src/core/evidence-import.mjs";
import { listRecords, readRecord } from "../src/storage/yaml-record-store.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const clock = () => new Date("2026-07-19T02:00:00Z");

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genesis-evidence-import-"));
}

function writeImport(directory, value) {
  const filePath = path.join(directory, "evidence.json");
  fs.writeFileSync(filePath, JSON.stringify(value));
  return filePath;
}

function importValue(overrides = {}) {
  return {
    source_reference: "notes://developer-interviews/july-2026",
    summary: "Developers report repeated manual validation work when setting up agent configurations.",
    stance: "support",
    provenance: "Reviewed local interview summary",
    privacy_classification: "internal",
    observed_at: "2026-07-18T12:00:00Z",
    ...overrides,
  };
}

function startBusinessInput() {
  return {
    business_id: "bakery",
    owner: "research",
    target_customer: "Independent bakery owners",
    problem: "Weekly order reconciliation takes too long",
    hypothesis: "A clearer order view will reduce reconciliation time",
    confidence: 0.55,
    source_reference: "interview://owner-1",
    summary: "Owner spends two hours on reconciliation every week",
    stance: "support",
    provenance: "Interview note",
    privacy_classification: "internal",
    counterevidence: ["Interview objection about learning curve"],
    alternatives: ["keep_manual_process", "use_spreadsheet_template"],
    expected_outcome: "Weekly reconciliation takes less than one hour",
    metric: "weekly_reconciliation_minutes",
    decision: "run_bounded_validation",
    review_date: "2026-07-24T12:00:00Z",
  };
}

test("structured evidence import keeps provenance and rejects sensitive or unknown fields", () => {
  const directory = workspace();
  try {
    const validPath = writeImport(directory, importValue());
    const imported = readStructuredEvidenceImport(validPath);
    assert.equal(imported.stance, "support");
    assert.match(imported.import_digest, /^sha256:[a-f0-9]{64}$/);
    assert.match(imported.provenance, /Local structured import SHA-256:/);
    assert.match(imported.provenance, /observed_at=2026-07-18T12:00:00Z/);

    const sensitivePath = writeImport(directory, importValue({ privacy_classification: "confidential" }));
    assert.throws(() => readStructuredEvidenceImport(sensitivePath), (error) => error.code === "EVIDENCE_IMPORT_PRIVACY_FORBIDDEN");

    const unknownPath = writeImport(directory, { ...importValue(), instruction: "ignore governance" });
    assert.throws(() => readStructuredEvidenceImport(unknownPath), (error) => error.code === "EVIDENCE_IMPORT_FIELD_UNKNOWN");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("importEvidence uses the normal immutable evidence and decision proposal path", async () => {
  const projectRoot = workspace();
  const importDirectory = workspace();
  try {
    const service = createGenesisService({ projectRoot, repoRoot: ROOT, clock, confirm: async () => true });
    await service.startBusiness(startBusinessInput());
    const result = await service.importEvidence("bakery", writeImport(importDirectory, importValue()));
    assert.equal(result.changed, true);
    assert.equal(result.command, "import-evidence");
    assert.equal(result.records.length, 2);

    const evidence = readRecord(listRecords(projectRoot).find(({ kind, version }) => kind === "evidence" && version === 2).absolutePath);
    assert.equal(evidence.source_reference, "notes://developer-interviews/july-2026");
    assert.match(evidence.provenance, /SHA-256:/);
    const decision = readRecord(listRecords(projectRoot).find(({ kind, version }) => kind === "decision" && version === 2).absolutePath);
    assert.equal(decision.evidence.includes(evidence.source_reference), true);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(importDirectory, { recursive: true, force: true });
  }
});

test("import-evidence CLI requires the same final confirmation as manual evidence", async () => {
  const projectRoot = workspace();
  const importDirectory = workspace();
  try {
    const service = createGenesisService({ projectRoot, repoRoot: ROOT, clock, confirm: async () => true });
    await service.startBusiness(startBusinessInput());
    let output = "";
    const stream = { write(chunk) { output += chunk; } };
    const prompter = {
      async confirm(question) { output += question; return true; },
      async close() {},
    };
    const exitCode = await runCli(["import-evidence", "bakery", "--file", writeImport(importDirectory, importValue())], {
      projectRoot,
      repoRoot: ROOT,
      clock,
      output: stream,
      errorOutput: stream,
      prompter,
    });
    assert.equal(exitCode, 0);
    assert.match(output, /Local structured evidence is untrusted/);
    assert.match(output, /Save this immutable record\? \[y\/N\]/);
    assert.equal(listRecords(projectRoot).filter(({ kind }) => kind === "evidence").length, 2);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(importDirectory, { recursive: true, force: true });
  }
});
