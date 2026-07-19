import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { GenesisError } from "./errors.mjs";

const MAX_BYTES = 256 * 1024;
const REQUIRED_FIELDS = ["reviewer", "actual_result", "comparison", "measurement_evidence", "data_quality"];
const OPTIONAL_FIELDS = ["calculation"];

function importError(code, message, correction, path_ = "/measurement_file") {
  return new GenesisError(code, message, { path: path_, correction, escalation: "analyst" });
}

function text(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw importError("MEASUREMENT_IMPORT_FIELD_REQUIRED", `Measurement import needs a non-empty ${field}`, `Add ${field} to the JSON import file`, `/${field}`);
  }
  return value.trim();
}

function textList(value, field, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw importError("MEASUREMENT_IMPORT_LIST_INVALID", `${field} must be ${required ? "a non-empty" : "an"} array of non-empty strings`, `Provide ${field} as ${required ? "a non-empty" : "an"} JSON string array`, `/${field}`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

export function readStructuredMeasurementImport(filePath) {
  if (!filePath) throw importError("MEASUREMENT_IMPORT_FILE_REQUIRED", "Measurement import needs a local JSON file", "Use genesis record-measurement <business-id> --measurement-file path/to/measurement.json");
  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw importError("MEASUREMENT_IMPORT_FILE_UNREADABLE", "Measurement import file could not be read", "Choose a readable local JSON file", resolved);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw importError("MEASUREMENT_IMPORT_FILE_UNSAFE", "Measurement import must be a regular local file", "Use a regular JSON file, not a directory or symbolic link", resolved);
  }
  if (stat.size <= 0 || stat.size > MAX_BYTES) {
    throw importError("MEASUREMENT_IMPORT_FILE_SIZE_INVALID", "Measurement import must be between 1 byte and 256 KiB", "Split large material into reviewed factual summaries", resolved);
  }
  let bytes;
  let value;
  try {
    bytes = fs.readFileSync(resolved);
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw importError("MEASUREMENT_IMPORT_JSON_INVALID", "Measurement import is not a valid UTF-8 JSON object", "Provide one structured JSON object", resolved);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw importError("MEASUREMENT_IMPORT_JSON_INVALID", "Measurement import must contain one JSON object", "Provide the documented measurement fields", resolved);
  }
  const unknown = Object.keys(value).filter((key) => ![...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].includes(key));
  if (unknown.length > 0) {
    throw importError("MEASUREMENT_IMPORT_FIELD_UNKNOWN", "Measurement import contains unsupported fields", `Remove: ${unknown.join(", ")}`, `/${unknown[0]}`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (value[field] === undefined) throw importError("MEASUREMENT_IMPORT_FIELD_REQUIRED", `Measurement import needs ${field}`, `Add ${field} to the JSON import file`, `/${field}`);
  }
  if (!value.data_quality || typeof value.data_quality !== "object" || Array.isArray(value.data_quality)) {
    throw importError("MEASUREMENT_IMPORT_DATA_QUALITY_INVALID", "data_quality must contain assessment and limitations", "Provide data_quality as an object", "/data_quality");
  }
  const dataQualityUnknown = Object.keys(value.data_quality).filter((key) => !["assessment", "limitations"].includes(key));
  if (dataQualityUnknown.length > 0) {
    throw importError("MEASUREMENT_IMPORT_FIELD_UNKNOWN", "data_quality contains unsupported fields", `Remove: ${dataQualityUnknown.join(", ")}`, `/data_quality/${dataQualityUnknown[0]}`);
  }
  if (!["adequate", "limited", "unreliable"].includes(value.data_quality.assessment)) {
    throw importError("MEASUREMENT_IMPORT_ASSESSMENT_INVALID", "data_quality.assessment is invalid", "Use adequate, limited, or unreliable", "/data_quality/assessment");
  }
  const limitations = textList(value.data_quality.limitations, "data_quality.limitations");
  if (value.data_quality.assessment !== "adequate" && limitations.length === 0) {
    throw importError("DATA_QUALITY_LIMITATION_REQUIRED", "Limited or unreliable measurement data requires an explicit limitation", "Add at least one factual data-quality limitation", "/data_quality/limitations");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    reviewer: text(value.reviewer, "reviewer"),
    actual_result: text(value.actual_result, "actual_result"),
    comparison: text(value.comparison, "comparison"),
    measurement_evidence: [
      ...textList(value.measurement_evidence, "measurement_evidence", { required: true }),
      `measurement-attachment-sha256:${digest}`,
    ],
    data_quality: { assessment: value.data_quality.assessment, limitations },
    ...(value.calculation === undefined ? {} : { calculation: value.calculation }),
    import_digest: `sha256:${digest}`,
  };
}
