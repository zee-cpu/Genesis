import { createHash } from "node:crypto";
import { open, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const GENERATOR_PATH = path.join(MODULE_DIRECTORY, "generator.mjs");
const EXECUTION_LOG_PATH = path.join(MODULE_DIRECTORY, "logs", "latest-generation.json");
const OUTPUT_DIRECTORY = path.join(MODULE_DIRECTORY, "output");
const PUBLIC_DIRECTORY = path.join(MODULE_DIRECTORY, "public");
const MANIFEST_PATH = path.join(PUBLIC_DIRECTORY, "agentic-digital-assets.manifest.json");

const EXPECTED_FILES = [
  "code-review-prompt.json",
  "database-query-tool.json",
  "http-api-request-tool.json",
  "json-schema-validation-tool.json",
  "weather-forecast-tool.json",
];

const GENERATOR_IMPORT_ALLOWLIST = new Set([
  "node:fs/promises",
  "node:path",
  "node:perf_hooks",
  "node:url",
  "ajv",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function auditGeneratorSource(source) {
  const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
    .map((match) => match[1]);
  const unexpectedImports = imports.filter((specifier) => !GENERATOR_IMPORT_ALLOWLIST.has(specifier));
  const networkCalls = [
    /\bfetch\s*\(/,
    /\bWebSocket\s*\(/,
    /\b(?:http|https)\.request\s*\(/,
    /\bnet\.connect\s*\(/,
  ].filter((pattern) => pattern.test(source));

  if (unexpectedImports.length > 0 || networkCalls.length > 0) {
    throw new Error(`offline boundary audit failed; unexpected imports: ${unexpectedImports.join(", ") || "none"}`);
  }
  return [...new Set(imports)].sort();
}

function validateGeneratorTelemetry(telemetry) {
  if (
    telemetry.assets_generated !== 5
    || telemetry.assets_verified !== 5
    || telemetry.network_operations !== 0
    || JSON.stringify(telemetry.generated_files) !== JSON.stringify(EXPECTED_FILES)
  ) {
    throw new Error("generator telemetry does not verify exactly five assets");
  }
  return telemetry;
}

async function atomicWrite(filePath, serialized) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "w", 0o644);
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

async function publish() {
  const generatorSource = await readFile(GENERATOR_PATH, "utf8");
  const auditedImports = auditGeneratorSource(generatorSource);

  // Inspect the generator's local execution log before packaging its output.
  const telemetry = validateGeneratorTelemetry(
    JSON.parse(await readFile(EXECUTION_LOG_PATH, "utf8")),
  );

  const outputFiles = (await readdir(OUTPUT_DIRECTORY))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();
  if (JSON.stringify(outputFiles) !== JSON.stringify(EXPECTED_FILES)) {
    throw new Error(`expected exactly five known JSON assets; found: ${outputFiles.join(", ")}`);
  }

  const assets = [];
  for (const fileName of EXPECTED_FILES) {
    const source = await readFile(path.join(OUTPUT_DIRECTORY, fileName), "utf8");
    const content = JSON.parse(source);
    if (`${content.asset_id}.json` !== fileName) {
      throw new Error(`${fileName}: asset_id does not match its file name`);
    }
    assets.push({
      file_name: fileName,
      sha256: sha256(source),
      content,
    });
  }

  const manifest = {
    distribution_schema_version: "1.0.0",
    package_id: "agentic-digital-assets",
    generated_at: new Date().toISOString(),
    asset_count: assets.length,
    network_boundary: {
      status: "offline_verified",
      external_requests: 0,
      audited_generator_imports: auditedImports,
      generator_assets_verified: telemetry.assets_verified,
      generator_elapsed_ms: telemetry.elapsed_ms,
    },
    assets,
  };

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  JSON.parse(serialized);
  await mkdir(PUBLIC_DIRECTORY, { recursive: true, mode: 0o755 });
  await atomicWrite(MANIFEST_PATH, serialized);

  console.log("[asset-publisher] staging complete");
  console.log(JSON.stringify({
    package_id: manifest.package_id,
    assets_packaged: manifest.asset_count,
    network_status: manifest.network_boundary.status,
    external_requests: manifest.network_boundary.external_requests,
    manifest_path: MANIFEST_PATH,
  }, null, 2));
}

publish().catch((error) => {
  console.error(`[asset-publisher] failed: ${error.message}`);
  process.exitCode = 1;
});
