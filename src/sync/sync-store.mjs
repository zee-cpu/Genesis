import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import YAML from "yaml";

import { GenesisError } from "../core/errors.mjs";
import { verifyApprovalRecord } from "../security/approval-signatures.mjs";
import { canonicalDigest } from "../security/canonical-json.mjs";
import { inspectHumanAuthorityIdentity, listIdentityEvents } from "../security/identity-store.mjs";
import { rebuildProjection } from "../storage/projection.mjs";
import { listRecords, readRecord } from "../storage/yaml-record-store.mjs";
import { ensureWorkspace, workspacePaths } from "../storage/workspace.mjs";

const EVENT_FILE_PATTERN = /^(?<digest>[a-f0-9]{64})\.yaml$/;
const KIND_DIRECTORIES = new Map([
  ["approval", "approvals"],
  ["decision", "decisions"],
  ["experiment", "experiments"],
  ["experience", "experiences"],
  ["evidence", "evidence"],
]);
const KIND_RECORD_TYPES = new Map([
  ["approval", "approval_record"],
  ["decision", "decision_record"],
  ["experiment", "experiment_record"],
  ["experience", "experience_record"],
  ["evidence", "evidence_entry"],
]);

function syncError(code, message, correction, path_ = "/sync") {
  return new GenesisError(code, message, {
    path: path_,
    correction,
    escalation: code === "SYNC_CONFLICT" ? "human_authority" : "builder",
  });
}

function parseYaml(filePath) {
  const document = YAML.parseDocument(fs.readFileSync(filePath, "utf8"), {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw syncError("SYNC_EVENT_INVALID", "A sync event is not valid YAML", "Restore the unchanged event from Git history", filePath);
  }
  return document.toJS({ mapAsMap: false });
}

function eventBody(event) {
  const body = structuredClone(event);
  delete body.event_id;
  return body;
}

function expectedLogicalPath(event) {
  const version = String(event.version).padStart(4, "0");
  if (event.resource_type === "identity") {
    return `.genesis/identities/genesis-owner-identity.v${version}.yaml`;
  }
  return `.genesis/records/${KIND_DIRECTORIES.get(event.kind)}/${event.resource_id}.v${version}.yaml`;
}

function validatePayload(registry, event) {
  if (event.logical_path !== expectedLogicalPath(event)) {
    throw syncError("SYNC_PATH_MISMATCH", "A sync event points to the wrong canonical path", "Do not rename or edit sync events; restore the original event", event.logical_path);
  }
  if (event.content_digest !== canonicalDigest(event.payload)) {
    throw syncError("SYNC_CONTENT_TAMPERED", "A sync event payload does not match its digest", "Restore the unchanged event from Git history", event.logical_path);
  }
  if (event.event_id !== canonicalDigest(eventBody(event))) {
    throw syncError("SYNC_EVENT_TAMPERED", "A sync event identifier does not match its content", "Restore the unchanged event from Git history", event.logical_path);
  }
  if (event.resource_type === "identity") {
    registry.validateIdentityEvent(event.payload);
    if (event.payload.id !== event.resource_id || event.payload.version !== event.version) {
      throw syncError("SYNC_IDENTITY_MISMATCH", "Identity metadata does not match its signed payload", "Restore the original identity sync event", event.logical_path);
    }
    return;
  }
  const expectedType = KIND_RECORD_TYPES.get(event.kind);
  const payloadTypeMatches = event.kind === "evidence"
    ? event.payload.record_type === undefined
    : event.payload.record_type === expectedType;
  if (!expectedType || !payloadTypeMatches || event.payload.id !== event.resource_id) {
    throw syncError("SYNC_RECORD_MISMATCH", "Record metadata does not match its payload", "Restore the original record sync event", event.logical_path);
  }
  if (event.kind === "evidence") registry.validateEvidence(event.payload);
  else registry.validateRecord(expectedType, event.payload);
}

function makeEvent(resource) {
  const body = {
    record_type: "sync_event",
    schema_version: "1.0.0",
    resource_type: resource.resourceType,
    kind: resource.kind,
    resource_id: resource.id,
    version: resource.version,
    logical_path: resource.logicalPath,
    content_digest: canonicalDigest(resource.payload),
    payload: resource.payload,
  };
  return { event_id: canonicalDigest(body), ...body };
}

function localResources(projectRoot, registry) {
  ensureWorkspace(projectRoot);
  const records = listRecords(projectRoot).map((descriptor) => ({
    resourceType: "record",
    kind: descriptor.kind,
    id: descriptor.id,
    version: descriptor.version,
    logicalPath: descriptor.relativePath,
    absolutePath: descriptor.absolutePath,
    payload: readRecord(descriptor.absolutePath),
  }));
  for (const resource of records) validatePayload(registry, makeEvent(resource));

  const identities = listIdentityEvents(projectRoot, registry).map(({ relativePath, path: absolutePath, event }) => ({
    resourceType: "identity",
    kind: null,
    id: event.id,
    version: event.version,
    logicalPath: relativePath,
    absolutePath,
    payload: event,
  }));
  return [...records, ...identities].sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
}

export function listSyncEvents(projectRoot, registry) {
  const paths = ensureWorkspace(projectRoot);
  return fs.readdirSync(paths.syncEvents, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = entry.name.match(EVENT_FILE_PATTERN);
      if (!match) {
        throw syncError("SYNC_EVENT_FILENAME_INVALID", "The sync event filename is not content-addressed", "Keep only <sha256>.yaml event files in .genesis/sync/events", path.join(paths.syncEvents, entry.name));
      }
      const absolutePath = path.join(paths.syncEvents, entry.name);
      const event = parseYaml(absolutePath);
      registry.validateSyncEvent(event);
      if (event.event_id !== `sha256:${match.groups.digest}`) {
        throw syncError("SYNC_EVENT_FILENAME_MISMATCH", "The sync event filename and identifier disagree", "Restore the event under its original content-addressed filename", absolutePath);
      }
      validatePayload(registry, event);
      return { event, absolutePath, relativePath: path.relative(projectRoot, absolutePath) };
    })
    .sort((left, right) => left.event.event_id.localeCompare(right.event.event_id));
}

