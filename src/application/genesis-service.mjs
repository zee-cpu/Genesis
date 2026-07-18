import fs from "node:fs";
import path from "node:path";

import { buildDecisionRecord, buildEvidenceEntry, buildExperimentRecord, versionDecisionRecord } from "../core/record-builders.mjs";
import { evaluateDiscoverGate, buildStatus } from "../core/discovery-workflow.mjs";
import { GenesisError } from "../core/errors.mjs";
import { normalizeBusinessId } from "../core/ids.mjs";
import { createSchemaRegistry } from "../core/schema-registry.mjs";
import { listRecords, readRecord, writeRecord } from "../storage/yaml-record-store.mjs";
import { openProjection, projectRecord, projectionConsistency, recordBlockedCommand, rebuildProjection } from "../storage/projection.mjs";
import { withWorkspaceLock, workspacePaths } from "../storage/workspace.mjs";

const DEFAULT_CONFIRM = async () => true;
const DEFAULT_CLOCK = () => new Date();

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

function toRecordEntries(projectRoot) {
  return listRecords(projectRoot).map((descriptor) => ({
    descriptor,
    record: readRecord(descriptor.absolutePath),
  }));
}

function latestByVersion(entries) {
  return [...entries].sort((left, right) => left.descriptor.version - right.descriptor.version).at(-1) ?? null;
}

function businessEntries(projectRoot, businessId) {
  const normalized = normalizeBusinessId(businessId);
  const entries = toRecordEntries(projectRoot).filter(({ descriptor, record }) => (
    (descriptor.kind === "decision" && record.affected_business === normalized)
    || (descriptor.kind === "experiment" && record.affected_business === normalized)
    || (descriptor.kind === "evidence" && record.business_id === normalized)
  ));

  return {
    entries,
    decisionEntries: entries.filter(({ descriptor }) => descriptor.kind === "decision"),
    experimentEntries: entries.filter(({ descriptor }) => descriptor.kind === "experiment"),
    evidenceEntries: entries.filter(({ descriptor }) => descriptor.kind === "evidence"),
  };
}

function ensureBusinessExists(decisionEntries, businessId) {
  if (decisionEntries.length === 0) {
    throw new GenesisError("BUSINESS_NOT_FOUND", "Business opportunity does not exist", {
      path: "/business_id",
      correction: "Start the business opportunity before adding evidence or planning an experiment",
      escalation: "builder",
    });
  }
}

function existingExperimentOrThrow(experimentEntries) {
  if (experimentEntries.length > 0) {
    throw new GenesisError("COMMAND_UNAVAILABLE", "No command is available once approval pending exists", {
      path: "/next_command",
      correction: "Use status or rebuild-index; version one does not progress beyond approval_pending",
      escalation: "builder",
    });
  }
}

function projectionIssue(cause) {
  return new GenesisError("PROJECTION_STALE", "Canonical YAML is safe but SQLite is stale", {
    path: "/projection_consistent",
    correction: "Run genesis rebuild-index",
    escalation: "builder",
    cause,
  });
}

function latestDescriptor(entries) {
  return latestByVersion(entries);
}

function latestRecord(entries) {
  return latestDescriptor(entries)?.record ?? null;
}

function latestDecisionEntry(entries) {
  return latestDescriptor(entries.filter(({ descriptor }) => descriptor.kind === "decision"));
}

function latestExperimentEntry(entries) {
  return latestDescriptor(entries.filter(({ descriptor }) => descriptor.kind === "experiment"));
}

function evidenceSources(evidenceEntries) {
  return evidenceEntries.map(({ record }) => record.source_reference).filter(Boolean);
}

function evidenceIds(evidenceEntries) {
  return evidenceEntries.map(({ record }) => record.id).filter(Boolean);
}

