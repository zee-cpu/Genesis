import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { GenesisError } from "../src/core/errors.mjs";
import {
  buildApprovalRecord,
  buildDecisionRecord,
  buildEvidenceEntry,
  buildExperienceRecord,
  buildExperimentRecord,
  versionApprovalRecord,
  versionDecisionRecord,
  versionExperienceRecord,
  versionExperimentRecord,
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
  const registry = createSchemaRegistry(ROOT);
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

  assert.throws(
    () => buildExperimentRecord({
      ...validExperimentInput,
      limits: {
        ...validExperimentInput.limits,
        data_classes: ["internal", "restricted"],
      },
    }, clock),
    (error) => error instanceof GenesisError
      && error.code === "SENSITIVE_DATA_FORBIDDEN"
      && error.path === "/limits/data_classes"
      && error.correction.includes("restricted"),
  );

  const experiment = buildExperimentRecord(validExperimentInput, clock);
  assert.throws(
    () => registry.validateRecord("experiment_record", {
      ...experiment,
      limits: { ...experiment.limits, data_classes: ["restricted"] },
    }),
    (error) => error.code === "RECORD_SCHEMA_INVALID" && error.path === "/limits/data_classes/0",
  );
});

test("decision builder preserves governed Learning Lab continuation fields", () => {
  const decision = buildDecisionRecord({
    ...validDecisionInput,
    business_id: "bakery-learning-lab-01",
    continuation_type: "learning_lab",
    parent_business: "bakery",
    learning_lab: {
      budget: { cash_usd: 1, labor_hours: 2 },
      owner: "research",
      learning_metric: "validated_failure_causes",
      monthly_review: "2026-08-18T00:00:00Z",
      expiry: "2026-10-18T00:00:00Z",
    },
  }, clock);
  assert.equal(decision.continuation_type, "learning_lab");
  assert.equal(decision.parent_business, "bakery");
  assert.equal(decision.learning_lab.owner, "research");
});

test("builders can validate against an injected registry", () => {
  let evidenceCalls = 0;
  let recordCalls = 0;
  const injectedRegistry = {
    validateEvidence(value) {
      evidenceCalls += 1;
      return value;
    },
    validateRecord(recordType, value) {
      recordCalls += 1;
      return { recordType, value };
    },
  };

  const evidence = buildEvidenceEntry({
    id: "bakery-ev-003",
    business_id: "bakery",
    source_reference: "interview://owner-2",
    summary: "Injected registry evidence",
    stance: "support",
    provenance: "User-entered note",
    privacy_classification: "internal",
  }, clock, { registry: injectedRegistry });

  assert.equal(evidenceCalls, 1);
  assert.equal(evidence.privacy_classification, "internal");

  const decision = buildDecisionRecord(validDecisionInput, clock, { registry: injectedRegistry });
  const experiment = buildExperimentRecord(validExperimentInput, clock, { registry: injectedRegistry });

  assert.equal(recordCalls, 2);
  assert.equal(decision.recordType, "decision_record");
  assert.equal(experiment.recordType, "experiment_record");
});

test("approval and experiment versions remain canonical and immutable", () => {
  const experiment = buildExperimentRecord(validExperimentInput, clock);
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
    scope: { actions: [`start_experiment:${experiment.id}`], wildcard: false },
    evidence_snapshot: experiment.evidence_references,
    limits: experiment.limits,
    decision: "approved",
    rationale: "The bounded preregistration is complete and safe to start.",
    effective_at: "2026-07-18T00:00:00Z",
    expires_at: "2026-07-25T00:00:00Z",
    review_at: "2026-07-21T00:00:00Z",
  }, clock);

  assert.equal(approval.record_type, "approval_record");
  assert.equal(approval.approver_principal_id, "genesis-owner");

  const activeExperiment = versionExperimentRecord(
    experiment,
    { status: "active", approval_references: [approval.id] },
    "records/experiments/bakery-experiment.v0001.yaml",
    clock,
  );
  assert.equal(activeExperiment.status, "active");
  assert.deepEqual(activeExperiment.approval_references, [approval.id]);

  const revoked = versionApprovalRecord(
    approval,
    {
      status: "revoked",
      revoked: true,
      revocation_reference: "human://genesis-owner/revocation/2026-07-18",
      rationale: "Approval withdrawn before further work.",
    },
    "records/approvals/bakery-experiment-approval.v0001.yaml",
    clock,
  );
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revoked, true);

  assert.throws(
    () => versionApprovalRecord(
      approval,
      { requester: "genesis-owner" },
      "records/approvals/bakery-experiment-approval.v0001.yaml",
      clock,
    ),
    (error) => error.code === "SEPARATION_OF_DUTIES_REQUIRED",
  );
});

test("experience builders create and close an immutable reviewed lesson", () => {
  const experience = buildExperienceRecord({
    business_id: "bakery",
    evidence_references: ["evidence://bakery/result"],
    related_records: ["bakery-decision", "bakery-experiment"],
    privacy_classification: "internal",
    domain: "customer_validation",
    tags: ["bakery", "reconciliation"],
    context: "A bounded observed validation.",
    hypothesis: "Reconciliation time will fall below one hour.",
    decision: "run_bounded_validation",
    action: "Observed the preregistered sessions.",
    outcome: "Median time was 55 minutes.",
    baseline: "Median time was 120 minutes.",
    expected_result: "Median time below 60 minutes.",
    metric_definition: "sum_minutes_divided_by_sessions",
    actual_result: "Median time was 55 minutes.",
    supporting_evidence: ["evidence://bakery/result"],
    contradicting_evidence: [],
    confidence: 0.7,
    valid_from: "2026-07-18T00:00:00Z",
    valid_until: "2026-10-18T00:00:00Z",
    related: ["bakery-decision", "bakery-experiment"],
    reflection: "The threshold passed with limited evidence.",
    reusable_lesson: "Require a larger bounded sample before scale.",
    reuse_evidence: [],
  }, clock);
  assert.equal(experience.record_type, "experience_record");
  assert.equal(experience.review_status, "reviewed_experience");
  const closed = versionExperienceRecord(
    experience,
    { status: "closed" },
    "records/experiences/bakery-experience-001.v0001.yaml",
    clock,
  );
  assert.equal(closed.status, "closed");
  assert.deepEqual(closed.immutable_history_refs, [
    "records/experiences/bakery-experience-001.v0001.yaml",
  ]);
});
