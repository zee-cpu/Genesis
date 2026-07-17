# Genesis Operating System Design

**Status:** Approved design
**Date:** July 17, 2026
**Scope:** Governance and operating-spec package for Genesis version 2.0

## 1. Purpose

Genesis is a human-governed business manufacturing system. It repeatedly discovers, validates, builds, operates, and improves trustworthy businesses while preserving evidence, correcting beliefs, and constraining autonomous action.

This design converts the existing manifesto into an executable policy package. It does not build an autonomous workflow engine. Genesis must first operate manually under these policies and earn automation through repeated, measured need.

## 2. Design Decisions

The approved decisions are:

1. One Human Authority is the final authority above the CEO.
2. Genesis uses bounded autonomy: agents may act within pre-approved low-risk envelopes, while protected actions require Human Authority approval.
3. YAML is the normative source of truth. Markdown is explanatory and cannot override YAML.
4. The repository includes executable validation infrastructure: JSON Schemas, a validation script, tests, and GitHub Actions.
5. Policy is modular rather than monolithic.
6. The first implementation is a manual operating protocol, not an automated orchestration engine.

## 3. Goals and Non-Goals

### Goals

- Establish unambiguous authority, permissions, approvals, and escalation.
- Define enforceable business and experiment lifecycles.
- Prevent Genesis from optimizing for its own internal machinery.
- Preserve evidence without turning memory into an uncurated archive.
- Make decision quality measurable.
- Fail closed when policy is missing, invalid, contradictory, or expired.
- Validate all normative configuration locally and in GitHub Actions.
- Provide reusable, schema-valid records for decisions, experiments, approvals, experiences, and constitutional amendments.

### Non-Goals

- Autonomous orchestration of agents.
- A workflow execution service or policy engine.
- A production database.
- Vector search or automated principle extraction.
- Customer billing, identity, or application infrastructure.
- Market-specific legal or regulatory certification.

These capabilities require separate designs after the manual protocol generates sufficient evidence.

## 4. Source of Truth and Precedence

`genesis.yaml` is the normative root manifest. It identifies every normative policy file, schema, policy version, and required validation rule.

Precedence is:

1. A valid, unrevoked Human Authority emergency suspension record.
2. The currently effective normative YAML policy set referenced by `genesis.yaml`.
3. Valid, scoped, unexpired Human Authority approval records.
4. Valid CEO approvals within Human-approved envelopes.
5. Markdown documentation and agent guidance.

Lower-precedence material cannot override higher-precedence policy. An invalid YAML policy set has no authority. If normative files disagree, validation fails and affected execution is suspended.

Markdown must state its non-normative status and policy version. Documentation drift is a validation failure when a document claims a different authority hierarchy or policy version.

## 5. Repository Architecture

```text
Genesis/
├── genesis.yaml
├── Genesis.md
├── Genesis Configuration.md
├── AGENTS.md
├── codex.md.md
├── package.json
├── config/
│   ├── governance.yaml
│   ├── organization.yaml
│   ├── permissions.yaml
│   ├── decision-policy.yaml
│   ├── portfolio-policy.yaml
│   ├── experience-policy.yaml
│   ├── risk-policy.yaml
│   ├── metrics-policy.yaml
│   └── workflows/
│       ├── business-lifecycle.yaml
│       └── experiment-lifecycle.yaml
├── templates/
│   ├── approval-record.yaml
│   ├── decision-record.yaml
│   ├── experiment-record.yaml
│   ├── experience-record.yaml
│   └── constitutional-amendment.yaml
├── schemas/
│   ├── genesis.schema.json
│   ├── governance.schema.json
│   ├── organization.schema.json
│   ├── permissions.schema.json
│   ├── decision-policy.schema.json
│   ├── portfolio-policy.schema.json
│   ├── experience-policy.schema.json
│   ├── risk-policy.schema.json
│   ├── metrics-policy.schema.json
│   ├── workflow.schema.json
│   └── records/
│       ├── approval-record.schema.json
│       ├── decision-record.schema.json
│       ├── experiment-record.schema.json
│       ├── experience-record.schema.json
│       └── constitutional-amendment.schema.json
├── scripts/
│   └── validate-genesis.mjs
├── tests/
│   ├── configuration.test.mjs
│   ├── invariants.test.mjs
│   └── records.test.mjs
├── docs/
│   ├── reviews/
│   └── superpowers/
└── .github/workflows/
    └── validate-genesis.yml
```