function analyze(projectRoot, registry) {
  const resources = localResources(projectRoot, registry);
  const entries = listSyncEvents(projectRoot, registry);
  const localByPath = new Map(resources.map((resource) => [resource.logicalPath, resource]));
  const eventById = new Map(entries.map((entry) => [entry.event.event_id, entry]));
  const eventsByPath = new Map();
  for (const entry of entries) {
    const group = eventsByPath.get(entry.event.logical_path) ?? [];
    group.push(entry);
    eventsByPath.set(entry.event.logical_path, group);
  }

  const conflicts = [];
  for (const [logicalPath, group] of eventsByPath) {
    const digests = new Set(group.map(({ event }) => event.content_digest));
    const local = localByPath.get(logicalPath);
    if (digests.size > 1) {
      conflicts.push({ logical_path: logicalPath, reason: "concurrent_versions", digests: [...digests].sort() });
    } else if (local && !digests.has(canonicalDigest(local.payload))) {
      conflicts.push({ logical_path: logicalPath, reason: "local_content_differs", digests: [...digests, canonicalDigest(local.payload)].sort() });
    }
  }

  const missingEvents = resources
    .map((resource) => makeEvent(resource))
    .filter((event) => !eventById.has(event.event_id));
  const pending = [...eventsByPath]
    .filter(([logicalPath, group]) => !localByPath.has(logicalPath) && new Set(group.map(({ event }) => event.content_digest)).size === 1)
    .map(([, group]) => group[0].event)
    .sort((left, right) => left.logical_path.localeCompare(right.logical_path));

  return { resources, entries, conflicts, missingEvents, pending };
}

export function syncStatus(projectRoot, registry) {
  const result = analyze(projectRoot, registry);
  return {
    local_resources: result.resources.length,
    sync_events: result.entries.length,
    missing_events: result.missingEvents.length,
    pending_resources: result.pending.length,
    conflicts: result.conflicts,
    ready_to_apply: result.conflicts.length === 0,
  };
}

