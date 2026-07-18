# Genesis 2.0

Genesis is an offline CLI for recording and reviewing discovery work. It creates immutable YAML records under `.genesis/` and rebuilds a SQLite projection from those records when needed.

Policy-Version: 2.0.0
Authority: Explanatory

## Install

```bash
npm ci
```

## Run locally

Use whichever entry point fits your workflow:

```bash
npm start
```

or

```bash
node bin/genesis.mjs --help
```

If you want the command on your PATH during local development, you can also use:

```bash
npm link
genesis --help
```

## Supported commands

- `genesis start-business`
- `genesis add-evidence <business-id>`
- `genesis status <business-id>`
- `genesis plan-experiment <business-id>`
- `genesis rebuild-index`

The CLI stops at `approval_pending`. It does not automatically research, contact customers, execute experiments, build products, deploy software, bill customers, or operate a business.

## What it creates

Each workspace gets these paths:

- `.genesis/records/decisions/*.yaml`
- `.genesis/records/evidence/*.yaml`
- `.genesis/records/experiments/*.yaml`
- `.genesis/genesis.db`
- `.genesis/workspace.lock`

Records are immutable versioned YAML files. If the SQLite projection becomes stale, the canonical YAML is still the source of truth and you recover with:

```bash
genesis rebuild-index
```

## Manual flow

1. Start a business opportunity.
2. Add supporting or contradicting evidence.
3. Check `status` to see counts, gate state, and projection consistency.
4. Plan an experiment when the Discover gate is satisfied.
5. If the database is removed or stale, run `genesis rebuild-index` and re-check `status`.

Example:

```bash
genesis start-business
genesis add-evidence bakery
genesis status bakery
genesis plan-experiment bakery
genesis rebuild-index
```

## Privacy and scope

- Use public, internal, or confidential classifications exactly as prompted.
- Do not store secrets or sensitive personal data in records.
- Do not treat prompts, suggestions, or examples as evidence or approval.
- Human Authority approval is required for protected actions and cannot be inferred from silence or previous behavior.

## Documentation boundary

`Genesis Configuration.md` is explanatory only. The normative policy is `genesis.yaml` and its referenced YAML files.
