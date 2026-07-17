# Task 5 Report: SQLite projection and deterministic rebuild

Implemented `src/storage/projection.mjs` and `tests/projection.test.mjs`.

Changes:
- Added `openProjection(dbPath)` to create the projection schema with foreign keys enabled.
- Added `projectRecord(db, descriptor, record)` with SQLite transaction semantics for decision, experiment, and evidence projections.
- Added `recordBlockedCommand(db, event)` and `readOpportunity(db, businessId)`.
- Added `projectionConsistency(db, descriptors)` for source/projection count checks.
- Added `rebuildProjection({ projectRoot, registry })` to rebuild into `.genesis/genesis.db.rebuild.tmp`, validate YAML, ignore `.tmp` YAML files, preserve the prior database on failure, and atomically replace `genesis.db` on success.
- Added focused tests covering latest-path projection, counts, snapshot equality after rebuild, `.tmp` file filtering, blocked command recording, and fail-closed behavior when YAML is malformed.

Tests run:
- `node --test tests/projection.test.mjs`
- `npm run check`
- `git diff --check`

Concerns:
- `projectionConsistency` is intentionally conservative and only checks the local projection state and registered record types. If the record model expands, the descriptor registry and projection rules should be updated together.