Each file has one responsibility. Policy files contain normative rules, schemas validate their local structure, and cross-file tests enforce system-wide invariants.

## 6. Authority Model

The mandatory hierarchy is:

```text
Human Authority
└── CEO
    ├── Research
    ├── Builder
    ├── Operator
    └── Analyst
```

### Human Authority

The Human Authority is a single identified human principal with the stable principal ID `genesis-owner`. This identity cannot be assigned to an AI agent, service account, delegated agent, or autonomous process.

The Human Authority may:

- Approve, reject, veto, revoke, or suspend any Genesis action.
- Define and revoke budget and permission envelopes.
- Approve Major Bets and protected actions.
- Amend the Constitution and normative policy.
- Approve temporary policy exceptions.
- Activate or release the emergency stop.
- Appoint, replace, constrain, or remove the CEO.

Human Authority approval cannot be inferred from silence, prior behavior, conversation context, or a role label. It exists only as a valid approval record attributable to `genesis-owner`.

### CEO

The CEO is accountable to the Human Authority. The CEO allocates resources within approved envelopes, approves normal Experiments, resolves operational conflicts, enforces policy, and reports material risk. The CEO cannot amend policy, approve its own permission escalation, waive protected-action controls, or overrule the Human Authority.

### Functions

Research, Builder, Operator, and Analyst operate within explicit responsibility and permission scopes. A function may propose actions outside its scope but may not execute them until the required approval exists.

For Major Bets, protected actions, permission escalation, and constitutional actions, proposer and approver must be different principals.

## 7. Bounded Autonomy and Permissions

Genesis is default-deny. An action is permitted only when all of the following are true:

1. The policy set is valid and effective.
2. The actor has the required role and permission.
3. The action is within an unexpired budget, duration, data, and risk envelope.
4. Every required approval exists and is valid.
5. No emergency suspension or revocation applies.
6. Required evidence and records are present.

Agents may perform reversible, low-risk internal work such as public-source research, internal drafting, sandboxed code changes, tests, analysis, and record preparation when those actions stay within declared scopes.

### Protected Actions

The following require Human Authority approval regardless of cost:

- Contracts, terms, warranties, or legal commitments.
- Spending outside an approved portfolio envelope.
- Banking authority, payments, refunds, transfers, or changes to financial authority.
- Production deployment or an irreversible production change.
- Collection, purchase, sharing, or processing of personal or sensitive data.
- External customer communication outside an approved template and audience.
- Regulated-market activity or regulated claims.
- Security exceptions, credential access, permission escalation, or access-control changes.
- Public claims or representations made on behalf of Genesis.
- Creation or dissolution of a legal entity.
- Constitutional amendments or policy exceptions.
- Any action classified high or critical risk.

### Approval Records

Every approval contains:

- Record ID and policy version.
- Human or CEO approver principal ID.
- Requester and affected actor.
- Action class and exact scope.
- Evidence snapshot references.
- Maximum cash, labor, duration, data, and risk limits.
- Decision and rationale.
- Issued, effective, expiry, and review timestamps.
- Revocation status and revocation reference.

Missing, expired, revoked, mismatched, or ambiguous approval means deny.

## 8. Decision Classes

### Routine

- Reversible internal work.
- No external commitment.
- No protected action.
- No incremental spend outside an existing envelope.
- Governed by role permissions.

### Micro-Experiment

- Maximum direct cash cost: USD 500.
- Maximum duration: seven calendar days.
- Must fit within a Human-approved aggregate portfolio envelope.
- Must have a pre-registered hypothesis, metric, stop condition, owner, and decision date.
- May be approved by the CEO or run under an explicit standing CEO approval.

