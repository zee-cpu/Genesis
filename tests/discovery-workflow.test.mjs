import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import YAML from "yaml";

import {
  buildStatus,
  evaluateDiscoverGate,
  experimentCompleteness,
} from "../src/core/discovery-workflow.mjs";
import { calculateMetrics } from "../src/core/metrics.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKFLOW_PATH = path.join(ROOT, "config", "workflows", "experiment-lifecycle.yaml");

async function loadRequiredPaths() {
  const workflow = YAML.parse(await readFile(WORKFLOW_PATH, "utf8"));
  return workflow.preregistration_required_fields.map((field) => `/${field.replaceAll(".", "/")}`);
}

function makeDecision(overrides = {}) {
  return {
    target_customer: "Independent bakery owners",
    problem: "Weekly order reconciliation takes too long",
    hypothesis: "A clearer order view will reduce reconciliation time",
    ...overrides,
  };
}

function makeExperiment(overrides = {}) {
  return {
    id: "bakery-experiment",
    record_type: "experiment_record",
    schema_version: "1.0.0",
    policy_version: "2.0.0",
    created_at: "2026-07-16T00:00:00Z",
    updated_at: "2026-07-16T00:00:00Z",
    owner: "research",
    affected_business: "bakery",
    status: "draft",
    subtype: "validation",
    validation_outcome: "pending",
    evidence_references: ["evidence://bakery/interview-1"],
    related_records: ["bakery-decision"],
    privacy_classification: "internal",
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
    decision_date: "2026-07-18T00:00:00Z",
    allowed_outcomes: ["scale", "pivot", "learning_lab", "archive", "kill"],
    approval_references: [],
    ...overrides,
  };
}

test("Discover gate blocks missing target customer, problem, hypothesis, and zero evidence separately", () => {
  const evidence = [{
    id: "bakery-evidence-001",
    business_id: "bakery",
    collected_at: "2026-07-14T00:00:00Z",
    source_reference: "interview://owner-1",
    summary: "Owner spends two hours on reconciliation every week",
    stance: "support",
    provenance: "Interview note",
    privacy_classification: "internal",
  }];

  for (const [field, pathName, evidenceInput, overrides] of [
    ["target_customer", "/target_customer", evidence, { target_customer: "   " }],
    ["problem", "/problem", evidence, { problem: " " }],
    ["hypothesis", "/hypothesis", evidence, { hypothesis: null }],
    ["evidence", "/evidence", [], {}],
  ]) {
    const result = evaluateDiscoverGate({
      decision: makeDecision(overrides),
      evidence: evidenceInput,
    });

    assert.equal(result.passed, false);
    assert.deepEqual(result.blockers, [{
      code: "DISCOVER_GATE_BLOCKED",
      path: pathName,
      correction: field === "evidence"
        ? "Add at least one confirmed evidence entry"
        : `Provide ${field.replaceAll("_", " ")}`,
      escalation: "builder",
    }]);
  }
});

test("Discover gate passes when the decision has the required fields and one evidence entry exists", () => {
  const evidence = [{
    id: "bakery-evidence-001",
    business_id: "bakery",
    collected_at: "2026-07-14T00:00:00Z",
    source_reference: "interview://owner-1",
    summary: "Owner spends two hours on reconciliation every week",
    stance: "support",
    provenance: "Interview note",
    privacy_classification: "internal",
  }];

  assert.deepEqual(
    evaluateDiscoverGate({
      decision: makeDecision(),
      evidence,
    }),
    { passed: true, blockers: [] },
  );
});

test("experimentCompleteness reads the workflow preregistration requirements from YAML", async () => {
  const requiredPaths = await loadRequiredPaths();
  const result = experimentCompleteness(makeExperiment());

  assert.deepEqual(result.required, requiredPaths);
  assert.equal(result.complete, true);
  assert.equal(result.ratio, 1);
  assert.deepEqual(result.missing, []);
  assert.equal(result.present.length, requiredPaths.length);
});

test("experimentCompleteness reports exact JSON-pointer-like missing paths", () => {
  const result = experimentCompleteness(makeExperiment({
    problem: "",
    metric: {
      formula: " ",
      population: "qualified_bakery_owners",
      denominator: "completed_reconciliation_sessions",
      data_source: "observed_session_log",
    },
    limits: {
      cash_usd: null,
      labor_hours: 8,
      duration_days: 7,
      data_classes: [],
      risk_level: "low",
    },
    decision_date: undefined,
    allowed_outcomes: [],
  }));

  assert.equal(result.complete, false);
  assert.equal(result.ratio < 1, true);
  assert.deepEqual(result.missing, [
    "/problem",
    "/metric/formula",
    "/limits/cash_usd",
    "/limits/data_classes",
    "/decision_date",
    "/allowed_outcomes",
  ]);
});

