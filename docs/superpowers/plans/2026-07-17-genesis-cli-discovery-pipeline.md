# Genesis CLI Discovery Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an offline, resumable `genesis` CLI that creates immutable Decision and Experiment YAML records, maintains a rebuildable SQLite projection, reports supported early metrics, and stops at `approval_pending` before any real-world experiment execution.

**Architecture:** The CLI is a thin terminal adapter over an application service. The service validates proposals against canonical Genesis schemas and workflow rules, writes append-only YAML first, and then updates a disposable SQLite projection. Deterministic offline suggestions assist the human without becoming evidence or advancing state. All state-changing commands are confirmed, locked, fail closed, and recoverable from YAML.

**Tech Stack:** Node.js 22, ECMAScript modules, npm, `yaml` 2.8.3, Ajv 8.18.0, `ajv-formats` 3.0.1, `better-sqlite3` 12.11.1, Node's built-in test runner, JSON Schema Draft 2020-12, YAML 1.2, SQLite 3.

## Global Constraints

- External decision: determine whether one human-confirmed opportunity is ready to leave Discover and receive a validation plan.
- Owner: `builder`. Review date: 2026-08-17. Sunset date: 2027-01-17.
- Before Task 1, execution must find and validate `records/approvals/approval-cli-discovery-pipeline-2026-07-17.yaml`. It must be an active, unexpired Human Authority `protected_action` record for actor `codex-agent` and action `sandboxed_cli_pipeline_implementation`. The evidence snapshot and rationale must identify the Decision/Experiment schema alignment, transition-validator alignment, offline CLI, local YAML storage, and rebuildable SQLite projection. Its envelope must allow USD 0 cash, eight labor hours, seven calendar days, `public` and `internal` data, and `high` risk. The implementer must not create, infer, broaden, or repair this approval.
- If the approval record is absent, expired, revoked, ambiguous, or mismatched, stop before changing normative files and report the exact validation issue to `genesis-owner`. Read-only inspection remains allowed.
- `genesis.yaml` and its referenced YAML and schemas remain normative. Markdown and this plan are explanatory and cannot grant authority.
- YAML under `.genesis/` is canonical runtime evidence. SQLite is a derived projection and may be deleted and rebuilt.
- Every confirmed record version is immutable. A correction creates the next version and links the preceding path through `immutable_history_refs`.
- Runtime data is local and Git-ignored. Version one stores user-entered references and summaries; it never copies referenced files.
- Privacy defaults to `internal`. Version one rejects `restricted` evidence and any workflow that proposes sensitive-data collection.
- The CLI has no network adapter, API key, autonomous agent, experiment runner, outreach, deployment, billing, payment, or production capability.
- Suggestions are deterministic, visibly labeled, and never count as evidence without a human-supplied source reference and explicit confirmation.
- `plan-experiment` creates a `draft` Experiment Record and projected `approval_pending` state. No version-one command can enter `running`.
- Stable errors include `code`, affected `path`, expected `correction`, and `escalation` target. Missing or contradictory state fails closed.
- Each task uses red-green-refactor: add one focused failing test, observe the expected failure, add the smallest implementation, rerun the focused test, then commit.
- Run `npm run check` after every normative task and before completion. Do not push or open a pull request without separately valid publication authority.

## File Responsibility Map

- `bin/genesis.mjs`: executable entry point and process exit code.
- `src/cli/run-cli.mjs`: argument routing and command orchestration.
- `src/cli/prompter.mjs`: injectable terminal questions and confirmation.
- `src/cli/render.mjs`: stable human-readable proposals, status, warnings, and errors.
- `src/application/genesis-service.mjs`: transactional application operations.
- `src/core/errors.mjs`: stable error type and formatting.
- `src/core/ids.mjs`: business IDs and immutable version filenames.
- `src/core/suggestions.mjs`: deterministic offline suggestions.
- `src/core/schema-registry.mjs`: Ajv compilation for canonical and runtime schemas.
- `src/core/record-builders.mjs`: canonical Decision, Experiment, and evidence construction.
- `src/core/discovery-workflow.mjs`: Discover gates, experiment completeness, and current status.
- `src/core/metrics.mjs`: only metrics supported by local evidence.
- `src/storage/workspace.mjs`: paths, private directories, and writer lock.
- `src/storage/yaml-record-store.mjs`: append-only atomic YAML persistence.
- `src/storage/projection.mjs`: SQLite projection, consistency check, and rebuild.
- `schemas/records/*.schema.json`: normative canonical record shapes.
- `schemas/runtime/evidence-entry.schema.json`: local evidence-entry shape; not a normative record-template registration.
- `tests/*.test.mjs`: focused unit, storage, service, CLI, recovery, and no-network behavior.

---

### Task 1: Verify authority and align canonical record/transition contracts

