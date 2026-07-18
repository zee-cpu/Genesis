import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import YAML from "yaml";

import { GenesisError } from "../core/errors.mjs";
import { ensureWorkspace, workspacePaths } from "./workspace.mjs";

const KIND_DIRECTORIES = new Map([
  ["approval", "approvals"],
  ["decision", "decisions"],
  ["experiment", "experiments"],
  ["experience", "experiences"],
  ["evidence", "evidence"],
]);
const DIRECTORY_KINDS = new Map(Array.from(KIND_DIRECTORIES, ([kind, directory]) => [directory, kind]));

const RECORD_FILE_PATTERN = /^(?<id>.+)\.v(?<version>\d{4})\.ya?ml$/;

function recordDirectoryForKind(paths, kind) {
  const directory = KIND_DIRECTORIES.get(kind);
  if (!directory) {
    throw new GenesisError("RECORD_KIND_INVALID", "Record kind is not supported", {
      path: "/kind",
      correction: "Use approval, decision, experiment, experience, or evidence",
      escalation: "builder",
    });
  }

  return paths[directory];
}

function recordPath(projectRoot, kind, id, version) {
  const paths = workspacePaths(projectRoot);
  const directory = recordDirectoryForKind(paths, kind);
  const versionLabel = String(version).padStart(4, "0");
  return path.join(directory, `${id}.v${versionLabel}.yaml`);
}

