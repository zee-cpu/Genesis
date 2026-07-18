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

  return [
    `Business ID: ${status.business_id}`,
    `State: ${status.state}`,
    `Next command: ${status.next_command ?? status.next_permitted_command ?? "status"}`,
    `Decision versions: ${status.decision_versions}`,
    `Experiment versions: ${status.experiment_versions}`,
    `Evidence count: ${status.evidence_count}`,
    `Supporting evidence: ${status.metrics?.supporting_evidence_count ?? 0}`,
    `Contradicting evidence: ${status.metrics?.contradicting_evidence_count ?? 0}`,
    `Discover gate: ${status.discover_gate?.passed ? "passed" : "blocked"}`,
    `Missing preregistration fields: ${renderList(status.experiment_completeness?.missing)}`,
    "Limits:",
    limits,
    `Blocked commands: ${blockedLines}`,
    `Projection consistent: ${status.projection_consistent ? "yes" : "no"}`,
    `Preregistration completeness: ${status.metrics?.preregistration_completeness ?? status.experiment_completeness?.ratio ?? 0}`,
    `Confidence history: ${(status.metrics?.confidence_history ?? []).join(", ") || "none"}`,
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
