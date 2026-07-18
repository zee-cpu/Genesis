import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputFlag = process.argv.indexOf("--output");
const persistentOutput = outputFlag >= 0 ? process.argv[outputFlag + 1] : null;
if (outputFlag >= 0 && !persistentOutput) {
  throw new Error("--output requires a directory");
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-package-"));
const outputDirectory = persistentOutput
  ? path.resolve(repoRoot, persistentOutput)
  : path.join(temporaryRoot, "artifacts");
const installDirectory = path.join(temporaryRoot, "install");
fs.mkdirSync(outputDirectory, { recursive: true });
fs.mkdirSync(installDirectory, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}\n${result.stderr ?? ""}`);
  }
  return result.stdout ?? "";
}

try {
  const packOutput = run("npm", [
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    outputDirectory,
  ], { capture: true });
  const packed = JSON.parse(packOutput).at(-1);
  assert.ok(packed?.filename, "npm pack did not report a tarball");
  const filePaths = packed.files.map((file) => file.path);
  for (const required of [
    "bin/genesis.mjs",
    "LICENSE",
    "NOTICE",
    "genesis.yaml",
    "src/cli/run-cli.mjs",
    "schemas/genesis.schema.json",
    "templates/decision-record.yaml",
  ]) {
    assert.equal(filePaths.includes(required), true, `package is missing ${required}`);
  }
  for (const forbidden of [
    ".github/",
    "docs/reviews/",
    "records/",
    "site/",
    "src/experiments/",
    "tests/",
  ]) {
    assert.equal(filePaths.some((file) => file.startsWith(forbidden)), false, `package leaked ${forbidden}`);
  }

  fs.writeFileSync(path.join(installDirectory, "package.json"), "{\"private\":true}\n");
  const tarballPath = path.join(outputDirectory, packed.filename);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], {
    cwd: installDirectory,
  });
  const help = run("node", [
    path.join(installDirectory, "node_modules", "genesis-governance", "bin", "genesis.mjs"),
    "--help",
  ], { cwd: installDirectory, capture: true });
  assert.match(help, /genesis start-business/);
  assert.match(help, /genesis next <business-id>/);
  assert.match(help, /genesis search <query>/);
  const installedVersion = run("node", [
    path.join(installDirectory, "node_modules", "genesis-governance", "bin", "genesis.mjs"),
    "--version",
  ], { cwd: installDirectory, capture: true }).trim();
  assert.equal(installedVersion, packed.version);

  process.stdout.write(`${JSON.stringify({
    package: packed.filename,
    version: packed.version,
    files: packed.entryCount,
    size_bytes: packed.size,
    unpacked_size_bytes: packed.unpackedSize,
    smoke_test: "passed",
    output: persistentOutput ? path.relative(repoRoot, tarballPath) : "temporary",
  }, null, 2)}\n`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
