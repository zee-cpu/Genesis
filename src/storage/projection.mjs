import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { GenesisError } from "../core/errors.mjs";
import { listRecords, readRecord } from "./yaml-record-store.mjs";
import { ensureWorkspace, workspacePaths } from "./workspace.mjs";

function dbPathFor(projectRoot) {
  return workspacePaths(projectRoot).db;
}

function tempDbPathFor(projectRoot) {
  return `${dbPathFor(projectRoot)}.rebuild.tmp`;
}

function recordTypeForKind(kind) {
  if (kind === "decision") return "decision_record";
  if (kind === "experiment") return "experiment_record";
  if (kind === "evidence") return "evidence_entry";

  throw new GenesisError("RECORD_KIND_INVALID", "Record kind is not supported", {
    path: "/kind",
    correction: "Use decision, experiment, or evidence",
    escalation: "builder",
  });
}

function schemaSql() {
  return `
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS record_versions (
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (record_type, record_id, version)
    );
    CREATE TABLE IF NOT EXISTS opportunities (
      business_id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      latest_decision_path TEXT NOT NULL,
      latest_experiment_path TEXT,
      support_count INTEGER NOT NULL,
      contradict_count INTEGER NOT NULL,
      confidence REAL NOT NULL,
      discover_started_at TEXT NOT NULL,
      validation_planned_at TEXT,
      projection_consistent INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS blocked_commands (
      id INTEGER PRIMARY KEY,
      business_id TEXT,
      command TEXT NOT NULL,
      code TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
  `;
}

function createOpportunityDefaults(businessId, decisionId, startedAt) {
  return {
    business_id: businessId,
    decision_id: decisionId,
    state: "discover",
    created_at: startedAt,
    updated_at: startedAt,
    latest_decision_path: "",
    latest_experiment_path: null,
    support_count: 0,
    contradict_count: 0,
    confidence: 0,
    discover_started_at: startedAt,
    validation_planned_at: null,
  };
}

function getOpportunity(db, businessId) {
  return db.prepare("SELECT * FROM opportunities WHERE business_id = ?").get(businessId) ?? null;
}

function upsertOpportunity(db, values) {
  const current = getOpportunity(db, values.business_id);
  const next = current
    ? {
        business_id: values.business_id,
        decision_id: values.decision_id ?? current.decision_id,
        state: values.state ?? current.state,
        created_at: values.created_at ?? current.created_at,
        updated_at: values.updated_at ?? current.updated_at,
        latest_decision_path: values.latest_decision_path ?? current.latest_decision_path,
        latest_experiment_path: values.latest_experiment_path ?? current.latest_experiment_path,
        support_count: values.support_count ?? current.support_count,
        contradict_count: values.contradict_count ?? current.contradict_count,
        confidence: values.confidence ?? current.confidence,
        discover_started_at: values.discover_started_at ?? current.discover_started_at,
        validation_planned_at: values.validation_planned_at ?? current.validation_planned_at,
      }
    : values;

  db.prepare(`
    INSERT INTO opportunities (
      business_id, decision_id, state, created_at, updated_at, latest_decision_path,
      latest_experiment_path, support_count, contradict_count, confidence,
      discover_started_at, validation_planned_at, projection_consistent
    )
    VALUES (
      @business_id, @decision_id, @state, @created_at, @updated_at, @latest_decision_path,
      @latest_experiment_path, @support_count, @contradict_count, @confidence,
      @discover_started_at, @validation_planned_at, 1
    )
    ON CONFLICT(business_id) DO UPDATE SET
      decision_id = excluded.decision_id,
      state = excluded.state,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      latest_decision_path = excluded.latest_decision_path,
      latest_experiment_path = excluded.latest_experiment_path,
      support_count = excluded.support_count,
      contradict_count = excluded.contradict_count,
      confidence = excluded.confidence,
      discover_started_at = excluded.discover_started_at,
      validation_planned_at = excluded.validation_planned_at,
      projection_consistent = 1
  `).run(next);
}

