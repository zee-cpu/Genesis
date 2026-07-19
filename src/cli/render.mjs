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
    `Experience versions: ${status.experience_versions ?? 0}`,
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
    `Human Authority signature: ${status.approval_signature_validity ? (status.approval_signature_validity.valid ? "verified" : status.approval_signature_validity.code) : "not recorded"}`,
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

export function renderOpportunityList(result) {
  if (result.opportunities.length === 0) {
    return "No opportunities found. Start one with: genesis start-business";
  }

  const lines = [
    `Opportunities: ${result.count}`,
    `Projection consistent: ${result.projection_consistent ? "yes" : "no"}`,
    "",
  ];
  for (const opportunity of result.opportunities) {
    lines.push(
      opportunity.business_id,
      `  State: ${opportunity.state}`,
      `  Next: genesis next ${opportunity.business_id} (${opportunity.next_command})`,
      `  Review: ${opportunity.review_due_at ?? "none"}${opportunity.review_due_at ? ` (${opportunity.review_status}, ${opportunity.review_type})` : ""}`,
      `  Blocker: ${opportunity.blocker ? `${opportunity.blocker.code} — ${opportunity.blocker.correction}` : "none"}`,
      `  Updated: ${opportunity.updated_at}`,
      "",
    );
  }
  return lines.join("\n").trimEnd();
}

export function renderEvidenceSearch(result) {
  if (result.results.length === 0) {
    return `No evidence matched: ${result.query}`;
  }
  const lines = [`Evidence matches: ${result.count}`, `Query: ${result.query}`, ""];
  for (const item of result.results) {
    lines.push(
      `${item.id} (${item.record_type})`,
      `  Business: ${item.business_id}`,
      `  Summary: ${item.summary}`,
      `  Source: ${item.source_reference ?? item.path}`,
      `  Stance: ${item.stance ?? "reviewed"}`,
      `  Privacy: ${item.privacy_classification}`,
      "",
    );
  }
  return lines.join("\n").trimEnd();
}

