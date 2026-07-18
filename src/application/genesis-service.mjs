import fs from "node:fs";
import path from "node:path";

import { actionClassForLimits, evaluateExperimentApproval, evaluateOutcomeApproval, experimentApprovalAction, outcomeApprovalAction, requireExperimentApproval, requireOutcomeApproval } from "../core/approval-workflow.mjs";
import { buildApprovalRecord, buildDecisionRecord, buildEvidenceEntry, buildExperienceRecord, buildExperimentRecord, versionApprovalRecord, versionDecisionRecord, versionExperienceRecord, versionExperimentRecord } from "../core/record-builders.mjs";
import { evaluateDiscoverGate, buildStatus } from "../core/discovery-workflow.mjs";
import { GenesisError } from "../core/errors.mjs";
import { normalizeBusinessId } from "../core/ids.mjs";
import { createSchemaRegistry } from "../core/schema-registry.mjs";
import { listRecords, readRecord, writeRecords } from "../storage/yaml-record-store.mjs";
import { openProjection, projectRecord, projectionConsistency, readOpportunities, readOpportunity, recordBlockedCommand, rebuildProjection } from "../storage/projection.mjs";
import { withWorkspaceLock, workspacePaths } from "../storage/workspace.mjs";

const DEFAULT_CONFIRM = async () => true;
const DEFAULT_CLOCK = () => new Date();
const RISK_LEVELS = ["low", "medium", "high", "critical"];

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

function toRecordEntries(projectRoot) {
  return listRecords(projectRoot).map((descriptor) => ({
    descriptor,
    record: readRecord(descriptor.absolutePath),
  }));
}

function latestByVersion(entries) {
  return [...entries].sort((left, right) => left.descriptor.version - right.descriptor.version).at(-1) ?? null;
}

function businessEntries(projectRoot, businessId) {
  const normalized = normalizeBusinessId(businessId);
  const entries = toRecordEntries(projectRoot).filter(({ descriptor, record }) => (
    (descriptor.kind === "decision" && record.affected_business === normalized)
    || (descriptor.kind === "approval" && record.affected_business === normalized)
    || (descriptor.kind === "experiment" && record.affected_business === normalized)
    || (descriptor.kind === "experience" && record.affected_business === normalized)
    || (descriptor.kind === "evidence" && record.business_id === normalized)
  ));

  return {
    entries,
    decisionEntries: entries.filter(({ descriptor }) => descriptor.kind === "decision"),
    approvalEntries: entries.filter(({ descriptor }) => descriptor.kind === "approval"),
    experimentEntries: entries.filter(({ descriptor }) => descriptor.kind === "experiment"),
    experienceEntries: entries.filter(({ descriptor }) => descriptor.kind === "experience"),
    evidenceEntries: entries.filter(({ descriptor }) => descriptor.kind === "evidence"),
  };
}

function ensureBusinessExists(decisionEntries, businessId) {
  if (decisionEntries.length === 0) {
    throw new GenesisError("BUSINESS_NOT_FOUND", "Business opportunity does not exist", {
      path: "/business_id",
      correction: "Start the business opportunity before adding evidence or planning an experiment",
      escalation: "builder",
    });
  }
}

function existingExperimentOrThrow(experimentEntries) {
  if (experimentEntries.length > 0) {
    throw new GenesisError("COMMAND_UNAVAILABLE", "No command is available once approval pending exists", {
      path: "/next_command",
      correction: "Use review-experiment, approve-experiment, deny-experiment, or status for the existing plan",
      escalation: "builder",
    });
  }
}

function projectionIssue(cause) {
  return new GenesisError("PROJECTION_STALE", "Canonical YAML is safe but SQLite is stale", {
    path: "/projection_consistent",
    correction: "Run genesis rebuild-index",
    escalation: "builder",
    cause,
  });
}

function latestDescriptor(entries) {
  return latestByVersion(entries);
}

function latestRecord(entries) {
  return latestDescriptor(entries)?.record ?? null;
}

function latestDecisionEntry(entries) {
  return latestDescriptor(entries.filter(({ descriptor }) => descriptor.kind === "decision"));
}

function latestExperimentEntry(entries) {
  return latestDescriptor(entries.filter(({ descriptor }) => descriptor.kind === "experiment"));
}

function latestApprovalEntry(entries) {
  return latestDescriptor(entries.filter(({ descriptor }) => descriptor.kind === "approval"));
}

function latestExperienceEntry(entries) {
  return latestDescriptor(entries.filter(({ descriptor }) => descriptor.kind === "experience"));
}

function ensureExperimentExists(experimentEntries) {
  if (experimentEntries.length === 0) {
    throw new GenesisError("EXPERIMENT_NOT_FOUND", "Experiment plan does not exist", {
      path: "/experiment",
      correction: "Run genesis plan-experiment before using the approval workflow",
      escalation: "research",
    });
  }
}

function requireHumanAuthority(principalId) {
  if (principalId !== "genesis-owner") {
    throw new GenesisError("HUMAN_AUTHORITY_REQUIRED", "This decision requires Genesis Human Authority", {
      path: "/approver_principal_id",
      correction: "The real Human Authority must confirm as genesis-owner",
      escalation: "human_authority",
    });
  }
}

function evidenceSources(evidenceEntries) {
  return evidenceEntries.map(({ record }) => record.source_reference).filter(Boolean);
}

function evidenceIds(evidenceEntries) {
  return evidenceEntries.map(({ record }) => record.id).filter(Boolean);
}

function currentStatus({ projectRoot, businessId, now }) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, approvalEntries, decisionEntries, experimentEntries, experienceEntries, evidenceEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);

  const latestDecision = latestDecisionEntry(entries);
  const latestExperiment = latestExperimentEntry(entries);
  const latestExperience = latestExperienceEntry(entries);
  const latestApproval = latestApprovalEntry(entries);
  const paths = workspacePaths(projectRoot);
  let consistency = { consistent: entries.length === 0, yamlCount: entries.length, projectedCount: 0 };
  let blockedCommands = [];

  if (fs.existsSync(paths.db)) {
    const db = openProjection(paths.db);
    try {
      consistency = projectionConsistency(db, listRecords(projectRoot));
      blockedCommands = db.prepare(
        "SELECT code FROM blocked_commands WHERE business_id = ? ORDER BY id",
      ).all(normalized);
    } finally {
      db.close();
    }
  }

  const status = buildStatus({
    decisionVersions: decisionEntries.map(({ record }) => record),
    experimentVersions: experimentEntries.map(({ record }) => record),
    evidence: evidenceEntries.map(({ record }) => record),
    blockedCommands,
    consistency,
    now,
  });

  let state = status.state;
  let nextCommand = status.next_command;
  let approvalValidity = null;
  if (latestApproval) {
    const approval = latestApproval.record;
    approvalValidity = ["outcome_approved", "closed"].includes(latestExperiment?.record.status)
      ? evaluateOutcomeApproval({
          approval,
          experiment: latestExperiment?.record,
          experience: latestExperience?.record,
          decision: latestDecision?.record,
          actor: approval.actor,
          outcome: latestExperiment?.record.decision_outcome,
          now,
        })
      : evaluateExperimentApproval({
          approval,
          experiment: latestExperiment?.record,
          actor: approval.actor,
          now,
        });
    if (
      (approval.revoked || approval.status === "revoked")
      && ["draft", "active", "outcome_approved", "superseded"].includes(latestExperiment?.record.status)
    ) {
      state = "approval_revoked";
      nextCommand = "review-experiment";
    } else if (approval.decision === "denied" && latestExperiment?.record.status === "draft") {
      state = "approval_denied";
      nextCommand = "review-experiment";
    } else if (!approvalValidity.valid && ["draft", "active", "outcome_approved"].includes(latestExperiment?.record.status)) {
      state = "approval_invalid";
      nextCommand = "review-experiment";
    } else if (latestExperiment?.record.status === "draft") {
      state = "approved";
      nextCommand = "start-experiment";
    }
  } else if (status.state === "approval_pending") {
    nextCommand = "review-experiment";
  }

  if (latestExperiment?.record.status === "active") nextCommand = "record-execution";
  if (state === "measurement") nextCommand = "record-measurement";
  if (state === "reflection") nextCommand = "record-reflection";
  if (state === "decision") nextCommand = "decide-experiment";
  if (state === "outcome_approved") nextCommand = "close-experiment";
  if (state === "closed") nextCommand = "status";

  return {
    business_id: normalized,
    latest_decision_version: latestDecision?.descriptor.version ?? null,
    latest_experiment_version: latestExperiment?.descriptor.version ?? null,
    latest_approval_version: latestApproval?.descriptor.version ?? null,
    latest_experience_version: latestExperience?.descriptor.version ?? null,
    latest_decision_path: latestDecision?.descriptor.relativePath ?? null,
    latest_experiment_path: latestExperiment?.descriptor.relativePath ?? null,
    latest_approval_path: latestApproval?.descriptor.relativePath ?? null,
    approval_versions: approvalEntries.length,
    experience_versions: experienceEntries.length,
    approval: latestApproval?.record ?? null,
    approval_validity: approvalValidity,
    limits: latestRecord(experimentEntries)?.limits ?? null,
    ...status,
    state,
    next_command: nextCommand,
    next_permitted_command: nextCommand,
  };
}

function guidedApprovalTimes(clock, durationDays) {
  const issuedAt = clock();
  const durationMs = Math.max(1, Number(durationDays) || 1) * 86_400_000;
  return {
    effective_at: issuedAt.toISOString(),
    expires_at: new Date(issuedAt.getTime() + durationMs).toISOString(),
    review_at: new Date(issuedAt.getTime() + (durationMs / 2)).toISOString(),
  };
}

