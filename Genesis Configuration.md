# Genesis Configuration Guide

Policy-Version: 2.0.0
Authority: Explanatory

This is a non-normative CLI runtime guide. [genesis.yaml](genesis.yaml) is the normative manifest, and its referenced YAML is normative policy. YAML wins over Markdown whenever valid sources differ. Stop and escalate if normative sources are missing, invalid, contradictory, ambiguous, expired, or revoked.

## Repository map

- `genesis.yaml` registers policies, record templates, schemas, and explanatory documents.
- `config/` holds governance, organization, permission, decision, portfolio, workflow, Experience, risk, and metric policies.
- `schemas/` defines the accepted structure for the manifest, every policy, and every canonical record.
- `templates/` contains explicit examples. They are not approvals and grant no authority.
- `scripts/validate-genesis.mjs` parses YAML, validates schemas, resolves references, and enforces cross-file invariants.
- `tests/` contains positive contracts and intentional invalid fixtures.

## Policy ownership

- [Governance](config/governance.yaml) defines Human Authority, precedence, amendments, exceptions, CEO bounds, and emergency stop.
- [Organization](config/organization.yaml) defines roles, hierarchy, escalation, and separation of duties.
- [Permissions](config/permissions.yaml) defines default-deny permissions and protected actions.
- [Decision](config/decision-policy.yaml) and [Portfolio](config/portfolio-policy.yaml) define classifications, approval thresholds, allocations, experiment envelopes, work-in-progress, and anti-meta-work controls.
- [Business](config/workflows/business-lifecycle.yaml) and [Experiment](config/workflows/experiment-lifecycle.yaml) workflows define lifecycle gates.
- [Experience](config/experience-policy.yaml), [Risk](config/risk-policy.yaml), and [Metrics](config/metrics-policy.yaml) define learning, safeguards, measurement, and Genesis Experiment #001.

## Validation commands

Install exactly locked dependencies and run the same checks intended for CI:

```bash
npm ci
npm run validate
npm test
npm run check
```

`npm run validate` must produce no issues in the completed repository. Any failure denies the affected action; validation never silently repairs policy.

## Human approval workflow

After `genesis plan-experiment <business-id>` creates an experiment in `approval_pending`, use the following sequence:

```bash
genesis review-experiment <business-id>
genesis approve-experiment <business-id>  # or deny-experiment
genesis start-experiment <business-id>
genesis record-execution <business-id>
genesis record-measurement <business-id>
genesis record-reflection <business-id>
genesis decide-experiment <business-id>
genesis close-experiment <business-id>
genesis start-follow-up <business-id>     # only after an eligible closed pivot or scale outcome
genesis start-learning-lab <business-id>  # only after a closed failed learning_lab outcome
genesis revoke-approval <business-id>     # when authority must be withdrawn
```

Review is read-only. Approval and denial create immutable runtime approval records under `.genesis/records/approvals/`. Starting is a separate manual action that revalidates Human Authority, separation of duties, exact scope, actor, limits, effective time, expiry, and revocation state before recording the experiment as `active`. It does not perform experiment tasks. After the operator performs or stops the approved work, `record-execution` preserves the factual execution log, deviations, completion reason, timestamps, actual cost, data classes, and risk. It rejects actor, time, or exposure outside the approval. `record-measurement` separately preserves the observed result, baseline comparison, evidence sources, and data-quality limitations. `record-reflection` creates a reviewed experience and confidence update. `decide-experiment` presents the exact outcome, evidence review, constitution review, and CEO recommendation at a Human Authority Major Bet gate. That approval authorizes only classification and closure; it does not authorize executing the selected outcome. `close-experiment` revalidates the decision approval before closing the linked experiment, decision, and experience versions. For closed `pivot` or `scale` classifications, `start-follow-up` creates a new Discover workflow linked to the reviewed experience. For a closed `learning_lab` classification, `start-learning-lab` additionally requires the reviewed initiative to have failed and records a separate budget, owner, learning metric, monthly review, and expiry on the child decision. Neither path carries forward approval, budget, or execution authority. A Learning Lab experiment must stay within those controls and still pass normal experiment approval. Revocation creates a new approval version and supersedes an active experiment without rewriting history.

The local CLI does not authenticate or cryptographically verify the names entered by an operator. Treat access to the workspace and its operating account as part of the trust boundary. Do not expose this workflow as a hosted or multi-user service without adding identity and access controls.

## Guided operator workflow

For an existing opportunity, run:

```bash
genesis list
genesis search "keyword or phrase" --business <business-id>
genesis next <business-id>
```

`genesis list` provides a read-only operator inbox with projected state, next action, nearest review timing, and the first actionable blocker. `genesis next` reads the selected lifecycle state from SQLite, verifies that the projection matches canonical YAML, and explains the next supported action. It pulls reusable values from existing records, calculates system timestamps through the configured clock, validates typed input while prompting, and delegates every mutation to the existing service methods. During experiment approval it renders one consolidated authority envelope immediately before the final confirmation. The guided layer does not weaken schemas, approval validity, append-only storage, or rebuild behavior.

Use `--json` with `list`, `search`, `status`, `next`, `review-experiment`, or `rebuild-index` for machine-readable output. Use `--input <file.json>` with a mutation command to load proposal fields without answering each prompt. Structured input still passes through the same proposal preview, schema and policy checks, immutable storage path, and final confirmation; it never supplies authority by itself.

Filter `genesis list` with `--business`, `--state`, `--blocked`, or `--review`. `genesis search` performs the policy-supported literal keyword and field search over immutable evidence entries and reviewed experiences, with optional `--business`, `--stance`, and `--privacy` filters. Both commands verify SQLite against canonical YAML before returning results and never modify or promote evidence.

Operator mistakes are corrected through new versions, never in-place edits. `genesis correct-decision <business-id>` is limited to mutable discovery fields before an experiment exists. `genesis revise-experiment <business-id>` is limited to draft preregistrations and rejects identity, history, lifecycle, execution, and authority fields. An approved draft must have its approval revoked before revision. Every correction stores its reason, corrected fields, and superseded version path.

## Change workflow

1. Identify the external decision and affected normative files.
2. Classify the change under decision and governance policy.
3. Obtain required approval before changing protected or constitutional policy.
4. Update YAML, its schema, tests, and only then explanatory documentation.
5. Run `npm run check`, inspect exact errors and the diff, and preserve evidence.
6. Commit intentionally. Publish only after Human Authority approves the final destination and scope.

Do not edit Markdown to override policy. Changes to authority, precedence, protected actions, decision thresholds, amendment rules, or the normative policy set are Constitutional Actions.
