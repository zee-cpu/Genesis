import { open, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import Ajv from "ajv";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIRECTORY = path.join(SCRIPT_DIRECTORY, "output");
const LOG_DIRECTORY = path.join(SCRIPT_DIRECTORY, "logs");
const EXECUTION_LOG_PATH = path.join(LOG_DIRECTORY, "latest-generation.json");

const assetSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: [
    "$schema",
    "schema_version",
    "asset_id",
    "asset_type",
    "name",
    "description",
    "prompt_template",
    "input_schema",
    "example_input",
  ],
  properties: {
    $schema: { const: "http://json-schema.org/draft-07/schema#" },
    schema_version: { const: "1.0.0" },
    asset_id: { type: "string", pattern: "^[a-z][a-z0-9-]+$" },
    asset_type: { const: "agent_tool_configuration" },
    name: { type: "string", minLength: 3 },
    description: { type: "string", minLength: 10 },
    prompt_template: { type: "string", minLength: 10 },
    input_schema: { type: "object" },
    example_input: { type: "object" },
  },
};

const assets = [
  {
    $schema: "http://json-schema.org/draft-07/schema#",
    schema_version: "1.0.0",
    asset_id: "weather-forecast-tool",
    asset_type: "agent_tool_configuration",
    name: "Weather Forecast Tool",
    description: "Collects a normalized location and forecast window for a weather provider.",
    prompt_template: "Return a concise weather forecast for {{location}} covering {{forecast_days}} day(s).",
    input_schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      required: ["location", "forecast_days", "units"],
      properties: {
        location: { type: "string", minLength: 2 },
        forecast_days: { type: "integer", minimum: 1, maximum: 14 },
        units: { enum: ["metric", "imperial"] },
      },
    },
    example_input: { location: "Dubai, AE", forecast_days: 3, units: "metric" },
  },
  {
    $schema: "http://json-schema.org/draft-07/schema#",
    schema_version: "1.0.0",
    asset_id: "database-query-tool",
    asset_type: "agent_tool_configuration",
    name: "Read-Only Database Query Tool",
    description: "Defines a bounded, parameterized, read-only database query request.",
    prompt_template: "Execute the named read-only query {{query_name}} with the supplied parameters and row limit.",
    input_schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      required: ["query_name", "parameters", "max_rows"],
      properties: {
        query_name: { type: "string", pattern: "^[a-z][a-z0-9_]+$" },
        parameters: { type: "object" },
        max_rows: { type: "integer", minimum: 1, maximum: 1000 },
      },
    },
    example_input: { query_name: "recent_orders", parameters: { days: 7 }, max_rows: 100 },
  },
  {
    $schema: "http://json-schema.org/draft-07/schema#",
    schema_version: "1.0.0",
    asset_id: "code-review-prompt",
    asset_type: "agent_tool_configuration",
    name: "Structured Code Review Prompt",
    description: "Requests a bounded code review with explicit language, focus areas, and severity threshold.",
    prompt_template: "Review the supplied {{language}} code. Report only findings at or above {{minimum_severity}}.",
    input_schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      required: ["language", "source", "focus_areas", "minimum_severity"],
      properties: {
        language: { type: "string", minLength: 1 },
        source: { type: "string", minLength: 1 },
        focus_areas: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { enum: ["correctness", "security", "performance", "maintainability"] },
        },
        minimum_severity: { enum: ["low", "medium", "high", "critical"] },
      },
    },
    example_input: {
      language: "javascript",
      source: "export const sum = (a, b) => a + b;",
      focus_areas: ["correctness", "maintainability"],
      minimum_severity: "medium",
    },
  },
  {
    $schema: "http://json-schema.org/draft-07/schema#",
    schema_version: "1.0.0",
    asset_id: "http-api-request-tool",
    asset_type: "agent_tool_configuration",
    name: "Controlled HTTP API Request Tool",
    description: "Describes an allowlisted HTTP request without embedding credentials or unrestricted methods.",
    prompt_template: "Call the approved endpoint {{endpoint_id}} using {{method}} and return structured JSON.",
    input_schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      required: ["endpoint_id", "method", "query"],
      properties: {
        endpoint_id: { type: "string", pattern: "^[a-z][a-z0-9-]+$" },
        method: { enum: ["GET", "POST"] },
        query: {
          type: "object",
          additionalProperties: {
            anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
          },
        },
      },
    },
    example_input: { endpoint_id: "public-catalog", method: "GET", query: { page: 1 } },
  },
  {
    $schema: "http://json-schema.org/draft-07/schema#",
    schema_version: "1.0.0",
    asset_id: "json-schema-validation-tool",
    asset_type: "agent_tool_configuration",
    name: "JSON Schema Validation Tool",
    description: "Defines a deterministic request for validating a JSON value against a supplied schema.",
    prompt_template: "Validate {{document}} against {{schema}} and return a path-indexed error list.",
    input_schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      required: ["schema", "document", "all_errors"],
      properties: {
        schema: { type: "object" },
        document: {},
        all_errors: { type: "boolean" },
      },
    },
    example_input: {
      schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      document: { id: "asset-001" },
      all_errors: true,
    },
  },
];

function describeErrors(errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;

  // Parsing the exact serialized payload catches malformed output before disk installation.
  JSON.parse(serialized);

  let handle;
  try {
    handle = await open(temporaryPath, "w", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

async function generate() {
  const startedAt = new Date();
  const started = performance.now();
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validateAsset = ajv.compile(assetSchema);

  const assetIds = new Set(assets.map((asset) => asset.asset_id));
  if (assets.length !== 5 || assetIds.size !== assets.length) {
    throw new Error("asset catalog must contain exactly five unique assets");
  }

  await mkdir(OUTPUT_DIRECTORY, { recursive: true, mode: 0o700 });

  const validated = [];
  for (const asset of assets) {
    if (!validateAsset(asset)) {
      throw new Error(`${asset.asset_id}: asset envelope invalid: ${describeErrors(validateAsset.errors)}`);
    }

    const validateExample = ajv.compile(asset.input_schema);
    if (!validateExample(asset.example_input)) {
      throw new Error(`${asset.asset_id}: example input invalid: ${describeErrors(validateExample.errors)}`);
    }

    const fileName = `${asset.asset_id}.json`;
    JSON.parse(JSON.stringify(asset));
    validated.push({ asset, fileName });
  }

  const generated = [];
  for (const { asset, fileName } of validated) {
    await atomicWriteJson(path.join(OUTPUT_DIRECTORY, fileName), asset);
    generated.push(fileName);
    console.log(`[verified] ${fileName}`);
  }

  const completedAt = new Date();
  const elapsedMs = Number((performance.now() - started).toFixed(2));
  const telemetry = {
    started_at_local: startedAt.toString(),
    completed_at_local: completedAt.toString(),
    elapsed_ms: elapsedMs,
    assets_generated: generated.length,
    assets_verified: generated.length,
    generated_files: generated.sort(),
    network_operations: 0,
    output_directory: OUTPUT_DIRECTORY,
  };
  await mkdir(LOG_DIRECTORY, { recursive: true, mode: 0o700 });
  await atomicWriteJson(EXECUTION_LOG_PATH, telemetry);

  console.log("[asset-engine] generation complete");
  console.log(JSON.stringify(telemetry, null, 2));
}

generate().catch((error) => {
  console.error(`[asset-engine] failed: ${error.message}`);
  process.exitCode = 1;
});