**Files:**
- Require: `records/approvals/approval-cli-discovery-pipeline-2026-07-17.yaml`
- Modify: `schemas/records/decision-record.schema.json`
- Modify: `schemas/records/experiment-record.schema.json`
- Modify: `config/workflows/experiment-lifecycle.yaml`
- Modify: `templates/decision-record.yaml`
- Modify: `templates/experiment-record.yaml`
- Modify: `scripts/validate-genesis.mjs`
- Modify: `tests/records.test.mjs`
- Modify: `tests/invariants.test.mjs`

**Interfaces:**
- Extends: `validateApproval(record, { now, action, actor, limits? }) -> ValidationIssue[]`
- Changes: `validateTransition(policySet, workflowId, from, to, context) -> ValidationIssue[]`
- Consumes canonical `context.records`, `context.approvals`, and `context.experimentRecord`; removes ad hoc approval, record-type, preregistration-field, and closure-field shapes.

- [ ] **Step 1: Validate execution authority before touching normative files**

Run:

```bash
test -f records/approvals/approval-cli-discovery-pipeline-2026-07-17.yaml
npm run validate
node --input-type=module -e "import fs from 'node:fs'; import Ajv2020 from 'ajv/dist/2020.js'; import addFormats from 'ajv-formats'; import { parseYamlFile, validateApproval } from './scripts/validate-genesis.mjs'; const p='records/approvals/approval-cli-discovery-pipeline-2026-07-17.yaml'; const r=parseYamlFile(p); const a=new Ajv2020({allErrors:true,strict:true}); addFormats(a); const schema=JSON.parse(fs.readFileSync('schemas/records/approval-record.schema.json','utf8')); const ok=a.compile(schema)(r); const e=validateApproval(r,{now:new Date().toISOString(),action:'sandboxed_cli_pipeline_implementation',actor:'codex-agent'}); const envelope=r.limits?.cash_usd>=0&&r.limits?.labor_hours>=8&&r.limits?.duration_days>=7&&['public','internal'].every(x=>r.limits?.data_classes?.includes(x))&&['high','critical'].includes(r.limits?.risk_level); const authority=r.status==='active'&&r.approver_role==='human_authority'&&r.approver_principal_id==='genesis-owner'&&r.action_class==='protected_action'; if(!ok||e.length||!envelope||!authority){console.error(JSON.stringify({schema:a.errors,approval:e,envelope,authority},null,2));process.exit(1)}"
```

Expected: all commands exit 0. If any command fails, stop this plan and escalate to `genesis-owner`; do not continue to Step 2.

- [ ] **Step 2: Replace ad hoc transition fixtures with canonical record-shaped fixtures**

In `tests/invariants.test.mjs`, remove `COMPLETE_PREREGISTRATION`. Add helpers that clone the schema-valid templates and override only fields relevant to the test:

```js
async function canonicalRecord(templateId, overrides = {}) {
  const record = structuredClone((await loadRequiredPolicySet()).templates.get(templateId));
  return { ...record, ...overrides };
}

async function activeApproval(action, approverRole = "human_authority", overrides = {}) {
  return canonicalRecord("approval_record", {
    status: "active",
    approver_role: approverRole,
    actor: "codex-agent",
    scope: { actions: [action], wildcard: false },
    decision: "approved",
    revoked: false,
    effective_at: "2026-07-17T00:00:00Z",
    expires_at: "2026-07-19T00:00:00Z",
    review_at: "2026-07-18T00:00:00Z",
    ...overrides,
  });
}
```

Add assertions for:

```js
const passedValidation = await canonicalRecord("experiment_record", {
  subtype: "validation",
  status: "closed",
  validation_outcome: "passed",
});
assert.deepEqual(transitionIssues(policySet, "business_lifecycle", "validate", "build", {
  records: [passedValidation], now: "2026-07-18T00:00:00Z", actor: "codex-agent",
}), []);

const draft = await canonicalRecord("experiment_record", {
  status: "draft", approval_references: [],
});
assert.deepEqual(transitionIssues(policySet, "experiment_lifecycle", "approval", "running", {
  experimentRecord: draft,
  approvals: [await activeApproval("experiment", "ceo")],
  now: "2026-07-18T00:00:00Z",
  actor: "codex-agent",
}), []);
```

Also assert that an expired approval, wrong actor, missing preregistration value, and non-closed validation record each produce the existing stable gate code. Add direct `validateApproval` cases in `tests/records.test.mjs` proving requested cash, labor, duration, data classes, and risk cannot exceed the canonical approval envelope; each mismatch must produce `APPROVAL_LIMIT_MISMATCH`.

Assert that the workflow's preregistration and closure names resolve directly against an Experiment Record. The canonical nested paths are `metric.formula`, `metric.population`, `metric.denominator`, `metric.data_source`, `limits.cash_usd`, `limits.labor_hours`, `limits.duration_days`, `limits.data_classes`, and `limits.risk_level`; the canonical Experience link is `experience_reference`.

- [ ] **Step 3: Run the transition tests and observe the contract mismatch**

