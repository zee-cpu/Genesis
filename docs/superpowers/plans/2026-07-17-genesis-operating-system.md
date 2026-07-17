# Genesis Operating System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Genesis version 1.0 into a validated, human-governed version 2.0 policy package with bounded agent autonomy, executable workflows, canonical records, tests, and GitHub Actions enforcement.

**Architecture:** `genesis.yaml` is the normative manifest for modular YAML policy files. JSON Schemas validate local document structure, while one Node.js validator enforces cross-file invariants such as Human Authority supremacy, protected-action approval, budget classification, lifecycle gates, and policy-version compatibility. Markdown documents explain the policy but cannot override it.

**Tech Stack:** Node.js 22, npm 10, `yaml` 2.8.1, Ajv 8.17.1, `ajv-formats` 3.0.1, Node's built-in test runner, JSON Schema Draft 2020-12, YAML 1.2, GitHub Actions.

## Global Constraints

- The stable Human Authority principal ID is `genesis-owner` and its principal type is `human`.
- Human Authority is above CEO and has final veto, revocation, emergency-stop, amendment, and protected-action authority.
- YAML referenced by `genesis.yaml` is normative; Markdown is explanatory.
- Missing, contradictory, ambiguous, expired, or revoked policy and approvals fail closed.
- Micro-Experiments are capped at USD 500 and seven calendar days.
- Experiments are capped at USD 5,000 and 30 calendar days and require CEO approval.
- Major Bets and all protected actions require Human Authority approval.
- Bootstrap Mode limits Genesis system work to 10% of weekly capacity and one active business opportunity.
- Automation requires the same material manual failure to occur at least three times.
- The implementation adds validation and tests only; it does not add an autonomous workflow engine or production database.
- No document may contain a credential, password, API key, or secret.
- Every implementation task follows a failing-test, minimal-change, passing-test cycle.
- Commit steps require a restored writable Git repository. In the current workspace they are recorded as blocked checkpoints because `.git` is empty and read-only.

## File Responsibility Map

- `genesis.yaml`: policy manifest, versions, normative file registry, record-template registry, documentation registry, validation requirements.
- `config/governance.yaml`: authority, precedence, amendment, exception, and emergency-stop rules.
- `config/organization.yaml`: role hierarchy, accountabilities, separation of duties, and escalation.
- `config/permissions.yaml`: default-deny model, low-risk permissions, protected actions, and approval requirements.
- `config/decision-policy.yaml`: Routine, Micro-Experiment, Experiment, Major Bet, Protected Action, and Constitutional Action classification.
- `config/portfolio-policy.yaml`: Bootstrap and Operating allocations, aggregate envelopes, work-in-progress limits, Learning Lab rules, and meta-work controls.
- `config/workflows/business-lifecycle.yaml`: business states, gates, inputs, outputs, roles, and allowed transitions.
- `config/workflows/experiment-lifecycle.yaml`: experiment states, preregistration fields, approvals, measurement, reflection, closure, and outcomes.
- `config/experience-policy.yaml`: immutable evidence, curated knowledge, promotion, supersession, retrieval, curation, and quality rules.
- `config/risk-policy.yaml`: risk levels and legal, privacy, security, financial, customer, regulatory, and AI controls.
- `config/metrics-policy.yaml`: metric definitions and Genesis Experiment #001 scorecard.
- `schemas/*.schema.json`: structural validation for each policy type.
- `schemas/records/*.schema.json`: structural validation for record templates.
- `templates/*.yaml`: schema-valid example records used for manual operation.
- `scripts/validate-genesis.mjs`: YAML parsing, schema validation, reference resolution, invariant validation, documentation checks, and CLI reporting.
- `tests/*.test.mjs`: positive and negative behavior tests.
- `AGENTS.md`: active agent rules.
- `Genesis.md`: readable Constitution.
- `Genesis Configuration.md`: non-normative configuration guide.
- `codex.md.md`: deprecation pointer only.
- `.github/workflows/validate-genesis.yml`: GitHub validation gate.

---

### Task 1: Validation foundation and normative manifest

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `genesis.yaml`
- Create: `schemas/genesis.schema.json`
- Create: `scripts/validate-genesis.mjs`
- Create: `tests/configuration.test.mjs`

**Interfaces:**
- Produces: `parseYamlFile(filePath) -> object`
- Produces: `loadJsonFile(filePath) -> object`
- Produces: `loadPolicySet(rootDir) -> { rootDir, manifest, policies, templates, documents }`
- Produces: `validatePolicySet(rootDir) -> Promise<{ ok: boolean, errors: ValidationIssue[], policySet }>`
- Produces: `ValidationIssue = { code: string, file: string, path: string, message: string }`
- Consumes: no earlier task interfaces.

- [ ] **Step 1: Write failing configuration tests**

Create `tests/configuration.test.mjs` with these initial tests:

```js
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadPolicySet,
  parseYamlFile,
  validatePolicySet,
} from "../scripts/validate-genesis.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

test("normative manifest loads and identifies version 2.0.0", async () => {
  const policySet = await loadPolicySet(ROOT);
  assert.equal(policySet.manifest.version, "2.0.0");
  assert.equal(policySet.manifest.authority, "normative");
});

test("manifest passes its JSON Schema", async () => {
  const result = await validatePolicySet(ROOT);
  assert.deepEqual(result.errors.filter((issue) => issue.code.startsWith("SCHEMA_")), []);
});

test("duplicate YAML keys are rejected", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "genesis-yaml-"));
  const file = path.join(directory, "duplicate.yaml");
  await writeFile(file, "version: 1\nversion: 2\n", "utf8");
  assert.throws(() => parseYamlFile(file), /Map keys must be unique/);
});
```

