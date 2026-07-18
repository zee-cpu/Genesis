# Task 8 Report

Implemented the interactive Genesis CLI layer for the approved discovery workflow.

Changes made:

- Added `src/cli/prompter.mjs` with scripted and terminal-friendly prompt handling.
- Added `src/cli/render.mjs` with proposal, status, rebuild-result, and error rendering.
- Added `src/cli/run-cli.mjs` with routing for:
  - `genesis start-business`
  - `genesis add-evidence <business-id>`
  - `genesis status <business-id>`
  - `genesis plan-experiment <business-id>`
  - `genesis rebuild-index`
- The CLI:
  - prints proposal YAML before confirmation
  - stays offline
  - uses the confirmed application service
  - returns `2` for unknown commands
  - returns `1` for Genesis errors
  - returns `0` for successful commands
- Added `tests/cli-integration.test.mjs` covering:
  - start-business flow
  - add-evidence flow
  - status rendering
  - plan-experiment flow
  - rebuild-index
  - unknown commands
  - fail-closed validation errors

Verification run:

- `node --test tests/cli-integration.test.mjs`
- `node bin/genesis.mjs --help`
- `npm run check`

Notes:

- The CLI uses a scripted prompter in tests and a real readline prompter in normal use.
- Proposal rendering happens before confirmation so the user sees the full immutable record before saving.
