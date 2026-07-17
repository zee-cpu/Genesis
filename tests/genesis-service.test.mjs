import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSchemaRegistry } from "../src/core/schema-registry.mjs";
import { buildDecisionRecord, versionDecisionRecord } from "../src/core/record-builders.mjs";
import { listRecords, readRecord, writeRecord } from "../src/storage/yaml-record-store.mjs";
import { workspacePaths } from "../src/storage/workspace.mjs";

import { createGenesisService } from "../src/application/genesis-service.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const clock = () => new Date("2026-07-17T12:00:00Z");

function makeProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genesis-service-"));
}

function cleanupProjectRoot(projectRoot) {
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

function startBusinessInput(overrides = {}) {
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
    ...overrides,
  };
}

function addEvidenceInput(overrides = {}) {
  return {
    source_reference: "interview://owner-2",
    summary: "A second owner also wants the same flow",
    stance: "contradict",
    provenance: "Interview note",
    privacy_classification: "internal",
    decision_changes: { confidence: 0.65 },
    ...overrides,
  };
}

function experimentInput(overrides = {}) {
  return {
    owner: "research",
    baseline: "Owners currently take two hours each week",
    comparison_method: "Compare observed time with the two-hour baseline",
    metric: {
      formula: "sum_reconciliation_minutes_divided_by_sessions",
      population: "qualified_bakery_owners",
      denominator: "completed_reconciliation_sessions",
      data_source: "observed_session_log",
    },
    expected_outcome: "Median reconciliation time is below one hour",
    minimum_meaningful_effect: "median_time_reduction_at_least_60_minutes",
    failure_conditions: ["median_time_is_not_reduced"],
    stop_conditions: ["participant_harm", "privacy_incident"],
    limits: {
      cash_usd: 0,
      labor_hours: 8,
      duration_days: 7,
      data_classes: ["internal"],
      risk_level: "low",
    },
    decision_date: "2026-07-17T12:00:00Z",
    allowed_outcomes: ["scale", "pivot", "learning_lab", "archive", "kill"],
    ...overrides,
  };
}

function createService(projectRoot, confirm = async () => true) {
  return createGenesisService({
    projectRoot,
    repoRoot: ROOT,
    clock,
    confirm,
  });
}

async function runSection(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`FAILED SECTION: ${label}`);
    console.error(error);
    throw error;
  }
}

await runSection("startBusiness", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);

    const result = await service.startBusiness(startBusinessInput());

    assert.equal(result.changed, true);
    assert.equal(result.state, "discover");
    assert.equal(result.projection_stale, false);
    assert.equal(result.records.length, 2);
    assert.equal(result.records[0].record_type, undefined);
    assert.equal(result.records[1].record_type, "decision_record");

    const records = listRecords(projectRoot);
    assert.equal(records.length, 2);

    const decisionPath = records.find((record) => record.kind === "decision").absolutePath;
    const evidencePath = records.find((record) => record.kind === "evidence").absolutePath;
    const decision = readRecord(decisionPath);
    const evidence = readRecord(evidencePath);

    assert.equal(evidence.stance, "support");
    assert.equal(decision.id, "bakery-decision");
    assert.deepEqual(decision.immutable_history_refs, ["records/decisions/bakery-decision.v0001.yaml"]);

    const status = await service.status("bakery");
    assert.equal(status.state, "discover");
    assert.equal(status.next_command, "plan-experiment");
    assert.equal(status.decision_versions, 1);
    assert.equal(status.experiment_versions, 0);
    assert.equal(status.evidence_count, 1);
    assert.equal(status.metrics.supporting_evidence_count, 1);
    assert.equal(status.projection_consistent, true);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("addEvidence", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());

    const result = await service.addEvidence("bakery", addEvidenceInput());

    assert.equal(result.changed, true);
    assert.equal(result.state, "discover");
    assert.equal(result.projection_stale, false);

    const records = listRecords(projectRoot);
    assert.equal(records.length, 4);

    const decisionV2 = readRecord(records.filter((record) => record.kind === "decision").at(-1).absolutePath);
    assert.equal(decisionV2.confidence, 0.65);
    assert.deepEqual(
      decisionV2.immutable_history_refs,
      ["records/decisions/bakery-decision.v0001.yaml"],
    );

    const status = await service.status("bakery");
    assert.equal(status.decision_versions, 2);
    assert.equal(status.evidence_count, 2);
    assert.equal(status.metrics.supporting_evidence_count, 1);
    assert.equal(status.metrics.contradicting_evidence_count, 1);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("planExperiment", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());
    await service.addEvidence("bakery", addEvidenceInput());

    const result = await service.planExperiment("bakery", experimentInput());

    assert.equal(result.changed, true);
    assert.equal(result.state, "approval_pending");
    assert.equal(result.next_command, "status");
    assert.equal(result.projection_stale, false);
    assert.equal(result.record.status, "draft");
    assert.equal(result.record.validation_outcome, "pending");
    assert.deepEqual(result.record.approval_references, []);

    const status = await service.status("bakery");
    assert.equal(status.state, "approval_pending");
    assert.equal(status.next_command, "status");
    assert.equal(status.experiment_versions, 1);
    assert.equal(status.experiment_completeness.complete, true);
    assert.equal(status.metrics.preregistration_completeness, 1);

    const rebuild = await service.rebuildIndex();
    assert.deepEqual(rebuild, { recordCount: 5, businessCount: 1, projection_consistent: true });

    const rebuiltStatus = await service.status("bakery");
    assert.equal(rebuiltStatus.projection_consistent, true);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("repeatStart", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());

    await assert.rejects(
      () => service.startBusiness(startBusinessInput()),
      (error) => error.code === "BUSINESS_ALREADY_EXISTS",
    );
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("cancelled", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot, async () => false);

    const result = await service.startBusiness(startBusinessInput());

    assert.deepEqual(result, { changed: false, reason: "cancelled" });
    assert.deepEqual(listRecords(projectRoot), []);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("blockedGate", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    const registry = createSchemaRegistry(ROOT);

    const decision = buildDecisionRecord({
      business_id: "bakery",
      owner: "research",
      evidence_references: ["interview://owner-1"],
      related_records: [],
      immutable_history_refs: ["records/decisions/bakery-decision.v0001.yaml"],
      target_customer: "Independent bakery owners",
      problem: "Weekly order reconciliation takes too long",
      hypothesis: "A clearer order view will reduce reconciliation time",
      confidence: 0.55,
      evidence: ["interview://owner-1"],
      counterevidence: [],
      alternatives: ["keep_manual_process", "use_spreadsheet_template"],
      expected_outcome: "Weekly reconciliation takes less than one hour",
      metric: "weekly_reconciliation_minutes",
      decision: "run_bounded_validation",
      review_date: "2026-07-24T12:00:00Z",
    }, clock, { registry });

    await writeRecord({
      projectRoot,
      kind: "decision",
      id: decision.id,
      version: 1,
      value: decision,
    });

    await assert.rejects(
      () => service.planExperiment("bakery", experimentInput()),
      (error) => error.code === "DISCOVER_GATE_BLOCKED",
    );

    const status = await service.status("bakery");
    assert.deepEqual(status.blocked_commands_by_code, { DISCOVER_GATE_BLOCKED: 1 });
    assert.equal(status.next_command, "status");
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("pendingUnavailable", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());
    await service.addEvidence("bakery", addEvidenceInput());
    await service.planExperiment("bakery", experimentInput());

    await assert.rejects(
      () => service.planExperiment("bakery", experimentInput()),
      (error) => error.code === "COMMAND_UNAVAILABLE",
    );
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});