- [ ] **Step 2: Run the test and verify the foundation is absent**

Run: `node --test tests/configuration.test.mjs`

Expected: FAIL because `scripts/validate-genesis.mjs` does not exist.

- [ ] **Step 3: Create deterministic package metadata**

Create `package.json`:

```json
{
  "name": "genesis-governance",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "validate": "node scripts/validate-genesis.mjs",
    "test": "node --test tests/*.test.mjs",
    "check": "npm run validate && npm test"
  },
  "devDependencies": {
    "ajv": "8.17.1",
    "ajv-formats": "3.0.1",
    "yaml": "2.8.1"
  }
}
```

Create `.gitignore`:

```gitignore
node_modules/
npm-debug.log*
*.tmp
```

Run: `npm install --package-lock-only`

Expected: exit 0 and a `package-lock.json` with lockfile version 3.

- [ ] **Step 4: Create the root manifest**

Create `genesis.yaml` with:

```yaml
$schema: ./schemas/genesis.schema.json
version: 2.0.0
schema_version: 1.0.0
authority: normative
effective_date: 2026-07-17
human_authority_principal_id: genesis-owner
policies:
  - { id: governance, path: config/governance.yaml, schema: schemas/governance.schema.json }
  - { id: organization, path: config/organization.yaml, schema: schemas/organization.schema.json }
  - { id: permissions, path: config/permissions.yaml, schema: schemas/permissions.schema.json }
  - { id: decision_policy, path: config/decision-policy.yaml, schema: schemas/decision-policy.schema.json }
  - { id: portfolio_policy, path: config/portfolio-policy.yaml, schema: schemas/portfolio-policy.schema.json }
  - { id: business_lifecycle, path: config/workflows/business-lifecycle.yaml, schema: schemas/workflow.schema.json }
  - { id: experiment_lifecycle, path: config/workflows/experiment-lifecycle.yaml, schema: schemas/workflow.schema.json }
  - { id: experience_policy, path: config/experience-policy.yaml, schema: schemas/experience-policy.schema.json }
  - { id: risk_policy, path: config/risk-policy.yaml, schema: schemas/risk-policy.schema.json }
  - { id: metrics_policy, path: config/metrics-policy.yaml, schema: schemas/metrics-policy.schema.json }
record_templates:
  - { id: approval_record, path: templates/approval-record.yaml, schema: schemas/records/approval-record.schema.json }
  - { id: decision_record, path: templates/decision-record.yaml, schema: schemas/records/decision-record.schema.json }
  - { id: experiment_record, path: templates/experiment-record.yaml, schema: schemas/records/experiment-record.schema.json }
  - { id: experience_record, path: templates/experience-record.yaml, schema: schemas/records/experience-record.schema.json }
  - { id: constitutional_amendment, path: templates/constitutional-amendment.yaml, schema: schemas/records/constitutional-amendment.schema.json }
documents:
  - { id: constitution, path: Genesis.md, authority: explanatory, required_policy_version: 2.0.0 }
  - { id: configuration_guide, path: Genesis Configuration.md, authority: explanatory, required_policy_version: 2.0.0 }
  - { id: agent_instructions, path: AGENTS.md, authority: explanatory, required_policy_version: 2.0.0 }
validation:
  fail_closed: true
  reject_duplicate_yaml_keys: true
  reject_unknown_schema_properties: true
  require_all_references: true
  require_document_version_markers: true
```

- [ ] **Step 5: Implement the manifest schema**

Create `schemas/genesis.schema.json` using Draft 2020-12. Require every property shown above, set `additionalProperties: false` on every object, require semver strings with `^\\d+\\.\\d+\\.\\d+$`, require nonempty unique `id` values structurally, and constrain `authority` to `normative` at the root and `explanatory` for documents.

The policy and template descriptor definition must require exactly `id`, `path`, and `schema`. The document descriptor must require exactly `id`, `path`, `authority`, and `required_policy_version`.

- [ ] **Step 6: Implement the validator foundation**

Create `scripts/validate-genesis.mjs` with these exports and CLI behavior:

```js
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";

export function parseYamlFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const document = YAML.parseDocument(source, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length) {
    throw new Error(`${filePath}: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  return document.toJS({ mapAsMap: false });
}

export function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function issue(code, file, pointer, message) {
  return { code, file: path.relative(process.cwd(), file), path: pointer, message };
}

export async function loadPolicySet(rootDir) {
  const manifestPath = path.join(rootDir, "genesis.yaml");
  const manifest = parseYamlFile(manifestPath);
  return {
    rootDir,
    manifestPath,
    manifest,
    policies: new Map(),
    templates: new Map(),
    documents: new Map(),
  };
}

export function validateInvariants() {
  return [];
}

export async function validatePolicySet(rootDir) {
  const policySet = await loadPolicySet(rootDir);
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemaPath = path.join(rootDir, "schemas/genesis.schema.json");
  const validate = ajv.compile(loadJsonFile(schemaPath));
  if (!validate(policySet.manifest)) {
    for (const error of validate.errors ?? []) {
      errors.push(issue("SCHEMA_MANIFEST", policySet.manifestPath, error.instancePath, error.message));
    }
  }
  errors.push(...validateInvariants(policySet));
  return { ok: errors.length === 0, errors, policySet };
}