function currentStatus({ projectRoot, businessId, now }) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries, evidenceEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);

  const latestDecision = latestDecisionEntry(entries);
  const latestExperiment = latestExperimentEntry(entries);
  const paths = workspacePaths(projectRoot);
  let consistency = { consistent: entries.length === 0, yamlCount: entries.length, projectedCount: 0 };
  let blockedCommands = [];

  if (fs.existsSync(paths.db)) {
    const db = openProjection(paths.db);
    try {
      consistency = projectionConsistency(db, entries.map(({ descriptor }) => descriptor));
      blockedCommands = db.prepare(
        "SELECT code FROM blocked_commands WHERE business_id = ? ORDER BY id",
      ).all(normalized);
    } finally {
      db.close();
    }
  }

  const status = buildStatus({
    decisionVersions: decisionEntries.map(({ record }) => record),
    experimentVersions: experimentEntries.map(({ record }) => record),
    evidence: evidenceEntries.map(({ record }) => record),
    blockedCommands,
    consistency,
    now,
  });

  return {
    business_id: normalized,
    latest_decision_version: latestDecision?.descriptor.version ?? null,
    latest_experiment_version: latestExperiment?.descriptor.version ?? null,
    latest_decision_path: latestDecision?.descriptor.relativePath ?? null,
    latest_experiment_path: latestExperiment?.descriptor.relativePath ?? null,
    limits: latestRecord(experimentEntries)?.limits ?? null,
    ...status,
  };
}

function verifyProjectionReference(db, relativePath) {
  const row = db.prepare("SELECT 1 AS present FROM record_versions WHERE relative_path = ?").get(relativePath);
  if (!row) {
    throw new Error(`projection missing record reference: ${relativePath}`);
  }
}

function projectWrittenRecords({ projectRoot, registry, written }) {
  const dbPath = workspacePaths(projectRoot).db;
  const db = openProjection(dbPath);
  try {
    for (const item of written) {
      projectRecord(db, {
        kind: item.kind,
        id: item.record.id,
        version: item.version,
        relativePath: item.relativePath,
      }, item.record);
      verifyProjectionReference(db, item.relativePath);
    }

    const consistency = projectionConsistency(db, listRecords(projectRoot));
    if (!consistency.consistent) {
      throw new Error("projection row count mismatch");
    }

    return { projection_stale: false, warning: null };
  } catch (cause) {
    return {
      projection_stale: true,
      warning: projectionIssue(cause),
    };
  } finally {
    db.close();
  }
}

function proposalCancelled() {
  return { changed: false, reason: "cancelled" };
}

function startBusinessProposal(input, clock, registry) {
  const businessId = normalizeBusinessId(input.business_id);
  const now = clock();
  const evidenceId = `${businessId}-evidence-001`;
  const sourceReferences = unique(input.evidence_references ?? [input.source_reference]);
  const evidenceRecord = buildEvidenceEntry({
    id: evidenceId,
    business_id: businessId,
    source_reference: input.source_reference,
    summary: input.summary,
    stance: input.stance,
    provenance: input.provenance,
    privacy_classification: input.privacy_classification,
  }, clock, { registry });

  const decisionRecord = buildDecisionRecord({
    business_id: businessId,
    owner: input.owner,
    evidence_references: sourceReferences,
    related_records: input.related_records ?? [evidenceId],
    immutable_history_refs: [`records/decisions/${businessId}-decision.v0001.yaml`],
    target_customer: input.target_customer,
    problem: input.problem,
    hypothesis: input.hypothesis,
    confidence: input.confidence,
    evidence: sourceReferences,
    counterevidence: input.counterevidence ?? [],
    alternatives: input.alternatives,
    expected_outcome: input.expected_outcome,
    metric: input.metric,
    decision: input.decision,
    review_date: input.review_date,
    privacy_classification: input.privacy_classification,
  }, clock, { registry });

  return {
    command: "start-business",
    business_id: businessId,
    state: "discover",
    records: [
      { kind: "evidence", record: evidenceRecord, version: 1 },
      { kind: "decision", record: decisionRecord, version: 1 },
    ],
  };
}

function addEvidenceProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries, evidenceEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  existingExperimentOrThrow(experimentEntries);

  const latestDecision = latestDecisionEntry(entries);
  const evidenceVersion = evidenceEntries.length + 1;
  const evidenceId = `${normalized}-evidence-${String(evidenceVersion).padStart(3, "0")}`;
  const evidenceRecord = buildEvidenceEntry({
    id: evidenceId,
    business_id: normalized,
    source_reference: input.source_reference,
    summary: input.summary,
    stance: input.stance,
    provenance: input.provenance,
    privacy_classification: input.privacy_classification,
  }, clock, { registry });

  const currentDecision = latestDecision.record;
  const nextEvidenceReferences = unique([
    ...(currentDecision.evidence_references ?? []),
    evidenceRecord.source_reference,
  ]);
  const nextEvidence = unique([
    ...(currentDecision.evidence ?? []),
    evidenceRecord.source_reference,
  ]);
  const nextCounterevidence = evidenceRecord.stance === "contradict"
    ? unique([
        ...(currentDecision.counterevidence ?? []),
        evidenceRecord.source_reference,
      ])
    : currentDecision.counterevidence ?? [];
  const nextRelatedRecords = unique([
    ...(currentDecision.related_records ?? []),
    evidenceRecord.id,
  ]);

  const decisionRecord = versionDecisionRecord(
    currentDecision,
    {
      ...input.decision_changes,
      evidence_references: nextEvidenceReferences,
      evidence: nextEvidence,
      counterevidence: nextCounterevidence,
      related_records: nextRelatedRecords,
    },
    currentDecision.immutable_history_refs?.[0] ?? latestDecision.descriptor.relativePath,
    clock,
    { registry },
  );

  return {
    command: "add-evidence",
    business_id: normalized,
    state: "discover",
    records: [
      { kind: "evidence", record: evidenceRecord, version: evidenceVersion },
      {
        kind: "decision",
        record: decisionRecord,
        version: latestDecision.descriptor.version + 1,
      },
    ],
  };
}

function planExperimentProposal(projectRoot, businessId, input, clock, registry) {
  const normalized = normalizeBusinessId(businessId);
  const { entries, decisionEntries, experimentEntries, evidenceEntries } = businessEntries(projectRoot, normalized);
  ensureBusinessExists(decisionEntries, normalized);
  existingExperimentOrThrow(experimentEntries);

  const latestDecision = latestDecisionEntry(entries);
  const discoverGate = evaluateDiscoverGate({
    decision: latestDecision.record,
    evidence: evidenceEntries.map(({ record }) => record),
  });
  if (!discoverGate.passed) {
    const dbPath = workspacePaths(projectRoot).db;
    const db = openProjection(dbPath);
    try {
      recordBlockedCommand(db, {
        businessId: normalized,
        command: "plan-experiment",
        code: "DISCOVER_GATE_BLOCKED",
        occurredAt: clock().toISOString(),
      });
    } finally {
      db.close();
    }

    const blocker = discoverGate.blockers[0];
    throw new GenesisError("DISCOVER_GATE_BLOCKED", "Discover gate blocked", {
      path: blocker?.path ?? "/discover_gate",
      correction: blocker?.correction ?? "Complete the Discover gate before planning an experiment",
      escalation: blocker?.escalation ?? "builder",
    });
  }

  const supportingEvidence = evidenceEntries.filter(({ record }) => record.stance === "support");
  const contradictingEvidence = evidenceEntries.filter(({ record }) => record.stance === "contradict");
  const evidenceReferences = unique([
    ...evidenceSources(evidenceEntries),
    ...(latestDecision.record.evidence_references ?? []),
  ]);
  const relatedRecords = unique([
    latestDecision.record.id,
    ...evidenceIds(evidenceEntries),
    ...(latestDecision.record.related_records ?? []),
  ]);

  const experimentRecord = buildExperimentRecord({
    business_id: normalized,
    owner: input.owner ?? latestDecision.record.owner,
    evidence_references: evidenceReferences,
    related_records: relatedRecords,
    problem: input.problem ?? latestDecision.record.problem,
    supported_decision: input.supported_decision ?? latestDecision.record.id,
    hypothesis: input.hypothesis ?? latestDecision.record.hypothesis,
    confidence: input.confidence ?? latestDecision.record.confidence,
    evidence: input.evidence ?? supportingEvidence.map(({ record }) => record.source_reference),
    counterevidence: input.counterevidence ?? contradictingEvidence.map(({ record }) => record.source_reference),
    baseline: input.baseline,
    comparison_method: input.comparison_method,
    metric: input.metric,
    expected_outcome: input.expected_outcome,
    minimum_meaningful_effect: input.minimum_meaningful_effect,
    failure_conditions: input.failure_conditions,
    stop_conditions: input.stop_conditions,
    limits: input.limits,
    decision_date: input.decision_date,
    allowed_outcomes: input.allowed_outcomes,
    privacy_classification: input.privacy_classification ?? latestDecision.record.privacy_classification,
  }, clock, { registry });

  return {
    command: "plan-experiment",
    business_id: normalized,
    state: "approval_pending",
    record: experimentRecord,
    records: [
      { kind: "experiment", record: experimentRecord, version: 1 },
    ],
  };
}