Run: `node --test --test-name-pattern='Build requires|experiment Approval|experiment closure' tests/invariants.test.mjs`

Expected: FAIL because `validateTransition` still reads `recordTypes`, `preregistrationFields`, `closureFields`, and `{ approver, action, valid }`.

- [ ] **Step 4: Write failing record-schema tests for lifecycle-conditional requirements**

In `tests/records.test.mjs`, add tests proving:

```js
test("draft experiment requires preregistration but not closure fields", async () => {
  const draft = loadTemplate("experiment_record");
  draft.status = "draft";
  draft.approval_references = [];
  for (const field of ["actual_cost", "results", "reflection", "outcome", "experience_reference", "confidence_update", "decision_outcome"]) {
    delete draft[field];
  }
  assert.equal(compileSchema("experiment_record")(draft), true);
});

test("closed validation experiment requires closure and validation outcome", async () => {
  const closed = loadTemplate("experiment_record");
  delete closed.validation_outcome;
  assert.equal(compileSchema("experiment_record")(closed), false);
  closed.validation_outcome = "passed";
  assert.equal(compileSchema("experiment_record")(closed), true);
});

test("decision record carries the target customer", async () => {
  const decision = loadTemplate("decision_record");
  delete decision.target_customer;
  assert.equal(compileSchema("decision_record")(decision), false);
});
```

- [ ] **Step 5: Run the schema tests and verify they fail for the intended reasons**

Run: `node --test --test-name-pattern='draft experiment|closed validation|target customer' tests/records.test.mjs`

Expected: FAIL because closure fields are always required, the validation fields do not exist, and `target_customer` is not required.

- [ ] **Step 6: Make the smallest normative schema and template alignment**

In `decision-record.schema.json`, require and define:

```json
"target_customer": { "$ref": "#/$defs/nonempty" }
```

In `experiment-record.schema.json`:

- add `subtype` with enum `validation`;
- add `validation_outcome` with enum `pending`, `passed`, `failed`;
- add `confidence_update` as number-or-null from 0 through 1;
- add `decision_outcome` as null or one of `scale`, `pivot`, `learning_lab`, `archive`, `kill`;
- keep every preregistration field in the base `required` array;
- remove closure fields from the base `required` array;
- change `approval_references` to `recordRefs` at the property level;
- add an `allOf` branch requiring nonempty approval references for `active` and `closed`;
- add an `allOf` branch requiring all closure fields for `closed` and restricting `validation_outcome` to `passed` or `failed`.

Use this conditional shape:

```json
{
  "if": { "properties": { "status": { "const": "closed" } }, "required": ["status"] },
  "then": {
    "required": ["actual_cost", "results", "reflection", "outcome", "experience_reference", "confidence_update", "decision_outcome"],
    "properties": { "validation_outcome": { "enum": ["passed", "failed"] } }
  }
}
```

Update the example templates with `target_customer`, `subtype: validation`, `validation_outcome: passed`, `confidence_update: 0.60`, and `decision_outcome: pivot`.

In `config/workflows/experiment-lifecycle.yaml`, replace the conceptual aliases `metric_formula`, `metric_population`, `metric_denominator`, `metric_data_source`, `maximum_cash`, `maximum_labor`, `maximum_duration`, `maximum_data`, and `maximum_risk` with the canonical nested paths listed in Step 2. Replace `linked_experience_record` with `experience_reference` in `closure_required_fields` and state evidence lists. This lets the validator resolve the normative path rather than maintaining a second alias map.

- [ ] **Step 7: Make transition validation consume canonical records**

Replace `validApproval` with:

```js
function matchingApproval(approvals, { approverRole, action, actor, now, limits }) {
  return Array.isArray(approvals) && approvals.some((approval) => (
    approval?.approver_role === approverRole
    && validateApproval(approval, { now, action, actor, limits }).length === 0
  ));
}
```

Extend `validateApproval` with an optional requested `limits` object. Compare cash, labor, and duration numerically; require every requested data class to appear in the approved `data_classes`; and compare risk using `low < medium < high < critical`. Any excess or unknown value returns `APPROVAL_LIMIT_MISMATCH` at `/limits`. Pass the Experiment Record's `limits` through `matchingApproval` for Approval to Running and pass the bounded learning-prototype limits for its exception path.

For Validate to Build, accept only:

```js
const passedValidation = context.records?.some((record) => (
  record?.record_type === "experiment_record"
  && record.subtype === "validation"
  && record.status === "closed"
  && record.validation_outcome === "passed"
));
```

For Approval to Running, validate `context.experimentRecord` against the compiled Experiment schema, resolve every dot-separated workflow preregistration path against that record, confirm each value is nonempty, and call `matchingApproval` using `context.actor`, `context.now`, and the record's `limits`. For Decision to Closed, require a canonical closed Experiment record with every configured closure path. Preserve existing error codes and paths.

- [ ] **Step 8: Run focused and complete gates**

Run:

