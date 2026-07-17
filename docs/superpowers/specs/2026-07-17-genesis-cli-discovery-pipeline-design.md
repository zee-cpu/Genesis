# Genesis CLI Discovery Pipeline Design

Policy-Version: 2.0.0
Authority: Explanatory
Status: User-reviewed design
Date: 2026-07-17
External-Decision: Decide whether to implement the first operational Genesis pipeline as an offline, human-assisted CLI covering Discover through validation planning.
Owner: builder
Review-Date: 2026-08-17
Sunset-Date: 2027-01-17

## 1. Purpose

This design defines the first executable operating slice built on Genesis 2.0. It turns the governance package into a resumable local CLI that can register one business opportunity, preserve evidence, create a Decision Record, preregister a validation experiment, calculate supported early metrics, and stop at the approval gate before real-world execution.

The design does not authorize normative policy changes or protected actions. Any implementation change to a normative schema or validator must follow the applicable decision class, records, versioning, tests, and approval requirements before it becomes effective.

## 2. Decisions approved during design review

- The first interface is a CLI rather than a web application.
- Runtime state uses canonical immutable YAML records with a rebuildable SQLite projection.
- The workflow is human-assisted; suggestions cannot save evidence or advance state.
- `genesis start-business` is a guided interactive wizard.
- The first release covers Discover through validation planning and stops at `approval_pending`.
- The CLI works without an external AI API or network access.
- Work is resumable across commands rather than requiring one long session.

## 3. Goals

- Create a real, policy-valid opportunity and Decision Record from a guided CLI.
- Add supporting and contradicting evidence without silently rewriting history.
- Explain current lifecycle state, missing gates, permitted next action, and blockers.
- Produce a complete preregistered validation Experiment Record.
- Enforce the approval boundary before experiment execution.
- Preserve YAML as durable evidence while making state and metrics practical through SQLite.
- Recover the complete projection from YAML alone.
- Produce actionable fail-closed errors.

## 4. Non-goals

Version one does not:

- Search the web or call an AI service.
- Contact customers or conduct an experiment.
- Build or deploy a product.
- Enter contracts, spend money, process payments, or handle financial authority.
- Collect or copy sensitive files.
- Implement Build, Launch, Operate, Review, Scale, Pivot, Learning Lab, Archive, or Kill execution.
- Provide a web UI, multi-user service, production database, billing, outreach, or autonomous agents.
- Calculate outcome metrics that require an executed experiment.

## 5. Architecture

The implementation remains a Node.js application in the existing repository and is divided into focused components.

### 5.1 CLI layer

The CLI owns terminal input and output only. It collects guided answers, displays complete proposals, requests explicit confirmation, and renders success or actionable errors. It does not contain policy, storage, or lifecycle logic.

### 5.2 Workflow service

The workflow service loads the normative Genesis policy set, identifies the current lifecycle state, evaluates gates, and returns allowed actions or blockers. It consumes canonical records rather than ad hoc helper shapes.

### 5.3 Record service

The record service creates and validates versioned Decision and Experiment Records. Confirmed changes produce new immutable YAML versions. It never rewrites a prior canonical record.

### 5.4 YAML record store

YAML is the durable evidence layer. Records are written to a temporary file, validated, and atomically renamed into place. Stable record identifiers and monotonically increasing version numbers identify history.

### 5.5 SQLite projection

SQLite stores current lifecycle state, latest record versions, searchable fields, record paths, and supported metrics. It is not authoritative. It may be deleted and rebuilt deterministically from YAML.

### 5.6 Suggestion provider

The first provider is deterministic and offline. It offers examples of hypotheses, evidence categories, validation methods, metrics, and stop conditions. Suggestions are labeled, require explicit user selection or editing, and never become evidence automatically. A provider interface allows a future AI adapter without coupling AI behavior to policy or storage.

## 6. Runtime workspace

Each working directory receives a private local runtime directory:

```text
.genesis/
├── records/
│   ├── decisions/
│   └── experiments/
├── evidence/
├── genesis.db
└── workspace.lock
```

Runtime data is ignored by Git by default. Privacy classification defaults to `internal`. Evidence files are not copied automatically; version one stores user-confirmed references and summaries.

## 7. Commands and user flow

### 7.1 `genesis start-business`

The guided wizard collects the business identifier, target customer, problem, hypothesis, confidence, initial evidence, counterevidence, alternatives, expected outcome, metric, owner, and review date. It shows the complete proposed Decision Record before confirmation.

After confirmation, the command creates the first immutable Decision Record, initializes the SQLite projection, and places the opportunity in `discover`.

### 7.2 `genesis add-evidence <business-id>`

The command collects a source reference, summary, collection date, privacy classification, provenance, and whether the item supports or contradicts the current hypothesis. It shows the proposed addition before confirmation.

The command appends evidence and creates a new Decision Record version when belief, confidence, or the current evidence set changes. Prior versions remain intact.

### 7.3 `genesis status <business-id>`

The command displays:

- Current lifecycle state.
- Latest Decision and Experiment Record versions.
- Supporting and contradicting evidence counts.
- Missing exit criteria and preregistration fields.
- Current cash, labor, duration, data, and risk limits.
- The next permitted command.
- Approval, policy, or record blockers.
- SQLite projection consistency.

### 7.4 `genesis plan-experiment <business-id>`

