#!/usr/bin/env node
// Seeds a throwaway Genesis workspace with real records by driving the actual
// Genesis engine (service + guided CLI) through its normal gates and
// confirmations. Nothing here bypasses validation, signing, or governance —
// it answers the same prompts a human operator would.
//
// Usage: node apps/operator-console/scripts/seed-demo-workspace.mjs <target-dir>

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createGenesisService } from "../../../src/application/genesis-service.mjs";
import { runCli } from "../../../src/cli/run-cli.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const target = process.argv[2];
if (!target) {
  console.error("Usage: seed-demo-workspace.mjs <target-dir>");
  process.exit(2);
}

const projectRoot = path.resolve(target);
fs.mkdirSync(projectRoot, { recursive: true });
if (fs.existsSync(path.join(projectRoot, ".genesis"))) {
  console.error(`Refusing to seed: ${projectRoot} already contains a .genesis workspace`);
  process.exit(1);
}

const signingKeyPath = path.join(projectRoot, "demo-authority-key");
const generated = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", signingKeyPath], { encoding: "utf8" });
if (generated.status !== 0) {
  console.error("ssh-keygen failed:", generated.stderr);
  process.exit(1);
}

// The engine derives several approval timestamps from repeated clock() calls
// inside one command, so the seed uses a frozen clock advanced manually
// between steps. This mirrors the repository's own integration tests and also
// spreads the demo history over several in-record days.
const clockState = { current: Date.now() - 4 * 86_400_000 };
const clock = () => new Date(clockState.current);
const tick = (hours) => { clockState.current += hours * 3_600_000; };

const service = createGenesisService({
  projectRoot,
  repoRoot: REPO_ROOT,
  clock,
  confirm: async () => true,
});

function scriptedPrompter(answers) {
  let index = 0;
  const next = (fallback = "") => (index < answers.length ? answers[index++] : fallback);
  return {
    async ask() { return next(""); },
    async choose(_question, choices) {
      const answer = next("");
      const numeric = Number.parseInt(answer, 10);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
        const selected = choices[numeric - 1];
        return typeof selected === "string" ? selected : selected.value;
      }
      const selected = choices.find((choice) => (
        (typeof choice === "string" ? choice : choice.label) === answer
        || (typeof choice === "string" ? choice : choice.value) === answer
      ));
      if (selected) return typeof selected === "string" ? selected : selected.value;
      return typeof choices[0] === "string" ? choices[0] : choices[0]?.value;
    },
    async confirm() {
      return ["y", "yes", "true", "1"].includes(String(next("n")).trim().toLowerCase());
    },
    async close() {},
  };
}

async function guided(businessId, answers) {
  let captured = "";
  const buffer = { write(chunk) { captured += chunk; return true; } };
  const exit = await runCli(["next", businessId], {
    projectRoot,
    repoRoot: REPO_ROOT,
    clock,
    output: buffer,
    errorOutput: buffer,
    prompter: scriptedPrompter(answers),
  });
  tick(5);
  if (exit !== 0) {
    throw new Error(`guided next for ${businessId} exited ${exit}\n--- CLI output ---\n${captured}`);
  }
}