```bash
node --test tests/records.test.mjs tests/invariants.test.mjs
npm run check
```

Expected: both exit 0; all templates remain schema-valid and all negative fixtures remain rejected.

- [ ] **Step 9: Commit the canonical-contract change**

```bash
git add records/approvals/approval-cli-discovery-pipeline-2026-07-17.yaml schemas/records/decision-record.schema.json schemas/records/experiment-record.schema.json config/workflows/experiment-lifecycle.yaml templates/decision-record.yaml templates/experiment-record.yaml scripts/validate-genesis.mjs tests/records.test.mjs tests/invariants.test.mjs
git commit -m "Align canonical discovery record contracts"
```

---

### Task 2: Add the runtime package, stable errors, identifiers, and suggestions

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `bin/genesis.mjs`
- Create: `src/core/errors.mjs`
- Create: `src/core/ids.mjs`
- Create: `src/core/suggestions.mjs`
- Create: `tests/cli-core.test.mjs`

**Interfaces:**
- `GenesisError(code, message, { path, correction, escalation, cause })`
- `formatError(error) -> string`
- `normalizeBusinessId(value) -> string`
- `versionFileName(id, version) -> string`
- `suggestionsFor(topic) -> readonly string[]`

- [ ] **Step 1: Write failing core tests**

Create `tests/cli-core.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { formatError, GenesisError } from "../src/core/errors.mjs";
import { normalizeBusinessId, versionFileName } from "../src/core/ids.mjs";
import { suggestionsFor } from "../src/core/suggestions.mjs";

test("business IDs and version paths are deterministic", () => {
  assert.equal(normalizeBusinessId("  Local Bakery CRM  "), "local-bakery-crm");
  assert.equal(versionFileName("local-bakery-crm-decision", 2), "local-bakery-crm-decision.v0002.yaml");
  assert.throws(() => normalizeBusinessId("---"), { code: "BUSINESS_ID_INVALID" });
});

test("errors render actionable fail-closed fields", () => {
  const error = new GenesisError("RECORD_SCHEMA_INVALID", "Record is invalid", {
    path: "/confidence", correction: "Enter a number from 0 to 1", escalation: "human_authority",
  });
  assert.match(formatError(error), /RECORD_SCHEMA_INVALID/);
  assert.match(formatError(error), /Enter a number from 0 to 1/);
});

test("suggestions are stable, offline, and immutable", () => {
  const first = suggestionsFor("validation_methods");
  assert.deepEqual(first, suggestionsFor("validation_methods"));
  assert.equal(Object.isFrozen(first), true);
});
```

- [ ] **Step 2: Observe missing modules**

Run: `node --test tests/cli-core.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/core/errors.mjs`.

- [ ] **Step 3: Add runtime dependencies and executable metadata**

Move `ajv`, `ajv-formats`, and `yaml` from `devDependencies` to `dependencies`; add `better-sqlite3: 12.11.1`; and add:

```json
"bin": { "genesis": "./bin/genesis.mjs" }
```

Run: `npm install`

Expected: exit 0, lockfile version 3, and `npm ls better-sqlite3` reports `12.11.1`.

- [ ] **Step 4: Implement the minimal core interfaces**

`GenesisError` must set `name`, `code`, `path`, `correction`, `escalation`, and optional `cause`. `normalizeBusinessId` must lowercase, replace non-alphanumerics with single hyphens, trim hyphens, and enforce the canonical ID regex. `versionFileName` must reject nonpositive/noninteger versions. `suggestionsFor` must return frozen copies from a closed map of supported topics.

Create `bin/genesis.mjs` with a shebang and a temporary call to the later `runCli` module:

```js
#!/usr/bin/env node
import { runCli } from "../src/cli/run-cli.mjs";
process.exitCode = await runCli(process.argv.slice(2));
```

Do not invoke the binary until Task 8 creates `run-cli.mjs`.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/cli-core.test.mjs
npm run check
git add package.json package-lock.json bin/genesis.mjs src/core tests/cli-core.test.mjs
git commit -m "Add Genesis CLI runtime foundation"
```

Expected: tests and full gate exit 0.

---

### Task 3: Validate and build canonical runtime records

**Files:**
- Create: `schemas/runtime/evidence-entry.schema.json`
- Create: `src/core/schema-registry.mjs`
- Create: `src/core/record-builders.mjs`
- Create: `tests/record-builders.test.mjs`

**Interfaces:**
- `createSchemaRegistry(repoRoot) -> { validateRecord(recordType, value), validateEvidence(value) }`
- `buildEvidenceEntry(input, clock) -> EvidenceEntry`
- `buildDecisionRecord(input, clock) -> DecisionRecord`
- `versionDecisionRecord(previous, changes, historyRef, clock) -> DecisionRecord`
- `buildExperimentRecord(input, clock) -> ExperimentRecord`

- [ ] **Step 1: Write failing schema-registry and builder tests**

Use a fixed clock `() => new Date("2026-07-18T00:00:00Z")`. Assert that:

```js
const registry = await createSchemaRegistry(ROOT);
const evidence = buildEvidenceEntry({
  id: "bakery-ev-001", business_id: "bakery", source_reference: "interview://owner-1",
  summary: "Owner loses two hours weekly reconciling orders", stance: "support",
  provenance: "User-entered interview note", privacy_classification: "internal",
}, clock);
assert.equal(registry.validateEvidence(evidence), evidence);