function upsertRecordVersion(db, descriptor, record) {
  const result = db.prepare(`
    INSERT INTO record_versions (record_type, record_id, version, relative_path, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(record_type, record_id, version) DO NOTHING
  `).run(
    descriptor.kind,
    descriptor.id,
    descriptor.version,
    descriptor.relativePath,
    record.updated_at ?? record.collected_at ?? record.created_at ?? new Date().toISOString(),
  );
  return result.changes === 1;
}

function recordKindForType(recordType) {
  if (recordType === "decision_record") return "decision";
  if (recordType === "experiment_record") return "experiment";
  if (recordType === "evidence_entry") return "evidence";
  throw new GenesisError("RECORD_SCHEMA_INVALID", "Record failed its registered schema", {
    path: "/record_type",
    correction: "Use a manifest-registered record type",
    escalation: "builder",
  });
}

function validateProjectionRecord(registry, descriptor, record) {
  const recordType = recordTypeForKind(descriptor.kind);
  if (recordType === "evidence_entry") {
    registry.validateEvidence(record);
  } else {
    registry.validateRecord(recordType, record);
  }
}

function projectDecision(db, descriptor, record) {
  const current = getOpportunity(db, record.affected_business);
  upsertOpportunity(db, current
    ? {
        business_id: record.affected_business,
        decision_id: record.id,
        state: current.state,
        created_at: current.created_at,
        updated_at: record.updated_at,
        latest_decision_path: descriptor.relativePath,
        latest_experiment_path: current.latest_experiment_path,
        support_count: current.support_count,
        contradict_count: current.contradict_count,
        confidence: record.confidence,
        discover_started_at: current.discover_started_at,
        validation_planned_at: current.validation_planned_at,
      }
    : {
        ...createOpportunityDefaults(record.affected_business, record.id, record.created_at),
        latest_decision_path: descriptor.relativePath,
        confidence: record.confidence,
      });
}

function projectEvidence(db, record) {
  const current = getOpportunity(db, record.business_id);
  const startedAt = current?.discover_started_at ?? record.collected_at;
  const currentCounts = current ?? createOpportunityDefaults(record.business_id, `${record.business_id}-decision`, startedAt);
  upsertOpportunity(db, {
    ...currentCounts,
    state: currentCounts.state ?? "discover",
    decision_id: currentCounts.decision_id ?? `${record.business_id}-decision`,
    created_at: currentCounts.created_at ?? startedAt,
    updated_at: record.collected_at,
    latest_decision_path: currentCounts.latest_decision_path ?? "",
    latest_experiment_path: currentCounts.latest_experiment_path ?? null,
    support_count: currentCounts.support_count + (record.stance === "support" ? 1 : 0),
    contradict_count: currentCounts.contradict_count + (record.stance === "contradict" ? 1 : 0),
    confidence: currentCounts.confidence,
    discover_started_at: currentCounts.discover_started_at ?? startedAt,
    validation_planned_at: currentCounts.validation_planned_at ?? null,
  });
}

function projectExperiment(db, descriptor, record) {
  const current = getOpportunity(db, record.affected_business);
  upsertOpportunity(db, current
    ? {
        business_id: record.affected_business,
        decision_id: current.decision_id,
        state: record.status === "draft" ? "approval_pending" : record.status,
        created_at: current.created_at,
        updated_at: record.updated_at,
        latest_decision_path: current.latest_decision_path,
        latest_experiment_path: descriptor.relativePath,
        support_count: current.support_count,
        contradict_count: current.contradict_count,
        confidence: current.confidence,
        discover_started_at: current.discover_started_at,
        validation_planned_at: record.decision_date,
      }
    : {
        ...createOpportunityDefaults(record.affected_business, `${record.affected_business}-decision`, record.created_at),
        state: record.status === "draft" ? "approval_pending" : record.status,
        latest_experiment_path: descriptor.relativePath,
        validation_planned_at: record.decision_date,
      });
}