function futureIso(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function business(id, overrides = {}) {
  return {
    business_id: id,
    owner: "research",
    confidence: 0.55,
    stance: "support",
    provenance: "Interview note",
    privacy_classification: "internal",
    decision: "run_bounded_validation",
    review_date: futureIso(5),
    ...overrides,
  };
}

const planAnswers = (baseline) => [
  baseline,
  "Compare observed values with the recorded baseline",
  "",
  "Qualified pilot participants",
  "Completed pilot sessions",
  "Observed session log",
  "At least a 60 minute median improvement",
  "Median time does not improve",
  "Participant harm,privacy incident",
  "0",
  "8",
  "7",
  "",
  "1",
  "",
  "y",
];

const approveAnswers = [
  "1",
  "The bounded experiment is ready for manual execution.",
  signingKeyPath,
  "y",
];

console.log(`Seeding demo workspace at ${projectRoot} ...`);

await service.setupIdentity({ signing_key_path: signingKeyPath });

// 1. bakery-analytics: complete lifecycle through closure (pivot outcome).
tick(3);
await service.startBusiness(business("bakery-analytics", {
  target_customer: "Independent bakery owners",
  problem: "Weekly order reconciliation takes too long",
  hypothesis: "A clearer order view will reduce reconciliation time",
  source_reference: "interview://owner-1",
  summary: "Owner spends two hours on reconciliation every week",
  counterevidence: ["Learning curve may offset savings"],
  alternatives: ["manual process", "spreadsheet template"],
  expected_outcome: "Weekly reconciliation takes less than one hour",
  metric: "weekly_reconciliation_minutes",
}));
tick(2);
await service.addEvidence("bakery-analytics", {
  source_reference: "interview://owner-2",
  summary: "A second owner reports the same reconciliation burden",
  stance: "support",
  provenance: "Interview note",
  privacy_classification: "internal",
});
tick(2);
await service.addEvidence("bakery-analytics", {
  source_reference: "interview://owner-3",
  summary: "One owner says the current spreadsheet is good enough",
  stance: "contradict",
  provenance: "Interview note",
  privacy_classification: "internal",
});
await guided("bakery-analytics", planAnswers("Two hours per weekly session"));
await guided("bakery-analytics", approveAnswers);
await guided("bakery-analytics", ["y"]); // activate
await guided("bakery-analytics", [
  "Completed the preregistered bounded test with three bakeries",
  "",
  "completed",
  "",
  "",
  "0",
  "6",
  "internal",
  "low",
  "y",
]);
await guided("bakery-analytics", [
  "Median reconciliation time was 55 minutes",
  "The result improved on the two-hour baseline by 65 minutes",
  "observed_session_log",
  "limited",
  "small sample of three bakeries",
  "y",
]);
await guided("bakery-analytics", [
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
]);
await guided("bakery-analytics", [
  "2",
  "The limited sample supports a narrower follow-up",
  "No constitutional conflict; classification and closure only",
  "Supporting and contradicting evidence were reviewed",
  "Pivot to a larger bounded validation",
  signingKeyPath,
  "y",
]);
await guided("bakery-analytics", ["y"]); // close

// 2. tutor-match: approved and active.
tick(3);
await service.startBusiness(business("tutor-match", {
  target_customer: "Parents of secondary-school students",
  problem: "Finding a vetted tutor takes weeks of referrals",
  hypothesis: "A curated shortlist within 48 hours wins trials",
  source_reference: "survey://parents-2026-06",
  summary: " 18 of 25 surveyed parents said matching took over two weeks",
  counterevidence: ["Existing platforms claim next-day matching"],
  alternatives: ["referral groups", "large tutoring platforms"],
  expected_outcome: "Half of pilot families accept a shortlist within 48 hours",
  metric: "shortlist_acceptance_rate",
}));
tick(2);
await service.addEvidence("tutor-match", {
  source_reference: "interview://parent-4",
  summary: "Parent says platform tutors felt unvetted and generic",
  stance: "support",
  provenance: "Interview note",
  privacy_classification: "internal",
});
await guided("tutor-match", planAnswers("Two weeks median matching time via referrals"));
await guided("tutor-match", approveAnswers);
await guided("tutor-match", ["y"]); // activate

// 3. craft-supply: planned experiment awaiting approval.
tick(3);
await service.startBusiness(business("craft-supply", {
  target_customer: "Independent ceramics studios",
  problem: "Reordering glaze materials is manual and error-prone",
  hypothesis: "A standing order template cuts stockouts",
  source_reference: "interview://studio-1",
  summary: "Studio ran out of a core glaze twice last quarter",
  counterevidence: ["Suppliers already offer subscriptions"],
  alternatives: ["supplier subscriptions", "manual reordering"],
  expected_outcome: "Stockouts drop to zero across a quarter",
  metric: "stockouts_per_quarter",
}));
await guided("craft-supply", planAnswers("Two stockouts per quarter across studios"));

// 4. menu-board: discovery stage with contested evidence.
tick(3);
await service.startBusiness(business("menu-board", {
  confidence: 0.4,
  target_customer: "Food-truck operators",
  problem: "Menu changes require reprinting boards",
  hypothesis: "A cheap e-ink board reduces reprint costs",
  source_reference: "interview://truck-1",
  summary: "Operator reprints boards roughly twice a month",
  counterevidence: ["E-ink hardware cost may exceed savings"],
  alternatives: ["laminated inserts", "chalkboards"],
  expected_outcome: "Reprint spending drops by half",
  metric: "monthly_reprint_cost_usd",
}));
tick(2);
await service.addEvidence("menu-board", {
  source_reference: "quote://hardware-vendor",
  summary: "Vendor quote puts a weatherproof e-ink board at 480 USD",
  stance: "contradict",
  provenance: "Written vendor quote",
  privacy_classification: "internal",
});

// 5. pet-portraits: planned then denied.
tick(3);
await service.startBusiness(business("pet-portraits", {
  confidence: 0.35,
  target_customer: "Urban pet owners",
  problem: "Custom pet portraits take weeks and cost hundreds",
  hypothesis: "A 72-hour turnaround at 60 USD finds repeat buyers",
  source_reference: "forum://pet-owners-thread",
  summary: "Thread with 40 replies asking for faster cheaper portraits",
  counterevidence: ["Print-on-demand competitors are entrenched"],
  alternatives: ["print-on-demand marketplaces", "local artists"],
  expected_outcome: "Ten paid orders in the pilot window",
  metric: "paid_orders_count",
}));
await guided("pet-portraits", planAnswers("Zero current orders; cold start"));
await guided("pet-portraits", [
  "2",
  "Unit economics are unproven and the channel is saturated; not worth the bounded spend yet.",
  signingKeyPath,
  "y",
]);

// Prepare sync events so the sync center has real content.
await service.prepareSync();

const list = await service.list();
console.log("Seeded opportunities:");
for (const item of list.opportunities ?? list.items ?? []) {
  console.log(`  ${item.business_id}: ${item.state}`);
}
console.log(`Signing key (demo only): ${signingKeyPath}`);
console.log("Done.");
