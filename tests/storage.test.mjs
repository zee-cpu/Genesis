import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureWorkspace, workspacePaths, withWorkspaceLock } from "../src/storage/workspace.mjs";
import {
  listRecords,
  readRecord,
  writeRecord,
} from "../src/storage/yaml-record-store.mjs";

function makeProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genesis-storage-"));
}

function cleanupProjectRoot(projectRoot) {
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

test("workspace directories are private and deterministic", () => {
  const projectRoot = makeProjectRoot();
  try {
    const paths = ensureWorkspace(projectRoot);

    assert.equal(paths.root, path.join(projectRoot, ".genesis"));
    for (const directory of [paths.root, paths.records, paths.decisions, paths.experiments, paths.evidence]) {
      assert.equal(fs.existsSync(directory), true, directory);
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700, directory);
    }
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("writeRecord stores immutable YAML and rejects duplicate versions", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const value = {
      id: "bakery-decision",
      record_type: "decision_record",
      schema_version: "1.0.0",
      policy_version: "2.0.0",
    };

    const written = await writeRecord({
      projectRoot,
      kind: "decision",
      id: "bakery-decision",
      version: 1,
      value,
    });

    assert.equal(written.relativePath, ".genesis/records/decisions/bakery-decision.v0001.yaml");
    assert.deepEqual(readRecord(written.absolutePath), value);

    await assert.rejects(
      () => writeRecord({
        projectRoot,
        kind: "decision",
        id: "bakery-decision",
        version: 1,
        value,
      }),
      (error) => error.code === "RECORD_VERSION_EXISTS",
    );
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("writeRecord rejects unsupported kinds", async () => {
  const projectRoot = makeProjectRoot();
  try {
    await assert.rejects(
      () => writeRecord({
        projectRoot,
        kind: "invalid",
        id: "bakery-decision",
        version: 1,
        value: {},
      }),
      (error) => error.code === "RECORD_KIND_INVALID",
    );
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("withWorkspaceLock excludes competing locks and cleans up the lock file", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const paths = workspacePaths(projectRoot);

    await withWorkspaceLock(projectRoot, async () => {
      assert.equal(fs.existsSync(paths.lock), true);

      await assert.rejects(
        withWorkspaceLock(projectRoot, async () => {}),
        (error) => error.code === "WORKSPACE_LOCKED",
      );

      assert.equal(fs.existsSync(paths.lock), true);
    });

    assert.equal(fs.existsSync(paths.lock), false);

    await assert.rejects(
      withWorkspaceLock(projectRoot, async () => {
        throw new Error("boom");
      }),
      /boom/,
    );

    assert.equal(fs.existsSync(paths.lock), false);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("listRecords sorts by kind, id, and version and ignores tmp files", async () => {
  const projectRoot = makeProjectRoot();
  try {
    await writeRecord({
      projectRoot,
      kind: "experiment",
      id: "beta",
      version: 2,
      value: { id: "beta", version: 2 },
    });
    await writeRecord({
      projectRoot,
      kind: "decision",
      id: "alpha",
      version: 2,
      value: { id: "alpha", version: 2 },
    });
    await writeRecord({
      projectRoot,
      kind: "decision",
      id: "alpha",
      version: 1,
      value: { id: "alpha", version: 1 },
    });
    await writeRecord({
      projectRoot,
      kind: "evidence",
      id: "alpha",
      version: 1,
      value: { id: "alpha", version: 1 },
    });

    const tempPath = path.join(
      workspacePaths(projectRoot).records,
      "decisions",
      ".ignored.v0009.yaml.tmp",
    );
    fs.writeFileSync(tempPath, "temporary");

    const records = listRecords(projectRoot);
    assert.deepEqual(records.map(({ kind, id, version }) => ({ kind, id, version })), [
      { kind: "decision", id: "alpha", version: 1 },
      { kind: "decision", id: "alpha", version: 2 },
      { kind: "evidence", id: "alpha", version: 1 },
      { kind: "experiment", id: "beta", version: 2 },
    ]);
    assert.equal(records.every((record) => !record.relativePath.includes(".tmp")), true);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});
