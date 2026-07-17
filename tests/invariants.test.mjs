import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as validator from "../scripts/validate-genesis.mjs";

const {
  loadPolicySet,
  parseYamlFile,
  validateInvariants,
  validatePolicySet,
} = validator;

const ROOT = path.resolve(import.meta.dirname, "..");

async function loadRequiredPolicySet(...policyIds) {
  const policySet = await loadPolicySet(ROOT);
  for (const policyId of policyIds) {
    assert.equal(
      policySet.policies.has(policyId),
      true,
      `expected manifest policy "${policyId}" to load`,
    );
  }
  return policySet;
}

function loadFixture(name) {
  return parseYamlFile(path.join(ROOT, "tests", "fixtures", "invalid", name));
}

test("governance, organization, and permissions policies load", async () => {
  const policySet = await loadPolicySet(ROOT);
  assert.deepEqual(
    [...policySet.policies.keys()].filter((id) => [
      "governance",
      "organization",
      "permissions",
    ].includes(id)),
    ["governance", "organization", "permissions"],
  );
});

test("Human Authority is human and above CEO", async () => {
  const result = await validatePolicySet(ROOT);
  for (const policyId of ["governance", "organization", "permissions"]) {
    assert.equal(
      result.policySet.policies.has(policyId),
      true,
      `expected manifest policy "${policyId}" to load`,
    );
  }
  assert.equal(result.errors.some((error) => error.code.startsWith("AUTH_")), false);
});

test("loaded policies pass their schemas", async () => {
  const result = await validatePolicySet(ROOT);
  assert.deepEqual(
    result.errors.filter((error) => error.code === "SCHEMA_POLICY"),
    [],
  );
});

test("manifest references cannot escape the repository root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "genesis-path-"));
  await mkdir(path.join(root, "config"));
  await mkdir(path.join(root, "schemas"));
  await writeFile(path.join(root, "config", "safe.yaml"), "id: safe\n", "utf8");
  await writeFile(path.join(root, "schemas", "safe.schema.json"), "{}\n", "utf8");
  await writeFile(
    path.join(root, "genesis.yaml"),
    [
      "policies:",
      "  - { id: safe, path: config/safe.yaml, schema: schemas/safe.schema.json }",
      "  - { id: escaped, path: ../escaped.yaml, schema: schemas/safe.schema.json }",
      "record_templates: []",
      "documents: []",
      "",
    ].join("\n"),
    "utf8",
  );

  const policySet = await loadPolicySet(root);
  assert.equal(policySet.policies.has("safe"), true);
  assert.deepEqual(
    policySet.loadErrors.map(({ code, path: issuePath }) => ({ code, path: issuePath })),
    [{ code: "PATH_TRAVERSAL", path: "/policies/1/path" }],
  );
});

test("an agent cannot occupy Human Authority", async () => {
  const policySet = await loadRequiredPolicySet("governance");
  policySet.policies.get("governance").human_authority.principal_type = "agent";

  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "AUTH_HUMAN_REQUIRED"),
    true,
  );
});

test("Human Authority cannot be delegated", async () => {
  const policySet = await loadRequiredPolicySet("governance");
  policySet.policies.get("governance").human_authority.delegable = true;

  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "AUTH_DELEGATION_FORBIDDEN"),
    true,
  );
});

test("CEO reports directly to Human Authority", async () => {
  const policySet = await loadRequiredPolicySet("organization");
  policySet.policies.get("organization").roles
    .find((role) => role.id === "ceo").reports_to = null;

  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "AUTH_HIERARCHY_INVALID"),
    true,
  );
});

test("every protected action requires Human Authority", async () => {
  const policySet = await loadRequiredPolicySet("permissions");
  policySet.policies.get("permissions").protected_actions[0].required_approver = "ceo";

  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "PROTECTED_APPROVAL_REQUIRED"),
    true,
  );
});

test("organization role references must resolve", async () => {
  const policySet = await loadRequiredPolicySet("organization");
  policySet.policies.get("organization").roles
    .find((role) => role.id === "builder").escalates_to = "unknown_role";

  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "REFERENCE_ROLE_UNKNOWN"),
    true,
  );
});

test("authority-agent fixture is rejected", async () => {
  const policySet = await loadRequiredPolicySet("governance");
  Object.assign(
    policySet.policies.get("governance").human_authority,
    loadFixture("authority-agent.yaml").human_authority,
  );

  assert.deepEqual(
    validateInvariants(policySet)
      .filter((error) => error.code === "AUTH_HUMAN_REQUIRED")
      .map(({ code, path: issuePath }) => ({ code, path: issuePath })),
    [{ code: "AUTH_HUMAN_REQUIRED", path: "/human_authority" }],
  );
});

