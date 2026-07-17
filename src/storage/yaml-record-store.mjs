import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import YAML from "yaml";

import { GenesisError } from "../core/errors.mjs";
import { ensureWorkspace, workspacePaths } from "./workspace.mjs";

const KIND_DIRECTORIES = new Map([
  ["decision", "decisions"],
  ["experiment", "experiments"],
  ["evidence", "evidence"],
]);
const DIRECTORY_KINDS = new Map(Array.from(KIND_DIRECTORIES, ([kind, directory]) => [directory, kind]));

const RECORD_FILE_PATTERN = /^(?<id>.+)\.v(?<version>\d{4})\.ya?ml$/;

function recordDirectoryForKind(paths, kind) {
  const directory = KIND_DIRECTORIES.get(kind);
  if (!directory) {
    throw new GenesisError("RECORD_KIND_INVALID", "Record kind is not supported", {
      path: "/kind",
      correction: "Use decision, experiment, or evidence",
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

async function writeAtomicYaml(finalPath, value) {
  const directory = path.dirname(finalPath);
  const content = `${YAML.stringify(value)}\n`;
  const tempPath = path.join(
    directory,
    `.${path.basename(finalPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );

  let handle;
  try {
    handle = await fsp.open(tempPath, "wx", 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(tempPath, finalPath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fsp.unlink(tempPath).catch(() => {});
    throw error;
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
  const finalPath = recordPath(projectRoot, kind, id, version);
  ensureWorkspace(projectRoot);
  const directory = path.dirname(finalPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);

  if (fs.existsSync(finalPath)) {
    throw new GenesisError("RECORD_VERSION_EXISTS", "Record version already exists", {
      path: finalPath,
      correction: "Use the next version number for the record instead of overwriting an existing file",
      escalation: "builder",
    });
  }

  await writeAtomicYaml(finalPath, value);
  return {
    absolutePath: finalPath,
    relativePath: path.relative(projectRoot, finalPath),
  };
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