async function main() {
  const rootDir = path.resolve(process.argv[2] ?? process.cwd());
  const result = await validatePolicySet(rootDir);
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`${error.code} ${error.file}${error.path}: ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Genesis policy ${result.policySet.manifest.version} is valid.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
```

- [ ] **Step 7: Install dependencies and run the foundation tests**

Run: `npm install`

Expected: exit 0 with the three declared development dependencies installed.

Run: `node --test tests/configuration.test.mjs`

Expected: three tests pass.

- [ ] **Step 8: Commit the foundation checkpoint**

Run after Git is restored:

```bash
git add .gitignore package.json package-lock.json genesis.yaml schemas/genesis.schema.json scripts/validate-genesis.mjs tests/configuration.test.mjs
git commit -m "build: add Genesis policy validation foundation"
```

Expected: one commit containing only Task 1 files.

---

### Task 2: Human authority, organization, and permissions

**Files:**
- Create: `config/governance.yaml`
- Create: `config/organization.yaml`
- Create: `config/permissions.yaml`
- Create: `schemas/governance.schema.json`
- Create: `schemas/organization.schema.json`
- Create: `schemas/permissions.schema.json`
- Create: `tests/invariants.test.mjs`
- Create: `tests/fixtures/invalid/authority-agent.yaml`
- Create: `tests/fixtures/invalid/protected-without-human.yaml`
- Modify: `scripts/validate-genesis.mjs`

**Interfaces:**
- Consumes: `loadPolicySet`, `validatePolicySet`, and `validateInvariants` from Task 1.
- Produces: loaded policy entries in `policySet.policies` keyed by descriptor ID.
- Produces: `policySet.loadErrors: ValidationIssue[]` so incremental work and missing-file diagnostics remain inspectable without throwing away successfully loaded policies.
- Produces invariant codes: `AUTH_HUMAN_REQUIRED`, `AUTH_HIERARCHY_INVALID`, `AUTH_DELEGATION_FORBIDDEN`, `PROTECTED_APPROVAL_REQUIRED`, `REFERENCE_ROLE_UNKNOWN`.

- [ ] **Step 1: Write failing authority invariants**

Create `tests/invariants.test.mjs` with helpers that load the valid policy set, clone a named policy, apply an invalid fixture fragment, and call `validateInvariants`. Add tests asserting:

```js
test("Human Authority is human and above CEO", async () => {
  const result = await validatePolicySet(ROOT);
  assert.equal(result.errors.some((error) => error.code.startsWith("AUTH_")), false);
});

test("an agent cannot occupy Human Authority", async () => {
  const policySet = await loadPolicySet(ROOT);
  policySet.policies.get("governance").human_authority.principal_type = "agent";
  assert.equal(validateInvariants(policySet).some((error) => error.code === "AUTH_HUMAN_REQUIRED"), true);
});

test("every protected action requires Human Authority", async () => {
  const policySet = await loadPolicySet(ROOT);
  policySet.policies.get("permissions").protected_actions[0].required_approver = "ceo";
  assert.equal(validateInvariants(policySet).some((error) => error.code === "PROTECTED_APPROVAL_REQUIRED"), true);
});
```

- [ ] **Step 2: Run the authority tests and verify failure**

Run: `node --test tests/invariants.test.mjs`

Expected: FAIL because the governance policies and invariant logic do not exist.

- [ ] **Step 3: Create governance policy and schema**

Define `config/governance.yaml` with policy version `2.0.0`, `default_deny: true`, principal `genesis-owner`, `principal_type: human`, non-delegability, final veto, revocation, emergency stop, amendment, exception, and CEO appointment powers. Encode precedence in the approved order and require constitutional amendments to include Human approval, rationale, evidence, compatibility validation, version increment, effective date, and rollback version.

The schema must reject unknown properties, constrain principal type to `human`, require emergency exceptions to expire, and require emergency release records to identify cause, remediation evidence, restored scopes, and monitoring period.

- [ ] **Step 4: Create organization policy and schema**

Define roles `human_authority`, `ceo`, `research`, `builder`, `operator`, and `analyst`. `human_authority` has no parent; `ceo` reports to it; all functions report to CEO. Include accountabilities, escalation targets, and separation-of-duties rules. Require proposer and approver to differ for Major Bets, protected actions, permission escalation, and constitutional actions.

- [ ] **Step 5: Create permissions policy and schema**

Define low-risk internal permissions and the complete protected-action list from the approved specification. Every protected action object must contain `id`, `description`, `risk_floor`, and `required_approver: human_authority`. Define approval validity checks for scope, actor, budget, duration, data class, risk class, effective time, expiry, and revocation.

- [ ] **Step 6: Load all manifest files and implement authority invariants**

Expand `loadPolicySet` to iterate `manifest.policies`, `manifest.record_templates`, and `manifest.documents`; resolve paths under `rootDir`; reject path traversal; parse YAML policies/templates; and read Markdown documents. Missing or invalid entries must append a `ValidationIssue` to `policySet.loadErrors` while leaving successfully loaded entries available for focused tests. Expand schema validation to compile each available descriptor schema, merge `loadErrors`, and report `SCHEMA_POLICY`, `SCHEMA_TEMPLATE`, or `FILE_MISSING` with exact paths.

Implement `validateInvariants(policySet)` as an ordered combination of focused validators:

```js
export function validateInvariants(policySet) {
  return [
    ...validateAuthority(policySet),
    ...validateReferences(policySet),
  ];
}
```

Authority checks must implement the five codes listed in this task's Interfaces block.

- [ ] **Step 7: Create explicit negative fixtures**

`tests/fixtures/invalid/authority-agent.yaml` must set `human_authority.principal_type: agent`.

`tests/fixtures/invalid/protected-without-human.yaml` must define one protected action whose `required_approver` is `ceo`.

Tests must load these fragments and prove their corresponding invariant codes are returned.

- [ ] **Step 8: Run authority validation**

Run: `node --test tests/invariants.test.mjs`

Expected: all authority and permission tests pass.

Run: `npm run validate`

Expected at this checkpoint: failures only for manifest-referenced policy, schema, and template files scheduled in later tasks. No authority, organization, or permission error may remain.

- [ ] **Step 9: Commit the authority checkpoint**

```bash
git add config/governance.yaml config/organization.yaml config/permissions.yaml schemas/governance.schema.json schemas/organization.schema.json schemas/permissions.schema.json scripts/validate-genesis.mjs tests/invariants.test.mjs tests/fixtures/invalid
git commit -m "feat: define Human Authority and bounded permissions"
```

---

### Task 3: Decision classes, portfolio controls, and anti-meta-work invariants

**Files:**
- Create: `config/decision-policy.yaml`
- Create: `config/portfolio-policy.yaml`
- Create: `schemas/decision-policy.schema.json`
- Create: `schemas/portfolio-policy.schema.json`
- Create: `tests/fixtures/invalid/allocation-mismatch.yaml`
- Create: `tests/fixtures/invalid/micro-over-budget.yaml`
- Modify: `tests/invariants.test.mjs`
- Modify: `scripts/validate-genesis.mjs`

**Interfaces:**
- Consumes: policy loading and issue format from Tasks 1–2.
- Produces: `classifyDecision({ cashUsd, durationDays, capacityShare, riskLevel, protectedAction, constitutionalChange }) -> decisionClass`.
- Produces invariant codes: `ALLOCATION_TOTAL_INVALID`, `META_WORK_LIMIT_INVALID`, `WIP_LIMIT_INVALID`, `DECISION_THRESHOLD_INVALID`, `MAJOR_BET_HUMAN_REQUIRED`.

- [ ] **Step 1: Write failing decision and portfolio tests**

Add tests proving:

```js
assert.equal(classifyDecision({ cashUsd: 500, durationDays: 7, capacityShare: 0.01, riskLevel: "low", protectedAction: false, constitutionalChange: false }), "micro_experiment");
assert.equal(classifyDecision({ cashUsd: 501, durationDays: 7, capacityShare: 0.01, riskLevel: "low", protectedAction: false, constitutionalChange: false }), "experiment");
assert.equal(classifyDecision({ cashUsd: 5001, durationDays: 10, capacityShare: 0.01, riskLevel: "medium", protectedAction: false, constitutionalChange: false }), "major_bet");
assert.equal(classifyDecision({ cashUsd: 1, durationDays: 1, capacityShare: 0.01, riskLevel: "low", protectedAction: true, constitutionalChange: false }), "protected_action");
assert.equal(classifyDecision({ cashUsd: 0, durationDays: 1, capacityShare: 0, riskLevel: "low", protectedAction: false, constitutionalChange: true }), "constitutional_action");
```

Also test Bootstrap and Operating allocations sum to exactly `1`, meta-work is at most `0.10`, Bootstrap active opportunity WIP is `1`, and all Major Bets require Human Authority.

- [ ] **Step 2: Run the tests and verify missing decision policy**

Run: `node --test tests/invariants.test.mjs`

Expected: FAIL on missing classification and policy files.

- [ ] **Step 3: Create decision policy and schema**

Encode all six classes. Use inclusive Micro and Experiment maxima. Define Major Bet triggers as cash over USD 5,000, duration over 30 days, capacity share over `0.20`, strategically difficult reversal, multi-business material change, or high risk. Protected and Constitutional classifications take precedence over cost-based classes.

Every class must declare allowed risk, required approver, required records, cash and duration semantics, and whether a Human-approved aggregate envelope is required.

- [ ] **Step 4: Create portfolio policy and schema**

Encode Bootstrap allocations `0.80`, `0.15`, and `0.05`; Operating allocations `0.80`, `0.15`, and `0.05`; Bootstrap `active_business_opportunities: 1`; `system_meta_work_max_share: 0.10`; `automation_minimum_repeated_manual_failures: 3`; aggregate envelope enforcement; and Learning Lab owner, budget, metric, monthly review, and expiry requirements.

Define `proven` using repeatable demand, identified customer, working value delivery, and precommitted economic or strategic threshold.

- [ ] **Step 5: Implement classification and portfolio invariants**

Export `classifyDecision` from `scripts/validate-genesis.mjs`. Check protected and constitutional booleans before numeric thresholds. Reject non-finite or negative inputs.

Add the five invariant codes in this task. Sum allocations in integer basis points or with a tolerance no larger than `1e-9` to avoid floating-point ambiguity.

- [ ] **Step 6: Add and prove negative fixtures**

Create `allocation-mismatch.yaml` with Bootstrap shares totaling `0.95` and `micro-over-budget.yaml` with a Micro cash maximum of `501`. Tests must return `ALLOCATION_TOTAL_INVALID` and `DECISION_THRESHOLD_INVALID` respectively.

- [ ] **Step 7: Run decision and portfolio tests**

Run: `node --test tests/invariants.test.mjs`

Expected: all authority, permission, decision, portfolio, and negative-fixture tests pass.

- [ ] **Step 8: Commit the policy checkpoint**

```bash
git add config/decision-policy.yaml config/portfolio-policy.yaml schemas/decision-policy.schema.json schemas/portfolio-policy.schema.json scripts/validate-genesis.mjs tests/invariants.test.mjs tests/fixtures/invalid
git commit -m "feat: enforce decisions budgets and meta-work limits"
```

---

### Task 4: Business and experiment lifecycle gates

**Files:**
- Create: `config/workflows/business-lifecycle.yaml`
- Create: `config/workflows/experiment-lifecycle.yaml`
- Create: `schemas/workflow.schema.json`
- Create: `tests/fixtures/invalid/forbidden-transition.yaml`
- Modify: `tests/invariants.test.mjs`
- Modify: `scripts/validate-genesis.mjs`

**Interfaces:**
- Consumes: roles, decision classes, approval roles, and record type IDs.
- Produces: `validateTransition(policySet, workflowId, from, to, context) -> ValidationIssue[]`.
- Produces invariant codes: `WORKFLOW_ROLE_UNKNOWN`, `WORKFLOW_RECORD_UNKNOWN`, `WORKFLOW_TRANSITION_INVALID`, `BUILD_VALIDATION_REQUIRED`, `LAUNCH_HUMAN_APPROVAL_REQUIRED`, `EXPERIMENT_PREREGISTRATION_INCOMPLETE`.

- [ ] **Step 1: Write failing lifecycle tests**

Add tests proving:

- Discover may transition to Validate.
- Validate cannot transition to Build without a passed validation record or a valid Human-approved learning-prototype exception.
- Build may transition to Launch only with Human Authority approval.
- Review may transition to Scale, Pivot, Learning Lab, Archive, or Kill.
- Draft cannot transition directly to Running.
- Experiment Approval cannot transition to Running without the required approver and complete preregistration fields.

Use explicit context objects containing `recordTypes`, `approvals`, and `preregistrationFields`.

- [ ] **Step 2: Run lifecycle tests and verify failure**

Run: `node --test tests/invariants.test.mjs`

Expected: FAIL because workflows and `validateTransition` are absent.

- [ ] **Step 3: Create the shared workflow schema**

Require workflow ID, policy version, initial state, terminal states, states, allowed transitions, accountable role, responsible role, required inputs, allowed actions, exit criteria, required evidence, approval class, output record, review deadline, and next states. Reject duplicate state IDs and unknown properties structurally where possible.

- [ ] **Step 4: Create the business lifecycle**

Encode Discover, Validate, Build, Launch, Operate, Review, Scale, Pivot, Learning Lab, Archive, and Kill. Scale, Learning Lab, Archive, and Kill are terminal for a workflow instance; Pivot returns through Validate in a new versioned instance. Require Human approval for Launch and Human-approved exception semantics for an unvalidated learning prototype.

- [ ] **Step 5: Create the experiment lifecycle**

Encode Draft, Evidence Review, Approval, Running, Measurement, Reflection, Decision, and Closed. Require all preregistration fields from the approved specification before Approval. Closure requires actual cost, outcome, reflection, confidence update, decision outcome, and linked Experience Record.

- [ ] **Step 6: Implement workflow references and transition validation**

Resolve all role and record references. Implement `validateTransition` with deterministic codes, exact workflow/state paths, and no mutation. Add workflow-wide checks to `validateInvariants`.

- [ ] **Step 7: Add a forbidden-transition fixture**

Create `tests/fixtures/invalid/forbidden-transition.yaml` containing `from: draft` and `to: running`. Prove it returns `WORKFLOW_TRANSITION_INVALID`.

- [ ] **Step 8: Run workflow tests**

Run: `node --test tests/invariants.test.mjs`

Expected: all lifecycle, earlier invariant, and negative-fixture tests pass.

- [ ] **Step 9: Commit the workflow checkpoint**

```bash
git add config/workflows schemas/workflow.schema.json scripts/validate-genesis.mjs tests/invariants.test.mjs tests/fixtures/invalid/forbidden-transition.yaml
git commit -m "feat: define gated business and experiment workflows"
```

---

### Task 5: Experience, risk, and measurement policies

**Files:**
- Create: `config/experience-policy.yaml`
- Create: `config/risk-policy.yaml`
- Create: `config/metrics-policy.yaml`
- Create: `schemas/experience-policy.schema.json`
- Create: `schemas/risk-policy.schema.json`
- Create: `schemas/metrics-policy.schema.json`
- Modify: `tests/invariants.test.mjs`
- Modify: `scripts/validate-genesis.mjs`

**Interfaces:**
- Consumes: role, protected-action, workflow, and record references.
- Produces invariant codes: `EXPERIENCE_PROMOTION_UNSAFE`, `EXPERIENCE_SUPERSESSION_REQUIRED`, `RISK_PROTECTED_MISMATCH`, `METRIC_DEFINITION_INCOMPLETE`, `EXPERIMENT_001_BASELINE_REQUIRED`.

- [ ] **Step 1: Write failing Experience, risk, and metric tests**

Add tests proving:

- Promotion order is Raw Event → Reviewed Experience → Validated Lesson → Principle.
- A Principle requires replicated evidence or explicit Human approval and preserves evidence-quality limitations.
- Corrections require `supersedes` semantics.
- High and critical risk map to protected actions.
- Every metric declares formula, unit, population, denominator, source, cadence, owner, baseline, target, and guardrails.
- Genesis Experiment #001 excludes document volume and includes all approved decision-quality metrics.

- [ ] **Step 2: Run the policy tests and verify failure**

Run: `node --test tests/invariants.test.mjs`

Expected: FAIL because the three policies and schemas are absent.

- [ ] **Step 3: Create Experience policy and schema**

Define immutable evidence and curated knowledge layers, promotion stages, evidence requirements, weekly Human curation, duplicate and contradiction review, validity windows, current-belief projection, keyword/field search, retrieval benchmarks, lesson reuse, demotion, and automation exclusions.

- [ ] **Step 4: Create risk policy and schema**

Define low, medium, high, and critical risk. Encode legal, privacy, secrets, access, production, rollback, incident, financial, customer experiment, regulated activity, and AI controls. Require unresolved material uncertainty to raise risk by at least one level. Require model identity, model version, tool context, evidence, reviewer, and verification for consequential AI-assisted actions.

- [ ] **Step 5: Create metrics policy and schema**

Define forecast calibration, decision cycle time, assumptions tested before Build, avoidable rework, realized value per experiment, lesson reuse, retrieval success, system overhead, customer reality, exception rate, and protected-action denial/escalation metrics. Include complete calculation metadata and Genesis Experiment #001 comparator and adjudicator requirements.

- [ ] **Step 6: Implement Experience, risk, and metric invariants**

Add the five invariant codes in this task. Cross-check high/critical risk against permissions, Experience promotion against approval roles, and metric owners against organization roles.

- [ ] **Step 7: Run the expanded invariant suite**

Run: `node --test tests/invariants.test.mjs`

Expected: all governance, permission, decision, portfolio, workflow, Experience, risk, and metric tests pass.

- [ ] **Step 8: Commit the intelligence and risk checkpoint**

```bash
git add config/experience-policy.yaml config/risk-policy.yaml config/metrics-policy.yaml schemas/experience-policy.schema.json schemas/risk-policy.schema.json schemas/metrics-policy.schema.json scripts/validate-genesis.mjs tests/invariants.test.mjs
git commit -m "feat: govern experience risk and decision metrics"
```

---

### Task 6: Canonical record schemas and templates

**Files:**
- Create: `schemas/records/approval-record.schema.json`
- Create: `schemas/records/decision-record.schema.json`
- Create: `schemas/records/experiment-record.schema.json`
- Create: `schemas/records/experience-record.schema.json`
- Create: `schemas/records/constitutional-amendment.schema.json`
- Create: `templates/approval-record.yaml`
- Create: `templates/decision-record.yaml`
- Create: `templates/experiment-record.yaml`
- Create: `templates/experience-record.yaml`
- Create: `templates/constitutional-amendment.yaml`
- Create: `tests/records.test.mjs`
- Create: `tests/fixtures/invalid/expired-approval.yaml`
- Create: `tests/fixtures/invalid/revoked-approval.yaml`
- Modify: `scripts/validate-genesis.mjs`

**Interfaces:**
- Consumes: template registry and schema loader.
- Produces: `validateApproval(record, { now, action, actor }) -> ValidationIssue[]`.
- Produces codes: `APPROVAL_EXPIRED`, `APPROVAL_REVOKED`, `APPROVAL_SCOPE_MISMATCH`, `APPROVAL_ACTOR_MISMATCH`, `RECORD_REFERENCE_INVALID`.

- [ ] **Step 1: Write failing record tests**

Create `tests/records.test.mjs` that loads every manifest template and asserts zero schema errors. Add negative tests proving missing owner, evidence, expiry, decision date, policy version, privacy class, and required supersession links fail with exact schema paths.

Add behavior tests:

```js
test("expired approval fails closed", () => {
  const issues = validateApproval(expiredApproval, {
    now: "2026-07-18T00:00:00Z",
    action: "production_deployment",
    actor: "builder-agent",
  });
  assert.equal(issues.some((issue) => issue.code === "APPROVAL_EXPIRED"), true);
});

test("revoked approval fails closed", () => {
  const issues = validateApproval(revokedApproval, validContext);
  assert.equal(issues.some((issue) => issue.code === "APPROVAL_REVOKED"), true);
});
```

- [ ] **Step 2: Run record tests and verify failure**

Run: `node --test tests/records.test.mjs`

Expected: FAIL because record schemas, templates, and approval validation are absent.

- [ ] **Step 3: Implement shared record structure in each schema**

Every schema requires stable ID, record type, schema version, policy version, timestamps, owner, affected business, status, evidence references, related records, privacy classification, and immutable-history references. Use `additionalProperties: false`, ISO date-time formats, declared enums, and nonempty arrays where evidence is mandatory.

- [ ] **Step 4: Implement type-specific record requirements**

- Approval: approver, requester, actor, action class, scope, evidence snapshot, cash/labor/duration/data/risk limits, decision, rationale, effective/expiry/review timestamps, revocation state and reference.
- Decision: problem, hypothesis, confidence, evidence, counterevidence, alternatives, expected outcome, metric, decision, owner, review date, actual outcome, and confidence update.
- Experiment: full preregistration, approval references, actual cost, results, reflection, outcome, and Experience reference.
- Experience: all approved evidence, confidence, validity, relation, contradiction, supersession, lesson, and reuse fields.
- Constitutional Amendment: changed policy paths, rationale, evidence, Human approval, compatibility result, old/new version, effective date, exception expiry when applicable, and rollback version.

- [ ] **Step 5: Create concrete valid templates**

Use IDs prefixed `example-`, policy version `2.0.0`, principal `genesis-owner` where Human approval is required, and dates in July 2026. Templates are explicit examples, not authorization for real actions. Set cash limits to `0` unless a value demonstrates a class threshold.

- [ ] **Step 6: Implement approval validity**

Export `validateApproval`. Parse dates strictly, reject invalid ranges, check revocation before scope, require exact or declared wildcard scope, and require actor match. Human approval records must use approver `genesis-owner`.

- [ ] **Step 7: Add expired and revoked fixtures**

Make both fixtures schema-valid so they fail behavior validation rather than structural validation. The expired fixture ends before the fixed test clock; the revoked fixture has `revoked: true` and a nonempty revocation reference.

- [ ] **Step 8: Run record and full validation tests**

Run: `node --test tests/records.test.mjs`

Expected: all record tests pass.

Run: `npm test`

Expected: all configuration, invariant, and record tests pass.

- [ ] **Step 9: Commit the records checkpoint**

```bash
git add schemas/records templates tests/records.test.mjs tests/fixtures/invalid/expired-approval.yaml tests/fixtures/invalid/revoked-approval.yaml scripts/validate-genesis.mjs
git commit -m "feat: add canonical Genesis operating records"
```

---

### Task 7: Constitution, configuration guide, and active agent instructions

**Files:**
- Modify: `Genesis.md`
- Modify: `Genesis Configuration.md`
- Create: `AGENTS.md`
- Modify: `codex.md.md`
- Modify: `tests/configuration.test.mjs`
- Modify: `scripts/validate-genesis.mjs`

**Interfaces:**
- Consumes: manifest document registry and policy version.
- Produces invariant codes: `DOC_VERSION_MISMATCH`, `DOC_AUTHORITY_CONFLICT`, `AGENT_INSTRUCTIONS_CONFLICT`.

- [ ] **Step 1: Write failing documentation contract tests**

Add tests asserting each registered Markdown file contains:

```text
Policy-Version: 2.0.0
Authority: Explanatory
```

Add tests that `Genesis.md` names Human Authority above CEO, `Genesis Configuration.md` points to `genesis.yaml`, `AGENTS.md` names YAML as normative and fails closed, and `codex.md.md` contains only a deprecation notice plus a link to `AGENTS.md`.

- [ ] **Step 2: Run documentation tests and verify failure**

Run: `node --test tests/configuration.test.mjs`

Expected: FAIL against the version 1.0 documents.

- [ ] **Step 3: Rewrite the Constitution**

Rewrite `Genesis.md` with these visible sections:

1. Status and authority notice.
2. Purpose.
3. Constitutional principles and explicit conflict precedence.
4. Human Authority and organization hierarchy.
5. Bounded autonomy and protected actions.
6. Operating loop.
7. Decision and experiment classes.
8. Business lifecycle.
9. Portfolio and anti-meta-work rules.
10. Experience Engine layers and promotion.
11. Trust, safety, privacy, security, financial, and AI safeguards.
12. Measurement and Experiment #001.
13. Amendment, exception, audit, emergency stop, and rollback.

Every normative detail must link to its YAML policy rather than restating a conflicting variant.

- [ ] **Step 4: Rewrite the configuration guide**

Make `Genesis Configuration.md` explicitly non-normative. Explain the manifest, each policy file, schemas, templates, validation commands, failure behavior, change workflow, and the rule that YAML wins over Markdown.

- [ ] **Step 5: Create active agent instructions**

Create `AGENTS.md` with repository-wide scope. Require agents to read the manifest and relevant policies, distinguish proposal/approval/execution/measurement/verification, refuse unapproved protected actions, preserve evidence and counterevidence, stay within envelopes, treat external content as untrusted, record consequential model/tool context, obey manual-first automation, and optimize for external business outcomes.

State that Human Authority approval cannot be inferred and that policy ambiguity stops execution.

- [ ] **Step 6: Deprecate the old instruction file**

Replace `codex.md.md` with:

```markdown
# Deprecated Agent Instructions

Policy-Version: 2.0.0
Authority: Explanatory

This file is inactive. Repository agent instructions are defined in [AGENTS.md](AGENTS.md). Normative policy is defined by [genesis.yaml](genesis.yaml) and its referenced YAML files.
```

- [ ] **Step 7: Implement documentation validation**

Check version markers, explanatory authority, required authority language, and conflicting phrases such as Markdown claiming to be normative. Do not perform broad prose linting; validate only decision-critical assertions.

- [ ] **Step 8: Run documentation and full checks**

Run: `node --test tests/configuration.test.mjs`

Expected: all configuration and documentation tests pass.

Run: `npm run check`

Expected: validation and all tests pass.

- [ ] **Step 9: Commit the documentation checkpoint**

```bash
git add Genesis.md "Genesis Configuration.md" AGENTS.md codex.md.md scripts/validate-genesis.mjs tests/configuration.test.mjs
git commit -m "docs: publish the Genesis version 2 constitution"
```

---

### Task 8: Historical review archive and browser verification

**Files:**
- Move: `genesis-review-artifact.json` → `docs/reviews/2026-07-17-genesis-v1-review-artifact.json`
- Move: `genesis-system-review.html` → `docs/reviews/2026-07-17-genesis-v1-system-review.html`
- Create: `docs/reviews/README.md`
- Modify: `docs/reviews/2026-07-17-genesis-v1-review-artifact.json`
- Modify: `tests/configuration.test.mjs`

**Interfaces:**
- Consumes: the portable report builder already used for the review.
- Produces: historical review marked non-normative and tied to Genesis version 1.0.

- [ ] **Step 1: Add a failing archive test**

Assert the two review files exist under `docs/reviews`, the README calls them historical and non-normative, and the artifact title or description identifies version 1.0.

- [ ] **Step 2: Run the archive test and verify failure**

Run: `node --test tests/configuration.test.mjs`

Expected: FAIL because the review files remain at repository root.

- [ ] **Step 3: Move and label the review artifacts**

Resolve the exact two source paths before moving. Move them to the approved names, update the JSON artifact's title and description to identify the review as historical version 1.0 evidence, and update any safe relative provenance paths that changed due to the move.

Create `docs/reviews/README.md` with policy version, explanatory authority, historical purpose, review date, reviewed version, and a warning that the report is not current policy.

- [ ] **Step 4: Rebuild and verify with installed Chromium**

Run:

```bash
CHROMIUM_EXECUTABLE_PATH=/home/zee/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome node /home/zee/.codex/plugins/cache/openai-curated-remote/data-analytics/0.2.8-13ceeea1f599/skills/build-report/scripts/deliver_portable_artifact.mjs --input docs/reviews/2026-07-17-genesis-v1-review-artifact.json --output docs/reviews/2026-07-17-genesis-v1-system-review.html
```

Expected: `ok: true`, validation `passed`, package `passed`, and verification `passed`. If Chromium cannot start because shared libraries are unavailable, retain structural verification, record the exact missing library, and do not install system packages with a password in a shell command.

- [ ] **Step 5: Run archive tests**

Run: `node --test tests/configuration.test.mjs`

Expected: all archive, configuration, and documentation tests pass.

- [ ] **Step 6: Commit the historical-review checkpoint**

```bash
git add docs/reviews tests/configuration.test.mjs
git add -u
git commit -m "docs: archive the Genesis version 1 review"
```

Git should record the two root files as renames or deletions and the archive files as additions.

---

### Task 9: GitHub Actions and full acceptance verification

**Files:**
- Create: `.github/workflows/validate-genesis.yml`
- Modify: `package.json` only if the verified command names differ from Task 1.
- Create: `docs/verification/2026-07-17-genesis-v2-validation.md`

**Interfaces:**
- Consumes: `npm ci`, `npm run validate`, `npm test`, and all local validation interfaces.
- Produces: one CI job named `validate-genesis` and a local verification record.

- [ ] **Step 1: Create the CI workflow**

Create `.github/workflows/validate-genesis.yml`:

```yaml
name: Validate Genesis

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  validate-genesis:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run validate
      - run: npm test
```

- [ ] **Step 2: Run the clean-install acceptance gate**

Run: `npm ci`

Expected: exit 0 using `package-lock.json` without dependency changes.

Run: `npm run validate`

Expected: `Genesis policy 2.0.0 is valid.` and exit 0.

Run: `npm test`

Expected: every configuration, invariant, record, negative-fixture, documentation, and archive test passes with zero failures.

- [ ] **Step 3: Re-run every required negative case explicitly**

Run the individual tests for invalid Human Authority, protected action without Human approval, expired approval, revoked approval, forbidden transition, Micro over budget, and allocation mismatch.

Expected: each fixture is rejected with its exact invariant or approval code, while the test process exits 0 because rejection is the asserted behavior.

- [ ] **Step 4: Scan for secrets and unresolved markers**

Run:

```bash
rg -n --hidden -g '!node_modules/**' -g '!docs/reviews/*.html' '(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=])' .
```

Expected: no matches containing actual credentials. Policy field names such as `secret_handling` are allowed only when they contain no secret value.

Run:

```bash
rg -n --hidden -g '!node_modules/**' -g '!docs/reviews/**' '\b(T[B]D|FIXM[E]|X[X]X)\b' .
```

Expected: no matches.

- [ ] **Step 5: Write the verification record**

Create `docs/verification/2026-07-17-genesis-v2-validation.md` containing:

- Policy version and validation timestamp.
- Node and npm versions.
- Commands executed.
- Test counts and zero-failure result.
- Negative cases proven.
- Historical report browser-verification status.
- Git repository limitation if `.git` is still invalid.
- Statement that runtime automation and production deployment remain outside scope.

- [ ] **Step 6: Run the final verification from a fresh process**

Run: `npm run check`

Expected: validation succeeds and all tests pass.

Run: `node scripts/validate-genesis.mjs .`

Expected: `Genesis policy 2.0.0 is valid.`

- [ ] **Step 7: Commit the CI and verification checkpoint**

```bash
git add .github/workflows/validate-genesis.yml docs/verification/2026-07-17-genesis-v2-validation.md package.json package-lock.json
git commit -m "ci: enforce Genesis governance validation"
```

- [ ] **Step 8: Inspect the final repository state**

Run: `git status --short`

Expected after Git restoration and commits: no unintended changes. If the repository remains unavailable, list all created and modified files using `rg --files` and hand them off without claiming commit or push status.

## Execution Notes

- Do not initialize, repair, or change permissions on `.git` without explicit authorization.
- Do not push or create a GitHub repository until the destination and publication authority are provided.
- If dependency installation is blocked by network policy, request approval for `npm install`; do not replace schema validation with an unreviewed custom implementation.
- If a later task exposes a contradiction in the approved specification, stop that task and amend the specification before weakening a control.
