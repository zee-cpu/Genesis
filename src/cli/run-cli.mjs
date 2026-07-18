import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGenesisService } from "../application/genesis-service.mjs";
import { suggestionsFor } from "../core/suggestions.mjs";
import { GenesisError, formatError } from "../core/errors.mjs";
import { createPrompter } from "./prompter.mjs";
import { renderApprovalReview, renderCliError, renderProposal, renderRebuildResult, renderStatus } from "./render.mjs";

const HELP = [
  "Usage:",
  "  genesis start-business",
  "  genesis add-evidence <business-id>",
  "  genesis status <business-id>",
  "  genesis plan-experiment <business-id>",
  "  genesis review-experiment <business-id>",
  "  genesis approve-experiment <business-id>",
  "  genesis deny-experiment <business-id>",
  "  genesis start-experiment <business-id>",
  "  genesis revoke-approval <business-id>",
  "  genesis rebuild-index",
].join("\n");

function writeLine(stream, text = "") {
  stream.write(`${text}\n`);
}

function showSuggestions(output) {
  const suggestions = suggestionsFor("validation_methods");
  if (suggestions.length === 0) {
    return;
  }

  writeLine(output, "Offline suggestion — not evidence:");
  for (const suggestion of suggestions) {
    writeLine(output, `- ${suggestion}`);
  }
}

function parseCommaList(value, fallback = []) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return fallback;
  }
  return text.split(",").map((part) => part.trim()).filter(Boolean);
}

function parseNumber(value, fallback = 0) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return fallback;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    throw new GenesisError("INPUT_INVALID", "Numeric input is invalid", {
      path: "/input",
      correction: "Enter a finite number",
      escalation: "operator",
    });
  }
  return parsed;
}

async function gatherStartBusinessInput(prompter, output) {
  showSuggestions(output);
  const business_id = await prompter.ask("Business ID: ");
  const target_customer = await prompter.ask("Target customer: ");
  const problem = await prompter.ask("Problem: ");
  const hypothesis = await prompter.ask("Hypothesis: ");
  const confidence = parseNumber(await prompter.ask("Confidence (0-1): "), 0.5);
  const source_reference = await prompter.ask("Initial evidence source reference: ");
  const summary = await prompter.ask("Initial evidence summary: ");
  const stance = await prompter.choose("Initial evidence stance:", ["support", "contradict"]);
  const provenance = await prompter.ask("Evidence provenance: ");
  const privacy_classification = await prompter.choose("Privacy classification:", ["internal", "public", "confidential"]);
  const counterevidence = parseCommaList(await prompter.ask("Counterevidence (comma-separated): "));
  const alternatives = parseCommaList(await prompter.ask("Alternatives (comma-separated): "));
  const expected_outcome = await prompter.ask("Expected outcome: ");
  const metric = await prompter.ask("Metric: ");
  const decision = await prompter.ask("Decision: ");
  const owner = await prompter.ask("Owner: ");
  const review_date = await prompter.ask("Review date: ");

  return {
    business_id,
    target_customer,
    problem,
    hypothesis,
    confidence,
    source_reference,
    summary,
    stance,
    provenance,
    privacy_classification,
    counterevidence,
    alternatives,
    expected_outcome,
    metric,
    decision,
    owner,
    review_date,
  };
}

async function gatherAddEvidenceInput(prompter, output) {
  showSuggestions(output);
  const source_reference = await prompter.ask("Source reference: ");
  const summary = await prompter.ask("Summary: ");
  const stance = await prompter.choose("Evidence stance:", ["support", "contradict"]);
  const provenance = await prompter.ask("Provenance: ");
  const privacy_classification = await prompter.choose("Privacy classification:", ["internal", "public", "confidential"]);
  return {
    source_reference,
    summary,
    stance,
    provenance,
    privacy_classification,
  };
}

