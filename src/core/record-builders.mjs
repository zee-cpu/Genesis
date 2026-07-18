import { fileURLToPath } from "node:url";

import { GenesisError } from "./errors.mjs";
import { normalizeBusinessId } from "./ids.mjs";
import { createSchemaRegistry } from "./schema-registry.mjs";

const POLICY_VERSION = "2.0.0";
const SCHEMA_VERSION = "1.0.0";
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const registry = createSchemaRegistry(REPO_ROOT);

function timestamp(clock) {
  return clock().toISOString();
}

function approvalTimes(input, now) {
  const issuedAt = input.issued_at ?? now;
  const effectiveAt = input.effective_at ?? issuedAt;
  const expiresAt = input.expires_at;
  const reviewAt = input.review_at ?? issuedAt;
  const values = [issuedAt, effectiveAt, expiresAt, reviewAt].map((value) => Date.parse(value));
  if (
    values.some((value) => !Number.isFinite(value))
    || values[0] > values[1]
    || values[1] >= values[2]
    || values[3] < values[0]
    || values[3] > values[2]
  ) {
    throw new GenesisError("APPROVAL_TIME_INVALID", "Approval timestamps are invalid", {
      path: "/expires_at",
      correction: "Use issued <= effective < expiry with review between issue and expiry",
      escalation: "human_authority",
    });
  }
  return {
    issued_at: issuedAt,
    effective_at: effectiveAt,
    expires_at: expiresAt,
    review_at: reviewAt,
  };
}

function validateApprovalAuthority(input) {
  if (input.approver_principal_id !== "genesis-owner" || input.approver_role !== "human_authority") {
    throw new GenesisError("HUMAN_AUTHORITY_REQUIRED", "Approval must be issued by Genesis Human Authority", {
      path: "/approver_principal_id",
      correction: "Use the real Human Authority principal genesis-owner",
      escalation: "human_authority",
    });
  }
  if (input.requester === input.approver_principal_id) {
    throw new GenesisError("SEPARATION_OF_DUTIES_REQUIRED", "Protected-action requester and approver must differ", {
      path: "/requester",
      correction: "Preserve a requester distinct from genesis-owner",
      escalation: "human_authority",
    });
  }
}

function privacy(input) {
  return input.privacy_classification ?? "internal";
}

function resolveRegistry(options = {}) {
  if (options.registry) {
    return options.registry;
  }

  if (options.repoRoot) {
    return createSchemaRegistry(options.repoRoot);
  }

  return registry;
}

function rejectRestrictedExperimentData(limits) {
  if (limits?.data_classes?.includes("restricted")) {
    throw new GenesisError("SENSITIVE_DATA_FORBIDDEN", "Restricted experiment data is forbidden", {
      path: "/limits/data_classes",
      correction: "Remove restricted from experiment data_classes and keep the workflow within public or internal data",
      escalation: "human_authority",
    });
  }
}

export function buildEvidenceEntry(input, clock, options = {}) {
  const activeRegistry = resolveRegistry(options);
  if (privacy(input) === "restricted") {
    throw new GenesisError("SENSITIVE_DATA_FORBIDDEN", "Restricted evidence is forbidden", {
      path: "/privacy_classification",
      correction: "Use a non-sensitive evidence reference and summary",
      escalation: "human_authority",
    });
  }

  const evidence = {
    id: input.id,
    business_id: normalizeBusinessId(input.business_id),
    collected_at: timestamp(clock),
    source_reference: input.source_reference,
    summary: input.summary,
    stance: input.stance,
    provenance: input.provenance,
    privacy_classification: privacy(input),
  };

  return activeRegistry.validateEvidence(evidence);
}

