# Genesis Version 2.0 Validation Record

Policy-Version: 2.0.0
Authority: Explanatory
Validation-Timestamp: 2026-07-17T11:27:02+04:00

## Environment

- Node: `v24.14.0` (policy and CI minimum: Node 22)
- npm: `11.9.0`
- Repository: valid local Git repository
- Publication: not pushed; final remote publication remains a separate Human Authority decision

## Clean-install acceptance

The locked dependency tree was installed with:

```bash
HOME=/tmp/genesis-home npm ci --cache /tmp/genesis-ci-cache
```

Result: exit 0; seven packages installed; `package.json` and `package-lock.json` unchanged.

An initial `npm ci` attempt using the environment's default cache failed because npm could not create `/root/.npm`. The clean install was rerun with explicit writable temporary HOME and cache paths and succeeded. This was an environment path correction, not a dependency or lockfile change.

## Commands and results

```bash
node scripts/validate-genesis.mjs .
npm test
HOME=/tmp/genesis-home npm audit --cache /tmp/genesis-ci-cache
node --test tests/configuration.test.mjs
node --test tests/invariants.test.mjs
node --test tests/records.test.mjs
```

Results:

- Policy validation: `Genesis policy 2.0.0 is valid.`
- Full suite: 60 passed, 0 failed.
- Dependency audit: 0 vulnerabilities.
- JSON parse and diff checks: passed.

## Explicit negative cases

Each case was run independently by exact test name and exited successfully because the invalid input was rejected as asserted:

| Case | Required rejection code |
|---|---|
| Agent occupying Human Authority | `AUTH_HUMAN_REQUIRED` |
| Protected action without Human approval | `PROTECTED_APPROVAL_REQUIRED` |
| Expired approval | `APPROVAL_EXPIRED` |
| Revoked approval | `APPROVAL_REVOKED` |
| Forbidden Draft → Running transition | `WORKFLOW_TRANSITION_INVALID` |
| Micro-Experiment over budget | `DECISION_THRESHOLD_INVALID` |
| Portfolio allocation mismatch | `ALLOCATION_TOTAL_INVALID` |

## Repository hygiene

- Credential/private-key scan: no matches.
- Unresolved-marker scan after final cleanup: no matches.
- Canonical JSON: parsed successfully.
- Archived portable HTML: nonempty and structurally verified.
- Runtime dependency directory: excluded by `.gitignore`.

## Historical report verification

The version 1.0 portable report builder returned `ok: true`; validation and packaging passed. Verification was `structural_only` because no Chromium headless-shell executable is installed in this environment. No browser or system package was downloaded. Source-dialog interaction and viewport rendering therefore remain unverified.

## Scope boundary

This repository implements governance policy, schemas, examples, validation, tests, explanatory documentation, and CI. It does not introduce workflow runtime automation, autonomous business execution, production deployment, external communication, spending, or other protected action. Those remain outside scope and require their own valid policy path and approval.
