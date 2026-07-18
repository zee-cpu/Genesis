#!/usr/bin/env node
import { runCli } from "../src/cli/run-cli.mjs";
process.exitCode = await runCli(process.argv.slice(2));