const decision = buildDecisionRecord(validDecisionInput, clock);
assert.equal(registry.validateRecord("decision_record", decision), decision);
const v2 = versionDecisionRecord(decision, { confidence: 0.65 }, "records/decisions/bakery-decision.v0001.yaml", clock);
assert.deepEqual(v2.immutable_history_refs, ["records/decisions/bakery-decision.v0001.yaml"]);
```

Also assert that `restricted` evidence throws `SENSITIVE_DATA_FORBIDDEN`, invalid confidence throws `RECORD_SCHEMA_INVALID`, and an Experiment draft has `approval_references: []`, `validation_outcome: pending`, and no closure-only fields.

- [ ] **Step 2: Run and observe missing modules**

Run: `node --test tests/record-builders.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Define the evidence schema**

Create a closed JSON schema requiring exactly:

```json
{
  "id": "canonical-id",
  "business_id": "canonical-id",
  "collected_at": "date-time",
  "source_reference": "nonempty string",
  "summary": "nonempty string",
  "stance": "support | contradict",
  "provenance": "nonempty string",
  "privacy_classification": "public | internal | confidential | restricted"
}
```

Set `additionalProperties: false`. Do not register this file in `genesis.yaml`; it is a runtime entry, not a new canonical record type.

- [ ] **Step 4: Implement registry and builders**

Compile the manifest-registered record schemas with Ajv 2020 and `ajv-formats`. Return the original value on success. On failure, throw `GenesisError("RECORD_SCHEMA_INVALID", "Record failed its registered schema", { path: firstInstancePath, correction: allAjvMessages, escalation: "builder" })`.

Builders must:

- use policy version `2.0.0` and schema version `1.0.0`;
- create stable IDs from the business ID;
- set both timestamps from the injected clock;
- default privacy to `internal`;
- never synthesize evidence, counterevidence, approval, results, or outcome;
- validate after construction, before returning.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/record-builders.test.mjs
npm run check
git add schemas/runtime/evidence-entry.schema.json src/core/schema-registry.mjs src/core/record-builders.mjs tests/record-builders.test.mjs
git commit -m "Build schema-valid discovery records"
```

---

### Task 4: Add private workspaces and append-only atomic YAML storage

**Files:**
- Modify: `.gitignore`
- Create: `src/storage/workspace.mjs`
- Create: `src/storage/yaml-record-store.mjs`
- Create: `tests/storage.test.mjs`

**Interfaces:**
- `workspacePaths(projectRoot) -> { root, records, decisions, experiments, evidence, db, lock }`
- `ensureWorkspace(projectRoot) -> WorkspacePaths`
- `withWorkspaceLock(projectRoot, operation) -> Promise<T>`
- `writeRecord({ projectRoot, kind, id, version, value }) -> { absolutePath, relativePath }`
- `readRecord(absolutePath) -> object`
- `listRecords(projectRoot) -> RecordDescriptor[]`

- [ ] **Step 1: Write failing storage tests**

In a fresh `mkdtemp` directory, assert:

```js
const written = await writeRecord({ projectRoot, kind: "decision", id: "bakery-decision", version: 1, value });
assert.equal(written.relativePath, ".genesis/records/decisions/bakery-decision.v0001.yaml");
assert.deepEqual(await readRecord(written.absolutePath), value);
await assert.rejects(() => writeRecord({ projectRoot, kind: "decision", id: "bakery-decision", version: 1, value }), { code: "RECORD_VERSION_EXISTS" });
```

Acquire one lock and assert a nested competing lock fails with `WORKSPACE_LOCKED`; then assert the lock file is removed after both success and thrown-operation paths. Assert `listRecords` sorts by kind, ID, then numeric version and ignores `.tmp` files.

- [ ] **Step 2: Observe missing modules**

Run: `node --test tests/storage.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement private workspace creation and locking**

Add `.genesis/` to `.gitignore`. `ensureWorkspace` creates directories with mode `0700`. `withWorkspaceLock` opens `.genesis/workspace.lock` with flag `wx`, writes the PID and timestamp, and removes only the exact lock it created in `finally`. An existing lock fails closed; version one does not guess whether it is stale.

- [ ] **Step 4: Implement append-only atomic writes**

For each write:

1. validate `kind` against `decision`, `experiment`, `evidence`;
2. create the final version filename deterministically;
3. fail if the final path exists;
4. serialize with `YAML.stringify`;
5. create a same-directory unique `.tmp` file with mode `0600` and exclusive creation;
6. write, `sync`, close, and rename to the final path;
7. remove the exact temporary path on failure.