export function buildDecisionRecord(input, clock, options = {}) {
  const activeRegistry = resolveRegistry(options);
  const businessId = normalizeBusinessId(input.business_id);
  const id = `${businessId}-decision`;
  const now = timestamp(clock);
  const decision = {
    id,
    record_type: "decision_record",
    schema_version: SCHEMA_VERSION,
    policy_version: POLICY_VERSION,
    created_at: now,
    updated_at: now,
    owner: input.owner,
    affected_business: businessId,
    status: "draft",
    evidence_references: input.evidence_references,
    related_records: input.related_records ?? [],
    privacy_classification: privacy(input),
    immutable_history_refs: input.immutable_history_refs
      ?? [`records/decisions/${id}.v0001.yaml`],
    target_customer: input.target_customer,
    problem: input.problem,
    hypothesis: input.hypothesis,
    confidence: input.confidence,
    evidence: input.evidence,
    counterevidence: input.counterevidence,
    alternatives: input.alternatives,
    expected_outcome: input.expected_outcome,
    metric: input.metric,
    decision: input.decision,
    decision_date: now,
    review_date: input.review_date,
    actual_outcome: null,
    confidence_update: null,
  };

  return activeRegistry.validateRecord("decision_record", decision);
}

export function versionDecisionRecord(previous, changes, historyRef, clock, options = {}) {
  const activeRegistry = resolveRegistry(options);
  const decision = {
    ...previous,
    ...changes,
    id: previous.id,
    record_type: "decision_record",
    schema_version: SCHEMA_VERSION,
    policy_version: POLICY_VERSION,
    created_at: previous.created_at,
    updated_at: timestamp(clock),
    affected_business: previous.affected_business,
    immutable_history_refs: [...new Set([
      ...previous.immutable_history_refs,
      historyRef,
    ])],
  };

  return activeRegistry.validateRecord("decision_record", decision);
}

export function buildExperimentRecord(input, clock, options = {}) {
  const activeRegistry = resolveRegistry(options);
  const businessId = normalizeBusinessId(input.business_id);
  const id = `${businessId}-experiment`;
  const now = timestamp(clock);
  rejectRestrictedExperimentData(input.limits);
  const experiment = {
    id,
    record_type: "experiment_record",
    schema_version: SCHEMA_VERSION,
    policy_version: POLICY_VERSION,
    created_at: now,
    updated_at: now,
    owner: input.owner,
    affected_business: businessId,
    status: "draft",
    subtype: "validation",
    validation_outcome: "pending",
    evidence_references: input.evidence_references,
    related_records: input.related_records ?? [],
    privacy_classification: privacy(input),
    immutable_history_refs: input.immutable_history_refs
      ?? [`records/experiments/${id}.v0001.yaml`],
    problem: input.problem,
    supported_decision: input.supported_decision,
    hypothesis: input.hypothesis,
    confidence: input.confidence,
    evidence: input.evidence,
    counterevidence: input.counterevidence,
    baseline: input.baseline,
    comparison_method: input.comparison_method,
    metric: input.metric,
    expected_outcome: input.expected_outcome,
    minimum_meaningful_effect: input.minimum_meaningful_effect,
    failure_conditions: input.failure_conditions,
    stop_conditions: input.stop_conditions,
    limits: input.limits,
    decision_date: input.decision_date,
    allowed_outcomes: ["scale", "pivot", "learning_lab", "archive", "kill"],
    approval_references: [],
  };

  return activeRegistry.validateRecord("experiment_record", experiment);
}

export function versionExperimentRecord(previous, changes, historyRef, clock, options = {}) {
  const activeRegistry = resolveRegistry(options);
  const experiment = {
    ...previous,
    ...changes,
    id: previous.id,
    record_type: "experiment_record",
    schema_version: SCHEMA_VERSION,
    policy_version: POLICY_VERSION,
    created_at: previous.created_at,
    updated_at: timestamp(clock),
    affected_business: previous.affected_business,
    immutable_history_refs: [...new Set([
      ...previous.immutable_history_refs,
      historyRef,
    ])],
  };
  rejectRestrictedExperimentData(experiment.limits);
  return activeRegistry.validateRecord("experiment_record", experiment);
}

