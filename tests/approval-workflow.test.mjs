import assert from "node:assert/strict";
import test from "node:test";

import {
  actionClassForLimits,
  evaluateExperimentApproval,
  experimentApprovalAction,
  requireExperimentApproval,
} from "../src/core/approval-workflow.mjs";

function experiment(overrides = {}) {
  return {
    id: "bakery-experiment",
    limits: {
      cash_usd: 0,
      labor_hours: 8,
      duration_days: 7,
      data_classes: ["internal"],
      risk_level: "low",
    },
    ...overrides,
  };
}

function approval(overrides = {}) {
  return {
    id: "bakery-experiment-approval",
    status: "active",
    decision: "approved",
    revoked: false,
    approver_role: "human_authority",
    approver_principal_id: "genesis-owner",
    requester: "research",
    actor: "research",
    scope: { actions: [experimentApprovalAction("bakery-experiment")], wildcard: false },
    related_records: ["bakery-experiment"],
    limits: experiment().limits,
    effective_at: "2026-07-18T00:00:00Z",
    expires_at: "2026-07-25T00:00:00Z",
    ...overrides,
  };
}

test("valid Human Authority approval covers the exact experiment and actor", () => {
  const result = evaluateExperimentApproval({
    approval: approval(),
    experiment: experiment(),
    actor: "research",
    now: "2026-07-19T00:00:00Z",
  });
  assert.deepEqual(result, { valid: true, blockers: [] });
  assert.equal(requireExperimentApproval({
    approval: approval(),
    experiment: experiment(),
    actor: "research",
    now: "2026-07-19T00:00:00Z",
  }).id, "bakery-experiment-approval");
});

test("approval validation fails closed for every material mismatch", () => {
  for (const [code, approvalChanges, experimentChanges, actor, now] of [
    ["APPROVAL_REVOKED", { status: "revoked", revoked: true }, {}, "research", "2026-07-19T00:00:00Z"],
    ["APPROVAL_NOT_ACTIVE", { status: "closed", decision: "denied" }, {}, "research", "2026-07-19T00:00:00Z"],
    ["APPROVAL_APPROVER_INVALID", { approver_principal_id: "agent" }, {}, "research", "2026-07-19T00:00:00Z"],
    ["SEPARATION_OF_DUTIES_REQUIRED", { requester: "genesis-owner" }, {}, "research", "2026-07-19T00:00:00Z"],
    ["APPROVAL_SCOPE_MISMATCH", { scope: { actions: ["other"], wildcard: false } }, {}, "research", "2026-07-19T00:00:00Z"],
    ["APPROVAL_EXPERIMENT_MISMATCH", { related_records: ["other"] }, {}, "research", "2026-07-19T00:00:00Z"],
    ["APPROVAL_ACTOR_MISMATCH", {}, {}, "builder", "2026-07-19T00:00:00Z"],
    ["APPROVAL_LIMIT_MISMATCH", { limits: { ...approval().limits, labor_hours: 2 } }, {}, "research", "2026-07-19T00:00:00Z"],
    ["APPROVAL_NOT_EFFECTIVE", {}, {}, "research", "2026-07-17T00:00:00Z"],
    ["APPROVAL_EXPIRED", {}, {}, "research", "2026-07-25T00:00:00Z"],
  ]) {
    const result = evaluateExperimentApproval({
      approval: approval(approvalChanges),
      experiment: experiment(experimentChanges),
      actor,
      now,
    });
    assert.equal(result.valid, false, code);
    assert.equal(result.blockers.some((item) => item.code === code), true, code);
  }

  assert.equal(evaluateExperimentApproval({
    approval: null,
    experiment: experiment(),
    actor: "research",
    now: "2026-07-19T00:00:00Z",
  }).blockers[0].code, "APPROVAL_MISSING");
});

test("action classification follows the experiment risk envelope", () => {
  assert.equal(actionClassForLimits(experiment().limits), "micro_experiment");
  assert.equal(actionClassForLimits({ ...experiment().limits, risk_level: "medium" }), "experiment");
  assert.equal(actionClassForLimits({ ...experiment().limits, cash_usd: 5001 }), "major_bet");
  assert.equal(actionClassForLimits({ ...experiment().limits, duration_days: 31 }), "major_bet");
  assert.equal(actionClassForLimits({ ...experiment().limits, risk_level: "high" }), "protected_action");
});
