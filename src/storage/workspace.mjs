import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { GenesisError } from "../core/errors.mjs";

export function workspacePaths(projectRoot) {
  const root = path.resolve(projectRoot, ".genesis");
  const records = path.join(root, "records");
  return {
    root,
    records,
    approvals: path.join(records, "approvals"),
    decisions: path.join(records, "decisions"),
    experiments: path.join(records, "experiments"),
    evidence: path.join(records, "evidence"),
    db: path.join(root, "genesis.db"),
    lock: path.join(root, "workspace.lock"),
  };
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

export function ensureWorkspace(projectRoot) {
  const paths = workspacePaths(projectRoot);
  ensureDirectory(paths.root);
  ensureDirectory(paths.records);
  ensureDirectory(paths.approvals);
  ensureDirectory(paths.decisions);
  ensureDirectory(paths.experiments);
  ensureDirectory(paths.evidence);
  return paths;
}

function lockError(message, correction) {
  return new GenesisError("WORKSPACE_LOCKED", message, {
    path: "/workspace/lock",
    correction,
    escalation: "builder",
  });
}

async function reclaimStaleLock(lockPath) {
  let contents;
  try {
    contents = await fsp.readFile(lockPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw lockError(
      "The existing Genesis workspace lock cannot be inspected safely",
      "Verify the lock owner manually before removing .genesis/workspace.lock",
    );
  }

  const [pidText, timestampText, ...extra] = contents.trim().split("\n");
  const pid = Number(pidText);
  const timestamp = Date.parse(timestampText);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(timestamp) || extra.length > 0) {
    throw lockError(
      "The existing Genesis workspace lock is malformed or ambiguous",
      "Verify that no Genesis process is active, then remove .genesis/workspace.lock manually",
    );
  }

  try {
    process.kill(pid, 0);
    throw lockError(
      "The Genesis workspace is already locked by an active process",
      `Wait for process ${pid} to finish before retrying`,
    );
  } catch (error) {
    if (error instanceof GenesisError) {
      throw error;
    }
    if (error?.code !== "ESRCH") {
      throw lockError(
        "The existing Genesis workspace lock owner cannot be classified safely",
        "Verify the recorded process and lock manually before removing .genesis/workspace.lock",
      );
    }
  }

  const stalePath = `${lockPath}.stale.${randomUUID()}`;
  try {
    await fsp.rename(lockPath, stalePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw lockError(
      "A confirmed stale workspace lock could not be reclaimed",
      "Verify that no Genesis process is active, then remove .genesis/workspace.lock manually",
    );
  }
  await fsp.unlink(stalePath).catch(() => {});
  return true;
}

async function acquireLock(lockPath) {
  try {
    return await fsp.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  await reclaimStaleLock(lockPath);
  try {
    return await fsp.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw lockError(
        "The Genesis workspace was locked while reclaiming a stale lock",
        "Wait for the current workspace operation to finish before retrying",
      );
    }
    throw error;
  }
}

export async function withWorkspaceLock(projectRoot, operation) {
  const paths = ensureWorkspace(projectRoot);
  let handle;
  let operationError;
  let result;

  handle = await acquireLock(paths.lock);

  try {
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
    await handle.sync();
    result = await operation();
  } catch (error) {
    operationError = error;
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
  }

  let cleanupError;
  try {
    await fsp.unlink(paths.lock);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      cleanupError = error;
    }
  }

  if (operationError) {
    throw operationError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
  return result;
}
