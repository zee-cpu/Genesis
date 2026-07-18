import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSchemaRegistry } from "../src/core/schema-registry.mjs";
import { buildApprovalRecord, buildDecisionRecord, buildEvidenceEntry, buildExperimentRecord, versionDecisionRecord, versionExperimentRecord } from "../src/core/record-builders.mjs";
import { openProjection, projectRecord, readApprovals, readOpportunity, projectionConsistency, rebuildProjection, recordBlockedCommand } from "../src/storage/projection.mjs";
import { ensureWorkspace, workspacePaths } from "../src/storage/workspace.mjs";
import { listRecords, writeRecord } from "../src/storage/yaml-record-store.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

const clock1 = () => new Date("2026-07-17T08:00:00Z");
const clock2 = () => new Date("2026-07-17T09:00:00Z");

const decisionInput = {
  business_id: "bakery",
  owner: "research",
  evidence_references: ["evidence://bakery/interview-1"],
  related_records: [],
  immutable_history_refs: ["records/decisions/bakery-decision.v0001.yaml"],
  target_customer: "Independent bakery owners",
  problem: "Weekly order reconciliation takes too long",
  hypothesis: "A clearer order view will reduce reconciliation time",
  confidence: 0.55,
  evidence: ["evidence://bakery/interview-1"],
  counterevidence: [],
  alternatives: ["keep_manual_process", "use_spreadsheet_template"],
  expected_outcome: "Weekly reconciliation takes less than one hour",
  metric: "weekly_reconciliation_minutes",
  decision: "run_bounded_validation",
  review_date: "2026-07-24T08:00:00Z",
};

const experimentInput = {
  business_id: "bakery",
  owner: "research",
  evidence_references: ["evidence://bakery/interview-1"],
  related_records: ["bakery-decision"],
  immutable_history_refs: ["records/experiments/bakery-experiment.v0001.yaml"],
  problem: "Determine whether the proposed order view reduces reconciliation time",
  supported_decision: "bakery-decision",
  hypothesis: "Bakery owners complete reconciliation in less than one hour",
  confidence: 0.55,
  evidence: ["evidence://bakery/interview-1"],
  counterevidence: [],
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
  decision_date: "2026-07-24T08:00:00Z",
};

function makeProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genesis-projection-"));
}