### Experiment

- Maximum direct cash cost: USD 5,000.
- Maximum duration: 30 calendar days.
- Requires CEO approval.
- Must fit within a Human-approved aggregate portfolio envelope.
- Cannot contain a protected action without separate Human Authority approval.

### Major Bet

An action is a Major Bet if any of these are true:

- Direct cash cost exceeds USD 5,000.
- Planned duration exceeds 30 calendar days.
- It creates a strategically difficult-to-reverse commitment.
- It spans multiple businesses or materially changes the portfolio.
- It consumes more than 20% of monthly deployable cash or available operating capacity.
- It is classified high risk.

Major Bets require Constitution review, evidence review, CEO recommendation, and Human Authority approval.

### Constitutional Action

Any change to authority, precedence, protected actions, decision thresholds, amendment rules, or the normative policy set is a Constitutional Action. It requires Human Authority approval and change control.

## 9. Business Lifecycle

The states are:

```text
Discover → Validate → Build → Launch → Operate → Review
                                              ├→ Scale
                                              ├→ Pivot
                                              ├→ Learning Lab
                                              ├→ Archive
                                              └→ Kill
```

Every state defines:

- Accountable role.
- Responsible function.
- Required input records.
- Allowed actions.
- Exit criteria.
- Required evidence.
- Approval class.
- Output record.
- Review deadline.
- Allowed next states.

Build cannot begin unless a validation record meets its precommitted pass criteria. The sole exception is a Human-approved learning prototype with a capped budget, explicit non-production scope, and expiry.

Launch requires Human Authority approval because it introduces external users, production operation, public representation, or customer data. Routine production operations may later run under a scoped, expiring standing approval.

## 10. Experiment Lifecycle

The states are:

```text
Draft → Evidence Review → Approval → Running → Measurement
      → Reflection → Decision → Closed
```

Before approval, an experiment must specify:

- Problem and decision it supports.
- Hypothesis and confidence.
- Evidence and counterevidence.
- Baseline and comparison method.
- Metric formula, population, denominator, and data source.
- Expected outcome and minimum meaningful effect.
- Failure and stop conditions.
- Maximum cash, labor, duration, data, and risk exposure.
- Owner and decision date.
- Allowed outcomes.

Allowed outcomes are Scale, Pivot, Learning Lab, Archive, and Kill. Closure requires actual cost, outcome, reflection, confidence update, and linked Experience Record.

## 11. Portfolio Policy and Meta-Work Controls

Genesis has two portfolio modes.

### Bootstrap Mode

- 80% primary opportunity discovery, validation, building, or operation.
- 15% bounded experiments.
- 5% reserve; Learning Labs may use it only after a real failed initiative qualifies.
- Maximum one active business opportunity.
- Maximum 10% of total weekly capacity on the Genesis operating system itself.

### Operating Mode

- 80% proven businesses or opportunities.
- 15% experiments.
- 5% Learning Labs.

`proven` means evidence of repeatable demand, a defined customer, a working value-delivery process, and economics or strategic value meeting precommitted thresholds.

Additional controls are:

- No automation until the same material manual failure occurs at least three times.
- Every internal artifact must name the external decision it changes, its owner, review date, and sunset date.
- Producing records, dashboards, frameworks, prompts, or automation is not a business outcome.
- Work without a current external decision or validated operational need is stopped.
- Learning Labs require a budget, owner, learning metric, monthly review, and mandatory expiry.
- Aggregate experiment spending cannot exceed the active Human-approved envelope even if each experiment is individually below its class limit.

## 12. Canonical Records

Decision, Experiment, Approval, Experience, and Constitutional Amendment records share:

- Stable ID.
- Record type and schema version.
- Policy version.
- Created and updated timestamps.
- Owner and affected business.
- Current status.
- Evidence references.
- Related-record references.
- Privacy classification.
- Immutable history references.

The Decision–Experiment–Outcome model is the shared spine. Specialized record types extend it without redefining common concepts.

## 13. Experience Engine

