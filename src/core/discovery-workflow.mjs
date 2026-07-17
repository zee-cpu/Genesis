import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

import { calculateMetrics, PREREGISTRATION_REQUIRED_FIELDS } from "./metrics.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW_PATH = path.join(REPO_ROOT, "config", "workflows", "experiment-lifecycle.yaml");
const WORKFLOW = YAML.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));

function toDate(value) {
  if (value instanceof Date) {
    return value;
  }

  return new Date(value);
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

function requiredPaths() {
  return PREREGISTRATION_REQUIRED_FIELDS.map((field) => `/${field.replaceAll(".", "/")}`);
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

function latestVersion(values = []) {
  return orderedVersions(values).at(-1) ?? null;
}

function blocker(path, correction) {
  return {
    code: "DISCOVER_GATE_BLOCKED",
    path,
    correction,
    escalation: "builder",
  };
}

export function evaluateDiscoverGate({ decision, evidence }) {
  const blockers = [];

  if (isMissingValue(decision?.target_customer)) {
    blockers.push(blocker("/target_customer", "Provide target customer"));
  }

  if (isMissingValue(decision?.problem)) {
    blockers.push(blocker("/problem", "Provide problem"));
  }

  if (isMissingValue(decision?.hypothesis)) {
    blockers.push(blocker("/hypothesis", "Provide hypothesis"));
  }

  if (!Array.isArray(evidence) || evidence.length === 0) {
    blockers.push(blocker("/evidence", "Add at least one confirmed evidence entry"));
  }

  return {
    passed: blockers.length === 0,
    blockers,
  };
}

export function experimentCompleteness(experiment) {
  const required = requiredPaths();
  const present = [];
  const missing = [];

  for (const field of PREREGISTRATION_REQUIRED_FIELDS) {
    const pathName = `/${field.replaceAll(".", "/")}`;
    const value = getPathValue(experiment, field.split("."));
    if (field === "counterevidence" ? value === null || value === undefined : isMissingValue(value)) {
      missing.push(pathName);
    } else {
      present.push(pathName);
    }
  }

  return {
    complete: missing.length === 0,
    present,
    required,
    missing,
    ratio: required.length === 0 ? 0 : present.length / required.length,
  };
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

export function buildStatus({ decisionVersions = [], experimentVersions = [], evidence = [], blockedCommands = [], consistency, now } = {}) {
  const decision = latestVersion(decisionVersions);
  const experiment = latestVersion(experimentVersions);
  const discoverGate = evaluateDiscoverGate({ decision, evidence });
  const experimentCompletenessResult = experimentCompleteness(experiment ?? {});
  const metrics = calculateMetrics({
    decisionVersions,
    experimentVersions,
    evidence,
    blockedCommands,
    consistency,
    now,
  });

  const hasExperiment = experiment !== null;
  const experimentIsComplete = experimentCompletenessResult.complete;
  const state = hasExperiment
    ? (experiment?.status === "draft" && experimentIsComplete ? "approval_pending" : "discover")
    : "discover";
  const nextCommand = hasExperiment
    ? (experimentIsComplete ? "status" : "plan-experiment")
    : (discoverGate.passed ? "plan-experiment" : "status");

  return {
    state,
    next_command: nextCommand,
    next_permitted_command: nextCommand,
    decision_versions: decisionVersions.length,
    experiment_versions: experimentVersions.length,
    evidence_count: evidence.length,
    discover_gate: discoverGate,
    experiment_completeness: experimentCompletenessResult,
    blocked_commands_by_code: countByCode(blockedCommands),
    projection_consistent: Boolean(consistency?.consistent ?? consistency),
    metrics,
  };
}