test("protected-without-human fixture is rejected", async () => {
  const policySet = await loadRequiredPolicySet("permissions");
  const fixture = loadFixture("protected-without-human.yaml");
  Object.assign(
    policySet.policies.get("permissions").protected_actions[0],
    fixture.protected_actions[0],
  );

  assert.deepEqual(
    validateInvariants(policySet)
      .filter((error) => error.code === "PROTECTED_APPROVAL_REQUIRED")
      .map(({ code, path: issuePath }) => ({ code, path: issuePath })),
    [{
      code: "PROTECTED_APPROVAL_REQUIRED",
      path: "/protected_actions/0/required_approver",
    }],
  );
});

test("decision classification honors thresholds and protected precedence", () => {
  assert.equal(typeof validator.classifyDecision, "function");
  const classifyDecision = validator.classifyDecision;

  assert.equal(classifyDecision({
    cashUsd: 500,
    durationDays: 7,
    capacityShare: 0.01,
    riskLevel: "low",
    protectedAction: false,
    constitutionalChange: false,
  }), "micro_experiment");
  assert.equal(classifyDecision({
    cashUsd: 501,
    durationDays: 7,
    capacityShare: 0.01,
    riskLevel: "low",
    protectedAction: false,
    constitutionalChange: false,
  }), "experiment");
  assert.equal(classifyDecision({
    cashUsd: 5001,
    durationDays: 10,
    capacityShare: 0.01,
    riskLevel: "medium",
    protectedAction: false,
    constitutionalChange: false,
  }), "major_bet");
  assert.equal(classifyDecision({
    cashUsd: 1,
    durationDays: 1,
    capacityShare: 0.01,
    riskLevel: "low",
    protectedAction: true,
    constitutionalChange: false,
  }), "protected_action");
  assert.equal(classifyDecision({
    cashUsd: 0,
    durationDays: 1,
    capacityShare: 0,
    riskLevel: "low",
    protectedAction: false,
    constitutionalChange: true,
  }), "constitutional_action");
});

test("decision classification rejects invalid numeric inputs", () => {
  assert.equal(typeof validator.classifyDecision, "function");
  const valid = {
    cashUsd: 0,
    durationDays: 1,
    capacityShare: 0,
    riskLevel: "low",
    protectedAction: false,
    constitutionalChange: false,
  };

  for (const invalid of [
    { cashUsd: -1 },
    { cashUsd: Number.NaN },
    { durationDays: Number.POSITIVE_INFINITY },
    { capacityShare: -0.01 },
  ]) {
    assert.throws(
      () => validator.classifyDecision({ ...valid, ...invalid }),
      /finite non-negative number/,
    );
  }
});

test("decision and portfolio policies load", async () => {
  await loadRequiredPolicySet("decision_policy", "portfolio_policy");
});

test("portfolio allocations total one", async () => {
  const policySet = await loadRequiredPolicySet("portfolio_policy");
  policySet.policies.get("portfolio_policy").modes.bootstrap.allocations.reserve = 0;

  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "ALLOCATION_TOTAL_INVALID"),
    true,
  );
});

test("Bootstrap meta-work is capped at ten percent", async () => {
  const policySet = await loadRequiredPolicySet("portfolio_policy");
  policySet.policies.get("portfolio_policy").modes.bootstrap.system_meta_work_max_share = 0.11;

  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "META_WORK_LIMIT_INVALID"),
    true,
  );
});

test("Bootstrap permits one active business opportunity", async () => {
  const policySet = await loadRequiredPolicySet("portfolio_policy");
  policySet.policies.get("portfolio_policy").modes.bootstrap.active_business_opportunities = 2;

  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "WIP_LIMIT_INVALID"),
    true,
  );
});

test("Micro-Experiment thresholds cannot exceed USD 500 or seven days", async () => {
  const policySet = await loadRequiredPolicySet("decision_policy");
  policySet.policies.get("decision_policy").classes.micro_experiment.cash.max_usd = 501;

  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "DECISION_THRESHOLD_INVALID"),
    true,
  );
});

test("Major Bets require Human Authority", async () => {
  const policySet = await loadRequiredPolicySet("decision_policy");
  policySet.policies.get("decision_policy").classes.major_bet.required_approver = "ceo";

  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "MAJOR_BET_HUMAN_REQUIRED"),
    true,
  );
});