Never overwrite a final YAML path. Return paths only after rename succeeds.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/storage.test.mjs
npm run check
git add .gitignore src/storage tests/storage.test.mjs
git commit -m "Persist immutable Genesis YAML records"
```

---

### Task 5: Build the disposable SQLite projection and deterministic rebuild

**Files:**
- Create: `src/storage/projection.mjs`
- Create: `tests/projection.test.mjs`

**Interfaces:**
- `openProjection(dbPath) -> Database`
- `projectRecord(db, descriptor, record) -> void`
- `recordBlockedCommand(db, event) -> void`
- `readOpportunity(db, businessId) -> OpportunityProjection | null`
- `projectionConsistency(db, descriptors) -> { consistent, yamlCount, projectedCount }`
- `rebuildProjection({ projectRoot, registry }) -> { recordCount, businessCount }`

- [ ] **Step 1: Write failing projection tests**

Create two Decision versions, one evidence entry, and one draft Experiment in a temporary workspace. Assert projection tables expose the latest paths, state `approval_pending`, support/contradict counts, confidence, and timestamps. Delete `genesis.db`, rebuild, and assert the rebuilt rows deeply equal a normalized snapshot of the original rows.

Also create malformed YAML and assert rebuild fails with `RECORD_SCHEMA_INVALID` while the prior database remains byte-for-byte unchanged.

- [ ] **Step 2: Observe missing projection module**

Run: `node --test tests/projection.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Create the projection schema**

`openProjection` must enable foreign keys and create:

```sql
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
```

- [ ] **Step 4: Implement projection and rebuild**

Wrap each projection update in a SQLite transaction. Upsert `record_versions`; derive the opportunity row only from canonical record content and descriptors. Rebuild into `.genesis/genesis.db.rebuild.tmp`, validate every YAML entry, verify source/projected counts, close both databases, then rename the temporary database over `genesis.db`. If any step fails, close and remove only the temporary database, preserving the prior database.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/projection.test.mjs
npm run check
git add src/storage/projection.mjs tests/projection.test.mjs
git commit -m "Add rebuildable Genesis SQLite projection"
```

---

### Task 6: Evaluate Discover gates, preregistration completeness, and supported metrics

**Files:**
- Create: `src/core/discovery-workflow.mjs`
- Create: `src/core/metrics.mjs`
- Create: `tests/discovery-workflow.test.mjs`

**Interfaces:**
- `evaluateDiscoverGate({ decision, evidence }) -> { passed, blockers }`
- `experimentCompleteness(experiment) -> { complete, present, required, missing, ratio }`
- `buildStatus({ decisionVersions, experimentVersions, evidence, blockedCommands, consistency, now }) -> Status`
- `calculateMetrics(input) -> SupportedMetrics`

- [ ] **Step 1: Write failing workflow tests**

Assert that Discover is blocked separately for missing target customer, problem, hypothesis, and zero evidence. One confirmed evidence entry plus all required Decision fields passes. Assert that a complete draft experiment yields ratio `1`, state `approval_pending`, and next permitted command `status`; an incomplete draft lists exact JSON-pointer-like missing paths.

For a fixed clock, assert metrics exactly equal:

```js
{
  supporting_evidence_count: 2,
  contradicting_evidence_count: 1,
  discover_days: 3,
  time_to_validation_plan_days: 2,
  preregistration_completeness: 1,
  confidence_history: [0.4, 0.6],
  blocked_commands_by_code: { DISCOVER_GATE_BLOCKED: 1 },
  projection_consistent: true
}
```

- [ ] **Step 2: Observe missing modules**

Run: `node --test tests/discovery-workflow.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement deterministic gates and metrics**

Read preregistration requirements from `config/workflows/experiment-lifecycle.yaml`; do not duplicate a second normative list in application code. Treat trimmed empty strings, empty arrays, `null`, and `undefined` as missing. Calculate elapsed days as milliseconds divided by `86_400_000` without rounding. Do not produce realized value, experiment success, customer-reality ratio, or forecast calibration.

- [ ] **Step 4: Run tests and commit**

```bash
node --test tests/discovery-workflow.test.mjs
npm run check
git add src/core/discovery-workflow.mjs src/core/metrics.mjs tests/discovery-workflow.test.mjs
git commit -m "Evaluate discovery gates and early metrics"
```

---

### Task 7: Implement the human-confirmed application service

**Files:**
- Create: `src/application/genesis-service.mjs`
- Create: `tests/genesis-service.test.mjs`

**Interfaces:**
- `createGenesisService({ projectRoot, repoRoot, clock, confirm }) -> GenesisService`
- `service.startBusiness(input) -> CommandResult`
- `service.addEvidence(businessId, input) -> CommandResult`
- `service.status(businessId) -> Status`
- `service.planExperiment(businessId, input) -> CommandResult`
- `service.rebuildIndex() -> RebuildResult`

