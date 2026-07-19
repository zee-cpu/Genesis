import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { GenesisError } from "./errors.mjs";

const MAX_BYTES = 256 * 1024;
const REQUIRED_FIELDS = ["source_reference", "summary", "stance", "provenance", "privacy_classification"];
const OPTIONAL_FIELDS = ["observed_at"];

function importError(code, message, correction, path_ = "/file") {
  return new GenesisError(code, message, {
    path: path_,
    correction,
    escalation: "operator",
  });
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw importError("EVIDENCE_IMPORT_FIELD_REQUIRED", `Imported evidence needs a non-empty ${field}`, `Add ${field} to the JSON import file`, `/${field}`);
  }
  return value.trim();
}

function validateObservedAt(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw importError("EVIDENCE_IMPORT_TIMESTAMP_INVALID", "observed_at must be an ISO-8601 timestamp when supplied", "Use a value such as 2026-07-19T12:00:00Z", "/observed_at");
  }
  return value;
}

export function readStructuredEvidenceImport(filePath) {
  if (!filePath) {
    throw importError("EVIDENCE_IMPORT_FILE_REQUIRED", "Evidence import needs a local JSON file", "Use genesis import-evidence <business-id> --file path/to/evidence.json");
  }

  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (cause) {
    throw importError("EVIDENCE_IMPORT_FILE_UNREADABLE", "Evidence import file could not be read", "Choose a readable local JSON file", resolved);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw importError("EVIDENCE_IMPORT_FILE_UNSAFE", "Evidence import must be a regular local file", "Use a regular JSON file, not a directory or symbolic link", resolved);
  }
  if (stat.size <= 0 || stat.size > MAX_BYTES) {
    throw importError("EVIDENCE_IMPORT_FILE_SIZE_INVALID", "Evidence import must be between 1 byte and 256 KiB", "Split large material into reviewed summaries before importing", resolved);
  }

  let bytes;
  let value;
  try {
    bytes = fs.readFileSync(resolved);
    value = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    throw importError("EVIDENCE_IMPORT_JSON_INVALID", "Evidence import is not a valid UTF-8 JSON object", "Provide one structured JSON object", resolved);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw importError("EVIDENCE_IMPORT_JSON_INVALID", "Evidence import must contain one JSON object", "Provide an object with source_reference, summary, stance, provenance, and privacy_classification", resolved);
  }

  const allowed = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw importError("EVIDENCE_IMPORT_FIELD_UNKNOWN", "Evidence import contains unsupported fields", `Remove: ${unknown.join(", ")}`, `/${unknown[0]}`);
  }
  for (const field of REQUIRED_FIELDS) requiredText(value[field], field);
  if (!["support", "contradict"].includes(value.stance)) {
    throw importError("EVIDENCE_IMPORT_STANCE_INVALID", "stance must be support or contradict", "Set stance to support or contradict", "/stance");
  }
  if (!["public", "internal"].includes(value.privacy_classification)) {
    throw importError("EVIDENCE_IMPORT_PRIVACY_FORBIDDEN", "Structured import accepts public or internal evidence only", "Remove sensitive material and use public or internal classification", "/privacy_classification");
  }
  const observedAt = validateObservedAt(value.observed_at);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const importMarker = `Local structured import SHA-256:${digest}${observedAt ? `; observed_at=${observedAt}` : ""}`;

  return {
    source_reference: requiredText(value.source_reference, "source_reference"),
    summary: requiredText(value.summary, "summary"),
    stance: value.stance,
    provenance: `${requiredText(value.provenance, "provenance")}; ${importMarker}`,
    privacy_classification: value.privacy_classification,
    import_digest: `sha256:${digest}`,
    observed_at: observedAt,
  };
}