test("allocation-mismatch fixture is rejected", async () => {
  const policySet = await loadRequiredPolicySet("portfolio_policy");
  const fixture = loadFixture("allocation-mismatch.yaml");
  policySet.policies.get("portfolio_policy").modes.bootstrap.allocations =
    fixture.modes.bootstrap.allocations;

  assert.deepEqual(
    validateInvariants(policySet)
      .filter((error) => error.code === "ALLOCATION_TOTAL_INVALID")
      .map(({ code, path: issuePath }) => ({ code, path: issuePath })),
    [{
      code: "ALLOCATION_TOTAL_INVALID",
      path: "/modes/bootstrap/allocations",
    }],
  );
});

test("micro-over-budget fixture is rejected", async () => {
  const policySet = await loadRequiredPolicySet("decision_policy");
  const fixture = loadFixture("micro-over-budget.yaml");
  policySet.policies.get("decision_policy").classes.micro_experiment.cash =
    fixture.classes.micro_experiment.cash;

  assert.deepEqual(
    validateInvariants(policySet)
      .filter((error) => error.code === "DECISION_THRESHOLD_INVALID")
      .map(({ code, path: issuePath }) => ({ code, path: issuePath })),
    [{
      code: "DECISION_THRESHOLD_INVALID",
      path: "/classes/micro_experiment/cash",
    }],
  );
});

function transitionIssues(policySet, workflowId, from, to, context = {}) {
  assert.equal(typeof validator.validateTransition, "function");
  return validator.validateTransition(policySet, workflowId, from, to, context);
}

const COMPLETE_PREREGISTRATION = [
  "problem",
  "supported_decision",
  "hypothesis",
  "confidence",
  "evidence",
  "counterevidence",
  "baseline",
  "comparison_method",
  "metric_formula",
  "metric_population",
  "metric_denominator",
  "metric_data_source",
  "expected_outcome",
  "minimum_meaningful_effect",
  "failure_conditions",
  "stop_conditions",
  "maximum_cash",
  "maximum_labor",
  "maximum_duration",
  "maximum_data",
  "maximum_risk",
  "owner",
  "decision_date",
  "allowed_outcomes",
];

test("business and experiment workflows load and pass their schema", async () => {
  const result = await validatePolicySet(ROOT);
  for (const workflowId of ["business_lifecycle", "experiment_lifecycle"]) {
    assert.equal(result.policySet.policies.has(workflowId), true);
  }
  assert.deepEqual(
    result.errors.filter((error) => error.code === "SCHEMA_POLICY"),
    [],
  );
});

test("Discover may transition to Validate", async () => {
  const policySet = await loadRequiredPolicySet("business_lifecycle");
  assert.deepEqual(
    transitionIssues(policySet, "business_lifecycle", "discover", "validate"),
    [],
  );
});

test("Build requires passed validation or a bounded Human-approved learning prototype", async () => {
  const policySet = await loadRequiredPolicySet("business_lifecycle");

  assert.equal(
    transitionIssues(policySet, "business_lifecycle", "validate", "build")
      .some((error) => error.code === "BUILD_VALIDATION_REQUIRED"),
    true,
  );
  assert.deepEqual(
    transitionIssues(policySet, "business_lifecycle", "validate", "build", {
      recordTypes: [{ id: "experiment_record", subtype: "validation", status: "passed" }],
      approvals: [],
      preregistrationFields: [],
    }),
    [],
  );
  assert.equal(
    transitionIssues(policySet, "business_lifecycle", "validate", "build", {
      recordTypes: [],
      approvals: [{ approver: "human_authority", action: "learning_prototype_exception", valid: true }],
      preregistrationFields: [],
      learningPrototype: {
        budgetCapped: true,
        nonProduction: true,
        expiresAt: "2026-07-16T00:00:00Z",
      },
      now: "2026-07-17T00:00:00Z",
    }).some((error) => error.code === "BUILD_VALIDATION_REQUIRED"),
    true,
  );
  assert.deepEqual(
    transitionIssues(policySet, "business_lifecycle", "validate", "build", {
      recordTypes: [],
      approvals: [{ approver: "human_authority", action: "learning_prototype_exception", valid: true }],
      preregistrationFields: [],
      learningPrototype: {
        budgetCapped: true,
        nonProduction: true,
        expiresAt: "2026-07-31T00:00:00Z",
      },
      now: "2026-07-17T00:00:00Z",
    }),
    [],
  );
});