function reviewTiming({ decision, approval, state, action, now }) {
  if (state === "closed") {
    return { review_type: null, review_due_at: null, review_status: "none" };
  }

  const candidates = [];
  if (["review_experiment", "decide_experiment"].includes(action)) {
    candidates.push({ type: "human_authority_review", dueAt: now });
  }
  if (state === "discover" && decision?.review_date) {
    candidates.push({ type: "decision_review", dueAt: decision.review_date });
  }
  if (approval?.review_at && !["approval_denied", "approval_revoked"].includes(state)) {
    candidates.push({ type: "approval_review", dueAt: approval.review_at });
  }
  if (decision?.learning_lab?.monthly_review) {
    candidates.push({ type: "learning_lab_monthly_review", dueAt: decision.learning_lab.monthly_review });
  }
  if (decision?.learning_lab?.expiry) {
    candidates.push({ type: "learning_lab_expiry", dueAt: decision.learning_lab.expiry });
  }

  const valid = candidates
    .map((candidate) => ({ ...candidate, timestamp: Date.parse(candidate.dueAt) }))
    .filter((candidate) => Number.isFinite(candidate.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  const next = valid[0];
  if (!next) {
    return { review_type: null, review_due_at: null, review_status: "none" };
  }
  return {
    review_type: next.type,
    review_due_at: next.dueAt,
    review_status: next.timestamp < Date.parse(now) ? "overdue" : (next.timestamp === Date.parse(now) ? "due" : "upcoming"),
  };
}

function listBlocker(guidance) {
  if (guidance.blocker) return guidance.blocker;
  if (guidance.action === "review_experiment" && !guidance.approval) {
    return {
      code: "APPROVAL_REVIEW_REQUIRED",
      path: "/approval",
      correction: "Human Authority must review the experiment envelope",
      escalation: "human_authority",
    };
  }
  return null;
}

function nextCommandForGuidance(guidance) {
  const commands = {
    resolve_discover_blocker: "add-evidence",
    plan_experiment: "plan-experiment",
    review_experiment: "review-experiment",
    start_experiment: "start-experiment",
    record_execution: "record-execution",
    record_measurement: "record-measurement",
    record_reflection: "record-reflection",
    decide_experiment: "decide-experiment",
    close_experiment: "close-experiment",
    start_follow_up: "start-follow-up",
    start_learning_lab: "start-learning-lab",
  };
  return commands[guidance.action] ?? guidance.status.next_command ?? "status";
}

function listOpportunities({ projectRoot, clock, filters = {} }) {
  const paths = workspacePaths(projectRoot);
  if (!fs.existsSync(paths.db)) {
    throw new GenesisError("PROJECTION_STALE", "SQLite projection is unavailable", {
      path: "/projection",
      correction: "Run genesis rebuild-index before using genesis list",
      escalation: "operator",
    });
  }

  const descriptors = listRecords(projectRoot);
  const db = openProjection(paths.db);
  let rows;
  try {
    const consistency = projectionConsistency(db, descriptors);
    if (!consistency.consistent) {
      throw new GenesisError("PROJECTION_STALE", "Canonical records and SQLite projection differ", {
        path: "/projection",
        correction: "Run genesis rebuild-index before using genesis list",
        escalation: "operator",
      });
    }
    rows = readOpportunities(db);
  } finally {
    db.close();
  }

  const now = clock().toISOString();
  const opportunities = rows.map((row) => {
    const guidance = guidedNextStep({ projectRoot, businessId: row.business_id, clock });
    const timing = reviewTiming({
      decision: guidance.decision,
      approval: guidance.approval,
      state: guidance.state,
      action: guidance.action,
      now,
    });
    const blocker = listBlocker(guidance);
    return {
      business_id: row.business_id,
      state: guidance.state,
      projected_state: row.state,
      confidence: row.confidence,
      updated_at: row.updated_at,
      guided_action: guidance.action,
      next_command: nextCommandForGuidance(guidance),
      ...timing,
      blocker: blocker ? {
        code: blocker.code ?? "REQUIREMENT_MISSING",
        path: blocker.path,
        correction: blocker.correction,
        escalation: blocker.escalation,
      } : null,
    };
  });
  const filtered = opportunities.filter((opportunity) => (
    (!filters.business || opportunity.business_id === normalizeBusinessId(filters.business))
    && (!filters.state || opportunity.state === filters.state)
    && (!filters.review || opportunity.review_status === filters.review)
    && (!filters.blocked || opportunity.blocker !== null)
  ));
  return {
    generated_at: now,
    projection_consistent: true,
    count: filtered.length,
    total_count: opportunities.length,
    filters,
    opportunities: filtered,
  };
}

function searchEvidence({ projectRoot, query, filters = {} }) {
  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  if (!normalizedQuery) {
    throw new GenesisError("SEARCH_QUERY_REQUIRED", "Evidence search requires a query", {
      path: "/query",
      correction: "Provide a literal keyword or phrase to search",
      escalation: "operator",
    });
  }
  const paths = workspacePaths(projectRoot);
  if (!fs.existsSync(paths.db)) {
    throw new GenesisError("PROJECTION_STALE", "SQLite projection is unavailable", {
      path: "/projection",
      correction: "Run genesis rebuild-index before searching evidence",
      escalation: "operator",
    });
  }
  const descriptors = listRecords(projectRoot);
  const db = openProjection(paths.db);
  try {
    if (!projectionConsistency(db, descriptors).consistent) {
      throw new GenesisError("PROJECTION_STALE", "Canonical records and SQLite projection differ", {
        path: "/projection",
        correction: "Run genesis rebuild-index before searching evidence",
        escalation: "operator",
      });
    }
  } finally {
    db.close();
  }

  const businessFilter = filters.business ? normalizeBusinessId(filters.business) : null;
  const results = descriptors
    .filter((descriptor) => ["evidence", "experience"].includes(descriptor.kind))
    .map((descriptor) => ({ descriptor, record: readRecord(descriptor.absolutePath) }))
    .filter(({ descriptor, record }) => {
      const businessId = descriptor.kind === "evidence" ? record.business_id : record.affected_business;
      if (businessFilter && businessId !== businessFilter) return false;
      if (filters.privacy && record.privacy_classification !== filters.privacy) return false;
      if (filters.stance && (descriptor.kind !== "evidence" || record.stance !== filters.stance)) return false;
      const searchable = descriptor.kind === "evidence"
        ? [record.id, record.business_id, record.source_reference, record.summary, record.provenance, record.stance]
        : [
            record.id, record.affected_business, record.domain, ...(record.tags ?? []), record.context,
            record.hypothesis, record.outcome, record.actual_result, record.reflection, record.reusable_lesson,
            ...(record.supporting_evidence ?? []), ...(record.contradicting_evidence ?? []),
          ];
      return searchable.some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
    })
    .map(({ descriptor, record }) => ({
      record_type: descriptor.kind === "evidence" ? "evidence_entry" : "reviewed_experience",
      id: record.id,
      version: descriptor.version,
      business_id: descriptor.kind === "evidence" ? record.business_id : record.affected_business,
      timestamp: descriptor.kind === "evidence" ? record.collected_at : record.timestamp,
      privacy_classification: record.privacy_classification,
      stance: descriptor.kind === "evidence" ? record.stance : null,
      source_reference: descriptor.kind === "evidence" ? record.source_reference : null,
      summary: descriptor.kind === "evidence" ? record.summary : record.reusable_lesson,
      provenance: descriptor.kind === "evidence" ? record.provenance : `Reviewed experience ${record.id}`,
      path: descriptor.relativePath,
    }))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.path.localeCompare(right.path));
  return {
    query: String(query).trim(),
    filters,
    count: results.length,
    projection_consistent: true,
    results,
  };
}

function guidedNextStep({ projectRoot, businessId, clock }) {
  const normalized = normalizeBusinessId(businessId);
  const paths = workspacePaths(projectRoot);
  if (!fs.existsSync(paths.db)) {
    throw new GenesisError("PROJECTION_STALE", "SQLite projection is unavailable", {
      path: "/projection",
      correction: "Run genesis rebuild-index before using genesis next",
      escalation: "operator",
    });
  }

  const db = openProjection(paths.db);
  let projected;
  try {
    projected = readOpportunity(db, normalized);
  } finally {
    db.close();
  }
  if (!projected) {
    throw new GenesisError("PROJECTION_STALE", "Business is missing from the SQLite projection", {
      path: "/projection/opportunity",
      correction: "Run genesis rebuild-index and retry genesis next",
      escalation: "operator",
    });
  }

  const now = clock().toISOString();
  const status = currentStatus({ projectRoot, businessId: normalized, now });
  if (!status.projection_consistent) {
    throw new GenesisError("PROJECTION_STALE", "Canonical records and SQLite projection differ", {
      path: "/projection",
      correction: "Run genesis rebuild-index before advancing the workflow",
      escalation: "operator",
    });
  }

  const { entries } = businessEntries(projectRoot, normalized);
  const decision = latestDecisionEntry(entries)?.record ?? null;
  const experiment = latestExperimentEntry(entries)?.record ?? null;
  const experience = latestExperienceEntry(entries)?.record ?? null;
  const approval = latestApprovalEntry(entries)?.record ?? null;
  const state = status.state === "approval_invalid" ? status.state : projected.state;
  const base = {
    business_id: normalized,
    state,
    projected_state: projected.state,
    status,
    decision,
    experiment,
    experience,
    approval,
  };

  if (state === "discover" && !status.discover_gate.passed) {
    return {
      ...base,
      action: "resolve_discover_blocker",
      message: "Discovery is blocked by one missing requirement.",
      blocker: status.discover_gate.blockers[0],
    };
  }
  if (state === "discover") {
    return {
      ...base,
      action: "plan_experiment",
      message: "Discovery is complete. Genesis will guide you through the remaining experiment fields.",
      defaults: {
        owner: decision.owner,
        supported_decision: decision.id,
        metric_formula: decision.metric,
        expected_outcome: decision.expected_outcome,
        decision_date: now,
        allowed_outcomes: ["scale", "pivot", "learning_lab", "archive", "kill"],
      },
    };
  }
  if (["approval_pending", "approval_denied", "approval_invalid", "approval_revoked"].includes(state)) {
    if (experiment?.status !== "draft") {
      return {
        ...base,
        action: "no_transition",
        message: "The latest experiment is not a draft, so Genesis cannot issue a new start approval.",
      };
    }
    return {
      ...base,
      action: "review_experiment",
      message: "The experiment is ready for one Human Authority decision.",
      approval_history_count: businessEntries(projectRoot, normalized).approvalEntries.length,
      defaults: {
        approver_principal_id: "genesis-owner",
        actor: experiment.owner,
        ...guidedApprovalTimes(clock, experiment.limits?.duration_days),
      },
    };
  }
  if (state === "approved") {
    return {
      ...base,
      action: "start_experiment",
      message: "The approval is valid. Genesis can record the manual transition to active.",
      defaults: { actor: approval.actor },
    };
  }
  if (projected.state === "active") {
    return {
      ...base,
      action: "record_execution",
      message: status.approval_validity?.valid
        ? "The experiment is active. Record the completed or stopped execution without rerunning it."
        : "The experiment is active, but its approval is currently invalid. Only execution completed inside the approved window can be recorded.",
      blocker: status.approval_validity?.valid ? null : status.approval_validity?.blockers?.[0],
      defaults: {
        actor: approval?.actor ?? experiment?.owner,
        started_at: experiment?.updated_at,
        completed_at: now,
        data_classes: experiment?.limits?.data_classes ?? [],
        risk_level: experiment?.limits?.risk_level,
      },
    };
  }
  if (projected.state === "measurement") {
    return {
      ...base,
      action: "record_measurement",
      message: "Execution is preserved. Record the observed metric result and its data quality separately.",
      defaults: {
        reviewer: "analyst",
        measurement_evidence: experiment?.metric?.data_source ? [experiment.metric.data_source] : [],
      },
    };
  }
  if (projected.state === "reflection") {
    return {
      ...base,
      action: "record_reflection",
      message: "Measurement is complete. Record analyst reflection and create a reviewed experience before any outcome decision.",
      defaults: {
        reviewer: "analyst",
        valid_from: now,
        valid_until: new Date(Date.parse(now) + (90 * 86_400_000)).toISOString(),
        supporting_evidence: experiment?.measurement_evidence ?? [],
        contradicting_evidence: experiment?.counterevidence ?? [],
      },
    };
  }
  if (projected.state === "decision") {
    return {
      ...base,
      action: "decide_experiment",
      message: "Reflection is complete. The next outcome is a Major Bet decision requiring one exact Human Authority approval.",
      defaults: {
        approver_principal_id: "genesis-owner",
        actor: "analyst",
        allowed_outcomes: experiment?.allowed_outcomes ?? ["scale", "pivot", "learning_lab", "archive", "kill"],
        ...guidedApprovalTimes(clock, 7),
      },
    };
  }
  if (projected.state === "outcome_approved") {
    return {
      ...base,
      action: "close_experiment",
      message: status.approval_validity?.valid
        ? "The exact outcome is approved. Genesis can now close the linked experiment, decision, and experience records."
        : "The recorded outcome approval is not currently valid, so closure will fail closed until Human Authority issues a corrected approval.",
      blocker: status.approval_validity?.valid ? null : status.approval_validity?.blockers?.[0],
      defaults: { actor: approval?.actor ?? "analyst" },
    };
  }
  if (projected.state === "closed") {
    if (["pivot", "scale"].includes(experiment?.decision_outcome)) {
      return {
        ...base,
        action: "start_follow_up",
        message: `The ${experiment.decision_outcome} classification permits a fresh workflow instance. No approval, budget, or execution authority will carry forward.`,
        defaults: {
          business_id: `${normalized}-${experiment.decision_outcome}-01`,
          target_customer: decision?.target_customer,
          confidence: experience?.confidence,
          source_reference: `experience://${experience?.id}`,
          summary: experience?.reusable_lesson,
          provenance: `Genesis reviewed experience ${experience?.id}`,
          privacy_classification: experience?.privacy_classification,
          counterevidence: experience?.contradicting_evidence ?? [],
          owner: experiment?.owner,
          review_date: new Date(Date.parse(now) + (14 * 86_400_000)).toISOString(),
        },
      };
    }
    if (experiment?.decision_outcome === "learning_lab") {
      if (experiment.validation_outcome !== "failed") {
        return {
          ...base,
          action: "no_transition",
          message: "The experiment is closed, but Learning Lab reserve cannot be used because the reviewed initiative did not fail.",
          blocker: {
            code: "LEARNING_LAB_FAILED_INITIATIVE_REQUIRED",
            path: "/validation_outcome",
            correction: "Preserve the closed result; Learning Lab reserve is only available to real failed initiatives.",
            escalation: "ceo",
          },
        };
      }
      return {
        ...base,
        action: "start_learning_lab",
        message: "The failed initiative is classified for a bounded Learning Lab. Define its separate budget, owner, metric, review, and expiry before any new experiment is planned.",
        defaults: {
          business_id: `${normalized}-learning-lab-01`,
          target_customer: decision?.target_customer,
          confidence: experience?.confidence,
          source_reference: `experience://${experience?.id}`,
          summary: experience?.reusable_lesson,
          provenance: `Genesis reviewed failed initiative ${experience?.id}`,
          privacy_classification: experience?.privacy_classification,
          counterevidence: experience?.contradicting_evidence ?? [],
          owner: experiment?.owner,
          review_date: new Date(Date.parse(now) + (14 * 86_400_000)).toISOString(),
          monthly_review: new Date(Date.parse(now) + (30 * 86_400_000)).toISOString(),
          expiry: new Date(Date.parse(now) + (90 * 86_400_000)).toISOString(),
        },
      };
    }
    const correction = experiment?.decision_outcome === "learning_lab"
      ? "A learning lab needs separate budget, learning metric, monthly review, and expiry governance."
      : "This terminal outcome does not create follow-up authority.";
    return {
      ...base,
      action: "no_transition",
      message: `The experiment is closed and its immutable records are preserved. ${correction}`,
    };
  }
  return {
    ...base,
    action: "no_transition",
    message: `No guided transition is implemented for state ${state}.`,
  };
}

function verifyProjectionReference(db, relativePath) {
  const row = db.prepare("SELECT 1 AS present FROM record_versions WHERE relative_path = ?").get(relativePath);
  if (!row) {
    throw new Error(`projection missing record reference: ${relativePath}`);
  }
}

function projectWrittenRecords({ projectRoot, registry, written }) {
  const dbPath = workspacePaths(projectRoot).db;
  const db = openProjection(dbPath);
  try {
    for (const item of written) {
      projectRecord(db, {
        kind: item.kind,
        id: item.record.id,
        version: item.version,
        relativePath: item.relativePath,
      }, item.record);
      verifyProjectionReference(db, item.relativePath);
    }

    const consistency = projectionConsistency(db, listRecords(projectRoot));
    if (!consistency.consistent) {
      throw new Error("projection row count mismatch");
    }

    return { projection_stale: false, warning: null };
  } catch (cause) {
    return {
      projection_stale: true,
      warning: projectionIssue(cause),
    };
  } finally {
    db.close();
  }
}

function proposalCancelled() {
  return { changed: false, reason: "cancelled" };
}

function startBusinessProposal(input, clock, registry) {
  const businessId = normalizeBusinessId(input.business_id);
  const now = clock();
  const evidenceId = `${businessId}-evidence-001`;
  const sourceReferences = unique(input.evidence_references ?? [input.source_reference]);
  const evidenceRecord = buildEvidenceEntry({
    id: evidenceId,
    business_id: businessId,
    source_reference: input.source_reference,
    summary: input.summary,
    stance: input.stance,
    provenance: input.provenance,
    privacy_classification: input.privacy_classification,
  }, clock, { registry });

  const decisionRecord = buildDecisionRecord({
    business_id: businessId,
    owner: input.owner,
    evidence_references: sourceReferences,
    related_records: unique([evidenceId, ...(input.related_records ?? [])]),
    immutable_history_refs: [`records/decisions/${businessId}-decision.v0001.yaml`],
    target_customer: input.target_customer,
    problem: input.problem,
    hypothesis: input.hypothesis,
    confidence: input.confidence,
    evidence: sourceReferences,
    counterevidence: input.counterevidence ?? [],
    alternatives: input.alternatives,
    expected_outcome: input.expected_outcome,
    metric: input.metric,
    decision: input.decision,
    review_date: input.review_date,
    privacy_classification: input.privacy_classification,
    continuation_type: input.continuation_type,
    parent_business: input.parent_business,
    learning_lab: input.learning_lab,
  }, clock, { registry });

  return {
    command: "start-business",
    business_id: businessId,
    state: "discover",
    records: [
      { kind: "evidence", record: evidenceRecord, version: 1 },
      { kind: "decision", record: decisionRecord, version: 1 },
    ],
  };
}

function startFollowUpProposal(projectRoot, parentBusinessId, input, clock, registry) {
  const parentId = normalizeBusinessId(parentBusinessId);
  const childId = normalizeBusinessId(input.business_id);
  if (parentId === childId) {
    throw new GenesisError("FOLLOW_UP_ID_REUSED", "A follow-up requires a new business ID", {
      path: "/business_id",
      correction: "Choose a new ID so the closed workflow remains immutable",
      escalation: "research",
    });
  }
  const parent = businessEntries(projectRoot, parentId);
  ensureBusinessExists(parent.decisionEntries, parentId);
  ensureExperimentExists(parent.experimentEntries);
  const parentExperiment = latestExperimentEntry(parent.entries);
  const parentExperience = latestExperienceEntry(parent.entries);
  const parentDecision = latestDecisionEntry(parent.entries);
  if (
    parentExperiment.record.status !== "closed"
    || parentExperience?.record.status !== "closed"
    || parentDecision.record.status !== "closed"
  ) {
    throw new GenesisError("FOLLOW_UP_PARENT_NOT_CLOSED", "Follow-up work requires a fully closed parent workflow", {
      path: "/parent_business/state",
      correction: "Complete governed closure before creating a follow-up opportunity",
      escalation: "research",
    });
  }
  const outcome = parentExperiment.record.decision_outcome;
  if (!["pivot", "scale"].includes(outcome)) {
    throw new GenesisError("FOLLOW_UP_OUTCOME_INELIGIBLE", "The closed outcome does not permit this generic follow-up workflow", {
      path: "/decision_outcome",
      correction: outcome === "learning_lab"
        ? "Create dedicated learning-lab governance with budget, metric, monthly review, and expiry"
        : "Preserve the terminal archive or kill outcome without creating follow-up work",
      escalation: outcome === "learning_lab" ? "ceo" : "analyst",
    });
  }
  if (businessEntries(projectRoot, childId).decisionEntries.length > 0) {
    throw new GenesisError("BUSINESS_ALREADY_EXISTS", "Follow-up business opportunity already exists", {
      path: "/business_id",
      correction: "Choose a new follow-up business ID",
      escalation: "research",
    });
  }

  const proposal = startBusinessProposal({
    ...input,
    business_id: childId,
    evidence_references: unique([
      input.source_reference,
      `experience://${parentExperience.record.id}`,
    ]),
    related_records: unique([
      parentDecision.record.id,
      parentExperiment.record.id,
      parentExperience.record.id,
    ]),
  }, clock, registry);
  return {
    ...proposal,
    command: "start-follow-up",
    parent_business_id: parentId,
    parent_outcome: outcome,
  };
}

function startLearningLabProposal(projectRoot, parentBusinessId, input, clock, registry) {
  const parentId = normalizeBusinessId(parentBusinessId);
  const childId = normalizeBusinessId(input.business_id);
  if (parentId === childId) {
    throw new GenesisError("LEARNING_LAB_ID_REUSED", "A learning lab requires a new business ID", {
      path: "/business_id",
      correction: "Choose a new ID so the closed initiative remains immutable",
      escalation: "research",
    });
  }

  const parent = businessEntries(projectRoot, parentId);
  ensureBusinessExists(parent.decisionEntries, parentId);
  ensureExperimentExists(parent.experimentEntries);
  const parentExperiment = latestExperimentEntry(parent.entries);
  const parentExperience = latestExperienceEntry(parent.entries);
  const parentDecision = latestDecisionEntry(parent.entries);
  if (
    parentExperiment.record.status !== "closed"
    || parentExperience?.record.status !== "closed"
    || parentDecision.record.status !== "closed"
  ) {
    throw new GenesisError("LEARNING_LAB_PARENT_NOT_CLOSED", "Learning Lab work requires a fully closed parent workflow", {
      path: "/parent_business/state",
      correction: "Complete governed closure before allocating Learning Lab reserve",
      escalation: "ceo",
    });
  }
  if (parentExperiment.record.decision_outcome !== "learning_lab") {
    throw new GenesisError("LEARNING_LAB_OUTCOME_REQUIRED", "The parent outcome does not authorize Learning Lab classification", {
      path: "/decision_outcome",
      correction: "Use the continuation route matching the immutable parent outcome",
      escalation: "analyst",
    });
  }
  if (parentExperiment.record.validation_outcome !== "failed") {
    throw new GenesisError("LEARNING_LAB_FAILED_INITIATIVE_REQUIRED", "Learning Lab reserve requires a real failed initiative", {
      path: "/validation_outcome",
      correction: "Do not allocate Learning Lab reserve unless the reviewed parent validation outcome is failed",
      escalation: "ceo",
    });
  }
  if (businessEntries(projectRoot, childId).decisionEntries.length > 0) {
    throw new GenesisError("BUSINESS_ALREADY_EXISTS", "Learning Lab opportunity already exists", {
      path: "/business_id",
      correction: "Choose a new Learning Lab business ID",
      escalation: "research",
    });
  }

  const budget = input.learning_lab?.budget;
  const monthlyReview = Date.parse(input.learning_lab?.monthly_review);
  const expiry = Date.parse(input.learning_lab?.expiry);
  const now = clock().getTime();
  if (
    !Number.isFinite(budget?.cash_usd)
    || budget.cash_usd < 0
    || !Number.isFinite(budget?.labor_hours)
    || budget.labor_hours < 0
  ) {
    throw new GenesisError("LEARNING_LAB_BUDGET_INVALID", "Learning Lab budget must contain finite non-negative limits", {
      path: "/learning_lab/budget",
      correction: "Provide explicit non-negative cash_usd and labor_hours limits",
      escalation: "ceo",
    });
  }
  if (!input.learning_lab?.owner || !input.learning_lab?.learning_metric) {
    throw new GenesisError("LEARNING_LAB_GOVERNANCE_INCOMPLETE", "Learning Lab owner and metric are required", {
      path: "/learning_lab",
      correction: "Provide a named owner and one explicit learning metric",
      escalation: "ceo",
    });
  }
  if (!Number.isFinite(monthlyReview) || !Number.isFinite(expiry) || monthlyReview <= now || monthlyReview >= expiry) {
    throw new GenesisError("LEARNING_LAB_TIME_INVALID", "Learning Lab review and expiry timestamps are invalid", {
      path: "/learning_lab/monthly_review",
      correction: "Set a future monthly review before a later expiry",
      escalation: "ceo",
    });
  }

  const proposal = startBusinessProposal({
    ...input,
    business_id: childId,
    owner: input.learning_lab.owner,
    metric: input.learning_lab.learning_metric,
    evidence_references: unique([
      input.source_reference,
      `experience://${parentExperience.record.id}`,
    ]),
    related_records: unique([
      parentDecision.record.id,
      parentExperiment.record.id,
      parentExperience.record.id,
    ]),
    continuation_type: "learning_lab",
    parent_business: parentId,
  }, clock, registry);
  return {
    ...proposal,
    command: "start-learning-lab",
    parent_business_id: parentId,
    parent_outcome: "learning_lab",
  };
}

function addEvidenceProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries, evidenceEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  existingExperimentOrThrow(experimentEntries);

  const latestDecision = latestDecisionEntry(entries);
  const evidenceVersion = evidenceEntries.length + 1;
  const evidenceId = `${normalized}-evidence-${String(evidenceVersion).padStart(3, "0")}`;
  const evidenceRecord = buildEvidenceEntry({
    id: evidenceId,
    business_id: normalized,
    source_reference: input.source_reference,
    summary: input.summary,
    stance: input.stance,
    provenance: input.provenance,
    privacy_classification: input.privacy_classification,
  }, clock, { registry });

  const currentDecision = latestDecision.record;
  const nextEvidenceReferences = unique([
    ...(currentDecision.evidence_references ?? []),
    evidenceRecord.source_reference,
  ]);
  const nextEvidence = unique([
    ...(currentDecision.evidence ?? []),
    evidenceRecord.source_reference,
  ]);
  const nextCounterevidence = evidenceRecord.stance === "contradict"
    ? unique([
        ...(currentDecision.counterevidence ?? []),
        evidenceRecord.source_reference,
      ])
    : currentDecision.counterevidence ?? [];
  const nextRelatedRecords = unique([
    ...(currentDecision.related_records ?? []),
    evidenceRecord.id,
  ]);

  const decisionRecord = versionDecisionRecord(
    currentDecision,
    {
      ...input.decision_changes,
      evidence_references: nextEvidenceReferences,
      evidence: nextEvidence,
      counterevidence: nextCounterevidence,
      related_records: nextRelatedRecords,
    },
    currentDecision.immutable_history_refs?.[0] ?? latestDecision.descriptor.relativePath,
    clock,
    { registry },
  );

  return {
    command: "add-evidence",
    business_id: normalized,
    state: "discover",
    records: [
      { kind: "evidence", record: evidenceRecord, version: evidenceVersion },
      {
        kind: "decision",
        record: decisionRecord,
        version: latestDecision.descriptor.version + 1,
      },
    ],
  };
}