export function buildExperienceRecord(input, clock, options = {}) {
  const activeRegistry = resolveRegistry(options);
  const businessId = normalizeBusinessId(input.business_id);
  const id = input.id ?? `${businessId}-experience-001`;
  const now = timestamp(clock);
  const experience = {
    id,
    record_type: "experience_record",
    schema_version: SCHEMA_VERSION,
    policy_version: POLICY_VERSION,
    created_at: now,
    updated_at: now,
    owner: "analyst",
    affected_business: businessId,
    status: input.status ?? "active",
    evidence_references: input.evidence_references,
    related_records: input.related_records,
    privacy_classification: privacy(input),
    immutable_history_refs: input.immutable_history_refs
      ?? [`records/experiences/${id}.v0001.yaml`],
    timestamp: now,
    business: businessId,
    domain: input.domain,
    tags: input.tags,
    context: input.context,
    hypothesis: input.hypothesis,
    decision: input.decision,
    action: input.action,
    outcome: input.outcome,
    baseline: input.baseline,
    expected_result: input.expected_result,
    metric_definition: input.metric_definition,
    actual_result: input.actual_result,
    supporting_evidence: input.supporting_evidence,
    contradicting_evidence: input.contradicting_evidence ?? [],
    confidence: input.confidence,
    valid_from: input.valid_from ?? now,
    valid_until: input.valid_until,
    review_status: "reviewed_experience",
    related: input.related,
    duplicate: input.duplicate ?? [],
    contradicts: input.contradicts ?? [],
    supersedes: input.supersedes ?? [],
    is_correction: false,
    reflection: input.reflection,
    reusable_lesson: input.reusable_lesson,
    reuse_evidence: input.reuse_evidence ?? [],
  };
  return activeRegistry.validateRecord("experience_record", experience);
}

export function versionExperienceRecord(previous, changes, historyRef, clock, options = {}) {
  const activeRegistry = resolveRegistry(options);
  const experience = {
    ...previous,
    ...changes,
    id: previous.id,
    record_type: "experience_record",
    schema_version: SCHEMA_VERSION,
    policy_version: POLICY_VERSION,
    created_at: previous.created_at,
    updated_at: timestamp(clock),
    affected_business: previous.affected_business,
    immutable_history_refs: [...new Set([
      ...previous.immutable_history_refs,
      historyRef,
    ])],
  };
  return activeRegistry.validateRecord("experience_record", experience);
}

export function buildApprovalRecord(input, clock, options = {}) {
  const activeRegistry = resolveRegistry(options);
  validateApprovalAuthority(input);

  const now = timestamp(clock);
  const times = approvalTimes(input, now);
  const approval = {
    id: input.id,
    record_type: "approval_record",
    schema_version: SCHEMA_VERSION,
    policy_version: POLICY_VERSION,
    created_at: now,
    updated_at: now,
    owner: "human_authority",
    affected_business: normalizeBusinessId(input.affected_business),
    status: input.status,
    evidence_references: input.evidence_references,
    related_records: input.related_records ?? [],
    privacy_classification: privacy(input),
    immutable_history_refs: input.immutable_history_refs,
    approver_role: "human_authority",
    approver_principal_id: "genesis-owner",
    requester: input.requester,
    actor: input.actor,
    action_class: input.action_class,
    scope: input.scope,
    evidence_snapshot: input.evidence_snapshot,
    limits: input.limits,
    decision: input.decision,
    rationale: input.rationale,
    ...times,
    revoked: input.revoked ?? false,
    revocation_reference: input.revocation_reference ?? null,
  };
  return activeRegistry.validateRecord("approval_record", approval);
}

export function versionApprovalRecord(previous, changes, historyRef, clock, options = {}) {
  const activeRegistry = resolveRegistry(options);
  const approval = {
    ...previous,
    ...changes,
    id: previous.id,
    record_type: "approval_record",
    schema_version: SCHEMA_VERSION,
    policy_version: POLICY_VERSION,
    created_at: previous.created_at,
    updated_at: timestamp(clock),
    affected_business: previous.affected_business,
    approver_role: "human_authority",
    approver_principal_id: "genesis-owner",
    immutable_history_refs: [...new Set([
      ...previous.immutable_history_refs,
      historyRef,
    ])],
  };
  validateApprovalAuthority(approval);
  approvalTimes(approval, approval.issued_at);
  return activeRegistry.validateRecord("approval_record", approval);
}