function writeEvent(paths, event) {
  const digest = event.event_id.slice("sha256:".length);
  const eventPath = path.join(paths.syncEvents, `${digest}.yaml`);
  const handle = fs.openSync(eventPath, "wx", 0o600);
  try {
    fs.writeFileSync(handle, `${YAML.stringify(event)}\n`);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  return eventPath;
}

export function prepareSync(projectRoot, registry) {
  const paths = ensureWorkspace(projectRoot);
  const before = analyze(projectRoot, registry);
  if (before.conflicts.length > 0) {
    throw syncError("SYNC_CONFLICT", "Sync preparation found divergent content for the same immutable version", "Keep every event and request a separate Human Authority reconciliation decision; Genesis will not select a winner", before.conflicts[0].logical_path);
  }
  const written = [];
  try {
    for (const event of before.missingEvents) written.push(writeEvent(paths, event));
  } catch (error) {
    for (const eventPath of written) fs.unlinkSync(eventPath);
    throw error;
  }
  const after = syncStatus(projectRoot, registry);
  return { ...after, events_created: written.length, event_directory: path.relative(projectRoot, paths.syncEvents) };
}

function writePayload(root, event) {
  const target = path.resolve(root, event.logical_path);
  const workspaceRoot = path.resolve(root, ".genesis");
  if (!target.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw syncError("SYNC_PATH_UNSAFE", "A sync event escaped the Genesis workspace", "Restore the original sync event", event.logical_path);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, `${YAML.stringify(event.payload)}\n`, { flag: "wx", mode: 0o600 });
  return target;
}

function validateMergedView(projectRoot, registry, pending, approvalVerifier) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-sync-validation-"));
  try {
    ensureWorkspace(temporaryRoot);
    for (const resource of localResources(projectRoot, registry)) writePayload(temporaryRoot, makeEvent(resource));
    for (const event of pending) writePayload(temporaryRoot, event);

    const identity = inspectHumanAuthorityIdentity(temporaryRoot, registry);
    if (identity.configured && !identity.valid) {
      throw syncError(identity.blocker?.code ?? "IDENTITY_INVALID", "The merged identity history is invalid", identity.blocker?.correction ?? "Restore the complete signed identity history", "/identity");
    }
    for (const descriptor of listRecords(temporaryRoot).filter(({ kind }) => kind === "approval")) {
      const approval = readRecord(descriptor.absolutePath);
      if (!approval.signature) continue;
      const verified = approvalVerifier({ projectRoot: temporaryRoot, registry, record: approval });
      if (!verified.valid) {
        throw syncError(verified.code ?? "SIGNATURE_INVALID", "A merged signed approval failed verification", "Restore the approval and complete identity history from a trusted peer", descriptor.relativePath);
      }
    }
    rebuildProjection({ projectRoot: temporaryRoot, registry });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function publishPending(projectRoot, pending) {
  const paths = ensureWorkspace(projectRoot);
  const staging = path.join(paths.sync, `.apply-${randomUUID()}`);
  fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
  const staged = [];
  const published = [];
  try {
    for (const event of pending) {
      const stagedPath = path.join(staging, `${event.event_id.slice(7)}.yaml`);
      fs.writeFileSync(stagedPath, `${YAML.stringify(event.payload)}\n`, { flag: "wx", mode: 0o600 });
      const finalPath = path.resolve(projectRoot, event.logical_path);
      if (!finalPath.startsWith(`${paths.root}${path.sep}`)) {
        throw syncError("SYNC_PATH_UNSAFE", "A sync event escaped the Genesis workspace", "Restore the original sync event", event.logical_path);
      }
      fs.mkdirSync(path.dirname(finalPath), { recursive: true, mode: 0o700 });
      staged.push({ stagedPath, finalPath });
    }
    for (const item of staged) {
      fs.linkSync(item.stagedPath, item.finalPath);
      published.push(item.finalPath);
    }
    return published;
  } catch (cause) {
    for (const finalPath of published) fs.rmSync(finalPath, { force: true });
    if (cause?.code === "EEXIST") {
      throw syncError("SYNC_TARGET_EXISTS", "A canonical record appeared while applying sync", "Run genesis sync status again; no existing record was overwritten", cause.path);
    }
    throw cause;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export function applySync(projectRoot, registry, approvalVerifier = verifyApprovalRecord) {
  const before = analyze(projectRoot, registry);
  if (before.conflicts.length > 0) {
    throw syncError("SYNC_CONFLICT", "The merged event set contains divergent immutable versions", "Preserve both events and request a separate Human Authority reconciliation decision; Genesis will not select a winner", before.conflicts[0].logical_path);
  }
  validateMergedView(projectRoot, registry, before.pending, approvalVerifier);
  const published = publishPending(projectRoot, before.pending);
  let rebuilt;
  try {
    rebuilt = rebuildProjection({ projectRoot, registry });
  } catch (cause) {
    throw syncError("PROJECTION_STALE", "Synced YAML is safe but the SQLite projection could not be rebuilt", "Run genesis rebuild-index after correcting the reported projection issue", "/projection");
  }
  return {
    ...syncStatus(projectRoot, registry),
    resources_applied: published.length,
    record_count: rebuilt.recordCount,
    business_count: rebuilt.businessCount,
    projection_consistent: true,
  };
}