async function gatherPlanExperimentInput(prompter, output, currentDecisionId) {
  showSuggestions(output);
  const supported_decision = await prompter.ask(`Supported decision [${currentDecisionId}]: `) || currentDecisionId;
  const owner = await prompter.ask("Owner: ");
  const baseline = await prompter.ask("Baseline: ");
  const comparison_method = await prompter.ask("Comparison method: ");
  const formula = await prompter.ask("Formula: ");
  const population = await prompter.ask("Population: ");
  const denominator = await prompter.ask("Denominator: ");
  const data_source = await prompter.ask("Data source: ");
  const expected_outcome = await prompter.ask("Expected outcome: ");
  const minimum_meaningful_effect = await prompter.ask("Minimum meaningful effect: ");
  const failure_conditions = parseCommaList(await prompter.ask("Failure conditions (comma-separated): "));
  const stop_conditions = parseCommaList(await prompter.ask("Stop conditions (comma-separated): "));
  const cash_usd = parseNumber(await prompter.ask("Maximum cash: "), 0);
  const labor_hours = parseNumber(await prompter.ask("Maximum labor hours: "), 0);
  const duration_days = parseNumber(await prompter.ask("Maximum duration days: "), 1);
  const data_classes = parseCommaList(await prompter.ask("Data classes (comma-separated): "), ["internal"]);
  const risk_level = await prompter.choose("Risk level:", ["low", "medium", "high", "critical"]);
  const decision_date = await prompter.ask("Decision date: ");
  const allowed_outcomes = parseCommaList(await prompter.ask("Allowed outcomes (comma-separated): "), ["scale", "pivot", "learning_lab", "archive", "kill"]);

  return {
    supported_decision,
    owner,
    baseline,
    comparison_method,
    metric: {
      formula,
      population,
      denominator,
      data_source,
    },
    expected_outcome,
    minimum_meaningful_effect,
    failure_conditions,
    stop_conditions,
    limits: {
      cash_usd,
      labor_hours,
      duration_days,
      data_classes,
      risk_level,
    },
    decision_date,
    allowed_outcomes,
  };
}

async function gatherApprovalDecisionInput(prompter, experiment, decision) {
  const approver_principal_id = await prompter.ask("Human Authority principal (type genesis-owner): ");
  const actor = await prompter.ask(`Approved experiment actor [${experiment.owner}]: `) || experiment.owner;
  const rationale = await prompter.ask(`${decision === "approved" ? "Approval" : "Denial"} rationale: `);
  if (decision === "denied") {
    return { approver_principal_id, actor, rationale };
  }
  const effective_at = await prompter.ask("Effective at (ISO timestamp; blank for now): ");
  const expires_at = await prompter.ask("Expires at (ISO timestamp): ");
  const review_at = await prompter.ask("Review at (ISO timestamp): ");
  return { approver_principal_id, actor, rationale, effective_at, expires_at, review_at };
}

async function gatherRevocationInput(prompter) {
  const approver_principal_id = await prompter.ask("Human Authority principal (type genesis-owner): ");
  const rationale = await prompter.ask("Revocation rationale: ");
  return { approver_principal_id, rationale };
}

function usage(output) {
  writeLine(output, HELP);
}

function isGenesisError(error) {
  return error instanceof GenesisError || typeof error?.code === "string";
}