- [ ] **Step 1: Write failing service tests**

Inject `confirm: async proposal => true` and a fixed clock. Exercise:

1. `startBusiness` writes evidence and Decision v1 and returns state `discover`;
2. `addEvidence` writes an Evidence entry and Decision v2 with v1 in `immutable_history_refs`;
3. `status` reports gates and counts;
4. `planExperiment` writes a draft Experiment and returns `approval_pending`;
5. repeating `startBusiness` throws `BUSINESS_ALREADY_EXISTS`;
6. declining confirmation returns `{ changed: false, reason: "cancelled" }` and writes nothing;
7. planning while a gate is missing throws `DISCOVER_GATE_BLOCKED` and records one blocked command;
8. requesting any transition beyond approval pending throws `COMMAND_UNAVAILABLE`.

- [ ] **Step 2: Observe missing service**

Run: `node --test tests/genesis-service.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement YAML-first service operations**

Each mutating method must run under `withWorkspaceLock` and follow:

```js
const proposal = buildAndValidate(input);
if (!await confirm(proposal)) return { changed: false, reason: "cancelled" };
const yaml = await writeRecord({
  projectRoot,
  kind: proposal.record_type === "decision_record" ? "decision" : "experiment",
  id: proposal.id,
  version: nextVersion,
  value: proposal,
});
try {
  projectRecord(db, yaml, proposal);
  verifyProjectionReference(db, yaml.relativePath);
  return { changed: true, record: proposal, path: yaml.relativePath, projection_stale: false };
} catch (cause) {
  return { changed: true, record: proposal, path: yaml.relativePath, projection_stale: true,
    warning: new GenesisError("PROJECTION_STALE", "Canonical YAML is safe but SQLite is stale", {
      correction: "Run genesis rebuild-index", escalation: "builder", cause,
    }) };
}
```

Never roll back or delete a successfully renamed YAML record because projection failed. Read current truth from YAML when SQLite is missing or marked inconsistent.

- [ ] **Step 4: Run tests and commit**

```bash
node --test tests/genesis-service.test.mjs
npm run check
git add src/application/genesis-service.mjs tests/genesis-service.test.mjs
git commit -m "Implement confirmed discovery workflow service"
```

---

### Task 8: Add the interactive CLI and resumable commands

**Files:**
- Create: `src/cli/prompter.mjs`
- Create: `src/cli/render.mjs`
- Create: `src/cli/run-cli.mjs`
- Create: `tests/cli-integration.test.mjs`

**Interfaces:**
- `createPrompter({ input, output }) -> { ask, choose, confirm, close }`
- `renderProposal(proposal) -> string`
- `renderStatus(status) -> string`
- `runCli(argv, dependencies?) -> Promise<number>`

- [ ] **Step 1: Write failing command-routing integration tests**

Use temporary project roots and a scripted prompter rather than a real TTY. Assert exact exit codes:

- `genesis start-business` returns 0 and prints the full proposal before the confirmation question;
- `genesis add-evidence bakery` returns 0 and labels support/contradict;
- `genesis status bakery` returns 0 and prints state, versions, evidence counts, gates, limits, next action, blockers, and projection consistency;
- `genesis plan-experiment bakery` returns 0 and prints `approval_pending`;
- `genesis rebuild-index` returns 0 and prints record/business counts;
- unknown command returns 2 and prints usage;
- policy or validation error returns 1 and prints code, path, correction, and escalation.

- [ ] **Step 2: Observe missing CLI modules**

Run: `node --test tests/cli-integration.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement guided prompts and proposal rendering**

`start-business` asks for business ID, target customer, problem, hypothesis, confidence, initial evidence, counterevidence, alternatives, expected outcome, metric, owner, and review date. `plan-experiment` asks for supported decision, baseline, comparison method, formula, population, denominator, data source, expected outcome, minimum meaningful effect, failure conditions, stop conditions, maximum cash, labor, duration, data classes, risk, owner, decision date, and allowed outcomes.

Render suggestions under `Offline suggestion — not evidence:`. Render the complete proposed YAML-shaped object before one final `Save this immutable record? [y/N]` prompt. Default confirmation is no.

- [ ] **Step 4: Implement routing without an execution command**

Supported command grammar is exactly:

```text
genesis start-business
genesis add-evidence <business-id>
genesis status <business-id>
genesis plan-experiment <business-id>
genesis rebuild-index
```

Do not implement `run-experiment`, `approve`, `advance`, or a generic escape hatch. Resolve `repoRoot` from the installed module and default `projectRoot` to `process.cwd()`.

- [ ] **Step 5: Run the binary and tests, then commit**

```bash
node --test tests/cli-integration.test.mjs
node bin/genesis.mjs --help
npm run check
git add src/cli tests/cli-integration.test.mjs bin/genesis.mjs
git commit -m "Add interactive Genesis discovery commands"
```