function cleanupProjectRoot(projectRoot) {
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

function descriptorFor(kind, written, record, version) {
  return {
    kind,
    id: record.id,
    version,
    relativePath: written.relativePath,
  };
}

function snapshotProjection(db) {
  return {
    record_versions: db.prepare(`
      SELECT record_type, record_id, version, relative_path, updated_at
      FROM record_versions
      ORDER BY record_type, record_id, version
    `).all(),
    opportunities: db.prepare(`
      SELECT business_id, decision_id, state, created_at, updated_at, latest_decision_path,
        latest_experiment_path, support_count, contradict_count, confidence, discover_started_at,
        validation_planned_at, projection_consistent
      FROM opportunities
      ORDER BY business_id
    `).all(),
    blocked_commands: db.prepare(`
      SELECT id, business_id, command, code, occurred_at
      FROM blocked_commands
      ORDER BY id
    `).all(),
  };
}

test("projection captures latest paths, counts, and rebuilds deterministically", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  try {
    const registry = createSchemaRegistry(ROOT);
    ensureWorkspace(projectRoot);

    const decisionV1 = buildDecisionRecord(decisionInput, clock1);
    const decisionV2 = versionDecisionRecord(decisionV1, { confidence: 0.65 }, decisionV1.immutable_history_refs[0], clock2);
    const evidence = buildEvidenceEntry({
      id: "bakery-evidence-001",
      business_id: "bakery",
      source_reference: "interview://owner-1",
      summary: "Owner spends two hours on reconciliation every week",
      stance: "support",
      provenance: "Interview note",
      privacy_classification: "internal",
    }, clock1);
    const experiment = buildExperimentRecord(experimentInput, clock2);

    const decisionV1Path = await writeRecord({
      projectRoot,
      kind: "decision",
      id: decisionV1.id,
      version: 1,
      value: decisionV1,
    });
    const decisionV2Path = await writeRecord({
      projectRoot,
      kind: "decision",
      id: decisionV2.id,
      version: 2,
      value: decisionV2,
    });
    const evidencePath = await writeRecord({
      projectRoot,
      kind: "evidence",
      id: evidence.id,
      version: 1,
      value: evidence,
    });
    const experimentPath = await writeRecord({
      projectRoot,
      kind: "experiment",
      id: experiment.id,
      version: 1,
      value: experiment,
    });

    fs.writeFileSync(
      path.join(workspacePaths(projectRoot).records, "decisions", "ignored.tmp.yaml"),
      "id: ignored\nrecord_type: decision_record\n",
      "utf8",
    );

    const dbPath = workspacePaths(projectRoot).db;
    const db = openProjection(dbPath);
    projectRecord(db, descriptorFor("decision", decisionV1Path, decisionV1, 1), {
      ...decisionV1,
      relativePath: decisionV1Path.relativePath,
      version: 1,
    });
    projectRecord(db, descriptorFor("decision", decisionV2Path, decisionV2, 2), {
      ...decisionV2,
      relativePath: decisionV2Path.relativePath,
      version: 2,
    });
    projectRecord(db, descriptorFor("evidence", evidencePath, evidence, 1), {
      ...evidence,
      relativePath: evidencePath.relativePath,
      version: 1,
    });
    projectRecord(db, descriptorFor("evidence", evidencePath, evidence, 1), {
      ...evidence,
      relativePath: evidencePath.relativePath,
      version: 1,
    });
    projectRecord(db, descriptorFor("experiment", experimentPath, experiment, 1), {
      ...experiment,
      relativePath: experimentPath.relativePath,
      version: 1,
    });

    const opportunity = readOpportunity(db, "bakery");
    assert.equal(opportunity.latest_decision_path, decisionV2Path.relativePath);
    assert.equal(opportunity.latest_experiment_path, experimentPath.relativePath);
    assert.equal(opportunity.state, "approval_pending");
    assert.equal(opportunity.support_count, 1);
    assert.equal(opportunity.contradict_count, 0);
    assert.equal(opportunity.confidence, 0.65);
    assert.equal(opportunity.created_at, decisionV1.created_at);
    assert.equal(opportunity.updated_at, decisionV2.updated_at);
    assert.equal(opportunity.discover_started_at, decisionV1.created_at);
    assert.equal(opportunity.validation_planned_at, experiment.decision_date);

    const consistency = projectionConsistency(db, listRecords(projectRoot));
    assert.deepEqual(consistency, {
      consistent: true,
      yamlCount: 4,
      projectedCount: 4,
    });
    assert.equal(projectionConsistency(db, listRecords(projectRoot).map((descriptor, index) => (
      index === 0 ? { ...descriptor, id: "wrong-id" } : descriptor
    ))).consistent, false);

    const originalSnapshot = {
      record_versions: snapshotProjection(db).record_versions,
      opportunities: snapshotProjection(db).opportunities,
    };

    recordBlockedCommand(db, {
      business_id: "bakery",
      command: "start-business",
      code: "DISCOVER_GATE_BLOCKED",
      occurred_at: "2026-07-17T10:00:00Z",
    });
    assert.deepEqual(snapshotProjection(db).blocked_commands, [{
      id: 1,
      business_id: "bakery",
      command: "start-business",
      code: "DISCOVER_GATE_BLOCKED",
      occurred_at: "2026-07-17T10:00:00Z",
    }]);

    db.close();

    fs.rmSync(dbPath, { force: true });
    const rebuilt = await rebuildProjection({ projectRoot, registry });
    assert.deepEqual(rebuilt, { recordCount: 4, businessCount: 1 });

    const rebuiltDb = openProjection(dbPath);
    const rebuiltSnapshot = snapshotProjection(rebuiltDb);
    rebuiltDb.close();

    assert.deepEqual(rebuiltSnapshot.record_versions, originalSnapshot.record_versions);
    assert.deepEqual(rebuiltSnapshot.opportunities, originalSnapshot.opportunities);
    assert.deepEqual(rebuiltSnapshot.blocked_commands, []);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("rebuildProjection preserves the prior database when YAML validation fails", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  try {
    const registry = createSchemaRegistry(ROOT);
    ensureWorkspace(projectRoot);

    const decision = buildDecisionRecord(decisionInput, clock1);
    const decisionPath = await writeRecord({
      projectRoot,
      kind: "decision",
      id: decision.id,
      version: 1,
      value: decision,
    });
    const dbPath = workspacePaths(projectRoot).db;
    const db = openProjection(dbPath);
    projectRecord(db, descriptorFor("decision", decisionPath, decision, 1), {
      ...decision,
      relativePath: decisionPath.relativePath,
      version: 1,
    });
    db.close();

    const before = fs.readFileSync(dbPath);
    fs.writeFileSync(
      path.join(workspacePaths(projectRoot).records, "experiments", "broken.v0001.yaml"),
      "id: broken\nrecord_type: experiment_record\nlimits: [",
      "utf8",
    );

    assert.throws(
      () => rebuildProjection({ projectRoot, registry }),
      (error) => error instanceof Error && error.code === "RECORD_SCHEMA_INVALID",
    );

    assert.deepEqual(fs.readFileSync(dbPath), before);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("approval projection records Human decisions and rebuilds approval state", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  try {
    const registry = createSchemaRegistry(ROOT);
    const decision = buildDecisionRecord(decisionInput, clock1);
    const experiment = buildExperimentRecord(experimentInput, clock2);
    const approval = buildApprovalRecord({
      id: "bakery-experiment-approval",
      affected_business: "bakery",
      status: "active",
      evidence_references: experiment.evidence_references,
      related_records: [experiment.id],
      privacy_classification: "internal",
      immutable_history_refs: ["records/approvals/bakery-experiment-approval.v0001.yaml"],
      approver_role: "human_authority",
      approver_principal_id: "genesis-owner",
      requester: "research",
      actor: "research",
      action_class: "micro_experiment",
      scope: { actions: ["start_experiment:bakery-experiment"], wildcard: false },
      evidence_snapshot: experiment.evidence_references,
      limits: experiment.limits,
      decision: "approved",
      rationale: "The bounded experiment is ready for manual start.",
      effective_at: "2026-07-17T09:00:00Z",
      expires_at: "2026-07-24T09:00:00Z",
      review_at: "2026-07-20T09:00:00Z",
    }, clock2);
    const activeExperiment = versionExperimentRecord(
      experiment,
      { status: "active", approval_references: [approval.id] },
      "records/experiments/bakery-experiment.v0001.yaml",
      clock2,
    );

    const written = [];
    for (const [kind, record, version] of [
      ["decision", decision, 1],
      ["experiment", experiment, 1],
      ["experiment", activeExperiment, 2],
      ["approval", approval, 1],
    ]) {
      const saved = await writeRecord({ projectRoot, kind, id: record.id, version, value: record });
      written.push({ kind, record, saved, version });
    }
    const db = openProjection(workspacePaths(projectRoot).db);
    for (const item of written) {
      projectRecord(db, descriptorFor(item.kind, item.saved, item.record, item.version), item.record);
    }

    assert.equal(readOpportunity(db, "bakery").state, "active");
    assert.equal(readOpportunity(db, "bakery").latest_approval_path, written[3].saved.relativePath);
    assert.deepEqual(readApprovals(db, "bakery").map((row) => ({
      decision: row.decision,
      status: row.status,
      actor: row.actor,
      revoked: row.revoked,
    })), [{ decision: "approved", status: "active", actor: "research", revoked: 0 }]);
    db.close();

    fs.rmSync(workspacePaths(projectRoot).db, { force: true });
    assert.deepEqual(rebuildProjection({ projectRoot, registry }), { recordCount: 4, businessCount: 1 });
    const rebuilt = openProjection(workspacePaths(projectRoot).db);
    assert.equal(readOpportunity(rebuilt, "bakery").state, "active");
    assert.equal(readApprovals(rebuilt, "bakery").length, 1);
    rebuilt.close();
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});
