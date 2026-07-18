import YAML from "yaml";

import { formatError } from "../core/errors.mjs";

function renderList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return "none";
  }

  return values.map((value) => `- ${value}`).join("\n");
}

function renderKeyValueLines(entries) {
  return entries
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export function renderProposal(proposal) {
  return [
    "Proposed record:",
    YAML.stringify(proposal).trimEnd(),
    "",
  ].join("\n");
}

export function renderStatus(status) {
  const blocked = status.blocked_commands_by_code ?? {};
  const blockedLines = Object.keys(blocked).length > 0
    ? Object.entries(blocked).map(([code, count]) => `${code}: ${count}`).join("\n")
    : "none";
  const limits = status.limits
    ? renderKeyValueLines([
        ["cash_usd", status.limits.cash_usd],
        ["labor_hours", status.limits.labor_hours],
        ["duration_days", status.limits.duration_days],
        ["data_classes", Array.isArray(status.limits.data_classes) ? status.limits.data_classes.join(", ") : status.limits.data_classes],
        ["risk_level", status.limits.risk_level],
      ])
    : "none";
  const approvalBlockers = status.approval_validity?.blockers ?? [];

  return [
    `Business ID: ${status.business_id}`,
    `State: ${status.state}`,
    `Next command: ${status.next_command ?? status.next_permitted_command ?? "status"}`,
    `Decision versions: ${status.decision_versions}`,
    `Experiment versions: ${status.experiment_versions}`,
    `Approval versions: ${status.approval_versions ?? 0}`,
    `Evidence count: ${status.evidence_count}`,
    `Supporting evidence: ${status.metrics?.supporting_evidence_count ?? 0}`,
    `Contradicting evidence: ${status.metrics?.contradicting_evidence_count ?? 0}`,
    `Discover gate: ${status.discover_gate?.passed ? "passed" : "blocked"}`,
    `Approval decision: ${status.approval?.decision ?? "none"}`,
    `Approval status: ${status.approval?.status ?? "none"}`,
    `Approved actor: ${status.approval?.actor ?? "none"}`,
    `Approval expires: ${status.approval?.expires_at ?? "none"}`,
    `Approval valid: ${status.approval_validity ? (status.approval_validity.valid ? "yes" : "no") : "not recorded"}`,
    `Approval blockers: ${renderList(approvalBlockers.map((item) => item.code))}`,
    `Missing preregistration fields: ${renderList(status.experiment_completeness?.missing)}`,
    "Limits:",
    limits,
    `Blocked commands: ${blockedLines}`,
    `Projection consistent: ${status.projection_consistent ? "yes" : "no"}`,
    `Preregistration completeness: ${status.metrics?.preregistration_completeness ?? status.experiment_completeness?.ratio ?? 0}`,
    `Confidence history: ${(status.metrics?.confidence_history ?? []).join(", ") || "none"}`,
  ].join("\n");
}

export function renderApprovalReview(review) {
  const blockers = review.approval_validity?.blockers ?? [];
  return [
    `Business ID: ${review.business_id}`,
    `State: ${review.state}`,
    "Experiment awaiting Human review:",
    YAML.stringify(review.experiment).trimEnd(),
    "",
    `Approval history: ${review.approval_history?.length ?? 0}`,
    review.approval
      ? `Latest approval:\n${YAML.stringify(review.approval).trimEnd()}`
      : "Latest approval: none",
    `Approval valid: ${review.approval_validity?.valid ? "yes" : "no"}`,
    `Approval blockers: ${renderList(blockers.map((item) => `${item.code}: ${item.correction}`))}`,
  ].join("\n");
}

export function renderNextGuidance(guidance) {
  const blocker = guidance.blocker;
  return [
    `Business ID: ${guidance.business_id}`,
    `Current state: ${guidance.state}`,
    `SQLite state: ${guidance.projected_state}`,
    guidance.message,
    `Guided action: ${guidance.action}`,
    blocker ? `Missing requirement: ${blocker.path} — ${blocker.correction}` : null,
  ].filter(Boolean).join("\n");
}

export function renderGuidedApprovalProposal(proposal) {
  const approval = proposal.record;
  const review = proposal.guided_review ?? {};
  const limits = approval.limits;
  return [
    "Human Authority decision envelope",
    `Business: ${proposal.business_id}`,
    `Decision: ${approval.decision}`,
    `Action: ${approval.scope.actions.join(", ")}`,
    `Actor: ${approval.actor}`,
    `Problem: ${review.problem ?? "not recorded"}`,
    `Hypothesis: ${review.hypothesis ?? "not recorded"}`,
    `Metric: ${review.metric?.formula ?? "not recorded"}`,
    `Expected outcome: ${review.expected_outcome ?? "not recorded"}`,
    `Minimum effect: ${review.minimum_meaningful_effect ?? "not recorded"}`,
    `Evidence: ${renderList(review.evidence)}`,
    `Counterevidence: ${renderList(review.counterevidence)}`,
    `Failure conditions: ${renderList(review.failure_conditions)}`,
    `Stop conditions: ${renderList(review.stop_conditions)}`,
    `Limits: $${limits.cash_usd} cash · ${limits.labor_hours} labor hours · ${limits.duration_days} days · ${limits.data_classes.join(", ")} data · ${limits.risk_level} risk`,
    `Effective: ${approval.effective_at}`,
    `Review: ${approval.review_at}`,
    `Expires: ${approval.expires_at}`,
    `Rationale: ${approval.rationale}`,
  ].join("\n");
}

export function renderRebuildResult(result) {
  return [
    `Records rebuilt: ${result.recordCount}`,
    `Businesses rebuilt: ${result.businessCount}`,
    `Projection consistent: ${result.projection_consistent ? "yes" : "no"}`,
  ].join("\n");
}

export function renderCliError(error) {
  return formatError(error);
}
