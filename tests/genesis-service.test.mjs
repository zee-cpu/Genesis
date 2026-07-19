import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSchemaRegistry } from "../src/core/schema-registry.mjs";
import { buildDecisionRecord, versionDecisionRecord } from "../src/core/record-builders.mjs";
import { listRecords, readRecord, writeRecord } from "../src/storage/yaml-record-store.mjs";
import { workspacePaths } from "../src/storage/workspace.mjs";

import { createGenesisService } from "../src/application/genesis-service.mjs";
import { testApprovalSigner, testApprovalVerifier } from "./helpers/test-approval-signatures.mjs";

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

function approvalInput(overrides = {}) {
  return {
    approver_principal_id: "genesis-owner",
    actor: "research",
    rationale: "The preregistered experiment is bounded and ready for manual execution.",
    effective_at: "2026-07-17T12:00:00Z",
    expires_at: "2026-07-24T12:00:00Z",
    review_at: "2026-07-20T12:00:00Z",
    ...overrides,
  };
}

function reflectionInput(overrides = {}) {
  return {
    reviewer: "analyst",
    validation_outcome: "passed",
    domain: "customer_validation",
    tags: ["bakery", "reconciliation"],
    context: "A bounded manual validation with observed bakery sessions.",
    supporting_evidence: ["observed_session_log"],
    contradicting_evidence: ["interview://owner-2"],
    reflection: "The measured reduction met the threshold, but the sample remains small.",
    reusable_lesson: "Validate reconciliation gains with a larger sample before scaling.",
    confidence_update: 0.7,
    valid_from: "2026-07-17T12:00:00Z",
    valid_until: "2026-10-15T12:00:00Z",
    reuse_evidence: [],
    ...overrides,
  };
}

function outcomeDecisionInput(overrides = {}) {
  return {
    approver_principal_id: "genesis-owner",
    actor: "analyst",
    outcome: "pivot",
    rationale: "The threshold passed, but the limited sample supports a narrower follow-up.",
    constitution_review: "No constitutional conflict; this authorizes classification and closure only.",
    evidence_review: "Supporting measurement and preserved counterevidence were reviewed together.",
    ceo_recommendation: "Pivot to a larger bounded validation before any scale action.",
    effective_at: "2026-07-17T12:00:00Z",
    expires_at: "2026-07-24T12:00:00Z",
    review_at: "2026-07-20T12:00:00Z",
    ...overrides,
  };
}

function followUpInput(overrides = {}) {
  return {
    business_id: "bakery-pivot-01",
    target_customer: "Independent bakery owners with recurring reconciliation work",
    problem: "The first sample was too small to justify scale",
    hypothesis: "A larger bounded sample will reproduce the observed time reduction",
    confidence: 0.7,
    source_reference: "experience://bakery-experience-001",
    summary: "The first experiment passed with limited sample quality",
    stance: "support",
    provenance: "Genesis reviewed experience bakery-experience-001",
    privacy_classification: "internal",
    counterevidence: ["interview://owner-2"],
    alternatives: ["archive", "run_smaller_segment_test"],
    expected_outcome: "The larger sample preserves at least a 60-minute reduction",
    metric: "median_reconciliation_minutes",
    decision: "decide_whether_scale_readiness_is_supported",
    owner: "research",
    review_date: "2026-07-31T12:00:00Z",
    ...overrides,
  };
}

function learningLabInput(overrides = {}) {
  return {
    ...followUpInput({
      business_id: "bakery-learning-lab-01",
      problem: "The failed validation needs bounded investigation before another market test",
      hypothesis: "A small learning exercise can identify why the validation failed",
      summary: "The reviewed validation failed and produced a bounded reusable lesson",
      expected_outcome: "The lab identifies one testable cause of failure",
      metric: "validated_failure_causes",
      decision: "decide_whether_a_new_validation_is_warranted",
    }),
    learning_lab: {
      budget: { cash_usd: 1, labor_hours: 2 },
      owner: "research",
      learning_metric: "validated_failure_causes",
      monthly_review: "2026-08-16T12:00:00Z",
      expiry: "2026-10-15T12:00:00Z",
    },
    ...overrides,
  };
}

