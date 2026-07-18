import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { workspacePaths } from "../src/storage/workspace.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const FORBIDDEN_IMPORTS = [
  "http",
  "node:http",
  "https",
  "node:https",
  "http2",
  "node:http2",
  "net",
  "node:net",
  "tls",
  "node:tls",
  "dgram",
  "node:dgram",
  "dns",
  "node:dns",
  "undici",
  "axios",
  "openai",
];

const CLOCK = () => new Date("2026-07-17T12:00:00Z");

function makeProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genesis-no-network-"));
}

function cleanupProjectRoot(projectRoot) {
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

function createBuffer() {
  let text = "";
  return {
    write(chunk) {
      text += chunk;
      return true;
    },
    toString() {
      return text;
    },
  };
}

function createScriptedPrompter(answers, output) {
  let index = 0;

  function nextAnswer(fallback = "") {
    const answer = index < answers.length ? answers[index] : fallback;
    index += 1;
    return answer;
  }

  return {
    async ask(question) {
      output.write(question);
      const answer = nextAnswer("");
      output.write(`${answer}\n`);
      return answer;
    },
    async choose(question, choices) {
      output.write(`${question}\n`);
      for (const [choiceIndex, choice] of choices.entries()) {
        output.write(`  ${choiceIndex + 1}. ${typeof choice === "string" ? choice : choice.label}\n`);
      }
      output.write("> ");
      const answer = nextAnswer("");
      output.write(`${answer}\n`);
      if (!answer) {
        return typeof choices[0] === "string" ? choices[0] : choices[0]?.value;
      }

      const numeric = Number.parseInt(answer, 10);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
        const selected = choices[numeric - 1];
        return typeof selected === "string" ? selected : selected.value;
      }

      const selected = choices.find((choice) => (
        (typeof choice === "string" ? choice : choice.label) === answer
        || (typeof choice === "string" ? choice : choice.value) === answer
      ));
      return typeof selected === "string" ? selected : selected?.value ?? (typeof choices[0] === "string" ? choices[0] : choices[0]?.value);
    },
    async confirm(question) {
      output.write(question);
      const answer = nextAnswer("n");
      output.write(`${answer}\n`);
      return ["y", "yes", "true", "1"].includes(String(answer).trim().toLowerCase());
    },
    async close() {},
  };
}

function runOutput(text) {
  return text.replaceAll("\r\n", "\n");
}

function collectSourceFiles(directory, results = []) {
  if (!fs.existsSync(directory)) {
    return results;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(absolutePath, results);
      continue;
    }

    if (entry.isFile() && /\.(mjs|js|cjs|json)$/u.test(entry.name)) {
      results.push(absolutePath);
    }
  }

  return results;
}

function importedSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:[^;"']*?\s+from\s*)?["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return specifiers;
}

function installNetworkGuards() {
  const blocked = () => {
    throw new Error("NETWORK_USED");
  };
  const targets = [
    [http, "request"],
    [http, "get"],
    [https, "request"],
    [https, "get"],
    [http2, "connect"],
    [net, "connect"],
    [net, "createConnection"],
    [net.Socket.prototype, "connect"],
  ];
  const originals = targets.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key] of targets) {
    target[key] = blocked;
  }
  return () => {
    for (const [target, key, value] of originals) {
      target[key] = value;
    }
  };
}

test("source tree has no network-capable imports or fetch calls", { concurrency: false }, async () => {
  const sourceFiles = [
    ...collectSourceFiles(path.join(ROOT, "bin")),
    ...collectSourceFiles(path.join(ROOT, "src")),
  ];

  const violations = [];
  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const specifiers = importedSpecifiers(source);
    for (const specifier of FORBIDDEN_IMPORTS) {
      if (specifiers.has(specifier)) {
        violations.push(`${path.relative(ROOT, filePath)} imports ${specifier}`);
      }
    }

    if (/\bfetch\s*\(/u.test(source)) {
      violations.push(`${path.relative(ROOT, filePath)} references fetch(`);
    }
  }

  assert.deepEqual(violations, []);
});

test("CLI flow completes without using fetch", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  const output = createBuffer();
  const originalFetch = globalThis.fetch;
  const restoreNetwork = installNetworkGuards();
  globalThis.fetch = async () => {
    throw new Error("NETWORK_USED");
  };

  try {
    const { runCli } = await import("../src/cli/run-cli.mjs");

    const scriptedPrompter = createScriptedPrompter([
      "bakery",
      "Independent bakery owners",
      "Weekly order reconciliation takes too long",
      "A clearer order view will reduce reconciliation time",
      "0.55",
      "interview://owner-1",
      "Owner spends two hours on reconciliation every week",
      "1",
      "Interview note",
      "1",
      "Two owners object to learning curve",
      "keep_manual_process,use_spreadsheet_template",
      "Weekly reconciliation takes less than one hour",
      "weekly_reconciliation_minutes",
      "run_bounded_validation",
      "research",
      "2026-07-24T12:00:00Z",
      "y",
      "interview://owner-2",
      "A second owner also wants the same flow",
      "contradict",
      "Interview note",
      "internal",
      "y",
      "",
      "research",
      "Owners currently take two hours each week",
      "Compare observed time with the two-hour baseline",
      "sum_reconciliation_minutes_divided_by_sessions",
      "qualified_bakery_owners",
      "completed_reconciliation_sessions",
      "observed_session_log",
      "Median reconciliation time is below one hour",
      "median_time_reduction_at_least_60_minutes",
      "median_time_is_not_reduced",
      "participant_harm,privacy_incident",
      "0",
      "8",
      "7",
      "internal",
      "1",
      "2026-07-17T12:00:00Z",
      "scale,pivot,learning_lab,archive,kill",
      "y",
    ], output);

    const startExit = await runCli(["start-business"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: scriptedPrompter,
      output,
      errorOutput: output,
    });
    assert.equal(startExit, 0);

    const addExit = await runCli(["add-evidence", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: scriptedPrompter,
      output,
      errorOutput: output,
    });
    assert.equal(addExit, 0);

    const statusExit = await runCli(["status", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: scriptedPrompter,
      output,
      errorOutput: output,
    });
    assert.equal(statusExit, 0);

    const planExit = await runCli(["plan-experiment", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: scriptedPrompter,
      output,
      errorOutput: output,
    });
    assert.equal(planExit, 0);

    fs.rmSync(workspacePaths(projectRoot).db, { force: true });

    const rebuildExit = await runCli(["rebuild-index"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: scriptedPrompter,
      output,
      errorOutput: output,
    });
    assert.equal(rebuildExit, 0);

    const statusAfterRebuildExit = await runCli(["status", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: scriptedPrompter,
      output,
      errorOutput: output,
    });
    assert.equal(statusAfterRebuildExit, 0);

    const text = runOutput(output.toString());
    assert.equal(text.includes("NETWORK_USED"), false);
    assert.equal(text.includes("Projection consistent: yes"), true);
    assert.equal(text.includes("Records rebuilt: 5"), true);
    assert.equal(text.includes("Businesses rebuilt: 1"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreNetwork();
    cleanupProjectRoot(projectRoot);
  }
});