const DECISION_CORRECTION_FIELDS = new Set([
  "owner", "target_customer", "problem", "hypothesis", "confidence", "counterevidence",
  "alternatives", "expected_outcome", "metric", "decision", "review_date", "privacy_classification",
]);
const EXPERIMENT_REVISION_FIELDS = new Set([
  "owner", "problem", "hypothesis", "confidence", "evidence", "counterevidence", "baseline",
  "comparison_method", "metric", "expected_outcome", "minimum_meaningful_effect",
  "failure_conditions", "stop_conditions", "limits", "decision_date", "allowed_outcomes",
  "privacy_classification",
]);

function correctionChanges(input, allowedFields, recordPath) {
  if (!input?.correction_reason?.trim()) {
    throw new GenesisError("CORRECTION_REASON_REQUIRED", "A correction reason is required", {
      path: "/correction_reason",
      correction: "Explain the factual operator mistake being corrected",
      escalation: "operator",
    });
  }
  const changes = input.changes;
  const fields = changes && typeof changes === "object" && !Array.isArray(changes)
    ? Object.keys(changes)
    : [];
  if (fields.length === 0) {
    throw new GenesisError("CORRECTION_FIELDS_REQUIRED", "At least one corrected field is required", {
      path: "/changes",
      correction: "Provide a non-empty object of corrected fields",
      escalation: "operator",
    });
  }
  const forbidden = fields.find((field) => !allowedFields.has(field));
  if (forbidden) {
    throw new GenesisError("CORRECTION_FIELD_FORBIDDEN", "The requested field cannot be changed through this correction workflow", {
      path: `/changes/${forbidden}`,
      correction: `Correct only mutable ${recordPath} fields; identity, history, state, and authority fields are immutable`,
      escalation: "operator",
    });
  }
  return { changes, fields: [...fields].sort() };
}

function correctDecisionProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  if (experimentEntries.length > 0) {
    throw new GenesisError("DECISION_CORRECTION_LOCKED", "The discovery decision is locked after experiment planning", {
      path: "/decision",
      correction: "Preserve the decision history; revise the draft experiment or start a new governed workflow",
      escalation: "research",
    });
  }
  const latest = latestDecisionEntry(entries);
  const { changes, fields } = correctionChanges(input, DECISION_CORRECTION_FIELDS, "decision");
  const record = versionDecisionRecord(latest.record, {
    ...changes,
    correction: {
      reason: input.correction_reason.trim(),
      corrected_fields: fields,
      supersedes_version: latest.descriptor.relativePath,
    },
  }, latest.descriptor.relativePath, clock, { registry });
  return {
    command: "correct-decision",
    business_id: normalized,
    state: "discover",
    records: [{ kind: "decision", record, version: latest.descriptor.version + 1 }],
  };
}

function validateLearningLabPlan(decision, input, clock) {
  const learningLab = decision.learning_lab;
  if (decision.continuation_type !== "learning_lab") return;
  if (input.owner !== learningLab.owner) {
    throw new GenesisError("LEARNING_LAB_OWNER_MISMATCH", "Experiment owner does not match Learning Lab governance", {
      path: "/owner", correction: `Use the governed Learning Lab owner ${learningLab.owner}`, escalation: "ceo",
    });
  }
  if (input.metric?.formula !== learningLab.learning_metric) {
    throw new GenesisError("LEARNING_LAB_METRIC_MISMATCH", "Experiment metric does not match the governed learning metric", {
      path: "/metric/formula", correction: `Use the governed learning metric: ${learningLab.learning_metric}`, escalation: "analyst",
    });
  }
  if (input.limits?.cash_usd > learningLab.budget.cash_usd || input.limits?.labor_hours > learningLab.budget.labor_hours) {
    throw new GenesisError("LEARNING_LAB_BUDGET_EXCEEDED", "Experiment limits exceed the Learning Lab budget", {
      path: "/limits", correction: "Reduce cash and labor limits to the governed Learning Lab budget", escalation: "ceo",
    });
  }
  const decisionTime = Date.parse(input.decision_date);
  const expiry = Date.parse(learningLab.expiry);
  const plannedEnd = decisionTime + ((input.limits?.duration_days ?? 0) * 86_400_000);
  if (!Number.isFinite(decisionTime) || clock().getTime() >= expiry || plannedEnd > expiry) {
    throw new GenesisError("LEARNING_LAB_EXPIRY_EXCEEDED", "Experiment duration extends beyond Learning Lab expiry", {
      path: "/limits/duration_days", correction: "Shorten the plan so it ends on or before the governed expiry", escalation: "ceo",
    });
  }
}

function reviseExperimentProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  ensureExperimentExists(experimentEntries);
  const latest = latestExperimentEntry(entries);
  if (latest.record.status !== "draft") {
    throw new GenesisError("EXPERIMENT_REVISION_LOCKED", "Only a draft experiment can be revised", {
      path: "/experiment/status",
      correction: "Preserve active and completed evidence; use the governed lifecycle instead of rewriting it",
      escalation: "research",
    });
  }
  const approval = latestApprovalEntry(entries)?.record;
  if (approval?.decision === "approved" && !approval.revoked) {
    throw new GenesisError("APPROVAL_REVOCATION_REQUIRED", "An approved draft cannot be revised while its approval remains recorded", {
      path: "/approval",
      correction: "Revoke the approval before revising the experiment envelope",
      escalation: "human_authority",
    });
  }
  const { changes, fields } = correctionChanges(input, EXPERIMENT_REVISION_FIELDS, "experiment");
  const nextSnapshot = { ...latest.record, ...changes };
  validateLearningLabPlan(latestDecisionEntry(entries).record, nextSnapshot, clock);
  const record = versionExperimentRecord(latest.record, {
    ...changes,
    status: "draft",
    validation_outcome: "pending",
    approval_references: [],
    correction: {
      reason: input.correction_reason.trim(),
      corrected_fields: fields,
      supersedes_version: latest.descriptor.relativePath,
    },
  }, latest.descriptor.relativePath, clock, { registry });
  return {
    command: "revise-experiment",
    business_id: normalized,
    state: "approval_pending",
    records: [{ kind: "experiment", record, version: latest.descriptor.version + 1 }],
  };
}

function planExperimentProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries, evidenceEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  existingExperimentOrThrow(experimentEntries);

  const latestDecision = latestDecisionEntry(entries);
  const discoverGate = evaluateDiscoverGate({
    decision: latestDecision.record,
    evidence: evidenceEntries.map(({ record }) => record),
  });
  if (!discoverGate.passed) {
    const dbPath = workspacePaths(projectRoot).db;
    const db = openProjection(dbPath);
    try {
      recordBlockedCommand(db, {
        businessId: normalized,
        command: "plan-experiment",
        code: "DISCOVER_GATE_BLOCKED",
        occurredAt: clock().toISOString(),
      });
    } finally {
      db.close();
    }

    const blocker = discoverGate.blockers[0];
    throw new GenesisError("DISCOVER_GATE_BLOCKED", "Discover gate blocked", {
      path: blocker?.path ?? "/discover_gate",
      correction: blocker?.correction ?? "Complete the Discover gate before planning an experiment",
      escalation: blocker?.escalation ?? "builder",
    });
  }

  validateLearningLabPlan(latestDecision.record, input, clock);

  const supportingEvidence = evidenceEntries.filter(({ record }) => record.stance === "support");
  const contradictingEvidence = evidenceEntries.filter(({ record }) => record.stance === "contradict");
  const evidenceReferences = unique([
    ...evidenceSources(evidenceEntries),
    ...(latestDecision.record.evidence_references ?? []),
  ]);
  const relatedRecords = unique([
    latestDecision.record.id,
    ...evidenceIds(evidenceEntries),
    ...(latestDecision.record.related_records ?? []),
  ]);

  const experimentRecord = buildExperimentRecord({
    business_id: normalized,
    owner: input.owner ?? latestDecision.record.owner,
    evidence_references: evidenceReferences,
    related_records: relatedRecords,
    problem: input.problem ?? latestDecision.record.problem,
    supported_decision: input.supported_decision ?? latestDecision.record.id,
    hypothesis: input.hypothesis ?? latestDecision.record.hypothesis,
    confidence: input.confidence ?? latestDecision.record.confidence,
    evidence: input.evidence ?? supportingEvidence.map(({ record }) => record.source_reference),
    counterevidence: input.counterevidence ?? contradictingEvidence.map(({ record }) => record.source_reference),
    baseline: input.baseline,
    comparison_method: input.comparison_method,
    metric: input.metric,
    expected_outcome: input.expected_outcome,
    minimum_meaningful_effect: input.minimum_meaningful_effect,
    failure_conditions: input.failure_conditions,
    stop_conditions: input.stop_conditions,
    limits: input.limits,
    decision_date: input.decision_date,
    allowed_outcomes: input.allowed_outcomes,
    privacy_classification: input.privacy_classification ?? latestDecision.record.privacy_classification,
  }, clock, { registry });

  return {
    command: "plan-experiment",
    business_id: normalized,
    state: "approval_pending",
    record: experimentRecord,
    records: [
      { kind: "experiment", record: experimentRecord, version: 1 },
    ],
  };
}