This command is available only when Discover exit criteria pass. It collects the supported decision, baseline, comparison method, metric formula, population, denominator, data source, expected outcome, minimum meaningful effect, failure conditions, stop conditions, maximum cash, labor, duration, data and risk exposure, owner, decision date, and allowed outcomes.

After confirmation, it creates a preregistered draft Experiment Record and sets the projected state to `approval_pending`. Version one cannot run the experiment or bypass this state.

### 7.5 `genesis rebuild-index`

The command deletes no canonical evidence. It reads every valid YAML version in deterministic order, rebuilds SQLite in a temporary database, verifies the resulting projection, and atomically replaces the stale database.

## 8. Record and validator alignment

The current Experiment Record schema requires closure-only fields even when a record is a draft. The current transition helper also expects approval and validation objects whose fields do not match canonical records.

Implementation therefore requires a separately authorized normative change that:

- Makes Experiment Record requirements conditional on lifecycle status.
- Requires preregistration fields for `draft` and `active` records.
- Requires actual cost, results, reflection, outcome, confidence update, decision outcome, and Experience linkage only when the record is `closed`.
- Defines a canonical validation subtype and outcome representation that can satisfy the Business Lifecycle Build gate in a later release.
- Makes transition validation consume canonical Approval and Experiment Record fields.
- Validates actor, action, scope, budget, duration, data class, risk class, effective time, expiry, and revocation from the canonical Approval Record.
- Updates schemas, templates, focused tests, negative fixtures, explanatory documentation, and the complete repository gate together.

This design records the need; it does not itself grant approval or make the change effective.

## 9. Write sequence and recovery

Every durable command follows the same sequence:

1. Collect input.
2. Validate field-level constraints.
3. Display the complete proposed record or evidence addition.
4. Receive explicit confirmation.
5. Validate the proposal against schema, policy, lifecycle, and authority requirements.
6. Write and flush a temporary YAML file.
7. Atomically rename it into the canonical record store.
8. Update SQLite.
9. Verify the projection references the new canonical version.

If steps 1 through 5 fail, nothing is written. If the process stops before the rename, no canonical partial record exists. If SQLite update or verification fails after the rename, the command reports that evidence is safe but the projection is stale and directs the user to `genesis rebuild-index`.

## 10. Safety and privacy

- A workspace lock prevents concurrent writers.
- Missing, invalid, contradictory, ambiguous, expired, revoked, or mismatched authority fails closed.
- Conversation context is never treated as approval.
- Approval requires a schema-valid canonical Approval Record.
- Protected actions remain unavailable in version one.
- Suggestions are visually identified and cannot be cited as evidence without a human-provided source and confirmation.
- Runtime data remains local and Git-ignored by default.
- Privacy defaults to `internal`; version one rejects sensitive-data collection workflows.
- No command makes network calls.
- Stable errors include code, affected record or field, expected correction, and escalation target.

## 11. Supported metrics

Version one calculates only metrics supported by its actual data:

- Supporting evidence count.
- Contradicting evidence count.
- Days spent in Discover.
- Time from opportunity creation to validation plan.
- Preregistration completeness.
- Decision confidence and version history.
- Commands blocked by policy or error code.
- Record and projection consistency.

It does not calculate realized value, experiment success, customer-reality ratio, forecast calibration, or other outcome metrics before an experiment is executed.

## 12. Testing strategy

### 12.1 Unit tests

Cover identifiers, deterministic suggestions, classifications, record versioning, gate evaluation, and metric calculations.

### 12.2 Schema and policy tests

Prove that each record status requires the correct fields, invalid phase combinations fail, canonical approvals enforce every limit, and the existing negative fixtures remain rejected.

### 12.3 Storage tests

Cover atomic YAML writes, append-only behavior, interrupted writes, workspace locking, projection updates, projection mismatch detection, and deterministic SQLite rebuilding.

### 12.4 CLI integration tests

Run commands in isolated temporary workspaces with scripted input. Verify terminal output, exit codes, YAML contents, version history, SQLite state, and fail-closed behavior.

### 12.5 No-network test

Run the complete CLI flow with network access unavailable and assert that no network-capable adapter is invoked.

## 13. Acceptance criteria

The first release is complete only when a clean environment can:

1. Run `genesis start-business` and create a schema-valid opportunity and Decision Record.
2. Resume the opportunity with `genesis add-evidence`.
3. Show missing Discover gates with `genesis status`.
4. Produce a complete preregistered Experiment Record with `genesis plan-experiment`.
5. Stop at `approval_pending` and reject execution without valid approval.
6. Delete SQLite, rebuild it from YAML, and recover identical state and metrics.
7. Reject missing, expired, revoked, actor-mismatched, scope-mismatched, and limit-mismatched approvals.
8. Pass focused tests and the complete `npm run check` gate.
9. Demonstrate that the full version-one flow works without network access or an API key.

## 14. Later releases

Later designs may separately add experiment execution and measurement, AI-assisted public research, a web approval interface, full business lifecycle states, customer outreach, product building, deployment, billing, and operations. Each addition receives its own design, plan, authority classification, evidence, and verification.

## 15. Review and sunset

The owner reviews this design by 2026-08-17 against implementation evidence, system-overhead ratio, and the external decision it supports. The design sunsets on 2027-01-17 unless renewed, superseded, or closed with recorded rationale.