async function writeStagedYaml(stagedPath, value) {
  const content = `${YAML.stringify(value)}\n`;
  let handle;
  try {
    handle = await fsp.open(stagedPath, "wx", 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fsp.unlink(stagedPath).catch(() => {});
    throw error;
  }
}

async function syncDirectory(directory) {
  const handle = await fsp.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function transactionDirectory(projectRoot) {
  return path.join(workspacePaths(projectRoot).root, ".transactions");
}

function safeTransactionPath(projectRoot, relativePath) {
  const recordsRoot = workspacePaths(projectRoot).records;
  const absolutePath = path.resolve(projectRoot, relativePath);
  if (!absolutePath.startsWith(`${recordsRoot}${path.sep}`)) {
    throw new GenesisError("TRANSACTION_RECOVERY_REQUIRED", "Transaction journal contains an unsafe path", {
      path: relativePath,
      correction: "Inspect .genesis/.transactions manually and preserve canonical records",
      escalation: "builder",
    });
  }
  return absolutePath;
}

async function sameFile(leftPath, rightPath) {
  try {
    const [left, right] = await Promise.all([fsp.stat(leftPath), fsp.stat(rightPath)]);
    return left.dev === right.dev && left.ino === right.ino;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function rollbackTransaction(projectRoot, entries) {
  for (const entry of entries) {
    const stagedPath = safeTransactionPath(projectRoot, entry.stagedPath);
    const finalPath = safeTransactionPath(projectRoot, entry.finalPath);
    if (await sameFile(stagedPath, finalPath)) {
      await fsp.unlink(finalPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
    await fsp.unlink(stagedPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

export async function recoverRecordTransactions(projectRoot) {
  const directory = transactionDirectory(projectRoot);
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const journalPath = path.join(directory, entry.name);
    let journal;
    try {
      journal = JSON.parse(await fsp.readFile(journalPath, "utf8"));
      if (!Number.isSafeInteger(journal.pid) || journal.pid <= 0 || !Array.isArray(journal.entries)) {
        throw new Error("pid and entries are required");
      }
      try {
        process.kill(journal.pid, 0);
        continue;
      } catch (error) {
        if (error?.code !== "ESRCH") {
          throw error;
        }
      }
      await rollbackTransaction(projectRoot, journal.entries);
      await fsp.unlink(journalPath);
    } catch (cause) {
      throw new GenesisError("TRANSACTION_RECOVERY_REQUIRED", "An interrupted record transaction could not be recovered safely", {
        path: path.relative(projectRoot, journalPath),
        correction: "Inspect the transaction journal and canonical YAML records before retrying",
        escalation: "builder",
        cause,
      });
    }
  }
}

function walkRecords(directory, projectRoot, results) {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkRecords(absolutePath, projectRoot, results);
      continue;
    }

    if (!entry.isFile() || entry.name.includes(".tmp")) {
      continue;
    }

    const match = entry.name.match(RECORD_FILE_PATTERN);
    if (!match) {
      continue;
    }

    const relativePath = path.relative(projectRoot, absolutePath);
    const relativeSegments = path.relative(path.join(projectRoot, ".genesis", "records"), absolutePath).split(path.sep);
    const kind = DIRECTORY_KINDS.get(relativeSegments[0]);
    if (!kind) {
      continue;
    }
    results.push({
      kind,
      id: match.groups.id,
      version: Number(match.groups.version),
      absolutePath,
      relativePath,
    });
  }
}

export async function writeRecord({ projectRoot, kind, id, version, value }) {
  const [saved] = await writeRecords({
    projectRoot,
    records: [{ kind, id, version, value }],
  });
  return saved;
}

export async function writeRecords({ projectRoot, records }) {
  ensureWorkspace(projectRoot);
  await recoverRecordTransactions(projectRoot);
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }

  const transactionId = randomUUID();
  const transactionEntries = records.map(({ kind, id, version, value }) => {
    const finalPath = recordPath(projectRoot, kind, id, version);
    const stagedPath = path.join(
      path.dirname(finalPath),
      `.${path.basename(finalPath)}.${transactionId}.staged`,
    );
    return { kind, id, version, value, finalPath, stagedPath };
  });
  const uniqueFinalPaths = new Set(transactionEntries.map((entry) => entry.finalPath));
  if (uniqueFinalPaths.size !== transactionEntries.length) {
    throw new GenesisError("RECORD_VERSION_EXISTS", "Record batch contains duplicate version paths", {
      path: "/records",
      correction: "Assign one unique version to every record in the command",
      escalation: "builder",
    });
  }

  const journalDirectory = transactionDirectory(projectRoot);
  fs.mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(journalDirectory, 0o700);
  const journalPath = path.join(journalDirectory, `${transactionId}.json`);
  const journal = {
    id: transactionId,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    entries: transactionEntries.map((entry) => ({
      stagedPath: path.relative(projectRoot, entry.stagedPath),
      finalPath: path.relative(projectRoot, entry.finalPath),
    })),
  };

  try {
    for (const entry of transactionEntries) {
      await writeStagedYaml(entry.stagedPath, entry.value);
    }
    const journalHandle = await fsp.open(journalPath, "wx", 0o600);
    try {
      await journalHandle.writeFile(`${JSON.stringify(journal, null, 2)}\n`);
      await journalHandle.sync();
    } finally {
      await journalHandle.close();
    }
    await syncDirectory(journalDirectory);

    for (const entry of transactionEntries) {
      try {
        await fsp.link(entry.stagedPath, entry.finalPath);
      } catch (cause) {
        if (cause?.code === "EEXIST") {
          throw new GenesisError("RECORD_VERSION_EXISTS", "Record version already exists", {
            path: entry.finalPath,
            correction: "Use the next version number for the record instead of overwriting an existing file",
            escalation: "builder",
            cause,
          });
        }
        throw cause;
      }
    }
    for (const directory of new Set(transactionEntries.map((entry) => path.dirname(entry.finalPath)))) {
      await syncDirectory(directory);
    }

    await fsp.unlink(journalPath);
    await syncDirectory(journalDirectory);
    for (const entry of transactionEntries) {
      await fsp.unlink(entry.stagedPath).catch(() => {});
    }
  } catch (error) {
    try {
      await rollbackTransaction(projectRoot, journal.entries);
      await fsp.unlink(journalPath).catch(() => {});
    } catch (cause) {
      throw new GenesisError("TRANSACTION_RECOVERY_REQUIRED", "Record transaction rollback did not complete safely", {
        path: path.relative(projectRoot, journalPath),
        correction: "Inspect the transaction journal and canonical YAML records before retrying",
        escalation: "builder",
        cause,
      });
    }
    throw error;
  }

  return transactionEntries.map((entry) => ({
    absolutePath: entry.finalPath,
    relativePath: path.relative(projectRoot, entry.finalPath),
  }));
}

export function readRecord(absolutePath) {
  return YAML.parse(fs.readFileSync(absolutePath, "utf8"));
}

export function listRecords(projectRoot) {
  const paths = ensureWorkspace(projectRoot);
  const results = [];
  walkRecords(paths.records, projectRoot, results);
  return results.sort((left, right) => {
    const kindOrder = left.kind.localeCompare(right.kind);
    if (kindOrder !== 0) {
      return kindOrder;
    }

    const idOrder = left.id.localeCompare(right.id);
    if (idOrder !== 0) {
      return idOrder;
    }

    return left.version - right.version;
  });
}
