import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGenesisService } from "../application/genesis-service.mjs";
import { suggestionsFor } from "../core/suggestions.mjs";
import { GenesisError, formatError } from "../core/errors.mjs";
import { createPrompter } from "./prompter.mjs";
import { renderApprovalReview, renderCliError, renderGuidedApprovalProposal, renderNextGuidance, renderProposal, renderRebuildResult, renderStatus } from "./render.mjs";

const HELP = [
  "Usage:",
  "  genesis start-business",
  "  genesis add-evidence <business-id>",
  "  genesis status <business-id>",
  "  genesis next <business-id>",
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

async function askRequired(prompter, question, fallback = "") {
  while (true) {
    const answer = (await prompter.ask(question)).trim() || fallback;
    if (answer) return answer;
  }
}

async function askGuidedNumber(prompter, question, { fallback = 0, integer = false, minimum = 0 } = {}) {
  while (true) {
    const answer = await prompter.ask(question);
    const value = answer.trim() ? Number(answer) : fallback;
    if (Number.isFinite(value) && value >= minimum && (!integer || Number.isInteger(value))) {
      return value;
    }
  }
}

async function askGuidedList(prompter, question, { fallback = [], allowed } = {}) {
  while (true) {
    const values = parseCommaList(await prompter.ask(question), fallback);
    if (values.length > 0 && (!allowed || values.every((value) => allowed.includes(value)))) {
      return values;
    }
  }
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

async function gatherGuidedExperimentInput(prompter, guidance) {
  const defaults = guidance.defaults;
  const baseline = await askRequired(prompter, "Current measurable baseline: ");
  const comparisonMethod = await askRequired(prompter, "How will the result be compared with the baseline? ");
  const formula = await askRequired(prompter, `Metric formula [${defaults.metric_formula}]: `, defaults.metric_formula);
  return {
    owner: defaults.owner,
    supported_decision: defaults.supported_decision,
    baseline,
    comparison_method: comparisonMethod,
    metric: {
      formula,
      population: await askRequired(prompter, "What population will be measured? "),
      denominator: await askRequired(prompter, "What is the metric denominator? "),
      data_source: await askRequired(prompter, "What local or approved source supplies the metric? "),
    },
    expected_outcome: defaults.expected_outcome,
    minimum_meaningful_effect: await askRequired(prompter, "Smallest result that would change the decision: "),
    failure_conditions: await askGuidedList(prompter, "Failure conditions (comma-separated): "),
    stop_conditions: await askGuidedList(prompter, "Stop conditions (comma-separated): "),
    limits: {
      cash_usd: await askGuidedNumber(prompter, "Maximum cash [0]: "),
      labor_hours: await askGuidedNumber(prompter, "Maximum labor hours [0]: "),
      duration_days: await askGuidedNumber(prompter, "Maximum duration days [1]: ", { fallback: 1, integer: true }),
      data_classes: await askGuidedList(prompter, "Permitted data classes [internal]: ", {
        fallback: ["internal"],
        allowed: ["public", "internal", "confidential"],
      }),
      risk_level: await prompter.choose("Risk level:", ["low", "medium", "high", "critical"]),
    },
    decision_date: defaults.decision_date,
    allowed_outcomes: await askGuidedList(prompter, "Allowed outcomes [scale,pivot,learning_lab,archive,kill]: ", {
      fallback: defaults.allowed_outcomes,
      allowed: ["scale", "pivot", "learning_lab", "archive", "kill"],
    }),
  };
}

async function gatherGuidedDiscoverCorrection(prompter, guidance, output) {
  const decisionChanges = {};
  if (["/target_customer", "/problem", "/hypothesis"].includes(guidance.blocker?.path)) {
    const field = guidance.blocker.path.slice(1);
    decisionChanges[field] = await askRequired(prompter, `${guidance.blocker.correction}: `);
  }
  writeLine(output, "Genesis needs one confirmed evidence entry to preserve this correction.");
  return {
    ...await gatherAddEvidenceInput(prompter, output),
    decision_changes: decisionChanges,
  };
}

function writeMutationResult(result, output, errorOutput) {
  if (!result.changed) {
    writeLine(output, "Cancelled.");
    return;
  }
  if (result.warning) writeLine(errorOutput, renderCliError(result.warning));
  writeLine(output, renderStatus(result.status));
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
    if (proposal.guided && ["approve-experiment", "deny-experiment"].includes(proposal.command)) {
      writeLine(output, renderGuidedApprovalProposal(proposal));
      return prompter.confirm("Human Authority genesis-owner — save this decision? [y/N] ");
    }
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

    if (command === "next") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const guidance = await service.next(businessId);
      writeLine(output, renderNextGuidance(guidance));

      if (guidance.action === "plan_experiment") {
        const result = await service.planExperiment(
          businessId,
          await gatherGuidedExperimentInput(prompter, guidance),
        );
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "resolve_discover_blocker") {
        const result = await service.addEvidence(
          businessId,
          await gatherGuidedDiscoverCorrection(prompter, guidance, output),
        );
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "review_experiment") {
        const decision = await prompter.choose("Human Authority decision:", [
          { label: "approve", value: "approved" },
          { label: "deny", value: "denied" },
        ]);
        const rationale = await askRequired(prompter, `${decision === "approved" ? "Approval" : "Denial"} rationale: `);
        const inputData = {
          ...guidance.defaults,
          approver_principal_id: "genesis-owner",
          rationale,
          guided: true,
        };
        const result = decision === "approved"
          ? await service.approveExperiment(businessId, inputData)
          : await service.denyExperiment(businessId, inputData);
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "start_experiment") {
        const result = await service.startExperiment(businessId, {
          actor: guidance.defaults.actor,
        });
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

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
