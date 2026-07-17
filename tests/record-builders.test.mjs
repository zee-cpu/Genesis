import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { GenesisError } from "../src/core/errors.mjs";
import {
  buildDecisionRecord,
  buildEvidenceEntry,
  buildExperimentRecord,
  versionDecisionRecord,
} from "../src/core/record-builders.mjs";
import { createSchemaRegistry } from "../src/core/schema-registry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clock = () => new Date("2026-07-18T00:00:00Z");

const validDecisionInput = {
  business_id: "bakery",
  owner: "research",
  evidence_references: ["evidence://bakery/owner-1"],
  related_records: [],
  immutable_history_refs: ["records/decisions/bakery-decision.v0001.yaml"],
  target_customer: "Independent bakery owners",
  problem: "Order reconciliation takes two hours each week",
  hypothesis: "A consolidated order view will reduce reconciliation time",
  confidence: 0.55,
  evidence: ["evidence://bakery/owner-1"],
  counterevidence: [],
  alternatives: ["keep_manual_process", "use_spreadsheet_template"],
  expected_outcome: "Weekly reconciliation takes less than one hour",
  metric: "weekly_reconciliation_minutes",
  decision: "plan_bounded_validation",
  review_date: "2026-07-25T00:00:00Z",
};

const validExperimentInput = {
  business_id: "bakery",
  owner: "research",
  evidence_references: ["evidence://bakery/owner-1"],
  related_records: ["bakery-decision"],
  immutable_history_refs: ["records/experiments/bakery-experiment.v0001.yaml"],
  problem: "Determine whether the order view reduces reconciliation time",
  supported_decision: "bakery-decision",
  hypothesis: "Bakery owners complete reconciliation in less than one hour",
  confidence: 0.55,
  evidence: ["evidence://bakery/owner-1"],
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
  decision_date: "2026-07-25T00:00:00Z",
};

test("builders produce schema-valid evidence and canonical records", async () => {
  const registry = await createSchemaRegistry(ROOT);
  const evidence = buildEvidenceEntry({
    id: "bakery-ev-001",
    business_id: "bakery",
    source_reference: "interview://owner-1",
    summary: "Owner loses two hours weekly reconciling orders",
    stance: "support",
    provenance: "User-entered interview note",
    privacy_classification: "internal",
  }, clock);

  assert.equal(registry.validateEvidence(evidence), evidence);
  assert.equal(evidence.collected_at, "2026-07-18T00:00:00.000Z");

  const decision = buildDecisionRecord(validDecisionInput, clock);
  assert.equal(registry.validateRecord("decision_record", decision), decision);
  assert.equal(decision.id, "bakery-decision");
  assert.equal(decision.created_at, "2026-07-18T00:00:00.000Z");
  assert.equal(decision.updated_at, decision.created_at);
  assert.equal(decision.privacy_classification, "internal");

  const v2 = versionDecisionRecord(
    decision,
    { confidence: 0.65 },
    "records/decisions/bakery-decision.v0001.yaml",
    clock,
  );
  assert.deepEqual(v2.immutable_history_refs, [
    "records/decisions/bakery-decision.v0001.yaml",
  ]);
  assert.equal(v2.confidence, 0.65);
  assert.equal(registry.validateRecord("decision_record", v2), v2);

  const experiment = buildExperimentRecord(validExperimentInput, clock);
  assert.equal(registry.validateRecord("experiment_record", experiment), experiment);
  assert.equal(experiment.id, "bakery-experiment");
  assert.deepEqual(experiment.approval_references, []);
  assert.equal(experiment.validation_outcome, "pending");
  for (const field of [
    "actual_cost",
    "results",
    "reflection",
    "outcome",
    "experience_reference",
    "confidence_update",
    "decision_outcome",
  ]) {
    assert.equal(Object.hasOwn(experiment, field), false, field);
  }
});

test("builders reject restricted evidence and schema-invalid records", () => {
  assert.throws(
    () => buildEvidenceEntry({
      id: "bakery-ev-002",
      business_id: "bakery",
      source_reference: "file://restricted-note",
      summary: "Sensitive evidence",
      stance: "support",
      provenance: "User-entered note",
      privacy_classification: "restricted",
    }, clock),
    (error) => error instanceof GenesisError
      && error.code === "SENSITIVE_DATA_FORBIDDEN"
      && error.path === "/privacy_classification",
  );

  assert.throws(
    () => buildDecisionRecord({ ...validDecisionInput, confidence: 1.01 }, clock),
    (error) => error instanceof GenesisError
      && error.code === "RECORD_SCHEMA_INVALID"
      && error.path === "/confidence"
      && error.correction.includes("must be <= 1")
      && error.escalation === "builder",
  );
});
