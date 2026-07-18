import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSchemaRegistry } from "../src/core/schema-registry.mjs";
import { createGenesisService } from "../src/application/genesis-service.mjs";
import { listRecords, readRecord } from "../src/storage/yaml-record-store.mjs";
import { workspacePaths } from "../src/storage/workspace.mjs";
import { runCli } from "../src/cli/run-cli.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLOCK = () => new Date("2026-07-17T12:00:00Z");

function makeProjectRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genesis-recovery-"));
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

function startBusinessInput(overrides = {}) {
  return {
    business_id: "bakery",
    owner: "research",
    target_customer: "Independent bakery owners",
    problem: "Weekly order reconciliation takes too long",
    hypothesis: "A clearer order view will reduce reconciliation time",
    confidence: 0.55,
    source_reference: "interview://owner-1",
    summary: "Owner spends two hours on reconciliation every week",
    stance: "support",
    provenance: "Interview note",
    privacy_classification: "internal",
    counterevidence: ["Interview objection about learning curve"],
    alternatives: ["keep_manual_process", "use_spreadsheet_template"],
    expected_outcome: "Weekly reconciliation takes less than one hour",
    metric: "weekly_reconciliation_minutes",
    decision: "run_bounded_validation",
    review_date: "2026-07-24T12:00:00Z",
    ...overrides,
  };
}

function addEvidenceInput(overrides = {}) {
  return {
    source_reference: "interview://owner-2",
    summary: "A second owner also wants the same flow",
    stance: "contradict",
    provenance: "Interview note",
    privacy_classification: "internal",
    decision_changes: { confidence: 0.65 },
    ...overrides,
  };
}

function createService(projectRoot, overrides = {}) {
  return createGenesisService({
    projectRoot,
    repoRoot: ROOT,
    clock: CLOCK,
    confirm: async () => true,
    ...overrides,
  });
}

function validateYAMLRecords(projectRoot, registry) {
  for (const descriptor of listRecords(projectRoot)) {
    const record = readRecord(descriptor.absolutePath);
    if (descriptor.kind === "evidence") {
      registry.validateEvidence(record);
    } else {
      registry.validateRecord(
        descriptor.kind === "decision" ? "decision_record" : "experiment_record",
        record,
      );
    }
  }
}

test("projection failure preserves YAML and rebuilds cleanly", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  const registry = createSchemaRegistry(ROOT);
  try {
    const service = createService(projectRoot, {
      projectRecords: async () => {
        throw new Error("projection adapter failed");
      },
    });

    const result = await service.startBusiness(startBusinessInput());
    assert.equal(result.changed, true);
    assert.equal(result.projection_stale, true);
    assert.equal(result.warning.code, "PROJECTION_STALE");

    validateYAMLRecords(projectRoot, registry);
    assert.equal(listRecords(projectRoot).length, 2);

    const paths = workspacePaths(projectRoot);
    fs.writeFileSync(path.join(paths.evidence, "bakery-evidence-999.v0001.yaml.tmp"), "not real yaml\n");

    const rebuild = await service.rebuildIndex();
    assert.deepEqual(rebuild, { recordCount: 2, businessCount: 1, projection_consistent: true });

    const status = await service.status("bakery");
    assert.equal(status.projection_consistent, true);
    assert.equal(status.state, "discover");
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("lock conflict leaves YAML and SQLite unchanged", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  try {
    const service = createService(projectRoot);
    await service.startBusiness(startBusinessInput());

    const paths = workspacePaths(projectRoot);
    const beforeRecords = listRecords(projectRoot).map((record) => record.relativePath);
    const beforeDb = fs.statSync(paths.db);

    fs.writeFileSync(paths.lock, "held\n", { mode: 0o600 });
    await assert.rejects(
      () => service.addEvidence("bakery", addEvidenceInput()),
      (error) => error.code === "WORKSPACE_LOCKED",
    );

    assert.deepEqual(listRecords(projectRoot).map((record) => record.relativePath), beforeRecords);
    const afterDb = fs.statSync(paths.db);
    assert.equal(afterDb.size, beforeDb.size);
    assert.equal(afterDb.mtimeMs, beforeDb.mtimeMs);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("CLI output reports stale projection after a projection adapter failure", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  const output = createBuffer();
  try {
    const service = createService(projectRoot, {
      projectRecords: async () => {
        throw new Error("projection adapter failed");
      },
    });

    const exit = await runCli(["start-business"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: createScriptedPrompter([
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
      ], output),
      output,
      errorOutput: output,
      service,
    });

    assert.equal(exit, 0);
    const text = output.toString().replaceAll("\r\n", "\n");
    assert.equal(text.includes("PROJECTION_STALE"), true);
    assert.equal(text.includes("Projection consistent: no"), true);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});
