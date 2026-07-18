import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/cli/run-cli.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLOCK = () => new Date("2026-07-17T12:00:00Z");

function makeProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genesis-cli-"));
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
      for (const [index_, choice] of choices.entries()) {
        output.write(`  ${index_ + 1}. ${typeof choice === "string" ? choice : choice.label}\n`);
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
      if (selected) {
        return typeof selected === "string" ? selected : selected.value;
      }

      return typeof choices[0] === "string" ? choices[0] : choices[0]?.value;
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

test("CLI runs start-business, add-evidence, status, plan-experiment, and rebuild-index", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  const output = createBuffer();
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

  try {
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

    const rebuildExit = await runCli(["rebuild-index"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: scriptedPrompter,
      output,
      errorOutput: output,
    });
    assert.equal(rebuildExit, 0);

    const text = runOutput(output.toString());
    assert.equal(text.includes("Offline suggestion — not evidence:"), true);
    assert.equal(text.includes("support"), true);
    assert.equal(text.includes("contradict"), true);
    assert.equal(text.includes("Save this immutable record? [y/N]"), true);
    assert.equal(text.indexOf("Proposed record:") >= 0, true);
    assert.equal(text.includes("State: discover"), true);
    assert.equal(text.includes("State: approval_pending"), true);
    assert.equal(text.includes("Decision versions: 2"), true);
    assert.equal(text.includes("Experiment versions: 1"), true);
    assert.equal(text.includes("Evidence count: 2"), true);
    assert.equal(text.includes("Blocked commands: none"), true);
    assert.equal(text.includes("Projection consistent: yes"), true);
    assert.equal(text.includes("Records rebuilt: 5"), true);
    assert.equal(text.includes("Businesses rebuilt: 1"), true);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("CLI returns 2 for unknown commands and 1 for validation errors", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  const output = createBuffer();
  try {
    const unknownExit = await runCli(["frobnicate"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter([], output),
    });
    assert.equal(unknownExit, 2);
    assert.equal(runOutput(output.toString()).includes("Usage:"), true);

    output.write("\n");

    const validationExit = await runCli(["status", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter([], output),
    });
    assert.equal(validationExit, 1);
    const text = runOutput(output.toString());
    assert.equal(text.includes("BUSINESS_NOT_FOUND"), true);
    assert.equal(text.includes("Path: /business_id"), true);
    assert.equal(text.includes("Correction:"), true);
    assert.equal(text.includes("Escalation:"), true);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});