function markdownText(value) {
  return String(value ?? "not recorded")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(/([\\`*_[\]{}])/g, "\\$1")
    .replaceAll("|", "\\|")
    .replaceAll(/\r?\n/g, " ");
}

function markdownBullets(values) {
  if (!Array.isArray(values) || values.length === 0) return "- None recorded";
  return values.map((value) => `- ${markdownText(value)}`).join("\n");
}

export function renderBusinessReport(report) {
  const decision = report.records.decision?.record;
  const experiment = report.records.experiment?.record;
  const approval = report.records.approval?.record;
  const experience = report.records.experience?.record;
  const evidence = report.records.evidence ?? [];
  const limits = experiment?.limits;
  const evidenceRows = evidence.length > 0
    ? evidence.map(({ record }) => (
        `| ${markdownText(record.stance)} | ${markdownText(record.summary)} | ${markdownText(record.source_reference)} | ${markdownText(record.privacy_classification)} |`
      )).join("\n")
    : "| None | No evidence recorded | — | — |";

  return [
    `# Genesis Business Report: ${report.business_id}`,
    "",
    `Generated: ${report.generated_at}`,
    `Lifecycle state: **${report.lifecycle.state}**`,
    `Next command: \`genesis ${report.lifecycle.next_command} ${report.business_id}\``,
    "",
    "## Opportunity",
    "",
    `**Target customer:** ${markdownText(decision?.target_customer ?? "Not recorded")}`,
    "",
    `**Problem:** ${markdownText(decision?.problem ?? "Not recorded")}`,
    "",
    `**Hypothesis:** ${markdownText(decision?.hypothesis ?? "Not recorded")}`,
    "",
    `**Confidence:** ${decision?.confidence ?? "Not recorded"}`,
    "",
    `**Expected outcome:** ${markdownText(decision?.expected_outcome ?? "Not recorded")}`,
    "",
    `**Primary metric:** ${markdownText(decision?.metric ?? "Not recorded")}`,
    "",
    "### Alternatives",
    "",
    markdownBullets(decision?.alternatives),
    "",
    "## Evidence",
    "",
    "| Stance | Summary | Source | Privacy |",
    "|---|---|---|---|",
    evidenceRows,
    "",
    "## Experiment",
    "",
    experiment
      ? [
          `**Status:** ${experiment.status}`,
          "",
          `**Baseline:** ${markdownText(experiment.baseline)}`,
          "",
          `**Comparison:** ${markdownText(experiment.comparison_method)}`,
          "",
          `**Success threshold:** ${markdownText(experiment.minimum_meaningful_effect)}`,
          "",
          `**Metric formula:** ${markdownText(experiment.metric?.formula ?? "Not recorded")}`,
        ].join("\n")
      : "No experiment has been planned.",
    "",
    "### Limits",
    "",
    limits
      ? `- Cash: $${limits.cash_usd}\n- Labor: ${limits.labor_hours} hours\n- Duration: ${limits.duration_days} days\n- Data: ${limits.data_classes.join(", ")}\n- Risk: ${limits.risk_level}`
      : "- No experiment limits recorded",
    "",
    "### Result",
    "",
    `- Validation outcome: ${experiment?.validation_outcome ?? "pending"}`,
    `- Actual result: ${markdownText(experiment?.actual_result ?? "Not recorded")}`,
    `- Decision outcome: ${experiment?.decision_outcome ?? "Not recorded"}`,
    `- Actual cost: ${experiment?.actual_cost ? `$${experiment.actual_cost.cash_usd}, ${experiment.actual_cost.labor_hours} labor hours` : "Not recorded"}`,
    "",
    "## Governance",
    "",
    `- Approval decision: ${approval?.decision ?? "Not recorded"}`,
    `- Approval status: ${approval?.status ?? "Not recorded"}`,
    `- Approved actor: ${approval?.actor ?? "Not recorded"}`,
    `- Approval expires: ${approval?.expires_at ?? "Not recorded"}`,
    `- Approval currently valid: ${report.lifecycle.approval_valid ?? "Not applicable"}`,
    "",
    "## Learning",
    "",
    `- Reflection: ${markdownText(experience?.reflection ?? experiment?.reflection ?? "Not recorded")}`,
    `- Reusable lesson: ${markdownText(experience?.reusable_lesson ?? "Not recorded")}`,
    `- Confidence update: ${experience?.confidence_update ?? experiment?.confidence_update ?? "Not recorded"}`,
    "",
    "## Audit trail",
    "",
    `- Canonical records: ${report.audit.record_count}`,
    `- Decision versions: ${report.audit.decision_versions}`,
    `- Evidence records: ${report.audit.evidence_count}`,
    `- Experiment versions: ${report.audit.experiment_versions}`,
    `- Approval versions: ${report.audit.approval_versions}`,
    `- Experience versions: ${report.audit.experience_versions}`,
    `- Privacy classifications: ${report.audit.privacy_classifications.join(", ") || "none"}`,
    `- SQLite projection consistent: ${report.lifecycle.projection_consistent ? "yes" : "no"}`,
  ].join("\n");
}

export function renderIdentityStatus(status) {
  if (!status.configured) {
    return [
      "Human Authority identity: not set up",
      "Next: genesis identity setup",
      "Genesis will ask you to choose an SSH key and show its fingerprint before saving anything.",
    ].join("\n");
  }
  return [
    `Human Authority identity: ${status.valid ? "verified" : "not usable"}`,
    `Principal: ${status.principal_id}`,
    `Active key: ${status.active_key?.fingerprint ?? "none"}`,
    `Identity events: ${status.events.length}`,
    status.blocker ? `Action needed: ${status.blocker.correction}` : "Action needed: none",
  ].join("\n");
}

export function renderWorkspaceVerification(result) {
  const lines = [
    `Human Authority identity: ${result.identity.valid ? "verified" : "not ready"}`,
    `Signed approvals verified: ${result.summary.signed_valid}`,
    `Unsigned legacy approvals: ${result.summary.unsigned_legacy}`,
    `Invalid signed approvals: ${result.summary.invalid}`,
    `Ready to authorize new actions: ${result.authorizing_ready ? "yes" : "no"}`,
  ];
  const problems = result.approvals.filter((item) => !item.valid);
  if (problems.length > 0) {
    lines.push("", "Approval details:");
    for (const item of problems) {
      lines.push(`- ${item.path}: ${item.code} — ${item.message}`);
    }
  }
  return lines.join("\n");
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

export function renderOutcomeDecisionProposal(proposal) {
  const approval = proposal.record;
  const decision = proposal.records.find((item) => item.record?.record_type === "decision_record")?.record;
  return [
    "Human Authority Major Bet decision envelope",
    `Business: ${proposal.business_id}`,
    `Outcome: ${decision?.decision ?? "not recorded"}`,
    `Action: ${approval.scope.actions.join(", ")}`,
    `Closure actor: ${approval.actor}`,
    `Decision class: ${approval.action_class}`,
    `Evidence snapshot: ${renderList(approval.evidence_snapshot)}`,
    `Constitution review: ${decision?.constitution_review ?? "not recorded"}`,
    `Evidence review: ${decision?.evidence_review ?? "not recorded"}`,
    `CEO recommendation: ${decision?.ceo_recommendation ?? "not recorded"}`,
    `Rationale: ${approval.rationale}`,
    `Effective: ${approval.effective_at}`,
    `Review: ${approval.review_at}`,
    `Expires: ${approval.expires_at}`,
    "This approval authorizes only classification and closure of the recorded outcome; it does not authorize executing scale, pivot, deployment, spending, or external communication.",
  ].join("\n");
}

export function renderRebuildResult(result) {
  return [
    `Records rebuilt: ${result.recordCount}`,
    `Businesses rebuilt: ${result.businessCount}`,
    `Projection consistent: ${result.projection_consistent ? "yes" : "no"}`,
  ].join("\n");
}

export function renderSyncStatus(result) {
  const lines = [
    "Team sync status",
    `Local canonical resources: ${result.local_resources}`,
    `Content-addressed events: ${result.sync_events}`,
    `Local resources not prepared: ${result.missing_events}`,
    `Resources ready to apply: ${result.pending_resources}`,
    `Conflicts: ${result.conflicts.length}`,
    `Safe to apply: ${result.ready_to_apply ? "yes" : "no"}`,
  ];
  for (const conflict of result.conflicts) {
    lines.push(`- ${conflict.logical_path}: ${conflict.reason}`);
  }
  return lines.join("\n");
}

export function renderSyncPrepared(result) {
  return [
    renderSyncStatus(result),
    `Events created: ${result.events_created}`,
    `Git-ready directory: ${result.event_directory}`,
    "Genesis did not run git, contact a network, or push anything.",
  ].join("\n");
}

export function renderSyncApplied(result) {
  return [
    renderSyncStatus(result),
    `Resources applied: ${result.resources_applied}`,
    `Projection records: ${result.record_count}`,
    `Projection businesses: ${result.business_count}`,
    `SQLite projection consistent: ${result.projection_consistent ? "yes" : "no"}`,
  ].join("\n");
}

export function renderCliError(error) {
  return formatError(error);
}