export async function runCli(argv, dependencies = {}) {
  const args = [...argv];
  if (args[0] === "genesis") {
    args.shift();
  }

  const output = dependencies.output ?? process.stdout;
  const errorOutput = dependencies.errorOutput ?? process.stderr;
  const input = dependencies.input ?? process.stdin;
  const prompter = dependencies.prompter ?? createPrompter({ input, output });
  const projectRoot = dependencies.projectRoot ?? process.cwd();
  const repoRoot = dependencies.repoRoot ?? path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const clock = dependencies.clock ?? (() => new Date());
  const confirm = dependencies.confirm ?? (async (proposal) => {
    writeLine(output, renderProposal(proposal));
    return prompter.confirm("Save this immutable record? [y/N] ");
  });

  const service = dependencies.service ?? createGenesisService({
    projectRoot,
    repoRoot,
    clock,
    confirm,
  });

  try {
    const [command, businessId] = args;
    if (!command || command === "--help" || command === "-h" || command === "help") {
      usage(output);
      return 0;
    }

    if (command === "start-business") {
      const inputData = await gatherStartBusinessInput(prompter, output);
      const result = await service.startBusiness(inputData);
      if (!result.changed) {
        writeLine(output, "Cancelled.");
        return 0;
      }
      if (result.warning) {
        writeLine(errorOutput, renderCliError(result.warning));
      }
      writeLine(output, renderStatus(result.status));
      return 0;
    }

    if (command === "add-evidence") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const inputData = await gatherAddEvidenceInput(prompter, output);
      const result = await service.addEvidence(businessId, inputData);
      if (!result.changed) {
        writeLine(output, "Cancelled.");
        return 0;
      }
      if (result.warning) {
        writeLine(errorOutput, renderCliError(result.warning));
      }
      writeLine(output, renderStatus(result.status));
      return 0;
    }

    if (command === "status") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const status = await service.status(businessId);
      writeLine(output, renderStatus(status));
      return 0;
    }

    if (command === "plan-experiment") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const status = await service.status(businessId);
      const currentDecisionId = status.latest_decision_path
        ? status.latest_decision_path.split("/").at(-1)?.replace(/\.v\d{4}\.yaml$/, "")
        : `${businessId}-decision`;
      const inputData = await gatherPlanExperimentInput(prompter, output, currentDecisionId);
      const result = await service.planExperiment(businessId, inputData);
      if (!result.changed) {
        writeLine(output, "Cancelled.");
        return 0;
      }
      if (result.warning) {
        writeLine(errorOutput, renderCliError(result.warning));
      }
      writeLine(output, renderStatus(result.status));
      return 0;
    }

    if (command === "review-experiment") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const review = await service.reviewExperiment(businessId);
      writeLine(output, renderApprovalReview(review));
      return 0;
    }

    if (command === "approve-experiment" || command === "deny-experiment") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const review = await service.reviewExperiment(businessId);
      writeLine(output, renderApprovalReview(review));
      const decision = command === "approve-experiment" ? "approved" : "denied";
      const inputData = await gatherApprovalDecisionInput(prompter, review.experiment, decision);
      const result = decision === "approved"
        ? await service.approveExperiment(businessId, inputData)
        : await service.denyExperiment(businessId, inputData);
      if (!result.changed) {
        writeLine(output, "Cancelled.");
        return 0;
      }
      if (result.warning) writeLine(errorOutput, renderCliError(result.warning));
      writeLine(output, renderStatus(result.status));
      return 0;
    }

    if (command === "start-experiment") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const review = await service.reviewExperiment(businessId);
      writeLine(output, renderApprovalReview(review));
      const actor = await prompter.ask(`Experiment actor [${review.approval?.actor ?? review.experiment.owner}]: `)
        || review.approval?.actor
        || review.experiment.owner;
      const result = await service.startExperiment(businessId, { actor });
      if (!result.changed) {
        writeLine(output, "Cancelled.");
        return 0;
      }
      if (result.warning) writeLine(errorOutput, renderCliError(result.warning));
      writeLine(output, renderStatus(result.status));
      return 0;
    }

    if (command === "revoke-approval") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const review = await service.reviewExperiment(businessId);
      writeLine(output, renderApprovalReview(review));
      const inputData = await gatherRevocationInput(prompter);
      const result = await service.revokeApproval(businessId, inputData);
      if (!result.changed) {
        writeLine(output, "Cancelled.");
        return 0;
      }
      if (result.warning) writeLine(errorOutput, renderCliError(result.warning));
      writeLine(output, renderStatus(result.status));
      return 0;
    }

    if (command === "rebuild-index") {
      const result = await service.rebuildIndex();
      writeLine(output, renderRebuildResult(result));
      return 0;
    }

    usage(output);
    return 2;
  } catch (error) {
    if (isGenesisError(error)) {
      writeLine(errorOutput, renderCliError(error));
      return 1;
    }
    writeLine(errorOutput, error?.stack ?? formatError(error));
    return 1;
  } finally {
    await prompter.close?.();
  }
}