function approvalRecordProposal(projectRoot, businessId, input, decision, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  ensureExperimentExists(experimentEntries);
  requireHumanAuthority(input.approver_principal_id);

  const latestExperiment = latestExperimentEntry(entries);
  if (latestExperiment.record.status !== "draft") {
    throw new GenesisError("COMMAND_UNAVAILABLE", "Only a draft experiment can receive an approval decision", {
      path: "/experiment/status",
      correction: "Use status for active or superseded experiments",
      escalation: "human_authority",
    });
  }
  const latestApproval = latestApprovalEntry(entries);
  if (latestApproval?.record.decision === "approved" && latestApproval.record.status === "active" && !latestApproval.record.revoked) {
    throw new GenesisError("APPROVAL_ALREADY_ACTIVE", "An active approval already exists", {
      path: "/approval",
      correction: "Start the experiment or revoke the existing approval",
      escalation: "human_authority",
    });
  }

  const experiment = latestExperiment.record;
  const version = (latestApproval?.descriptor.version ?? 0) + 1;
  const id = `${normalized}-experiment-approval`;
  const currentPath = `records/approvals/${id}.v${String(version).padStart(4, "0")}.yaml`;
  const now = clock();
  const issuedAt = now.toISOString();
  const deniedExpiry = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const candidate = buildApprovalRecord({
    id,
    affected_business: normalized,
    status: decision === "approved" ? "active" : "closed",
    evidence_references: experiment.evidence_references,
    related_records: unique([experiment.id, experiment.supported_decision]),
    privacy_classification: experiment.privacy_classification,
    immutable_history_refs: [currentPath],
    approver_role: "human_authority",
    approver_principal_id: input.approver_principal_id,
    requester: experiment.owner,
    actor: input.actor ?? experiment.owner,
    action_class: actionClassForLimits(experiment.limits),
    scope: { actions: [experimentApprovalAction(experiment.id)], wildcard: false },
    evidence_snapshot: unique([
      ...experiment.evidence_references,
      ...experiment.evidence,
      ...experiment.counterevidence,
    ]),
    limits: structuredClone(experiment.limits),
    decision,
    rationale: input.rationale,
    issued_at: issuedAt,
    effective_at: decision === "approved" ? (input.effective_at || issuedAt) : issuedAt,
    expires_at: decision === "approved" ? input.expires_at : deniedExpiry,
    review_at: decision === "approved" ? input.review_at : issuedAt,
    revoked: false,
    revocation_reference: null,
  }, () => now, { registry });

  const record = latestApproval
    ? versionApprovalRecord(
        latestApproval.record,
        candidate,
        latestApproval.descriptor.relativePath,
        () => now,
        { registry },
      )
    : candidate;

  return {
    command: decision === "approved" ? "approve-experiment" : "deny-experiment",
    business_id: normalized,
    state: decision === "approved" ? "approved" : "approval_denied",
    guided: input.guided === true,
    guided_review: input.guided === true ? {
      problem: experiment.problem,
      hypothesis: experiment.hypothesis,
      metric: experiment.metric,
      expected_outcome: experiment.expected_outcome,
      minimum_meaningful_effect: experiment.minimum_meaningful_effect,
      failure_conditions: experiment.failure_conditions,
      stop_conditions: experiment.stop_conditions,
      evidence: experiment.evidence,
      counterevidence: experiment.counterevidence,
    } : undefined,
    record,
    records: [{ kind: "approval", record, version }],
  };
}

function startExperimentProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  ensureExperimentExists(experimentEntries);
  const latestExperiment = latestExperimentEntry(entries);
  const latestApproval = latestApprovalEntry(entries);
  if (latestExperiment.record.status !== "draft") {
    throw new GenesisError("COMMAND_UNAVAILABLE", "Experiment is not waiting to start", {
      path: "/experiment/status",
      correction: "Use status for the current experiment state",
      escalation: "operator",
    });
  }
  requireExperimentApproval({
    approval: latestApproval?.record,
    experiment: latestExperiment.record,
    actor: input.actor,
    now: clock().toISOString(),
  });

  const experiment = versionExperimentRecord(
    latestExperiment.record,
    {
      status: "active",
      approval_references: unique([
        ...(latestExperiment.record.approval_references ?? []),
        latestApproval.record.id,
      ]),
    },
    latestExperiment.descriptor.relativePath,
    clock,
    { registry },
  );
  return {
    command: "start-experiment",
    business_id: normalized,
    state: "active",
    record: experiment,
    records: [{
      kind: "experiment",
      record: experiment,
      version: latestExperiment.descriptor.version + 1,
    }],
  };
}

function requireWithinActualEnvelope(actual, limits) {
  for (const field of ["cash_usd", "labor_hours", "duration_days"]) {
    if (!Number.isFinite(actual[field]) || actual[field] < 0 || actual[field] > limits[field]) {
      throw new GenesisError("ACTUAL_EXPOSURE_EXCEEDED", "Actual experiment exposure is outside the approved limit", {
        path: `/actual_exposure/${field}`,
        correction: `Enter the factual ${field} at or below the approved limit ${limits[field]}; escalate any overrun`,
        escalation: "human_authority",
      });
    }
  }
  if (
    !Array.isArray(actual.data_classes)
    || actual.data_classes.length === 0
    || actual.data_classes.some((value) => !limits.data_classes.includes(value))
  ) {
    throw new GenesisError("ACTUAL_DATA_CLASS_EXCEEDED", "Actual data use is outside the approved classes", {
      path: "/actual_exposure/data_classes",
      correction: `Use only actually accessed approved classes: ${limits.data_classes.join(", ")}`,
      escalation: "human_authority",
    });
  }
  const approvedRisk = RISK_LEVELS.indexOf(limits.risk_level);
  const actualRisk = RISK_LEVELS.indexOf(actual.risk_level);
  if (actualRisk < 0 || actualRisk > approvedRisk) {
    throw new GenesisError("ACTUAL_RISK_EXCEEDED", "Actual risk is outside the approved classification", {
      path: "/actual_exposure/risk_level",
      correction: `Use the factual risk at or below ${limits.risk_level}; escalate a higher classification`,
      escalation: "human_authority",
    });
  }
}

function recordExecutionProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  ensureExperimentExists(experimentEntries);
  const latestExperiment = latestExperimentEntry(entries);
  const latestApproval = latestApprovalEntry(entries);
  if (latestExperiment.record.status !== "active") {
    throw new GenesisError("COMMAND_UNAVAILABLE", "Only an active experiment can record execution", {
      path: "/experiment/status",
      correction: "Use status or genesis next for the current lifecycle state",
      escalation: "operator",
    });
  }

  const experiment = latestExperiment.record;
  const now = clock().toISOString();
  const startedAt = input.started_at || experiment.updated_at;
  const completedAt = input.completed_at || now;
  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt);
  const nowMs = Date.parse(now);
  if (
    !Number.isFinite(startedMs)
    || !Number.isFinite(completedMs)
    || startedMs < Date.parse(experiment.updated_at)
    || startedMs > completedMs
    || completedMs > nowMs
  ) {
    throw new GenesisError("EXECUTION_TIME_INVALID", "Execution timestamps are invalid", {
      path: "/actual_exposure/completed_at",
      correction: "Use start <= completion <= current time, with start no earlier than the active transition",
      escalation: "operator",
    });
  }

  requireExperimentApproval({
    approval: latestApproval?.record,
    experiment,
    actor: input.actor,
    now: startedAt,
  });
  requireExperimentApproval({
    approval: latestApproval?.record,
    experiment,
    actor: input.actor,
    now: completedAt,
  });

  const durationDays = (completedMs - startedMs) / 86_400_000;
  const actual = {
    cash_usd: input.actual_cost?.cash_usd,
    labor_hours: input.actual_cost?.labor_hours,
    duration_days: durationDays,
    data_classes: input.data_classes,
    risk_level: input.risk_level,
  };
  requireWithinActualEnvelope(actual, experiment.limits);

  const record = versionExperimentRecord(
    experiment,
    {
      status: "measurement",
      execution_log: input.execution_log,
      deviations: input.deviations ?? [],
      completion_reason: input.completion_reason,
      actual_exposure: {
        started_at: startedAt,
        completed_at: completedAt,
        duration_days: durationDays,
        data_classes: input.data_classes,
        risk_level: input.risk_level,
      },
      actual_cost: {
        cash_usd: input.actual_cost?.cash_usd,
        labor_hours: input.actual_cost?.labor_hours,
      },
    },
    latestExperiment.descriptor.relativePath,
    clock,
    { registry },
  );
  return {
    command: "record-execution",
    business_id: normalized,
    state: "measurement",
    record,
    records: [{
      kind: "experiment",
      record,
      version: latestExperiment.descriptor.version + 1,
    }],
  };
}

function recordMeasurementProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  ensureExperimentExists(experimentEntries);
  const latestExperiment = latestExperimentEntry(entries);
  if (latestExperiment.record.status !== "measurement") {
    throw new GenesisError("COMMAND_UNAVAILABLE", "Only an experiment awaiting measurement can record a result", {
      path: "/experiment/status",
      correction: "Record execution first, or use status for the current lifecycle state",
      escalation: "analyst",
    });
  }
  if (input.reviewer !== "analyst") {
    throw new GenesisError("MEASUREMENT_REVIEWER_INVALID", "Experiment measurement requires the analyst role", {
      path: "/measurement_reviewer",
      correction: "Use analyst as the accountable measurement reviewer",
      escalation: "analyst",
    });
  }
  if (
    ["limited", "unreliable"].includes(input.data_quality?.assessment)
    && (!Array.isArray(input.data_quality?.limitations) || input.data_quality.limitations.length === 0)
  ) {
    throw new GenesisError("DATA_QUALITY_LIMITATION_REQUIRED", "Limited or unreliable measurement data requires an explicit limitation", {
      path: "/data_quality/limitations",
      correction: "Record at least one concrete data-quality limitation",
      escalation: "analyst",
    });
  }

  const record = versionExperimentRecord(
    latestExperiment.record,
    {
      status: "reflection",
      actual_result: input.actual_result,
      comparison: input.comparison,
      data_quality: {
        assessment: input.data_quality?.assessment,
        limitations: input.data_quality?.limitations ?? [],
      },
      measurement_reviewer: input.reviewer,
      measurement_evidence: input.measurement_evidence,
      results: input.actual_result,
    },
    latestExperiment.descriptor.relativePath,
    clock,
    { registry },
  );
  return {
    command: "record-measurement",
    business_id: normalized,
    state: "reflection",
    record,
    records: [{
      kind: "experiment",
      record,
      version: latestExperiment.descriptor.version + 1,
    }],
  };
}

function recordReflectionProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries, experienceEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  ensureExperimentExists(experimentEntries);
  if (experienceEntries.length > 0) {
    throw new GenesisError("COMMAND_UNAVAILABLE", "A reviewed experience already exists for this experiment", {
      path: "/experience",
      correction: "Use status or genesis next for the current lifecycle state",
      escalation: "analyst",
    });
  }
  const latestExperiment = latestExperimentEntry(entries);
  const latestDecision = latestDecisionEntry(entries);
  if (latestExperiment.record.status !== "reflection") {
    throw new GenesisError("COMMAND_UNAVAILABLE", "Only a measured experiment can record reflection", {
      path: "/experiment/status",
      correction: "Record measurement first, or use status for the current lifecycle state",
      escalation: "analyst",
    });
  }
  if (input.reviewer !== "analyst") {
    throw new GenesisError("REFLECTION_REVIEWER_INVALID", "Experiment reflection requires the analyst role", {
      path: "/owner",
      correction: "Use analyst as the reviewed-experience owner",
      escalation: "analyst",
    });
  }
  const now = clock();
  const validFrom = input.valid_from || now.toISOString();
  const validUntil = input.valid_until;
  if (!Number.isFinite(Date.parse(validUntil)) || Date.parse(validUntil) <= Date.parse(validFrom)) {
    throw new GenesisError("EXPERIENCE_VALIDITY_INVALID", "Experience validity window is invalid", {
      path: "/valid_until",
      correction: "Use a validity end later than the validity start",
      escalation: "analyst",
    });
  }

  const experiment = latestExperiment.record;
  const decision = latestDecision.record;
  const experienceId = `${normalized}-experience-001`;
  const supportingEvidence = unique(input.supporting_evidence ?? []);
  const contradictingEvidence = unique([
    ...(experiment.counterevidence ?? []),
    ...(input.contradicting_evidence ?? []),
  ]);
  const evidenceReferences = unique([
    ...supportingEvidence,
    ...contradictingEvidence,
    ...(experiment.measurement_evidence ?? []),
  ]);
  const experience = buildExperienceRecord({
    id: experienceId,
    business_id: normalized,
    evidence_references: evidenceReferences,
    related_records: [decision.id, experiment.id],
    privacy_classification: experiment.privacy_classification,
    immutable_history_refs: [`records/experiences/${experienceId}.v0001.yaml`],
    domain: input.domain,
    tags: input.tags,
    context: input.context,
    hypothesis: experiment.hypothesis,
    decision: decision.decision,
    action: experiment.execution_log.join("; "),
    outcome: experiment.actual_result,
    baseline: experiment.baseline,
    expected_result: experiment.expected_outcome,
    metric_definition: experiment.metric.formula,
    actual_result: experiment.actual_result,
    supporting_evidence: supportingEvidence,
    contradicting_evidence: contradictingEvidence,
    confidence: input.confidence_update,
    valid_from: validFrom,
    valid_until: validUntil,
    related: [decision.id, experiment.id],
    reflection: input.reflection,
    reusable_lesson: input.reusable_lesson,
    reuse_evidence: input.reuse_evidence ?? [],
  }, () => now, { registry });
  const reflectedExperiment = versionExperimentRecord(
    experiment,
    {
      status: "decision",
      validation_outcome: input.validation_outcome,
      reflection: input.reflection,
      confidence_update: input.confidence_update,
      experience_reference: experience.id,
    },
    latestExperiment.descriptor.relativePath,
    () => now,
    { registry },
  );
  return {
    command: "record-reflection",
    business_id: normalized,
    state: "decision",
    record: experience,
    records: [
      { kind: "experience", record: experience, version: 1 },
      {
        kind: "experiment",
        record: reflectedExperiment,
        version: latestExperiment.descriptor.version + 1,
      },
    ],
  };
}

function decideExperimentProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  ensureExperimentExists(experimentEntries);
  requireHumanAuthority(input.approver_principal_id);
  const latestExperiment = latestExperimentEntry(entries);
  const latestExperience = latestExperienceEntry(entries);
  const latestDecision = latestDecisionEntry(entries);
  const latestApproval = latestApprovalEntry(entries);
  if (latestExperiment.record.status !== "decision" || !latestExperience) {
    throw new GenesisError("COMMAND_UNAVAILABLE", "Outcome approval requires completed reflection and a reviewed experience", {
      path: "/experiment/status",
      correction: "Run record-reflection before deciding the experiment outcome",
      escalation: "human_authority",
    });
  }
  if (!latestExperiment.record.allowed_outcomes.includes(input.outcome)) {
    throw new GenesisError("OUTCOME_INVALID", "Outcome is outside the preregistered allowed set", {
      path: "/outcome",
      correction: `Use one of: ${latestExperiment.record.allowed_outcomes.join(", ")}`,
      escalation: "human_authority",
    });
  }

  const now = clock();
  const experiment = latestExperiment.record;
  const experience = latestExperience.record;
  const decision = latestDecision.record;
  const approvalVersion = (latestApproval?.descriptor.version ?? 0) + 1;
  const approvalId = `${normalized}-experiment-approval`;
  const approvalPath = `records/approvals/${approvalId}.v${String(approvalVersion).padStart(4, "0")}.yaml`;
  const issuedAt = now.toISOString();
  const candidate = buildApprovalRecord({
    id: approvalId,
    affected_business: normalized,
    status: "active",
    evidence_references: unique([
      ...experience.evidence_references,
      ...experiment.measurement_evidence,
    ]),
    related_records: [experiment.id, experience.id, decision.id],
    privacy_classification: experiment.privacy_classification,
    immutable_history_refs: [approvalPath],
    approver_role: "human_authority",
    approver_principal_id: input.approver_principal_id,
    requester: "ceo",
    actor: input.actor ?? "analyst",
    action_class: "major_bet",
    scope: { actions: [outcomeApprovalAction(experiment.id, input.outcome)], wildcard: false },
    evidence_snapshot: unique([
      ...experience.supporting_evidence,
      ...experience.contradicting_evidence,
      ...experiment.measurement_evidence,
    ]),
    limits: {
      cash_usd: 0,
      labor_hours: 0,
      duration_days: 0,
      data_classes: experiment.actual_exposure.data_classes,
      risk_level: experiment.actual_exposure.risk_level,
    },
    decision: "approved",
    rationale: input.rationale,
    issued_at: issuedAt,
    effective_at: input.effective_at || issuedAt,
    expires_at: input.expires_at,
    review_at: input.review_at,
    revoked: false,
    revocation_reference: null,
  }, () => now, { registry });
  const approval = latestApproval
    ? versionApprovalRecord(
        latestApproval.record,
        candidate,
        latestApproval.descriptor.relativePath,
        () => now,
        { registry },
      )
    : candidate;
  const decidedRecord = versionDecisionRecord(
    decision,
    {
      status: "active",
      owner: "ceo",
      evidence_references: unique([...decision.evidence_references, ...experience.evidence_references]),
      related_records: unique([...decision.related_records, experiment.id, experience.id, approval.id]),
      confidence: experiment.confidence_update,
      decision: input.outcome,
      decision_date: issuedAt,
      review_date: input.review_at,
      actual_outcome: experiment.actual_result,
      confidence_update: experiment.confidence_update,
      decision_class: "major_bet",
      recommendation_rationale: input.rationale,
      constitution_review: input.constitution_review,
      evidence_review: input.evidence_review,
      ceo_recommendation: input.ceo_recommendation,
      approval_references: [approval.id],
    },
    latestDecision.descriptor.relativePath,
    () => now,
    { registry },
  );
  const decidedExperiment = versionExperimentRecord(
    experiment,
    {
      status: "outcome_approved",
      outcome: input.outcome,
      decision_outcome: input.outcome,
    },
    latestExperiment.descriptor.relativePath,
    () => now,
    { registry },
  );
  return {
    command: "decide-experiment",
    business_id: normalized,
    state: "outcome_approved",
    guided: input.guided === true,
    record: approval,
    records: [
      { kind: "approval", record: approval, version: approvalVersion },
      { kind: "decision", record: decidedRecord, version: latestDecision.descriptor.version + 1 },
      { kind: "experiment", record: decidedExperiment, version: latestExperiment.descriptor.version + 1 },
    ],
  };
}

function closeExperimentProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  ensureExperimentExists(experimentEntries);
  const latestExperiment = latestExperimentEntry(entries);
  const latestExperience = latestExperienceEntry(entries);
  const latestDecision = latestDecisionEntry(entries);
  const latestApproval = latestApprovalEntry(entries);
  if (latestExperiment.record.status !== "outcome_approved" || !latestExperience) {
    throw new GenesisError("COMMAND_UNAVAILABLE", "Experiment is not ready for closure", {
      path: "/experiment/status",
      correction: "Obtain the exact Human Authority outcome decision before closure",
      escalation: "analyst",
    });
  }
  const now = clock();
  requireOutcomeApproval({
    approval: latestApproval?.record,
    experiment: latestExperiment.record,
    experience: latestExperience.record,
    decision: latestDecision.record,
    actor: input.actor,
    outcome: latestExperiment.record.decision_outcome,
    now: now.toISOString(),
  });
  const closedExperiment = versionExperimentRecord(
    latestExperiment.record,
    { status: "closed" },
    latestExperiment.descriptor.relativePath,
    () => now,
    { registry },
  );
  const closedExperience = versionExperienceRecord(
    latestExperience.record,
    {
      status: "closed",
      related_records: unique([...latestExperience.record.related_records, latestApproval.record.id]),
      related: unique([...latestExperience.record.related, latestApproval.record.id]),
    },
    latestExperience.descriptor.relativePath,
    () => now,
    { registry },
  );
  const closedDecision = versionDecisionRecord(
    latestDecision.record,
    { status: "closed" },
    latestDecision.descriptor.relativePath,
    () => now,
    { registry },
  );
  return {
    command: "close-experiment",
    business_id: normalized,
    state: "closed",
    record: closedExperiment,
    records: [
      { kind: "experience", record: closedExperience, version: latestExperience.descriptor.version + 1 },
      { kind: "decision", record: closedDecision, version: latestDecision.descriptor.version + 1 },
      { kind: "experiment", record: closedExperiment, version: latestExperiment.descriptor.version + 1 },
    ],
  };
}

function revokeApprovalProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  ensureExperimentExists(experimentEntries);
  requireHumanAuthority(input.approver_principal_id);
  const latestApproval = latestApprovalEntry(entries);
  if (!latestApproval || latestApproval.record.status !== "active" || latestApproval.record.decision !== "approved" || latestApproval.record.revoked) {
    throw new GenesisError("APPROVAL_NOT_ACTIVE", "No active approval is available to revoke", {
      path: "/approval",
      correction: "Review the latest approval record before revocation",
      escalation: "human_authority",
    });
  }

  const now = clock();
  const approval = versionApprovalRecord(
    latestApproval.record,
    {
      status: "revoked",
      rationale: input.rationale,
      revoked: true,
      revocation_reference: `human://genesis-owner/revocation/${now.toISOString()}`,
    },
    latestApproval.descriptor.relativePath,
    () => now,
    { registry },
  );
  const latestExperiment = latestExperimentEntry(entries);
  const records = [];
  if (latestExperiment.record.status === "active") {
    const experiment = versionExperimentRecord(
      latestExperiment.record,
      { status: "superseded" },
      latestExperiment.descriptor.relativePath,
      () => now,
      { registry },
    );
    records.push({
      kind: "experiment",
      record: experiment,
      version: latestExperiment.descriptor.version + 1,
    });
  }
  records.push({
    kind: "approval",
    record: approval,
    version: latestApproval.descriptor.version + 1,
  });
  return {
    command: "revoke-approval",
    business_id: normalized,
    state: "approval_revoked",
    record: approval,
    records,
  };
}

async function persistCommand({ projectRoot, registry, proposal, projectRecords = projectWrittenRecords }) {
  const written = [];
  const items = proposal.records ?? (proposal.record ? [
    {
      kind: proposal.record.record_type === "decision_record" ? "decision" : "experiment",
      record: proposal.record,
      version: 1,
    },
  ] : []);

  const savedRecords = await writeRecords({
    projectRoot,
    records: items.map((item) => ({
      kind: item.kind,
      id: item.record.id,
      version: item.version,
      value: item.record,
    })),
  });
  written.push(...items.map((item, index) => ({
    ...item,
    ...savedRecords[index],
  })));

  try {
    return {
      items,
      written,
      ...await projectRecords({ projectRoot, registry, written }),
    };
  } catch (cause) {
    return {
      items,
      written,
      projection_stale: true,
      warning: projectionIssue(cause),
    };
  }
}

export function createGenesisService({
  projectRoot,
  repoRoot,
  clock = DEFAULT_CLOCK,
  confirm = DEFAULT_CONFIRM,
  registry,
  projectRecords = projectWrittenRecords,
} = {}) {
  if (!projectRoot) {
    throw new GenesisError("PROJECT_ROOT_REQUIRED", "A project root is required", {
      path: "/projectRoot",
      correction: "Pass a workspace root directory when creating the service",
      escalation: "builder",
    });
  }

  const activeRegistry = registry ?? createSchemaRegistry(repoRoot ?? path.resolve(import.meta.dirname, "../.."));

  async function runWithProposal(buildProposal, commandName) {
    return withWorkspaceLock(projectRoot, async () => {
      const proposal = await buildProposal();
      if (!(await confirm(proposal))) {
        return proposalCancelled();
      }

      const persisted = await persistCommand({
        projectRoot,
        registry: activeRegistry,
        proposal,
        projectRecords,
      });

      const status = currentStatus({
        projectRoot,
        businessId: proposal.business_id,
        now: clock().toISOString(),
      });

      const primaryRecord = proposal.record ?? proposal.records.at(-1)?.record ?? null;
      const primaryPath = persisted.written.at(-1)?.relativePath ?? null;

      return {
        changed: true,
        command: commandName,
        business_id: proposal.business_id,
        state: status.state,
        next_command: status.next_command,
        status,
        record: primaryRecord,
        records: persisted.items.map((item, index) => ({
          ...item.record,
          path: persisted.written[index]?.relativePath ?? null,
        })),
        path: primaryPath,
        paths: persisted.written.map((item) => item.relativePath),
        projection_stale: persisted.projection_stale,
        warning: persisted.warning ?? null,
      };
    });
  }

  return {
    async startBusiness(input) {
      return runWithProposal(() => {
        const normalized = normalizeBusinessId(input.business_id);
        const { decisionEntries } = businessEntries(projectRoot, normalized);
        if (decisionEntries.length > 0) {
          throw new GenesisError("BUSINESS_ALREADY_EXISTS", "Business opportunity already exists", {
            path: "/business_id",
            correction: "Use add-evidence or plan-experiment for the existing opportunity",
            escalation: "builder",
          });
        }
        return startBusinessProposal({ ...input, business_id: normalized }, clock, activeRegistry);
      }, "start-business");
    },

    async startFollowUp(parentBusinessId, input) {
      return runWithProposal(
        () => startFollowUpProposal(projectRoot, parentBusinessId, input, clock, activeRegistry),
        "start-follow-up",
      );
    },

    async startLearningLab(parentBusinessId, input) {
      return runWithProposal(
        () => startLearningLabProposal(projectRoot, parentBusinessId, input, clock, activeRegistry),
        "start-learning-lab",
      );
    },

    async addEvidence(businessId, input) {
      return runWithProposal(() => addEvidenceProposal(projectRoot, businessId, input, clock, activeRegistry), "add-evidence");
    },

    async correctDecision(businessId, input) {
      return runWithProposal(
        () => correctDecisionProposal(projectRoot, businessId, input, clock, activeRegistry),
        "correct-decision",
      );
    },

    async planExperiment(businessId, input) {
      return runWithProposal(() => planExperimentProposal(projectRoot, businessId, input, clock, activeRegistry), "plan-experiment");
    },

    async reviseExperiment(businessId, input) {
      return runWithProposal(
        () => reviseExperimentProposal(projectRoot, businessId, input, clock, activeRegistry),
        "revise-experiment",
      );
    },

    async reviewExperiment(businessId) {
      return withWorkspaceLock(projectRoot, async () => {
        const normalized = normalizeBusinessId(businessId);
        const { entries, approvalEntries, decisionEntries, experimentEntries } = businessEntries(projectRoot, normalized);
        ensureBusinessExists(decisionEntries, normalized);
        ensureExperimentExists(experimentEntries);
        const experiment = latestExperimentEntry(entries).record;
        const approval = latestApprovalEntry(entries)?.record ?? null;
        return {
          business_id: normalized,
          state: currentStatus({ projectRoot, businessId: normalized, now: clock().toISOString() }).state,
          experiment,
          approval,
          approval_history: approvalEntries.map(({ record }) => record),
          approval_validity: evaluateExperimentApproval({
            approval,
            experiment,
            actor: approval?.actor ?? experiment.owner,
            now: clock().toISOString(),
          }),
        };
      });
    },

    async approveExperiment(businessId, input) {
      return runWithProposal(
        () => approvalRecordProposal(projectRoot, businessId, input, "approved", clock, activeRegistry),
        "approve-experiment",
      );
    },

    async denyExperiment(businessId, input) {
      return runWithProposal(
        () => approvalRecordProposal(projectRoot, businessId, input, "denied", clock, activeRegistry),
        "deny-experiment",
      );
    },

    async startExperiment(businessId, input) {
      return runWithProposal(
        () => startExperimentProposal(projectRoot, businessId, input, clock, activeRegistry),
        "start-experiment",
      );
    },

    async recordExecution(businessId, input) {
      return runWithProposal(
        () => recordExecutionProposal(projectRoot, businessId, input, clock, activeRegistry),
        "record-execution",
      );
    },

    async recordMeasurement(businessId, input) {
      return runWithProposal(
        () => recordMeasurementProposal(projectRoot, businessId, input, clock, activeRegistry),
        "record-measurement",
      );
    },

    async recordReflection(businessId, input) {
      return runWithProposal(
        () => recordReflectionProposal(projectRoot, businessId, input, clock, activeRegistry),
        "record-reflection",
      );
    },

    async decideExperiment(businessId, input) {
      return runWithProposal(
        () => decideExperimentProposal(projectRoot, businessId, input, clock, activeRegistry),
        "decide-experiment",
      );
    },

    async closeExperiment(businessId, input) {
      return runWithProposal(
        () => closeExperimentProposal(projectRoot, businessId, input, clock, activeRegistry),
        "close-experiment",
      );
    },

    async revokeApproval(businessId, input) {
      return runWithProposal(
        () => revokeApprovalProposal(projectRoot, businessId, input, clock, activeRegistry),
        "revoke-approval",
      );
    },

    async next(businessId) {
      return withWorkspaceLock(projectRoot, async () => guidedNextStep({
        projectRoot,
        businessId,
        clock,
      }));
    },

    async list(filters = {}) {
      return withWorkspaceLock(projectRoot, async () => listOpportunities({
        projectRoot,
        clock,
        filters,
      }));
    },

    async searchEvidence(query, filters = {}) {
      return withWorkspaceLock(projectRoot, async () => searchEvidence({
        projectRoot,
        query,
        filters,
      }));
    },

    async status(businessId) {
      return withWorkspaceLock(projectRoot, async () => currentStatus({
        projectRoot,
        businessId,
        now: clock().toISOString(),
      }));
    },

    async rebuildIndex() {
      return withWorkspaceLock(projectRoot, async () => {
        const rebuilt = await rebuildProjection({
          projectRoot,
          registry: activeRegistry,
        });
        return {
          ...rebuilt,
          projection_consistent: true,
        };
      });
    },
  };
}
