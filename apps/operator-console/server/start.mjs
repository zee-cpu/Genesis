#!/usr/bin/env node
// Starts the read-only Genesis Operator Console on http://localhost:3000.
//
//   GENESIS_WORKSPACE=/path/to/workspace node server/start.mjs
//   node server/start.mjs --workspace /path/to/workspace --port 3000
//
// The server binds to 127.0.0.1. Passing --host is intentionally not
// supported: this console must never be exposed beyond the local machine.

import process from "node:process";

import { startConsoleServer } from "./server.mjs";

const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

// INIT_CWD preserves the directory the operator invoked npm from, so
// `npm run web:start` inside a workspace serves that workspace.
const workspaceDir = argValue("--workspace")
  ?? process.env.GENESIS_WORKSPACE
  ?? process.env.INIT_CWD
  ?? process.cwd();
const port = Number.parseInt(argValue("--port") ?? process.env.PORT ?? "3000", 10);

const server = await startConsoleServer({ workspaceDir, port });
const address = server.address();
console.log("Genesis Operator Console (read-only)");
console.log(`  Workspace : ${workspaceDir}`);
console.log(`  Listening : http://localhost:${address.port}`);
console.log("  This console never mutates records. Use the genesis CLI for every change.");