The Experience Engine separates history from current knowledge.

### Immutable Evidence Layer

This append-only layer stores decisions, experiments, approvals, observations, actions, and outcomes. Corrections are new records that reference prior records; historical evidence is never silently rewritten.

### Curated Knowledge Layer

This layer contains the current best lessons and principles. Each item links to supporting and contradicting evidence, carries confidence and validity dates, and identifies records it supersedes.

The promotion path is:

```text
Raw Event → Reviewed Experience → Validated Lesson → Principle
```

A single event cannot automatically become a universal principle. A broad principle requires replicated evidence or explicit Human Authority approval. Human approval does not convert weak evidence into strong evidence; it authorizes provisional use and must preserve the limitation.

Required Experience fields include:

- ID, timestamp, owner, business, domain, and tags.
- Context, hypothesis, decision, action, and outcome.
- Baseline, expected result, metric definition, and actual result.
- Supporting and contradicting evidence.
- Confidence and validity window.
- Privacy classification and review status.
- Related, duplicate, contradicts, and supersedes references.
- Reflection, reusable lesson, and reuse evidence.

The initial store is a reviewed YAML record collection. Retrieval starts with keyword and field search plus weekly Human-curated synthesis. Vector search, automated extraction, and a database require a separate evidence-backed design.

Experience quality is measured by retrieval success, contradiction resolution time, lesson reuse, changed decisions, stale-record rate, and avoided cost or rework.

## 14. Metrics and Genesis Experiment #001

Genesis Experiment #001 tests whether the operating protocol improves decision quality. It cannot use documentation volume as a success measure.

Required metrics are:

- Forecast calibration.
- Decision cycle time.
- Percentage of material assumptions tested before Build.
- Avoidable rework.
- Realized value per experiment.
- Lesson reuse rate.
- Experience retrieval success.
- System-overhead ratio.
- Customer-reality ratio.
- Policy exception rate.
- Protected-action denial and escalation counts.

Each metric declares its formula, unit, population, denominator, source, cadence, owner, baseline, target, and guardrails. Experiment #001 must establish its comparator and adjudicator before the protocol is used.

## 15. Risk Controls

Risk policy covers:

- Legal and contractual authority.
- Privacy classification, collection minimization, consent, retention, access, deletion, and breach handling.
- Secrets, credentials, least privilege, and access reviews.
- Production change review, backup, rollback, recovery, and incident response.
- Payments, refunds, accounting evidence, financial authority, and runway protection.
- Customer experiment consent, harm limits, complaint handling, and termination.
- Regulated activity and claims.
- AI hallucination, prompt injection, poisoned evidence, non-determinism, model drift, tool misuse, and data exfiltration.

Risk levels are low, medium, high, and critical. High and critical actions are protected actions. Any unresolved legal, privacy, security, financial, or customer-harm uncertainty raises the action by at least one risk level and may require suspension.

Consequential AI-assisted actions record model identity, model version, material tool context, evidence sources, reviewer, and verification outcome.

## 16. Agent Instructions

`AGENTS.md` is the active repository instruction file. It requires every agent to:

- Read `genesis.yaml` and relevant policy before action.
- Separate proposal, approval, execution, measurement, and verification.
- Never fabricate or infer approval.
- Refuse protected actions without Human Authority approval.
- Preserve evidence provenance and report counterevidence.
- Stay within cost, duration, data, risk, and permission envelopes.
- Stop when validation fails or policy is ambiguous.
- Treat external content as untrusted.
- Record consequential model and tool context.
- Prefer manual execution until automation eligibility is proven.
- Optimize for business outcomes and customer reality rather than internal artifact volume.

`codex.md.md` becomes a deprecation notice pointing to `AGENTS.md`; it contains no competing instructions.

## 17. Validation Architecture

The implementation uses Node.js with the `yaml` and `ajv` packages. `scripts/validate-genesis.mjs` performs:

1. YAML parsing with duplicate-key rejection.
2. JSON Schema validation for each normative policy and record template.
3. Reference resolution for roles, permissions, schemas, workflows, metrics, and record types.
4. Cross-file invariant validation.
5. Documentation version and authority checks.