export function openProjection(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(dbPath), 0o700);
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql());
  return db;
}

export function projectRecord(db, descriptor, record) {
  const transaction = db.transaction(() => {
    const inserted = upsertRecordVersion(db, descriptor, record);

    if (descriptor.kind === "decision") {
      projectDecision(db, descriptor, record);
      return;
    }

    if (descriptor.kind === "evidence") {
      if (inserted) {
        projectEvidence(db, record);
      }
      return;
    }

    if (descriptor.kind === "experiment") {
      projectExperiment(db, descriptor, record);
      return;
    }

    throw new GenesisError("RECORD_KIND_INVALID", "Record kind is not supported", {
      path: "/kind",
      correction: "Use decision, experiment, or evidence",
      escalation: "builder",
    });
  });

  return transaction();
}

export function recordBlockedCommand(db, event) {
  db.prepare(`
    INSERT INTO blocked_commands (business_id, command, code, occurred_at)
    VALUES (?, ?, ?, ?)
  `).run(
    event.businessId ?? event.business_id ?? null,
    event.command,
    event.code,
    event.occurredAt ?? event.occurred_at,
  );
}

export function readOpportunity(db, businessId) {
  return getOpportunity(db, businessId);
}

export function projectionConsistency(db, descriptors) {
  const yamlCount = descriptors.length;
  const projected = db.prepare(`
    SELECT record_type, record_id, version, relative_path
    FROM record_versions
  `).all();
  const projectedCount = projected.length;
  const identity = ({ kind, id, version, relativePath }) => (
    `${kind}\u0000${id}\u0000${version}\u0000${relativePath}`
  );
  const yamlIdentities = new Set(descriptors.map(identity));
  const projectedIdentities = new Set(projected.map((row) => identity({
    kind: row.record_type,
    id: row.record_id,
    version: row.version,
    relativePath: row.relative_path,
  })));
  const exactMatch = yamlIdentities.size === projectedIdentities.size
    && [...yamlIdentities].every((value) => projectedIdentities.has(value));
  return {
    consistent: exactMatch,
    yamlCount,
    projectedCount,
  };
}

export function rebuildProjection({ projectRoot, registry }) {
  if (!registry) {
    throw new GenesisError("REGISTRY_REQUIRED", "A schema registry must be supplied for rebuilds", {
      path: "/registry",
      correction: "Pass createSchemaRegistry(repoRoot) from the canonical repository root",
      escalation: "builder",
    });
  }

  ensureWorkspace(projectRoot);
  const descriptors = listRecords(projectRoot);
  const dbPath = dbPathFor(projectRoot);
  const tempPath = tempDbPathFor(projectRoot);
  fs.rmSync(tempPath, { force: true });

  const db = openProjection(tempPath);
  try {
    for (const descriptor of descriptors) {
      let record;
      try {
        record = readRecord(descriptor.absolutePath);
      } catch (cause) {
        throw new GenesisError("RECORD_SCHEMA_INVALID", "Record failed its registered schema", {
          path: descriptor.relativePath,
          correction: "fix the YAML syntax or duplicate keys",
          escalation: "builder",
          cause,
        });
      }
      validateProjectionRecord(registry, descriptor, record);
      projectRecord(db, descriptor, record);
    }

    const consistency = projectionConsistency(db, descriptors);
    if (!consistency.consistent) {
      throw new GenesisError("PROJECTION_INCONSISTENT", "Projection row count does not match YAML records", {
        path: "/projection_consistent",
        correction: "Rebuild the projection from the current YAML records",
        escalation: "builder",
      });
    }

    const businessCount = db.prepare("SELECT COUNT(*) AS count FROM opportunities").get().count;
    const recordCount = descriptors.length;
    db.close();
    fs.renameSync(tempPath, dbPath);
    return { recordCount, businessCount };
  } catch (error) {
    db.close();
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}
