# Genesis Configuration Guide

Policy-Version: 2.0.0
Authority: Explanatory

This is a non-normative operator guide. [genesis.yaml](genesis.yaml) is the normative manifest, and its referenced YAML is normative policy. YAML wins over Markdown whenever valid sources differ. Stop and escalate if normative sources are missing, invalid, contradictory, ambiguous, expired, or revoked.

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

## Change workflow

1. Identify the external decision and affected normative files.
2. Classify the change under decision and governance policy.
3. Obtain required approval before changing protected or constitutional policy.
4. Update YAML, its schema, tests, and only then explanatory documentation.
5. Run `npm run check`, inspect exact errors and the diff, and preserve evidence.
6. Commit intentionally. Publish only after Human Authority approves the final destination and scope.

Do not edit Markdown to override policy. Changes to authority, precedence, protected actions, decision thresholds, amendment rules, or the normative policy set are Constitutional Actions.