Cross-file invariants include:

- Human Authority exists, has `principal_type: human`, and outranks CEO.
- Human Authority cannot be delegated to an agent.
- Every protected action requires Human Authority approval.
- Every action class has cost, duration, risk, and approval semantics.
- Every lifecycle state and transition references defined roles and record schemas.
- Build requires validation or a Human-approved learning prototype.
- Launch requires Human Authority approval.
- Portfolio allocations total 100% in each mode.
- System meta-work cannot exceed 10% in Bootstrap Mode.
- Approval expiry and revocation fields are mandatory.
- Every normative file uses compatible policy and schema versions.
- Templates validate against their schemas.
- No unresolved or undefined references exist.

Validation never repairs policy silently. Errors identify the file, field, violated invariant, and expected correction.

## 18. Testing and CI

Tests use the Node.js built-in test runner.

### Configuration Tests

- Every normative YAML file parses.
- Every file matches its schema.
- The manifest references every required file and no missing file.

### Invariant Tests

- Human Authority outranks CEO.
- An AI principal cannot occupy Human Authority.
- Protected actions cannot omit Human approval.
- Expired or revoked approval fails.
- Excess budget changes an Experiment into a Major Bet.
- Invalid lifecycle transitions fail.
- Allocation totals other than 100% fail.
- Documentation cannot claim normative authority.

### Record Tests

- Every template validates.
- Missing provenance, owner, expiry, decision date, or supersession fields fail where required.
- Record references use declared types and identifiers.

GitHub Actions installs locked dependencies with `npm ci`, runs validation, and runs all tests. Pull requests cannot be treated as policy-ready unless the workflow passes.

## 19. Error Handling and Emergency Control

Genesis fails closed. A missing, invalid, contradictory, ambiguous, expired, or revoked policy or approval denies the affected action.

Errors must be actionable and include:

- Error code.
- File and field path.
- Actor and attempted action when applicable.
- Required policy or approval.
- Escalation target.

The emergency stop disables agent execution, spending, external communication, production changes, and new approvals below Human Authority. Read-only inspection, evidence preservation, validation, and recovery planning remain available.

Release from emergency stop requires a Human Authority record identifying cause, remediation evidence, restored scopes, and monitoring period.

## 20. Migration

- Rewrite `Genesis.md` as the readable Constitution for policy version 2.0.
- Rewrite `Genesis Configuration.md` as a non-normative configuration guide.
- Create `AGENTS.md` as the active instruction file.
- Replace `codex.md.md` with a deprecation notice.
- Move the version 1.0 review artifact and HTML report to `docs/reviews/` and mark them historical.
- Preserve the approved design and implementation plan under `docs/superpowers/`.

The historical review remains evidence of why version 2.0 changed. It cannot be used as current policy.

## 21. Acceptance Criteria

The governance package is ready when:

1. Every YAML file parses with duplicate keys rejected.
2. Every normative file passes its JSON Schema.
3. Every record template passes its schema.
4. All cross-file invariants pass.
5. Negative fixtures fail for invalid authority, expired approval, revoked approval, forbidden transition, excess budget, allocation mismatch, and protected action without Human approval.
6. Human Authority is provably above CEO and typed as human.
7. No protected action can pass validation without Human Authority approval semantics.
8. Constitution, configuration guide, agent instructions, and normative policy contain no authority or workflow contradiction.
9. GitHub Actions runs the same validation and tests as local development.
10. The portable historical review passes browser verification when Chromium is available.
11. The repository contains no placeholders, embedded secrets, or conflicting active instruction files.
12. No runtime automation is introduced beyond validation and tests.

## 22. Git and GitHub Handoff

The current workspace contains an empty, read-only `.git` directory and is not recognized as a Git repository. The implementation can prepare all files and verification evidence, but commits and GitHub publication require restoration of real repository metadata or creation of a writable repository by the user or authorized environment.

GitHub publication is a separate authorized action after local validation passes and the destination repository is known.
