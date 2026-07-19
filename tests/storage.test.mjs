import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureWorkspace, workspacePaths, withWorkspaceLock } from "../src/storage/workspace.mjs";
import {
  listRecords,
  readRecord,
  recoverRecordTransactions,
  writeRecord,
  writeRecords,
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
    for (const directory of [paths.root, paths.records, paths.approvals, paths.decisions, paths.experiments, paths.experiences, paths.evidence, paths.identities, paths.sync, paths.syncEvents]) {
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

test("writeRecords rolls back every published record when a batch collides", async () => {
  const projectRoot = makeProjectRoot();
  try {
    await writeRecord({
      projectRoot,
      kind: "evidence",
      id: "existing",
      version: 1,
      value: { id: "existing" },
    });

    await assert.rejects(
      () => writeRecords({
        projectRoot,
        records: [
          { kind: "decision", id: "new-decision", version: 1, value: { id: "new-decision" } },
          { kind: "evidence", id: "existing", version: 1, value: { id: "collision" } },
        ],
      }),
      (error) => error.code === "RECORD_VERSION_EXISTS",
    );

    assert.equal(
      fs.existsSync(path.join(workspacePaths(projectRoot).decisions, "new-decision.v0001.yaml")),
      false,
    );
    assert.deepEqual(
      readRecord(path.join(workspacePaths(projectRoot).evidence, "existing.v0001.yaml")),
      { id: "existing" },
    );
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("concurrent writes cannot replace an immutable record version", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const results = await Promise.allSettled([
      writeRecord({ projectRoot, kind: "decision", id: "race", version: 1, value: { winner: "left" } }),
      writeRecord({ projectRoot, kind: "decision", id: "race", version: 1, value: { winner: "right" } }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.code, "RECORD_VERSION_EXISTS");
    assert.equal(
      ["left", "right"].includes(readRecord(path.join(workspacePaths(projectRoot).decisions, "race.v0001.yaml")).winner),
      true,
    );
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("interrupted record publication rolls back from its transaction journal", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const paths = ensureWorkspace(projectRoot);
    const stagedPath = path.join(paths.decisions, ".interrupted.staged");
    const finalPath = path.join(paths.decisions, "interrupted.v0001.yaml");
    fs.writeFileSync(stagedPath, "id: interrupted\n", { mode: 0o600 });
    fs.linkSync(stagedPath, finalPath);
    const journalDirectory = path.join(paths.root, ".transactions");
    fs.mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(journalDirectory, "interrupted.json"), JSON.stringify({
      pid: 999999999,
      entries: [{
        stagedPath: path.relative(projectRoot, stagedPath),
        finalPath: path.relative(projectRoot, finalPath),
      }],
    }));

    await recoverRecordTransactions(projectRoot);
    assert.equal(fs.existsSync(stagedPath), false);
    assert.equal(fs.existsSync(finalPath), false);
    assert.deepEqual(fs.readdirSync(journalDirectory), []);
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

test("withWorkspaceLock reclaims confirmed stale locks and preserves ambiguous locks", async () => {
  const projectRoot = makeProjectRoot();
  try {
    const paths = ensureWorkspace(projectRoot);
    fs.writeFileSync(paths.lock, `999999999\n2026-07-17T00:00:00.000Z\n`, { mode: 0o600 });
    assert.equal(await withWorkspaceLock(projectRoot, async () => "recovered"), "recovered");
    assert.equal(fs.existsSync(paths.lock), false);

    fs.writeFileSync(paths.lock, "unknown owner\n", { mode: 0o600 });
    await assert.rejects(
      withWorkspaceLock(projectRoot, async () => {}),
      (error) => error.code === "WORKSPACE_LOCKED" && error.correction.includes("manually"),
    );
    assert.equal(fs.existsSync(paths.lock), true);
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