Expected: help exits 0; tests and complete gate exit 0.

---

### Task 9: Prove offline operation, recovery, locking, and fail-closed behavior

**Files:**
- Create: `tests/no-network.test.mjs`
- Create: `tests/recovery.test.mjs`
- Modify: `tests/cli-integration.test.mjs`

**Interfaces:**
- Uses only public interfaces from Tasks 4 through 8.

- [ ] **Step 1: Write a failing no-network test**

Before importing the application, replace network-capable globals with traps:

```js
globalThis.fetch = async () => { throw new Error("NETWORK_USED"); };
```

Run the complete scripted flow through `runCli`: start, add contradicting evidence, status, plan, delete SQLite, rebuild, status. Assert every command returns 0 and no output contains `NETWORK_USED`.

- [ ] **Step 2: Add static network-import protection**

Scan `bin/` and `src/` and fail if an import specifier matches `node:http`, `node:https`, `node:http2`, `node:net`, `undici`, `axios`, or `openai`, or if production code references `fetch(`.

Run: `node --test tests/no-network.test.mjs`

Expected before the complete harness exists: FAIL on the first unimplemented scripted dependency; after wiring, PASS with no network-capable import.

- [ ] **Step 3: Write recovery and stale-projection tests**

Inject a projection adapter that throws after YAML rename. Assert the command returns `changed: true`, the YAML exists and validates, the output contains `PROJECTION_STALE`, and `rebuild-index` restores consistency. Simulate a lock conflict and assert no YAML or SQLite change. Place a `.tmp` YAML file beside records and assert rebuild ignores it.

- [ ] **Step 4: Run resilience tests and commit**

```bash
node --test tests/no-network.test.mjs tests/recovery.test.mjs tests/cli-integration.test.mjs
npm run check
git add tests/no-network.test.mjs tests/recovery.test.mjs tests/cli-integration.test.mjs
git commit -m "Verify offline recovery and fail-closed CLI behavior"
```

---

### Task 10: Document operation and perform acceptance verification

**Files:**
- Modify: `README.md`
- Modify: `Genesis Configuration.md`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Documents the five supported CLI commands, YAML authority, SQLite rebuild, privacy boundary, approval stop, and troubleshooting codes.

- [ ] **Step 1: Add documentation assertions**

In `tests/configuration.test.mjs`, assert that `README.md` contains all five command strings, `.genesis/`, `approval_pending`, `YAML`, `SQLite`, and `rebuild-index`; assert `Genesis Configuration.md` labels the CLI runtime explanatory and links back to `genesis.yaml` as normative.

- [ ] **Step 2: Run and observe missing documentation**

Run: `node --test --test-name-pattern='CLI documentation' tests/configuration.test.mjs`

Expected: FAIL until the operating documentation is added.

- [ ] **Step 3: Write concise operator documentation**

Document installation with `npm ci`, local invocation with `npm link` or `node bin/genesis.mjs`, one manual example flow, exact created paths, immutable version behavior, the approval boundary, supported metrics, privacy limitations, and recovery with `genesis rebuild-index`. State explicitly that the CLI does not research, contact customers, execute experiments, build products, deploy, bill, or operate a business.

- [ ] **Step 4: Run a clean acceptance sequence**

Run:

```bash
npm ci
npm run check
node bin/genesis.mjs --help
git diff --check
git status --short
```

Expected:

- dependency installation succeeds on Node 22;
- validation and all tests pass;
- help lists only the five approved commands;
- no whitespace errors appear;
- status contains only intentional implementation and documentation changes.

- [ ] **Step 5: Review acceptance criteria manually**

In a new temporary working directory, complete the five-command flow. Inspect the Decision v1/v2 YAML, evidence YAML, draft Experiment YAML, and SQLite rows. Delete only `genesis.db`, rebuild, and compare status output before and after. Confirm `plan-experiment` ends at `approval_pending` and there is no command capable of further progression.

- [ ] **Step 6: Record consequential AI verification evidence**

In the implementation handoff, record model identity, model version, material tool context, repository evidence sources, reviewer, exact verification commands, their exit status, actual cash/labor/duration consumption, and remaining uncertainty. Do not invent a reviewer or verification outcome.

- [ ] **Step 7: Commit the completed release locally**

```bash
git add README.md "Genesis Configuration.md" .gitignore package.json package-lock.json
git commit -m "Document Genesis discovery pipeline"
git status --short --branch
```

Expected: clean working tree on the implementation branch. Stop here unless a separate valid publication approval authorizes pushing this new work.

---

## Completion Definition

The implementation is complete only when a clean Node 22 environment can create and resume one opportunity, add supporting and contradicting evidence, show exact Discover blockers, create a schema-valid draft validation Experiment, stop at `approval_pending`, rebuild identical state and metrics from YAML after deleting SQLite, reject mismatched authority and sensitive data, operate with networking disabled, and pass `npm run check`. A passing document-only validation without the manual CLI acceptance flow is not completion.
