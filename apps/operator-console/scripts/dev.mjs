#!/usr/bin/env node
// Development launcher: runs the read-only API server on 127.0.0.1:3000 and
// the Vite dev server on 127.0.0.1:5173 (which proxies /api to the former).

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDir = process.env.GENESIS_WORKSPACE ?? process.env.INIT_CWD ?? process.cwd();

const children = [
  spawn(process.execPath, [path.join(appDir, "server", "start.mjs")], {
    stdio: "inherit",
    env: { ...process.env, GENESIS_WORKSPACE: workspaceDir },
  }),
  spawn("npx", ["vite"], { stdio: "inherit", cwd: appDir, shell: process.platform === "win32" }),
];

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
for (const child of children) child.on("exit", shutdown);
