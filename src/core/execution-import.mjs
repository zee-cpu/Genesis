import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { GenesisError } from "./errors.mjs";

const MAX_BYTES = 256 * 1024;
const REQUIRED_FIELDS = ["actor", "execution_log", "completion_reason", "started_at", "completed_at", "actual_cost", "data_classes", "risk_level"];
const OPTIONAL_FIELDS = ["deviations"];

function importError(code, message, correction, path_ = "/execution_file") {
  return new GenesisError(code, message, { path: path_, correction, escalation: "operator" });
}

function text(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw importError("EXECUTION_IMPORT_FIELD_REQUIRED", `Execution import needs a non-empty ${field}`, `Add ${field} to the JSON import file`, `/${field}`);
  }
  return value.trim();
}

function textList(value, field, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw importError("EXECUTION_IMPORT_LIST_INVALID", `${field} must be ${required ? "a non-empty" : "an"} array of non-empty strings`, `Provide ${field} as ${required ? "a non-empty" : "an"} JSON string array`, `/${field}`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function finiteNonNegative(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw importError("EXECUTION_IMPORT_NUMBER_INVALID", `${field} must be a non-negative finite number`, `Provide ${field} as a non-negative number`, `/${field}`);
  }
  return value;
}

function timestamp(value, field) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw importError("EXECUTION_IMPORT_TIMESTAMP_INVALID", `${field} must be a valid timestamp`, "Use an ISO-8601 timestamp such as 2026-07-19T12:00:00Z", `/${field}`);
  }
  return value;
}

export function readStructuredExecutionImport(filePath) {
  if (!filePath) throw importError("EXECUTION_IMPORT_FILE_REQUIRED", "Execution import needs a local JSON file", "Use genesis record-execution <business-id> --execution-file path/to/execution.json");
  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw importError("EXECUTION_IMPORT_FILE_UNREADABLE", "Execution import file could not be read", "Choose a readable local JSON file", resolved);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw importError("EXECUTION_IMPORT_FILE_UNSAFE", "Execution import must be a regular local file", "Use a regular JSON file, not a directory or symbolic link", resolved);
  }
  if (stat.size <= 0 || stat.size > MAX_BYTES) {
    throw importError("EXECUTION_IMPORT_FILE_SIZE_INVALID", "Execution import must be between 1 byte and 256 KiB", "Split large material into reviewed factual summaries", resolved);
  }
  let bytes;
  let value;
  try {
    bytes = fs.readFileSync(resolved);
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw importError("EXECUTION_IMPORT_JSON_INVALID", "Execution import is not a valid UTF-8 JSON object", "Provide one structured JSON object", resolved);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw importError("EXECUTION_IMPORT_JSON_INVALID", "Execution import must contain one JSON object", "Provide the documented execution fields", resolved);
  }
  const allowed = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw importError("EXECUTION_IMPORT_FIELD_UNKNOWN", "Execution import contains unsupported fields", `Remove: ${unknown.join(", ")}`, `/${unknown[0]}`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (value[field] === undefined) throw importError("EXECUTION_IMPORT_FIELD_REQUIRED", `Execution import needs ${field}`, `Add ${field} to the JSON import file`, `/${field}`);
  }
  if (!["completed", "stop_condition", "failure_condition"].includes(value.completion_reason)) {
    throw importError("EXECUTION_IMPORT_REASON_INVALID", "completion_reason is invalid", "Use completed, stop_condition, or failure_condition", "/completion_reason");
  }
  if (!value.actual_cost || typeof value.actual_cost !== "object" || Array.isArray(value.actual_cost)) {
    throw importError("EXECUTION_IMPORT_COST_INVALID", "actual_cost must contain cash_usd and labor_hours", "Provide actual_cost as an object", "/actual_cost");
  }
  const dataClasses = textList(value.data_classes, "data_classes", { required: true });
  if (dataClasses.some((item) => !["public", "internal"].includes(item))) {
    throw importError("EXECUTION_IMPORT_PRIVACY_FORBIDDEN", "Execution-file import accepts public or internal data only", "Remove confidential or restricted material before import", "/data_classes");
  }
  if (!["low", "medium", "high", "critical"].includes(value.risk_level)) {
    throw importError("EXECUTION_IMPORT_RISK_INVALID", "risk_level is invalid", "Use low, medium, high, or critical", "/risk_level");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    actor: text(value.actor, "actor"),
    execution_log: [...textList(value.execution_log, "execution_log", { required: true }), `Structured execution evidence attachment SHA-256:${digest}`],
    deviations: textList(value.deviations ?? [], "deviations"),
    completion_reason: value.completion_reason,
    started_at: timestamp(value.started_at, "started_at"),
    completed_at: timestamp(value.completed_at, "completed_at"),
    actual_cost: {
      cash_usd: finiteNonNegative(value.actual_cost.cash_usd, "actual_cost.cash_usd"),
      labor_hours: finiteNonNegative(value.actual_cost.labor_hours, "actual_cost.labor_hours"),
    },
    data_classes: dataClasses,
    risk_level: value.risk_level,
    import_digest: `sha256:${digest}`,
  };
}