function createService(projectRoot, confirm = async () => true) {
  return createGenesisService({
    projectRoot,
    repoRoot: ROOT,
    clock,
    confirm,
    approvalSigner: testApprovalSigner,
    approvalVerifier: testApprovalVerifier,
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

await runSection("listOpportunities", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await assert.rejects(
      () => service.list(),
      (error) => error.code === "PROJECTION_STALE" && error.path === "/projection",
    );

    const rebuilt = await service.rebuildIndex();
    assert.equal(rebuilt.businessCount, 0);
    const empty = await service.list();
    assert.equal(empty.count, 0);
    assert.deepEqual(empty.opportunities, []);

    await service.startBusiness(startBusinessInput());
    const discovery = await service.list();
    assert.equal(discovery.count, 1);
    assert.equal(discovery.projection_consistent, true);
    assert.equal(discovery.opportunities[0].business_id, "bakery");
    assert.equal(discovery.opportunities[0].state, "discover");
    assert.equal(discovery.opportunities[0].projected_state, "discover");
    assert.equal(discovery.opportunities[0].next_command, "plan-experiment");
    assert.equal(discovery.opportunities[0].review_due_at, "2026-07-24T12:00:00Z");
    assert.equal(discovery.opportunities[0].review_status, "upcoming");
    assert.equal(discovery.opportunities[0].blocker, null);

    await service.planExperiment("bakery", experimentInput());
    const pending = await service.list();
    assert.equal(pending.opportunities[0].state, "approval_pending");
    assert.equal(pending.opportunities[0].next_command, "review-experiment");
    assert.equal(pending.opportunities[0].review_type, "human_authority_review");
    assert.equal(pending.opportunities[0].review_status, "due");
    assert.equal(pending.opportunities[0].blocker.code, "APPROVAL_REVIEW_REQUIRED");
    const filtered = await service.list({ state: "approval_pending", blocked: true, review: "due" });
    assert.equal(filtered.count, 1);
    assert.equal(filtered.total_count, 1);
    assert.equal((await service.list({ state: "active" })).count, 0);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("searchEvidence", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());
    await service.addEvidence("bakery", addEvidenceInput());

    const matches = await service.searchEvidence("second owner", {
      business: "bakery",
      stance: "contradict",
      privacy: "internal",
    });
    assert.equal(matches.projection_consistent, true);
    assert.equal(matches.count, 1);
    assert.equal(matches.results[0].record_type, "evidence_entry");
    assert.equal(matches.results[0].id, "bakery-evidence-002");
    assert.equal(matches.results[0].stance, "contradict");
    assert.equal((await service.searchEvidence("does-not-exist")).count, 0);
    await assert.rejects(
      () => service.searchEvidence("   "),
      (error) => error.code === "SEARCH_QUERY_REQUIRED",
    );
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("exportReport", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());
    await service.addEvidence("bakery", addEvidenceInput());

    const report = await service.exportReport("bakery");
    assert.equal(report.report_version, "1.0.0");
    assert.equal(report.generated_at, "2026-07-17T12:00:00.000Z");
    assert.equal(report.business_id, "bakery");
    assert.equal(report.lifecycle.state, "discover");
    assert.equal(report.lifecycle.projection_consistent, true);
    assert.equal(report.records.decision.record.target_customer, "Independent bakery owners");
    assert.equal(report.records.decision.version, 2);
    assert.equal(report.records.evidence.length, 2);
    assert.equal(report.records.evidence[0].record.id, "bakery-evidence-001");
    assert.equal(report.records.experiment, null);
    assert.equal(report.audit.record_count, 4);
    assert.deepEqual(report.audit.privacy_classifications, ["internal"]);
    assert.equal(report.audit.source_paths.length, 4);

    fs.rmSync(workspacePaths(projectRoot).db);
    await assert.rejects(
      () => service.exportReport("bakery"),
      (error) => error.code === "PROJECTION_STALE" && error.path === "/projection",
    );
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("appendOnlyCorrectionsAndDraftRevisions", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());

    await assert.rejects(
      () => service.correctDecision("bakery", {
        correction_reason: "Attempted identity rewrite",
        changes: { affected_business: "another-business" },
      }),
      (error) => error.code === "CORRECTION_FIELD_FORBIDDEN",
    );
    const corrected = await service.correctDecision("bakery", {
      correction_reason: "The operator entered the weekly duration incorrectly.",
      changes: {
        problem: "Weekly order reconciliation takes more than three hours",
        confidence: 0.5,
      },
    });
    assert.equal(corrected.state, "discover");
    assert.equal(corrected.status.decision_versions, 2);
    assert.equal(corrected.record.problem, "Weekly order reconciliation takes more than three hours");
    assert.deepEqual(corrected.record.correction.corrected_fields, ["confidence", "problem"]);
    assert.equal(corrected.record.correction.supersedes_version, ".genesis/records/decisions/bakery-decision.v0001.yaml");

    await service.planExperiment("bakery", experimentInput());
    await assert.rejects(
      () => service.correctDecision("bakery", {
        correction_reason: "Too late",
        changes: { problem: "A different problem" },
      }),
      (error) => error.code === "DECISION_CORRECTION_LOCKED",
    );
    await assert.rejects(
      () => service.reviseExperiment("bakery", {
        correction_reason: "Attempted state rewrite",
        changes: { status: "active" },
      }),
      (error) => error.code === "CORRECTION_FIELD_FORBIDDEN",
    );
    const revised = await service.reviseExperiment("bakery", {
      correction_reason: "The baseline unit was entered incorrectly.",
      changes: { baseline: "Owners currently take three hours each week" },
    });
    assert.equal(revised.state, "approval_pending");
    assert.equal(revised.status.experiment_versions, 2);
    assert.equal(revised.record.baseline, "Owners currently take three hours each week");
    assert.equal(revised.record.correction.supersedes_version, ".genesis/records/experiments/bakery-experiment.v0001.yaml");
    assert.deepEqual(revised.record.approval_references, []);

    await service.approveExperiment("bakery", approvalInput());
    await assert.rejects(
      () => service.reviseExperiment("bakery", {
        correction_reason: "Approval must be revoked first.",
        changes: { baseline: "Another baseline" },
      }),
      (error) => error.code === "APPROVAL_REVOCATION_REQUIRED",
    );
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("guidedNextUsesProjectionAndLifecycleState", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());

    const discover = await service.next("bakery");
    assert.equal(discover.state, "discover");
    assert.equal(discover.projected_state, "discover");
    assert.equal(discover.action, "plan_experiment");
    assert.equal(discover.defaults.owner, "research");
    assert.equal(discover.defaults.metric_formula, "weekly_reconciliation_minutes");
    assert.equal(discover.defaults.decision_date, "2026-07-17T12:00:00.000Z");

    await service.planExperiment("bakery", experimentInput());
    const pending = await service.next("bakery");
    assert.equal(pending.projected_state, "approval_pending");
    assert.equal(pending.action, "review_experiment");
    assert.equal(pending.defaults.approver_principal_id, "genesis-owner");
    assert.equal(pending.defaults.actor, "research");
    assert.equal(pending.defaults.effective_at, "2026-07-17T12:00:00.000Z");
    assert.equal(pending.defaults.expires_at, "2026-07-24T12:00:00.000Z");

    await service.approveExperiment("bakery", approvalInput());
    const approved = await service.next("bakery");
    assert.equal(approved.action, "start_experiment");
    assert.equal(approved.defaults.actor, "research");

    await service.startExperiment("bakery", { actor: "research" });
    const active = await service.next("bakery");
    assert.equal(active.projected_state, "active");
    assert.equal(active.action, "record_execution");
    assert.equal(active.defaults.actor, "research");

    const execution = await service.recordExecution("bakery", {
      actor: "research",
      execution_log: ["Completed the preregistered bounded test"],
      deviations: [],
      completion_reason: "completed",
      started_at: "2026-07-17T12:00:00Z",
      completed_at: "2026-07-17T12:00:00Z",
      actual_cost: { cash_usd: 0, labor_hours: 1 },
      data_classes: ["internal"],
      risk_level: "low",
    });
    assert.equal(execution.state, "measurement");
    assert.equal(execution.record.status, "measurement");
    assert.equal((await service.next("bakery")).action, "record_measurement");

    await assert.rejects(
      () => service.recordMeasurement("bakery", {
        reviewer: "analyst",
        actual_result: "Median reconciliation time was 55 minutes",
        comparison: "The result improved on the 120-minute baseline by 65 minutes",
        measurement_evidence: ["observed_session_log"],
        data_quality: { assessment: "limited", limitations: [] },
      }),
      (error) => error.code === "DATA_QUALITY_LIMITATION_REQUIRED",
    );

    const measurement = await service.recordMeasurement("bakery", {
      reviewer: "analyst",
      actual_result: "Median reconciliation time was 55 minutes",
      comparison: "The result improved on the 120-minute baseline by 65 minutes",
      measurement_evidence: ["observed_session_log"],
      data_quality: { assessment: "limited", limitations: ["small_sample"] },
    });
    assert.equal(measurement.state, "reflection");
    assert.equal(measurement.record.status, "reflection");
    assert.equal((await service.next("bakery")).action, "record_reflection");

    const reflection = await service.recordReflection("bakery", reflectionInput());
    assert.equal(reflection.state, "decision");
    assert.equal(reflection.record.record_type, "experience_record");
    assert.equal(reflection.records.some((record) => record.status === "decision"), true);
    assert.equal((await service.next("bakery")).action, "decide_experiment");

    await assert.rejects(
      () => service.decideExperiment("bakery", outcomeDecisionInput({ approver_principal_id: "agent" })),
      (error) => error.code === "HUMAN_AUTHORITY_REQUIRED",
    );
    const decided = await service.decideExperiment("bakery", outcomeDecisionInput());
    assert.equal(decided.state, "outcome_approved");
    assert.equal(decided.record.action_class, "major_bet");
    assert.deepEqual(decided.record.scope.actions, ["close_experiment:bakery-experiment:pivot"]);
    assert.equal((await service.next("bakery")).action, "close_experiment");

    await assert.rejects(
      () => service.closeExperiment("bakery", { actor: "builder" }),
      (error) => error.code === "APPROVAL_ACTOR_MISMATCH",
    );
    const closed = await service.closeExperiment("bakery", { actor: "analyst" });
    assert.equal(closed.state, "closed");
    assert.equal(closed.record.status, "closed");
    const continuation = await service.next("bakery");
    assert.equal(continuation.action, "start_follow_up");
    assert.equal(continuation.defaults.business_id, "bakery-pivot-01");

    await assert.rejects(
      () => service.startFollowUp("bakery", followUpInput({ business_id: "bakery" })),
      (error) => error.code === "FOLLOW_UP_ID_REUSED",
    );
    const followUp = await service.startFollowUp("bakery", followUpInput());
    assert.equal(followUp.state, "discover");
    assert.equal(followUp.business_id, "bakery-pivot-01");
    const followStatus = await service.status("bakery-pivot-01");
    assert.equal(followStatus.state, "discover");
    assert.equal(followStatus.approval_versions, 0);
    const followDecisionDescriptor = listRecords(projectRoot).find((item) => (
      item.kind === "decision" && item.id === "bakery-pivot-01-decision"
    ));
    const followDecision = readRecord(followDecisionDescriptor.absolutePath);
    assert.equal(followDecision.related_records.includes("bakery-experience-001"), true);
    assert.equal((await service.status("bakery")).state, "closed");

    const rebuild = await service.rebuildIndex();
    assert.equal(rebuild.projection_consistent, true);
    assert.equal((await service.status("bakery")).state, "closed");

    fs.rmSync(workspacePaths(projectRoot).db, { force: true });
    await assert.rejects(
      () => service.next("bakery"),
      (error) => error.code === "PROJECTION_STALE" && error.path === "/projection",
    );
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("failedInitiativeCreatesGovernedLearningLab", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());
    await service.planExperiment("bakery", experimentInput());
    await service.approveExperiment("bakery", approvalInput());
    await service.startExperiment("bakery", { actor: "research" });
    await service.recordExecution("bakery", {
      actor: "research",
      execution_log: ["Completed the bounded validation"],
      deviations: [],
      completion_reason: "completed",
      started_at: "2026-07-17T12:00:00Z",
      completed_at: "2026-07-17T12:00:00Z",
      actual_cost: { cash_usd: 0, labor_hours: 1 },
      data_classes: ["internal"],
      risk_level: "low",
    });
    await service.recordMeasurement("bakery", {
      reviewer: "analyst",
      actual_result: "The minimum meaningful effect was not reached",
      comparison: "Observed performance remained at the baseline",
      measurement_evidence: ["observed_session_log"],
      data_quality: { assessment: "adequate", limitations: [] },
    });
    await service.recordReflection("bakery", reflectionInput({
      validation_outcome: "failed",
      reflection: "The preregistered validation failed despite adequate evidence.",
      reusable_lesson: "Investigate the failure cause within a bounded Learning Lab.",
      confidence_update: 0.35,
    }));
    await service.decideExperiment("bakery", outcomeDecisionInput({
      outcome: "learning_lab",
      rationale: "The failed initiative warrants a separately governed bounded learning exercise.",
      ceo_recommendation: "Allocate a small Learning Lab reserve without carrying execution authority forward.",
    }));
    await service.closeExperiment("bakery", { actor: "analyst" });

    const guidance = await service.next("bakery");
    assert.equal(guidance.action, "start_learning_lab");
    assert.equal(guidance.defaults.business_id, "bakery-learning-lab-01");

    const created = await service.startLearningLab("bakery", learningLabInput());
    assert.equal(created.state, "discover");
    assert.equal(created.business_id, "bakery-learning-lab-01");
    const childStatus = await service.status("bakery-learning-lab-01");
    assert.equal(childStatus.approval_versions, 0);
    assert.equal(childStatus.experiment_versions, 0);
    const childDecisionDescriptor = listRecords(projectRoot).find((item) => (
      item.kind === "decision" && item.id === "bakery-learning-lab-01-decision"
    ));
    const childDecision = readRecord(childDecisionDescriptor.absolutePath);
    assert.equal(childDecision.continuation_type, "learning_lab");
    assert.equal(childDecision.parent_business, "bakery");
    assert.deepEqual(childDecision.learning_lab.budget, { cash_usd: 1, labor_hours: 2 });

    const compliantPlan = experimentInput({
      owner: "research",
      metric: {
        ...experimentInput().metric,
        formula: "validated_failure_causes",
      },
      limits: {
        ...experimentInput().limits,
        cash_usd: 1,
        labor_hours: 2,
      },
    });
    await assert.rejects(
      () => service.planExperiment("bakery-learning-lab-01", { ...compliantPlan, owner: "builder" }),
      (error) => error.code === "LEARNING_LAB_OWNER_MISMATCH",
    );
    await assert.rejects(
      () => service.planExperiment("bakery-learning-lab-01", {
        ...compliantPlan,
        metric: { ...compliantPlan.metric, formula: "another_metric" },
      }),
      (error) => error.code === "LEARNING_LAB_METRIC_MISMATCH",
    );
    await assert.rejects(
      () => service.planExperiment("bakery-learning-lab-01", {
        ...compliantPlan,
        limits: { ...compliantPlan.limits, labor_hours: 3 },
      }),
      (error) => error.code === "LEARNING_LAB_BUDGET_EXCEEDED",
    );
    await assert.rejects(
      () => service.planExperiment("bakery-learning-lab-01", {
        ...compliantPlan,
        limits: { ...compliantPlan.limits, duration_days: 100 },
      }),
      (error) => error.code === "LEARNING_LAB_EXPIRY_EXCEEDED",
    );
    const planned = await service.planExperiment("bakery-learning-lab-01", compliantPlan);
    assert.equal(planned.state, "approval_pending");
    assert.equal(planned.record.limits.cash_usd, 1);
    assert.equal(planned.record.metric.formula, "validated_failure_causes");
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
    assert.equal(result.next_command, "review-experiment");
    assert.equal(result.projection_stale, false);
    assert.equal(result.record.status, "draft");
    assert.equal(result.record.validation_outcome, "pending");
    assert.deepEqual(result.record.approval_references, []);

    const status = await service.status("bakery");
    assert.equal(status.state, "approval_pending");
    assert.equal(status.next_command, "review-experiment");
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

await runSection("approvalStartAndRevocation", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());
    await service.planExperiment("bakery", experimentInput());

    const pendingReview = await service.reviewExperiment("bakery");
    assert.equal(pendingReview.state, "approval_pending");
    assert.equal(pendingReview.approval, null);
    assert.equal(pendingReview.approval_validity.blockers[0].code, "APPROVAL_MISSING");

    await assert.rejects(
      () => service.approveExperiment("bakery", approvalInput({ approver_principal_id: "agent" })),
      (error) => error.code === "HUMAN_AUTHORITY_REQUIRED",
    );

    const approved = await service.approveExperiment("bakery", approvalInput());
    assert.equal(approved.state, "approved");
    assert.equal(approved.next_command, "start-experiment");
    assert.equal(approved.record.record_type, "approval_record");
    assert.equal(approved.record.decision, "approved");
    assert.equal(approved.record.scope.wildcard, false);
    assert.deepEqual(approved.record.scope.actions, ["start_experiment:bakery-experiment"]);

    const approvedStatus = await service.status("bakery");
    assert.equal(approvedStatus.state, "approved");
    assert.equal(approvedStatus.approval_versions, 1);
    assert.equal(approvedStatus.approval_validity.valid, true);

    await assert.rejects(
      () => service.startExperiment("bakery", { actor: "builder" }),
      (error) => error.code === "APPROVAL_ACTOR_MISMATCH",
    );

    const started = await service.startExperiment("bakery", { actor: "research" });
    assert.equal(started.state, "active");
    assert.equal(started.record.status, "active");
    assert.deepEqual(started.record.approval_references, ["bakery-experiment-approval"]);

    const executionInput = {
      actor: "research",
      execution_log: ["Completed the bounded test"],
      deviations: [],
      completion_reason: "completed",
      started_at: "2026-07-17T12:00:00Z",
      completed_at: "2026-07-17T12:00:00Z",
      actual_cost: { cash_usd: 0, labor_hours: 1 },
      data_classes: ["internal"],
      risk_level: "low",
    };
    await assert.rejects(
      () => service.recordExecution("bakery", { ...executionInput, actor: "builder" }),
      (error) => error.code === "APPROVAL_ACTOR_MISMATCH",
    );
    await assert.rejects(
      () => service.recordExecution("bakery", {
        ...executionInput,
        actual_cost: { cash_usd: 0, labor_hours: 9 },
      }),
      (error) => error.code === "ACTUAL_EXPOSURE_EXCEEDED" && error.path === "/actual_exposure/labor_hours",
    );

    const revoked = await service.revokeApproval("bakery", {
      approver_principal_id: "genesis-owner",
      rationale: "Human Authority stopped the approved work.",
    });
    assert.equal(revoked.state, "approval_revoked");
    assert.equal(revoked.record.status, "revoked");
    assert.equal(revoked.records.some((record) => record.status === "superseded"), true);

    const revokedStatus = await service.status("bakery");
    assert.equal(revokedStatus.state, "approval_revoked");
    assert.equal(revokedStatus.approval_versions, 2);
    assert.equal(revokedStatus.experiment_versions, 3);
    assert.equal(revokedStatus.approval.revoked, true);

    const rebuild = await service.rebuildIndex();
    assert.deepEqual(rebuild, { recordCount: 7, businessCount: 1, projection_consistent: true });
    assert.equal((await service.status("bakery")).state, "approval_revoked");
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

await runSection("denialCanBeSupersededByExplicitApproval", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());
    await service.planExperiment("bakery", experimentInput());

    const denied = await service.denyExperiment("bakery", {
      approver_principal_id: "genesis-owner",
      actor: "research",
      rationale: "The current evidence is not sufficient.",
    });
    assert.equal(denied.state, "approval_denied");
    assert.equal(denied.record.decision, "denied");
    assert.equal((await service.status("bakery")).state, "approval_denied");
    await assert.rejects(
      () => service.startExperiment("bakery", { actor: "research" }),
      (error) => error.code === "APPROVAL_NOT_ACTIVE",
    );

    const approved = await service.approveExperiment("bakery", approvalInput({
      rationale: "New review supports the bounded experiment.",
    }));
    assert.equal(approved.state, "approved");
    assert.equal(approved.status.approval_versions, 2);
    const review = await service.reviewExperiment("bakery");
    assert.equal(review.approval_history.length, 2);
    assert.equal(review.approval.decision, "approved");
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});
