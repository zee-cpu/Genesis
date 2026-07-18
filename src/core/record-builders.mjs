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