test("Build may transition to Launch only with Human Authority approval", async () => {
  const policySet = await loadRequiredPolicySet("business_lifecycle");
  assert.equal(
    transitionIssues(policySet, "business_lifecycle", "build", "launch")
      .some((error) => error.code === "LAUNCH_HUMAN_APPROVAL_REQUIRED"),
    true,
  );
  assert.deepEqual(
    transitionIssues(policySet, "business_lifecycle", "build", "launch", {
      recordTypes: [],
      approvals: [{ approver: "human_authority", action: "launch", valid: true }],
      preregistrationFields: [],
    }),
    [],
  );
});

test("Review supports every approved terminal business outcome", async () => {
  const policySet = await loadRequiredPolicySet("business_lifecycle");
  for (const outcome of ["scale", "pivot", "learning_lab", "archive", "kill"]) {
    assert.deepEqual(
      transitionIssues(policySet, "business_lifecycle", "review", outcome),
      [],
    );
  }
});

test("Draft cannot transition directly to Running", async () => {
  const policySet = await loadRequiredPolicySet("experiment_lifecycle");
  assert.equal(
    transitionIssues(policySet, "experiment_lifecycle", "draft", "running")
      .some((error) => error.code === "WORKFLOW_TRANSITION_INVALID"),
    true,
  );
});

test("experiment Approval requires its approver and complete preregistration", async () => {
  const policySet = await loadRequiredPolicySet("experiment_lifecycle");
  const approval = [{ approver: "ceo", action: "experiment", valid: true }];

  assert.equal(
    transitionIssues(policySet, "experiment_lifecycle", "approval", "running", {
      recordTypes: [],
      approvals: approval,
      preregistrationFields: COMPLETE_PREREGISTRATION.slice(1),
    }).some((error) => error.code === "EXPERIMENT_PREREGISTRATION_INCOMPLETE"),
    true,
  );
  assert.equal(
    transitionIssues(policySet, "experiment_lifecycle", "approval", "running", {
      recordTypes: [],
      approvals: [],
      preregistrationFields: COMPLETE_PREREGISTRATION,
    }).some((error) => error.code === "EXPERIMENT_PREREGISTRATION_INCOMPLETE"),
    true,
  );
  assert.deepEqual(
    transitionIssues(policySet, "experiment_lifecycle", "approval", "running", {
      recordTypes: [],
      approvals: approval,
      preregistrationFields: COMPLETE_PREREGISTRATION,
    }),
    [],
  );
});

test("experiment closure requires actuals, reflection, decision, and Experience linkage", async () => {
  const policySet = await loadRequiredPolicySet("experiment_lifecycle");
  const required = policySet.policies.get("experiment_lifecycle").closure_required_fields;

  assert.equal(
    transitionIssues(policySet, "experiment_lifecycle", "decision", "closed", {
      closureFields: required.slice(1),
    }).some((error) => error.code === "WORKFLOW_TRANSITION_INVALID"),
    true,
  );
  assert.deepEqual(
    transitionIssues(policySet, "experiment_lifecycle", "decision", "closed", {
      closureFields: required,
    }),
    [],
  );

  policySet.policies.get("experiment_lifecycle").closure_required_fields.shift();
  assert.equal(
    validateInvariants(policySet).some((error) => (
      error.code === "WORKFLOW_TRANSITION_INVALID"
      && error.path === "/closure_required_fields"
    )),
    true,
  );
});

test("workflow role and record references must resolve", async () => {
  const policySet = await loadRequiredPolicySet("business_lifecycle");
  const discover = policySet.policies.get("business_lifecycle").states[0];
  discover.accountable_role = "unknown_role";
  discover.output_record = "unknown_record";
  const errors = validateInvariants(policySet);

  assert.equal(errors.some((error) => error.code === "WORKFLOW_ROLE_UNKNOWN"), true);
  assert.equal(errors.some((error) => error.code === "WORKFLOW_RECORD_UNKNOWN"), true);
});

test("forbidden-transition fixture is rejected", async () => {
  const policySet = await loadRequiredPolicySet("experiment_lifecycle");
  const fixture = loadFixture("forbidden-transition.yaml");
  assert.deepEqual(
    transitionIssues(
      policySet,
      "experiment_lifecycle",
      fixture.from,
      fixture.to,
      { recordTypes: [], approvals: [], preregistrationFields: [] },
    )
      .filter((error) => error.code === "WORKFLOW_TRANSITION_INVALID")
      .map(({ code }) => ({ code })),
    [{ code: "WORKFLOW_TRANSITION_INVALID" }],
  );
});

