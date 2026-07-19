import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGenesisService } from "../src/application/genesis-service.mjs";
import { runCli } from "../src/cli/run-cli.mjs";
import { workspacePaths } from "../src/storage/workspace.mjs";

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

test("CLI guides Human Authority identity setup, verification, and revocation", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  const keyPath = path.join(projectRoot, "human-authority-key");
  const generated = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  try {
    const before = createBuffer();
    assert.equal(await runCli(["identity", "status"], {
      projectRoot, repoRoot: ROOT, clock: CLOCK, output: before, errorOutput: before,
      prompter: createScriptedPrompter([], before),
    }), 0);
    assert.match(before.toString(), /Human Authority identity: not set up/);

    const setup = createBuffer();
    assert.equal(await runCli(["identity", "setup", "--signing-key", keyPath], {
      projectRoot, repoRoot: ROOT, clock: CLOCK, output: setup, errorOutput: setup,
      prompter: createScriptedPrompter(["y"], setup),
    }), 0);
    assert.match(setup.toString(), /Use this physical key for Human Authority/);
    assert.match(setup.toString(), /identity verified and saved/);

    const verify = createBuffer();
    assert.equal(await runCli(["verify-workspace"], {
      projectRoot, repoRoot: ROOT, clock: CLOCK, output: verify, errorOutput: verify,
      prompter: createScriptedPrompter([], verify),
    }), 0);
    assert.match(verify.toString(), /Ready to authorize new actions: yes/);

    const revoke = createBuffer();
    assert.equal(await runCli(["identity", "revoke", "--signing-key", keyPath], {
      projectRoot, repoRoot: ROOT, clock: CLOCK, output: revoke, errorOutput: revoke,
      prompter: createScriptedPrompter(["Hardware key retired", "y"], revoke),
    }), 0);
    assert.match(revoke.toString(), /New approvals are blocked/);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

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

    const listExit = await runCli(["list"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: scriptedPrompter,
      output,
      errorOutput: output,
    });
    assert.equal(listExit, 0);

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
    assert.equal(text.includes("Opportunities: 1"), true);
    assert.equal(text.includes("Next: genesis next bakery (review-experiment)"), true);
    assert.equal(text.includes("Blocker: APPROVAL_REVIEW_REQUIRED"), true);
    assert.equal(text.includes("Records rebuilt: 5"), true);
    assert.equal(text.includes("Businesses rebuilt: 1"), true);
    assert.equal(text.includes("Decision versions: 2"), true);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("CLI accepts JSON proposal input and emits clean JSON read output", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  const proposalPath = path.join(projectRoot, "business-proposal.json");
  fs.writeFileSync(proposalPath, JSON.stringify({
    business_id: "structured-bakery",
    owner: "research",
    target_customer: "Independent bakery owners",
    problem: "Weekly reconciliation takes too long",
    hypothesis: "A clearer view reduces reconciliation time",
    confidence: 0.55,
    source_reference: "interview://structured-owner-1",
    summary: "The owner reports two hours of weekly reconciliation <img src=x> | untrusted",
    stance: "support",
    provenance: "Operator-entered interview note",
    privacy_classification: "internal",
    counterevidence: ["The owner may prefer the existing spreadsheet"],
    alternatives: ["keep_manual_process"],
    expected_outcome: "Reconciliation takes less than one hour",
    metric: "weekly_reconciliation_minutes",
    decision: "run_bounded_validation",
    review_date: "2026-07-24T12:00:00Z"
  }));
  const mutationOutput = createBuffer();
  const mutationPrompter = createScriptedPrompter(["y"], mutationOutput);

  try {
    const startExit = await runCli(["start-business", "--input", proposalPath], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: mutationPrompter,
      output: mutationOutput,
      errorOutput: mutationOutput,
    });
    assert.equal(startExit, 0);
    assert.equal(mutationOutput.toString().includes("Offline suggestion — not evidence:"), false);
    assert.equal(mutationOutput.toString().includes("Save this immutable record? [y/N]"), true);

    const jsonOutput = createBuffer();
    const listExit = await runCli(["list", "--json"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: createScriptedPrompter([], jsonOutput),
      output: jsonOutput,
      errorOutput: jsonOutput,
    });
    assert.equal(listExit, 0);
    const parsed = JSON.parse(jsonOutput.toString());
    assert.equal(parsed.count, 1);
    assert.equal(parsed.opportunities[0].business_id, "structured-bakery");
    assert.equal(parsed.opportunities[0].next_command, "plan-experiment");

    const searchOutput = createBuffer();
    const searchExit = await runCli(["search", "two hours", "--stance", "support", "--json"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: createScriptedPrompter([], searchOutput),
      output: searchOutput,
      errorOutput: searchOutput,
    });
    assert.equal(searchExit, 0);
    const search = JSON.parse(searchOutput.toString());
    assert.equal(search.count, 1);
    assert.equal(search.results[0].business_id, "structured-bakery");
    assert.equal(search.results[0].stance, "support");

    const reportJsonOutput = createBuffer();
    const reportJsonExit = await runCli(["export-report", "structured-bakery", "--json"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: createScriptedPrompter([], reportJsonOutput),
      output: reportJsonOutput,
      errorOutput: reportJsonOutput,
    });
    assert.equal(reportJsonExit, 0);
    const report = JSON.parse(reportJsonOutput.toString());
    assert.equal(report.business_id, "structured-bakery");
    assert.equal(report.records.evidence.length, 1);
    assert.equal(report.lifecycle.state, "discover");

    const reportMarkdownOutput = createBuffer();
    const reportMarkdownExit = await runCli(["export-report", "structured-bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      prompter: createScriptedPrompter([], reportMarkdownOutput),
      output: reportMarkdownOutput,
      errorOutput: reportMarkdownOutput,
    });
    assert.equal(reportMarkdownExit, 0);
    assert.equal(reportMarkdownOutput.toString().includes("# Genesis Business Report: structured-bakery"), true);
    assert.equal(reportMarkdownOutput.toString().includes("## Evidence"), true);
    assert.equal(reportMarkdownOutput.toString().includes("SQLite projection consistent: yes"), true);
    assert.equal(reportMarkdownOutput.toString().includes("&lt;img src=x&gt;"), true);
    assert.equal(reportMarkdownOutput.toString().includes("\\| untrusted"), true);
    assert.equal(reportMarkdownOutput.toString().includes("<img src=x>"), false);
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

test("CLI rejects numeric input with trailing non-numeric characters", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  const output = createBuffer();
  try {
    const exit = await runCli(["start-business"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter([
        "bakery",
        "Independent bakery owners",
        "Weekly order reconciliation takes too long",
        "A clearer order view will reduce reconciliation time",
        "0.55trailing",
      ], output),
    });
    assert.equal(exit, 1);
    assert.match(output.toString(), /INPUT_INVALID/);
    assert.equal(fs.existsSync(path.join(projectRoot, ".genesis", "records")), false);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("CLI dispatches Human review, approval, denial, start, and revocation commands", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  const output = createBuffer();
  const calls = [];
  const review = {
    business_id: "bakery",
    state: "approval_pending",
    experiment: { id: "bakery-experiment", owner: "research", hypothesis: "Test demand" },
    approval: null,
    approval_history: [],
    approval_validity: { valid: false, blockers: [{ code: "APPROVAL_MISSING", correction: "Record approval" }] },
  };
  const status = {
    business_id: "bakery",
    state: "approved",
    next_command: "start-experiment",
    decision_versions: 1,
    experiment_versions: 1,
    approval_versions: 1,
    evidence_count: 1,
    discover_gate: { passed: true },
    experiment_completeness: { missing: [], ratio: 1 },
    blocked_commands_by_code: {},
    projection_consistent: true,
    metrics: {},
  };
  const service = {
    async reviewExperiment(id) { calls.push(["review", id]); return review; },
    async approveExperiment(id, input) { calls.push(["approve", id, input]); return { changed: true, status }; },
    async denyExperiment(id, input) { calls.push(["deny", id, input]); return { changed: true, status: { ...status, state: "approval_denied" } }; },
    async startExperiment(id, input) { calls.push(["start", id, input]); return { changed: true, status: { ...status, state: "active" } }; },
    async revokeApproval(id, input) { calls.push(["revoke", id, input]); return { changed: true, status: { ...status, state: "approval_revoked" } }; },
  };

  try {
    assert.equal(await runCli(["review-experiment", "bakery"], {
      projectRoot, repoRoot: ROOT, output, errorOutput: output, service,
      prompter: createScriptedPrompter([], output),
    }), 0);
    assert.equal(await runCli(["approve-experiment", "bakery", "--signing-key", "/tmp/test-signing-key"], {
      projectRoot, repoRoot: ROOT, output, errorOutput: output, service,
      prompter: createScriptedPrompter([
        "genesis-owner", "research", "Approved rationale",
        "2026-07-17T12:00:00Z", "2026-07-24T12:00:00Z", "2026-07-20T12:00:00Z",
      ], output),
    }), 0);
    assert.equal(await runCli(["deny-experiment", "bakery", "--signing-key", "/tmp/test-signing-key"], {
      projectRoot, repoRoot: ROOT, output, errorOutput: output, service,
      prompter: createScriptedPrompter(["genesis-owner", "research", "Denied rationale"], output),
    }), 0);
    assert.equal(await runCli(["start-experiment", "bakery"], {
      projectRoot, repoRoot: ROOT, output, errorOutput: output, service,
      prompter: createScriptedPrompter(["research"], output),
    }), 0);
    assert.equal(await runCli(["revoke-approval", "bakery", "--signing-key", "/tmp/test-signing-key"], {
      projectRoot, repoRoot: ROOT, output, errorOutput: output, service,
      prompter: createScriptedPrompter(["genesis-owner", "Revoked rationale"], output),
    }), 0);

    assert.deepEqual(calls.filter(([name]) => name !== "review").map(([name]) => name), [
      "approve", "deny", "start", "revoke",
    ]);
    assert.equal(calls.find(([name]) => name === "approve")[2].approver_principal_id, "genesis-owner");
    assert.deepEqual(calls.find(([name]) => name === "start")[2], { actor: "research" });
    assert.match(output.toString(), /Experiment awaiting Human review/);
    assert.match(output.toString(), /Approval versions: 1/);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});

test("guided next progresses from discovery through governed experiment closure", { concurrency: false }, async () => {
  const projectRoot = makeProjectRoot();
  const output = createBuffer();
  try {
    const signingKeyPath = path.join(projectRoot, "human-authority-key");
    const generatedKey = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", signingKeyPath], { encoding: "utf8" });
    assert.equal(generatedKey.status, 0, generatedKey.stderr);
    const setup = createGenesisService({
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      confirm: async () => true,
    });
    await setup.setupIdentity({ signing_key_path: signingKeyPath });
    await setup.startBusiness({
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
      counterevidence: ["Learning curve objection"],
      alternatives: ["manual process"],
      expected_outcome: "Weekly reconciliation takes less than one hour",
      metric: "weekly_reconciliation_minutes",
      decision: "run_bounded_validation",
      review_date: "2026-07-24T12:00:00Z",
    });

    assert.equal(await runCli(["next", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter([
        "Two hours per weekly session",
        "Compare observed minutes with baseline",
        "",
        "Qualified bakery owners",
        "Completed sessions",
        "Observed session log",
        "At least 60 minutes saved",
        "Median time does not improve",
        "Participant harm,privacy incident",
        "0",
        "8",
        "7",
        "",
        "1",
        "",
        "y",
      ], output),
    }), 0);
    assert.equal((await setup.status("bakery")).state, "approval_pending");

    assert.equal(await runCli(["next", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter([
        "1",
        "The bounded experiment is ready for manual execution.",
        signingKeyPath,
        "y",
      ], output),
    }), 0);
    assert.equal((await setup.status("bakery")).state, "approved");
    const signedReview = await setup.reviewExperiment("bakery");
    assert.equal(signedReview.approval_validity.valid, true);
    assert.equal(signedReview.approval.signature.principal_id, "genesis-owner");
    assert.equal(signedReview.approval.signature.namespace, "genesis-approval-v1");

    assert.equal(await runCli(["next", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter(["y"], output),
    }), 0);
    assert.equal((await setup.status("bakery")).state, "active");

    assert.equal(await runCli(["next", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter([
        "Completed the preregistered bounded test",
        "",
        "completed",
        "",
        "",
        "0",
        "1",
        "internal",
        "low",
        "y",
      ], output),
    }), 0);
    assert.equal((await setup.status("bakery")).state, "measurement");

    assert.equal(await runCli(["next", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter([
        "Median reconciliation time was 55 minutes",
        "The result improved on the baseline by 65 minutes",
        "observed_session_log",
        "limited",
        "small sample",
        "y",
        "average",
        "110",
        "2",
        "120",
        "60",
        "lte",
        "minutes",
        "y",
      ], output),
    }), 0);
    assert.equal((await setup.status("bakery")).state, "reflection");
    const measuredReview = await setup.reviewExperiment("bakery");
    assert.equal(measuredReview.experiment.measurement_calculation.observed_value, 55);
    assert.equal(measuredReview.experiment.measurement_calculation.calculated_outcome, "passed");

    assert.equal(await runCli(["next", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter([
        "passed",
        "customer_validation",
        "bakery,reconciliation",
        "A bounded manual validation with observed bakery sessions",
        "",
        "",
        "The measured reduction passed, but the sample remains small",
        "Use a larger bounded sample before scaling",
        "0.7",
        "",
        "",
        "y",
      ], output),
    }), 0);
    assert.equal((await setup.status("bakery")).state, "decision");

    assert.equal(await runCli(["next", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter([
        "2",
        "The limited sample supports a narrower follow-up",
        "No constitutional conflict; classification and closure only",
        "Supporting and contradicting evidence were reviewed",
        "Pivot to a larger bounded validation",
        signingKeyPath,
        "y",
      ], output),
    }), 0);
    assert.equal((await setup.status("bakery")).state, "outcome_approved");

    assert.equal(await runCli(["next", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter(["y"], output),
    }), 0);
    assert.equal((await setup.status("bakery")).state, "closed");

    assert.equal(await runCli(["next", "bakery"], {
      projectRoot,
      repoRoot: ROOT,
      clock: CLOCK,
      output,
      errorOutput: output,
      prompter: createScriptedPrompter([
        "",
        "",
        "The first sample was too small to justify scale",
        "A larger bounded sample will reproduce the observed reduction",
        "",
        "",
        "",
        "1",
        "",
        "",
        "",
        "archive,run_smaller_segment_test",
        "The larger sample preserves at least a 60-minute reduction",
        "median_reconciliation_minutes",
        "decide_whether_scale_readiness_is_supported",
        "",
        "",
        "y",
      ], output),
    }), 0);
    assert.equal((await setup.status("bakery-pivot-01")).state, "discover");

    const text = output.toString();
    assert.match(text, /SQLite state: discover/);
    assert.match(text, /Human Authority decision envelope/);
    assert.match(text, /Human Authority genesis-owner — save this decision\? \[y\/N\]/);
    assert.match(text, /Current state: active/);
    assert.match(text, /Guided action: record_execution/);
    assert.match(text, /Current state: measurement/);
    assert.match(text, /Guided action: record_measurement/);
    assert.match(text, /Current state: reflection/);
    assert.match(text, /Guided action: record_reflection/);
    assert.match(text, /Current state: decision/);
    assert.match(text, /Human Authority Major Bet decision envelope/);
    assert.match(text, /approve this exact outcome\? \[y\/N\]/);
    assert.match(text, /Current state: outcome_approved/);
    assert.match(text, /Guided action: close_experiment/);
    assert.match(text, /Current state: closed/);
    assert.match(text, /Guided action: start_follow_up/);
    assert.match(text, /Business ID: bakery-pivot-01/);
  } finally {
    cleanupProjectRoot(projectRoot);
  }
});