async function persistCommand({ projectRoot, registry, proposal, projectRecords = projectWrittenRecords }) {
  const written = [];
  const items = proposal.records ?? (proposal.record ? [
    {
      kind: proposal.record.record_type === "decision_record" ? "decision" : "experiment",
      record: proposal.record,
      version: 1,
    },
  ] : []);

  for (const item of items) {
    const saved = await writeRecord({
      projectRoot,
      kind: item.kind,
      id: item.record.id,
      version: item.version,
      value: item.record,
    });
    written.push({
      ...item,
      ...saved,
    });
  }

  try {
    return {
      items,
      written,
      ...await projectRecords({ projectRoot, registry, written }),
    };
  } catch (cause) {
    return {
      items,
      written,
      projection_stale: true,
      warning: projectionIssue(cause),
    };
  }
}

export function createGenesisService({
  projectRoot,
  repoRoot,
  clock = DEFAULT_CLOCK,
  confirm = DEFAULT_CONFIRM,
  registry,
  projectRecords = projectWrittenRecords,
} = {}) {
  if (!projectRoot) {
    throw new GenesisError("PROJECT_ROOT_REQUIRED", "A project root is required", {
      path: "/projectRoot",
      correction: "Pass a workspace root directory when creating the service",
      escalation: "builder",
    });
  }

  const activeRegistry = registry ?? createSchemaRegistry(repoRoot ?? path.resolve(import.meta.dirname, "../.."));

  async function runWithProposal(buildProposal, commandName) {
    return withWorkspaceLock(projectRoot, async () => {
      const proposal = await buildProposal();
      if (!(await confirm(proposal))) {
        return proposalCancelled();
      }

      const persisted = await persistCommand({
        projectRoot,
        registry: activeRegistry,
        proposal,
        projectRecords,
      });

      const status = currentStatus({
        projectRoot,
        businessId: proposal.business_id,
        now: clock().toISOString(),
      });

      const primaryRecord = proposal.record ?? proposal.records.at(-1)?.record ?? null;
      const primaryPath = persisted.written.at(-1)?.relativePath ?? null;

      return {
        changed: true,
        command: commandName,
        business_id: proposal.business_id,
        state: status.state,
      next_command: status.next_command,
        status,
        record: primaryRecord,
        records: persisted.items.map((item, index) => ({
          ...item.record,
          path: persisted.written[index]?.relativePath ?? null,
        })),
        path: primaryPath,
        paths: persisted.written.map((item) => item.relativePath),
        projection_stale: persisted.projection_stale,
        warning: persisted.warning ?? null,
      };
    });
  }

  return {
    async startBusiness(input) {
      return runWithProposal(() => {
        const normalized = normalizeBusinessId(input.business_id);
        const { decisionEntries } = businessEntries(projectRoot, normalized);
        if (decisionEntries.length > 0) {
          throw new GenesisError("BUSINESS_ALREADY_EXISTS", "Business opportunity already exists", {
            path: "/business_id",
            correction: "Use add-evidence or plan-experiment for the existing opportunity",
            escalation: "builder",
          });
        }
        return startBusinessProposal({ ...input, business_id: normalized }, clock, activeRegistry);
      }, "start-business");
    },

    async addEvidence(businessId, input) {
      return runWithProposal(() => addEvidenceProposal(projectRoot, businessId, input, clock, activeRegistry), "add-evidence");
    },

    async planExperiment(businessId, input) {
      return runWithProposal(() => planExperimentProposal(projectRoot, businessId, input, clock, activeRegistry), "plan-experiment");
    },

    async status(businessId) {
      return withWorkspaceLock(projectRoot, async () => currentStatus({
        projectRoot,
        businessId,
        now: clock().toISOString(),
      }));
    },

    async rebuildIndex() {
      return withWorkspaceLock(projectRoot, async () => {
        const rebuilt = await rebuildProjection({
          projectRoot,
          registry: activeRegistry,
        });
        return {
          ...rebuilt,
          projection_consistent: true,
        };
      });
    },
  };
}