const REQUIRED_METRIC_FIELDS = [
  "formula",
  "unit",
  "population",
  "denominator",
  "source",
  "cadence",
  "owner",
  "baseline",
  "target",
  "guardrails",
];

const REQUIRED_METRIC_IDS = [
  "forecast_calibration",
  "decision_cycle_time",
  "assumptions_tested_before_build",
  "avoidable_rework",
  "realized_value_per_experiment",
  "lesson_reuse_rate",
  "experience_retrieval_success",
  "system_overhead_ratio",
  "customer_reality_ratio",
  "policy_exception_rate",
  "protected_action_denial_and_escalation",
];

test("Experience, risk, and metrics policies load and pass their schemas", async () => {
  const result = await validatePolicySet(ROOT);
  for (const policyId of ["experience_policy", "risk_policy", "metrics_policy"]) {
    assert.equal(result.policySet.policies.has(policyId), true);
  }
  assert.deepEqual(
    result.errors.filter((error) => error.code === "SCHEMA_POLICY"),
    [],
  );
});

test("Experience promotion is ordered and broad principles remain evidence-safe", async () => {
  const policySet = await loadRequiredPolicySet("experience_policy");
  const policy = policySet.policies.get("experience_policy");
  assert.deepEqual(policy.promotion_order, [
    "raw_event",
    "reviewed_experience",
    "validated_lesson",
    "principle",
  ]);

  policy.promotion.principle.replicated_evidence_or_human_approval_required = false;
  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "EXPERIENCE_PROMOTION_UNSAFE"),
    true,
  );
});

test("Experience corrections require explicit supersession", async () => {
  const policySet = await loadRequiredPolicySet("experience_policy");
  policySet.policies.get("experience_policy")
    .immutable_evidence.corrections.require_supersedes = false;

  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "EXPERIENCE_SUPERSESSION_REQUIRED"),
    true,
  );
});

test("high and critical risk are protected and uncertainty raises risk", async () => {
  const policySet = await loadRequiredPolicySet("risk_policy", "permissions");
  const policy = policySet.policies.get("risk_policy");
  const levelIds = policy.levels.map((level) => level.id);
  assert.deepEqual(levelIds, ["low", "medium", "high", "critical"]);
  for (const action of policySet.policies.get("permissions").protected_actions) {
    assert.equal(levelIds.includes(action.risk_floor), true, action.id);
  }
  for (const levelId of ["high", "critical"]) {
    const level = policy.levels.find((candidate) => candidate.id === levelId);
    assert.equal(level.protected_action, true);
    assert.equal(level.required_approver, "human_authority");
  }
  assert.equal(policy.unresolved_material_uncertainty.minimum_level_increase, 1);

  policy.levels.find((level) => level.id === "high").protected_action = false;
  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "RISK_PROTECTED_MISMATCH"),
    true,
  );
});

test("consequential AI actions require model, tool, evidence, review, and verification context", async () => {
  const policySet = await loadRequiredPolicySet("risk_policy");
  assert.deepEqual(
    policySet.policies.get("risk_policy").consequential_ai.required_context,
    ["model_identity", "model_version", "material_tool_context", "evidence_sources", "reviewer", "verification_outcome"],
  );
});

test("every required metric has complete calculation metadata and a known owner", async () => {
  const policySet = await loadRequiredPolicySet("metrics_policy", "organization");
  const metrics = policySet.policies.get("metrics_policy").metrics;
  assert.deepEqual(metrics.map((metric) => metric.id), REQUIRED_METRIC_IDS);
  for (const metric of metrics) {
    for (const field of REQUIRED_METRIC_FIELDS) {
      assert.notEqual(metric[field], undefined, `${metric.id}.${field}`);
    }
  }

  metrics[0].formula = "";
  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "METRIC_DEFINITION_INCOMPLETE"),
    true,
  );
});

test("Genesis Experiment #001 excludes document volume and preregisters its baseline", async () => {
  const policySet = await loadRequiredPolicySet("metrics_policy");
  const experiment = policySet.policies.get("metrics_policy").genesis_experiment_001;
  assert.equal(experiment.excluded_success_measures.includes("documentation_volume"), true);
  assert.deepEqual(experiment.metric_ids, REQUIRED_METRIC_IDS);
  assert.equal(experiment.pre_use_required, true);

  experiment.baseline_period = "";
  assert.equal(
    validateInvariants(policySet).some((error) => error.code === "EXPERIMENT_001_BASELINE_REQUIRED"),
    true,
  );
});
