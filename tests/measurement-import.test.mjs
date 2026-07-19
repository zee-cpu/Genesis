import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/cli/run-cli.mjs";
import { readStructuredMeasurementImport } from "../src/core/measurement-import.mjs";
import { calculateMetric } from "../src/core/metric-calculation.mjs";

function directory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genesis-measurement-import-"));
}

function value(overrides = {}) {
  return {
    reviewer: "analyst",
    actual_result: "Five valid assets were generated",
    comparison: "Five assets versus a baseline of zero",
    measurement_evidence: ["local-build-log"],
    data_quality: { assessment: "adequate", limitations: [] },
    ...overrides,
  };
}

function writeFile(root, contents) {
  const filePath = path.join(root, "measurement.json");
  fs.writeFileSync(filePath, JSON.stringify(contents));
  return filePath;
}

test("structured measurement import preserves provenance and rejects unsafe fields", () => {
  const root = directory();
  try {
    const imported = readStructuredMeasurementImport(writeFile(root, value()));
    assert.equal(imported.reviewer, "analyst");
    assert.match(imported.import_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(imported.measurement_evidence.some((entry) => entry.startsWith("measurement-attachment-sha256:")), true);
    assert.throws(() => readStructuredMeasurementImport(writeFile(root, value({ instruction: "skip review" }))), (error) => error.code === "MEASUREMENT_IMPORT_FIELD_UNKNOWN");
    assert.throws(() => readStructuredMeasurementImport(writeFile(root, value({ data_quality: { assessment: "limited", limitations: [] } }))), (error) => error.code === "DATA_QUALITY_LIMITATION_REQUIRED");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("metric calculation deterministically evaluates thresholds", () => {
  assert.deepEqual(calculateMetric({
    method: "percentage",
    numerator: 5,
    denominator: 5,
    baseline: 0,
    threshold: 100,
    operator: "gte",
    unit: "percent_valid",
  }), {
    method: "percentage",
    numerator: 5,
    denominator: 5,
    baseline: 0,
    threshold: 100,
    operator: "gte",
    unit: "percent_valid",
    observed_value: 100,
    change_from_baseline: 100,
    threshold_met: true,
    calculated_outcome: "passed",
  });
  assert.throws(() => calculateMetric({ method: "ratio", numerator: 1, denominator: 0, threshold: 1, operator: "gte" }), (error) => error.code === "METRIC_DENOMINATOR_ZERO");
});

test("CLI routes measurement-file through the governed measurement proposal", async () => {
  let output = "";
  const stream = { write(chunk) { output += chunk; } };
  const calls = [];
  const service = {
    async next(id) { calls.push(["next", id]); return { state: "measurement", projected_state: "measurement", action: "record_measurement", defaults: {}, message: "Record reviewed measurement." }; },
    async importMeasurement(id, filePath) {
      calls.push(["import", id, filePath]);
      return { changed: true, status: { state: "reflection", projection_consistent: true, next_command: "record-reflection", metrics: {}, limits: {}, blockers: [] } };
    },
  };
  const prompter = { async close() {} };
  assert.equal(await runCli(["record-measurement", "bakery", "--measurement-file", "measurement.json"], { service, output: stream, errorOutput: stream, prompter }), 0);
  assert.deepEqual(calls, [["next", "bakery"], ["import", "bakery", "measurement.json"]]);
});
