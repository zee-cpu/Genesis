# Genesis Operator Console

A **local-only, read-only** web console for inspecting a Genesis workspace at
`http://localhost:3000`, plus the public landing page sources in `../../site/`.

The Genesis CLI remains the only engine that creates, changes, approves,
signs, syncs, or transitions records. This console is a visualization layer:
it renders results computed by the trusted local engine and can copy CLI
commands to your clipboard — it can never run them.

## Commands

Run these from the repository root:

```bash
npm ci                              # root CLI dependencies
npm --prefix apps/operator-console install   # console dependencies (isolated)

npm run web:dev                     # API server on :3000 + Vite dev server on :5173
npm run web:build                   # type-check + production build to apps/operator-console/dist
npm run web:test                    # server security/behavior tests (node:test)
npm run web:start                   # serve the built console at http://localhost:3000
npm run web:seed-demo -- /tmp/demo  # optional: build a demo workspace with the real engine
```

`web:start` serves the workspace in the directory you invoked npm from.
To point at a different workspace:

```bash
GENESIS_WORKSPACE=/path/to/workspace npm run web:start
# or
node apps/operator-console/server/start.mjs --workspace /path/to/workspace --port 3000
```

## Architecture

```
Browser (React, renders only)
   │  GET /api/… + Server-Sent Events
   ▼
server/server.mjs  (plain Node http, 127.0.0.1, GET/HEAD only)
   │  read-only calls, serialized through the workspace lock
   ▼
src/application/genesis-service.mjs   (trusted engine: lifecycle, signatures,
src/storage/yaml-record-store.mjs      projection, validation — all evaluated here)
   ▼
.genesis/  canonical YAML (authoritative) + SQLite projection (derived)
```

- **Read-only by construction.** The server exposes GET endpoints only;
  POST/PUT/PATCH/DELETE return `405`. Its service instance is created with a
  `confirm` callback that always refuses, so even a coding mistake that
  reached a mutation method would cancel instead of writing.
- **Trusted evaluations.** Signature validity, approval envelopes, lifecycle
  states, blockers, and sync health all come from the engine on the Node
  side. The browser never re-derives authority.
- **Sanitized responses.** Absolute filesystem paths, private-key material,
  and signing-key fields are stripped from every payload. Workspace-relative
  paths (`.genesis/…`) pass through.
- **Live refresh.** A debounced `fs.watch` on `.genesis/` emits
  Server-Sent Events; the UI refetches trusted queries instead of parsing
  files in the browser.
- **Serialized reads.** Every Genesis operation takes an exclusive workspace
  lock, so the server queues service calls; a visible `WORKSPACE_LOCKED`
  error means the CLI itself is running.

### Endpoints

```
GET /api/health
GET /api/overview
GET /api/opportunities?q=&state=&blocked=1&review=&sort=&order=
GET /api/opportunities/:businessId
GET /api/opportunities/:businessId/timeline
GET /api/opportunities/:businessId/report
GET /api/opportunities/:businessId/next
GET /api/audit?business=&type=&actor=&signature=&privacy=&from=&to=
GET /api/identity
GET /api/sync
GET /api/events            (Server-Sent Events: hello, refresh)
```

All other methods return `405 Method Not Allowed`.

## Security posture

- Binds to `127.0.0.1` (never `0.0.0.0`); `start.mjs` accepts no host flag.
- No analytics, trackers, CDNs, remote fonts, or external requests —
  system font stacks and local assets only.
- Strict security headers (CSP `default-src 'self'`, nosniff, frame deny).
- Business IDs validated against `^[a-z0-9][a-z0-9-]{0,63}$`.
- Static file serving is containment-checked against `dist/`.
- Environment variables, SSH private keys, and paths outside the workspace
  never appear in responses (enforced by tests).
- No authentication by design: this is a strictly local, single-machine tool.

## UI

React 18 + TypeScript + Vite, react-router, hand-rolled accessible SVG
charts, CSS design tokens (dark graphite default, warm light theme, density
toggle, `prefers-reduced-motion` respected). Views: Overview, Opportunity
explorer, per-opportunity lifecycle timeline / experiment / evidence /
approvals with a record drawer and version compare, Audit trail, Approval &
identity audit, and Sync center. `Ctrl/Cmd+K` opens the command palette.

Every action button in the console says **“Copy CLI command”** — never
Approve, Start, Apply, or Execute.
