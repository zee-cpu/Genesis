import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { GenesisError } from "../core/errors.mjs";

export function workspacePaths(projectRoot) {
  const root = path.resolve(projectRoot, ".genesis");
  const records = path.join(root, "records");
  return {
    root,
    records,
    decisions: path.join(records, "decisions"),
    experiments: path.join(records, "experiments"),
    evidence: path.join(records, "evidence"),
    db: path.join(root, "workspace.sqlite"),
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
  ensureDirectory(paths.decisions);
  ensureDirectory(paths.experiments);
  ensureDirectory(paths.evidence);
  return paths;
}

export async function withWorkspaceLock(projectRoot, operation) {
  const paths = ensureWorkspace(projectRoot);
  let handle;
  let operationError;

  try {
    handle = await fsp.open(paths.lock, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new GenesisError("WORKSPACE_LOCKED", "The Genesis workspace is already locked", {
        path: "/workspace/lock",
        correction: "Wait for the current workspace operation to finish before retrying",
        escalation: "builder",
      });
    }
    throw error;
  }

  try {
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
    await handle.sync();
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }

    try {
      await fsp.unlink(paths.lock);
    } catch (error) {
      if (!operationError && error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