test("buildStatus reports approval_pending and supported metrics for a complete draft experiment", () => {
  const decisionVersions = [
    {
      version: 1,
      created_at: "2026-07-14T00:00:00Z",
      confidence: 0.4,
      target_customer: "Independent bakery owners",
      problem: "Weekly order reconciliation takes too long",
      hypothesis: "A clearer order view will reduce reconciliation time",
    },
    {
      version: 2,
      created_at: "2026-07-15T00:00:00Z",
      confidence: 0.6,
      target_customer: "Independent bakery owners",
      problem: "Weekly order reconciliation takes too long",
      hypothesis: "A clearer order view will reduce reconciliation time",
    },
  ];
  const experimentVersions = [makeExperiment()];
  const evidence = [
    {
      id: "bakery-evidence-001",
      business_id: "bakery",
      collected_at: "2026-07-14T00:00:00Z",
      source_reference: "interview://owner-1",
      summary: "Owner spends two hours on reconciliation every week",
      stance: "support",
      provenance: "Interview note",
      privacy_classification: "internal",
    },
    {
      id: "bakery-evidence-002",
      business_id: "bakery",
      collected_at: "2026-07-15T00:00:00Z",
      source_reference: "interview://owner-2",
      summary: "Another owner also wants the same flow",
      stance: "support",
      provenance: "Interview note",
      privacy_classification: "internal",
    },
    {
      id: "bakery-evidence-003",
      business_id: "bakery",
      collected_at: "2026-07-15T00:00:00Z",
      source_reference: "interview://owner-3",
      summary: "A separate owner prefers the current process",
      stance: "contradict",
      provenance: "Interview note",
      privacy_classification: "internal",
    },
  ];
  const blockedCommands = [{ code: "DISCOVER_GATE_BLOCKED" }];

  const metrics = calculateMetrics({
    decisionVersions,
    experimentVersions,
    evidence,
    blockedCommands,
    consistency: { consistent: true },
    now: "2026-07-17T00:00:00Z",
  });

  assert.deepEqual(metrics, {
    supporting_evidence_count: 2,
    contradicting_evidence_count: 1,
    discover_days: 3,
    time_to_validation_plan_days: 2,
    preregistration_completeness: 1,
    confidence_history: [0.4, 0.6],
    blocked_commands_by_code: { DISCOVER_GATE_BLOCKED: 1 },
    projection_consistent: true,
  });

  const status = buildStatus({
    decisionVersions,
    experimentVersions,
    evidence,
    blockedCommands,
    consistency: { consistent: true },
    now: "2026-07-17T00:00:00Z",
  });

  assert.equal(status.state, "approval_pending");
  assert.equal(status.next_command, "status");
  assert.equal(status.experiment_completeness.ratio, 1);
  assert.deepEqual(status.metrics, metrics);
});

test("buildStatus reports missing preregistration paths for incomplete drafts", () => {
  const status = buildStatus({
    decisionVersions: [{
      version: 1,
      created_at: "2026-07-14T00:00:00Z",
      confidence: 0.4,
      target_customer: "Independent bakery owners",
      problem: "Weekly order reconciliation takes too long",
      hypothesis: "A clearer order view will reduce reconciliation time",
    }],
    experimentVersions: [makeExperiment({
      problem: "",
      metric: {
        formula: " ",
        population: "qualified_bakery_owners",
        denominator: "completed_reconciliation_sessions",
        data_source: "observed_session_log",
      },
      limits: {
        cash_usd: null,
        labor_hours: 8,
        duration_days: 7,
        data_classes: [],
        risk_level: "low",
      },
      decision_date: undefined,
      allowed_outcomes: [],
    })],
    evidence: [{
      id: "bakery-evidence-001",
      business_id: "bakery",
      collected_at: "2026-07-14T00:00:00Z",
      source_reference: "interview://owner-1",
      summary: "Owner spends two hours on reconciliation every week",
      stance: "support",
      provenance: "Interview note",
      privacy_classification: "internal",
    }],
    blockedCommands: [],
    consistency: true,
    now: "2026-07-17T00:00:00Z",
  });

  assert.equal(status.state, "discover");
  assert.equal(status.next_command, "status");
  assert.equal(status.experiment_completeness.complete, false);
  assert.equal(status.experiment_completeness.missing.includes("/metric/formula"), true);
  assert.equal(status.experiment_completeness.missing.includes("/limits/cash_usd"), true);
  assert.equal(status.experiment_completeness.missing.includes("/decision_date"), true);
});

test("buildStatus preserves non-draft experiment lifecycle states", () => {
  for (const experimentStatus of ["active", "closed", "superseded"]) {
    const status = buildStatus({
      decisionVersions: [makeDecision({ version: 1, confidence: 0.5 })],
      experimentVersions: [makeExperiment({ status: experimentStatus })],
      evidence: [{ stance: "support" }],
      consistency: true,
      now: "2026-07-17T00:00:00Z",
    });

    assert.equal(status.state, experimentStatus);
    assert.equal(status.next_command, "status");
  }
});
