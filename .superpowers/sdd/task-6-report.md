# Task 6 Report

Implemented the discovery workflow layer for Genesis CLI gating and early metrics.

Changes made:

- Added `src/core/discovery-workflow.mjs` with:
  - `evaluateDiscoverGate({ decision, evidence })`
  - `experimentCompleteness(experiment)`
  - `buildStatus({ decisionVersions, experimentVersions, evidence, blockedCommands, consistency, now })`
- Added `src/core/metrics.mjs` with:
  - `calculateMetrics(input)`
  - workflow-derived preregistration field loading from `config/workflows/experiment-lifecycle.yaml`
- Added `tests/discovery-workflow.test.mjs` covering:
  - isolated Discover gate blocks
  - full gate pass
  - preregistration completeness loading from YAML
  - exact missing-path reporting
  - complete draft status behavior
  - supported metrics output

Verification run:

- `node --test tests/discovery-workflow.test.mjs`
- `npm run check`

Notes:

- Metrics are limited to the supported fields in the brief.
- Elapsed-day calculations use millisecond differences without rounding.
- The completeness logic reads preregistration requirements from the workflow YAML rather than duplicating the normative list in application code.

Concerns:

- No remaining functional concerns from Task 6 verification.
- Later CLI tasks will need to consume these helpers consistently for status rendering and command routing.
