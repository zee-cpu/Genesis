import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW_PATH = path.join(REPO_ROOT, "config", "workflows", "experiment-lifecycle.yaml");
const WORKFLOW = YAML.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));
const PREREGISTRATION_REQUIRED_FIELDS = Object.freeze([
  ...(WORKFLOW.preregistration_required_fields ?? []),
]);

function toDate(value) {
  if (value instanceof Date) {
    return value;
  }

  return new Date(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isMissingValue(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

function getPathValue(object, pathParts) {
  let current = object;

  for (const part of pathParts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function orderedVersions(values = []) {
  return [...values].sort((left, right) => {
    const leftVersion = Number.isFinite(left?.version) ? left.version : 0;
    const rightVersion = Number.isFinite(right?.version) ? right.version : 0;
    if (leftVersion !== rightVersion) {
      return leftVersion - rightVersion;
    }

    const leftTime = toDate(left?.created_at ?? left?.updated_at ?? 0).getTime();
    const rightTime = toDate(right?.created_at ?? right?.updated_at ?? 0).getTime();
    return leftTime - rightTime;
  });
}

function firstRecordTime(values, keys) {
  const ordered = orderedVersions(values);
  const selected = ordered[0];
  if (!selected) {
    return null;
  }

  for (const key of keys) {
    if (selected[key]) {
      return toDate(selected[key]).getTime();
    }
  }

  return null;
}

function countByCode(blockedCommands = []) {
  const counts = {};

  for (const command of blockedCommands) {
    const code = command?.code;
    if (!code) {
      continue;
    }

    counts[code] = (counts[code] ?? 0) + 1;
  }

  return counts;
}

function completenessForExperiment(experiment) {
  let present = 0;

  for (const field of PREREGISTRATION_REQUIRED_FIELDS) {
    const value = getPathValue(experiment, field.split("."));
    if (field === "counterevidence" ? value !== null && value !== undefined : !isMissingValue(value)) {
      present += 1;
    }
  }

  return PREREGISTRATION_REQUIRED_FIELDS.length === 0
    ? 0
    : present / PREREGISTRATION_REQUIRED_FIELDS.length;
}

export function calculateMetrics(input = {}) {
  const decisionVersions = orderedVersions(input.decisionVersions);
  const experimentVersions = orderedVersions(input.experimentVersions);
  const now = toDate(input.now ?? new Date());
  const latestExperiment = experimentVersions.at(-1);
  const latestDecisionCreatedAt = firstRecordTime(decisionVersions, ["created_at", "updated_at"]);
  const latestExperimentPlanAt = firstRecordTime(experimentVersions, ["created_at", "updated_at"]);

  const supportingEvidenceCount = (input.evidence ?? []).filter((entry) => entry?.stance === "support").length;
  const contradictingEvidenceCount = (input.evidence ?? []).filter((entry) => entry?.stance === "contradict").length;

  return Object.freeze({
    supporting_evidence_count: supportingEvidenceCount,
    contradicting_evidence_count: contradictingEvidenceCount,
    discover_days: latestDecisionCreatedAt === null ? 0 : (now.getTime() - latestDecisionCreatedAt) / 86_400_000,
    time_to_validation_plan_days: latestDecisionCreatedAt === null || latestExperimentPlanAt === null
      ? 0
      : (latestExperimentPlanAt - latestDecisionCreatedAt) / 86_400_000,
    preregistration_completeness: latestExperiment ? completenessForExperiment(latestExperiment) : 0,
    confidence_history: decisionVersions
      .map((version) => version?.confidence)
      .filter(isFiniteNumber),
    blocked_commands_by_code: countByCode(input.blockedCommands),
    projection_consistent: Boolean(input.consistency?.consistent ?? input.consistency),
  });
}

export { PREREGISTRATION_REQUIRED_FIELDS };
