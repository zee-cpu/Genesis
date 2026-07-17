# Task 7 Report

Implemented the human-confirmed Genesis application service that writes immutable YAML records, updates the rebuildable SQLite projection, and stops at the approval boundary.

Changes made:

- Added `src/application/genesis-service.mjs` with:
  - `createGenesisService({ projectRoot, repoRoot, clock, confirm })`
  - `startBusiness(input)`
  - `addEvidence(businessId, input)`
  - `status(businessId)`
  - `planExperiment(businessId, input)`
  - `rebuildIndex()`
- The service now:
  - writes Decision and Evidence YAML under a workspace lock
  - versions Decision history immutably
  - computes status from canonical YAML and supported metrics
  - records blocked commands when Discover is incomplete
  - returns `COMMAND_UNAVAILABLE` once approval pending already exists
  - falls back to `PROJECTION_STALE` if YAML is safe but SQLite projection fails
- Added `tests/genesis-service.test.mjs` covering:
  - start-business creation
  - add-evidence versioning
  - draft experiment planning and approval-pending stop
  - repeated start rejection
  - confirmation cancellation
  - blocked Discover planning
  - command unavailability after approval pending
  - rebuild-index recovery

Verification run:

- `node --test tests/genesis-service.test.mjs`

Notes:

- The service keeps YAML as the durable source of truth and treats SQLite as a rebuildable projection.
- Status output is derived from canonical records rather than ad hoc state.
- The service is ready for the later CLI layer to consume directly.
