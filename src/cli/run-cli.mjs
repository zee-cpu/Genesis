import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGenesisService } from "../application/genesis-service.mjs";
import { suggestionsFor } from "../core/suggestions.mjs";
import { GenesisError, formatError } from "../core/errors.mjs";
import { createPrompter } from "./prompter.mjs";
import { renderApprovalReview, renderCliError, renderGuidedApprovalProposal, renderNextGuidance, renderOpportunityList, renderOutcomeDecisionProposal, renderProposal, renderRebuildResult, renderStatus } from "./render.mjs";

const HELP = [
  "Usage:",
  "  genesis start-business",
  "  genesis start-follow-up <business-id>",
  "  genesis start-learning-lab <business-id>",
  "  genesis add-evidence <business-id>",
  "  genesis list",
  "  genesis status <business-id>",
  "  genesis next <business-id>",
  "  genesis plan-experiment <business-id>",
  "  genesis review-experiment <business-id>",
  "  genesis approve-experiment <business-id>",
  "  genesis deny-experiment <business-id>",
  "  genesis start-experiment <business-id>",
  "  genesis record-execution <business-id>",
  "  genesis record-measurement <business-id>",
  "  genesis record-reflection <business-id>",
  "  genesis decide-experiment <business-id>",
  "  genesis close-experiment <business-id>",
  "  genesis revoke-approval <business-id>",
  "  genesis rebuild-index",
  "",
  "Options:",
  "  --json              Machine-readable output for list, status, next, review-experiment, or rebuild-index",
  "  --input <file.json> Read proposal fields from JSON; final confirmation is still required",
].join("\n");

function writeLine(stream, text = "") {
  stream.write(`${text}\n`);
}

function parseCliOptions(values) {
  const positional = [];
  let json = false;
  let inputPath = null;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--json") {
      json = true;
    } else if (value === "--help") {
      positional.push(value);
    } else if (value === "--input") {
      inputPath = values[index + 1];
      index += 1;
      if (!inputPath) {
        throw new GenesisError("INPUT_FILE_REQUIRED", "--input requires a JSON file path", {
          path: "/input",
          correction: "Use --input path/to/proposal.json",
          escalation: "operator",
        });
      }
    } else if (value.startsWith("--")) {
      throw new GenesisError("OPTION_UNKNOWN", `Unknown CLI option: ${value}`, {
        path: "/options",
        correction: "Run genesis --help to see supported options",
        escalation: "operator",
      });
    } else {
      positional.push(value);
    }
  }
  return { positional, json, inputPath };
}

function readStructuredInput(projectRoot, inputPath) {
  const absolutePath = path.resolve(projectRoot, inputPath);
  try {
    const value = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("root must be an object");
    }
    return value;
  } catch (cause) {
    throw new GenesisError("INPUT_FILE_INVALID", "Structured input is not a valid JSON object", {
      path: absolutePath,
      correction: "Provide a readable UTF-8 JSON file containing one object",
      escalation: "operator",
      cause,
    });
  }
}

function writeJson(stream, value) {
  writeLine(stream, JSON.stringify(value, null, 2));
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

async function askGuidedNumber(prompter, question, { fallback = 0, integer = false, minimum = 0, maximum = Number.POSITIVE_INFINITY } = {}) {
  while (true) {
    const answer = await prompter.ask(question);
    const value = answer.trim() ? Number(answer) : fallback;
    if (Number.isFinite(value) && value >= minimum && value <= maximum && (!integer || Number.isInteger(value))) {
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

async function askGuidedChoice(prompter, question, allowed, fallback) {
  while (true) {
    const answer = (await prompter.ask(question)).trim() || fallback;
    if (allowed.includes(answer)) return answer;
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

async function gatherFollowUpInput(prompter, guidance) {
  const defaults = guidance.defaults ?? {};
  return {
    business_id: await askRequired(prompter, `New follow-up business ID [${defaults.business_id}]: `, defaults.business_id),
    target_customer: await askRequired(prompter, `Target customer [${defaults.target_customer}]: `, defaults.target_customer),
    problem: await askRequired(prompter, "New or narrowed customer problem: "),
    hypothesis: await askRequired(prompter, "New testable hypothesis: "),
    confidence: await askGuidedNumber(prompter, `Starting confidence [${defaults.confidence}]: `, {
      fallback: defaults.confidence,
      maximum: 1,
    }),
    source_reference: await askRequired(
      prompter,
      `Initial evidence source [${defaults.source_reference}]: `,
      defaults.source_reference,
    ),
    summary: await askRequired(prompter, `Evidence summary [${defaults.summary}]: `, defaults.summary),
    stance: await prompter.choose("Does this evidence support or contradict the new hypothesis?", ["support", "contradict"]),
    provenance: await askRequired(prompter, `Evidence provenance [${defaults.provenance}]: `, defaults.provenance),
    privacy_classification: await askGuidedChoice(
      prompter,
      `Privacy classification [${defaults.privacy_classification}]: `,
      ["internal", "public", "confidential"],
      defaults.privacy_classification,
    ),
    counterevidence: parseCommaList(
      await prompter.ask(`Counterevidence [${(defaults.counterevidence ?? []).join(",")}]: `),
      defaults.counterevidence ?? [],
    ),
    alternatives: await askGuidedList(prompter, "Alternatives to this follow-up (comma-separated): "),
    expected_outcome: await askRequired(prompter, "Expected observable outcome: "),
    metric: await askRequired(prompter, "Decision metric: "),
    decision: await askRequired(prompter, "Decision this follow-up should support: "),
    owner: await askRequired(prompter, `Owner [${defaults.owner}]: `, defaults.owner),
    review_date: await askRequired(prompter, `Review date [${defaults.review_date}]: `, defaults.review_date),
  };
}

async function gatherLearningLabInput(prompter, guidance) {
  const base = await gatherFollowUpInput(prompter, guidance);
  const defaults = guidance.defaults ?? {};
  const owner = base.owner;
  const learningMetric = base.metric;
  return {
    ...base,
    owner,
    metric: learningMetric,
    learning_lab: {
      budget: {
        cash_usd: await askGuidedNumber(prompter, "Learning Lab cash budget (USD) [0]: ", { fallback: 0 }),
        labor_hours: await askGuidedNumber(prompter, "Learning Lab labor budget (hours) [1]: ", { fallback: 1 }),
      },
      owner,
      learning_metric: learningMetric,
      monthly_review: await askRequired(
        prompter,
        `Monthly review timestamp [${defaults.monthly_review}]: `,
        defaults.monthly_review,
      ),
      expiry: await askRequired(prompter, `Learning Lab expiry [${defaults.expiry}]: `, defaults.expiry),
    },
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

async function gatherExecutionInput(prompter, guidance) {
  const defaults = guidance.defaults ?? {};
  return {
    actor: defaults.actor,
    execution_log: await askGuidedList(prompter, "What was actually executed? (comma-separated factual entries): "),
    deviations: parseCommaList(await prompter.ask("Deviations from the preregistered plan (comma-separated; blank for none): ")),
    completion_reason: await askGuidedChoice(
      prompter,
      "Completion reason (completed, stop_condition, or failure_condition): ",
      ["completed", "stop_condition", "failure_condition"],
      undefined,
    ),
    started_at: await askRequired(prompter, `Execution started at [${defaults.started_at}]: `, defaults.started_at),
    completed_at: await askRequired(prompter, `Execution completed at [${defaults.completed_at}]: `, defaults.completed_at),
    actual_cost: {
      cash_usd: await askGuidedNumber(prompter, "Actual cash spent: ", { fallback: Number.NaN }),
      labor_hours: await askGuidedNumber(prompter, "Actual labor hours: ", { fallback: Number.NaN }),
    },
    data_classes: await askGuidedList(
      prompter,
      `Data classes actually accessed (approved: ${(defaults.data_classes ?? []).join(",")}): `,
      {
        fallback: [],
        allowed: ["public", "internal", "confidential"],
      },
    ),
    risk_level: await askGuidedChoice(
      prompter,
      `Actual risk level (approved maximum: ${defaults.risk_level}): `,
      ["low", "medium", "high", "critical"],
      undefined,
    ),
  };
}

async function gatherMeasurementInput(prompter, guidance) {
  const defaults = guidance.defaults ?? {};
  return {
    reviewer: defaults.reviewer ?? "analyst",
    actual_result: await askRequired(prompter, "Observed metric result: "),
    comparison: await askRequired(prompter, "Comparison with the preregistered baseline and minimum effect: "),
    measurement_evidence: await askGuidedList(
      prompter,
      `Measurement source references (preregistered: ${(defaults.measurement_evidence ?? []).join(",")}): `,
      { fallback: [] },
    ),
    data_quality: {
      assessment: await askGuidedChoice(
        prompter,
        "Data quality (adequate, limited, or unreliable): ",
        ["adequate", "limited", "unreliable"],
        undefined,
      ),
      limitations: parseCommaList(await prompter.ask("Data-quality limitations (comma-separated; blank for none): ")),
    },
  };
}

async function gatherReflectionInput(prompter, guidance) {
  const defaults = guidance.defaults ?? {};
  return {
    reviewer: defaults.reviewer ?? "analyst",
    validation_outcome: await askGuidedChoice(
      prompter,
      "Did the experiment pass or fail its preregistered criteria? (passed or failed): ",
      ["passed", "failed"],
      undefined,
    ),
    domain: await askRequired(prompter, "Experience domain: "),
    tags: await askGuidedList(prompter, "Experience tags (comma-separated): "),
    context: await askRequired(prompter, "Material context for interpreting the result: "),
    supporting_evidence: await askGuidedList(
      prompter,
      `Supporting evidence references [${(defaults.supporting_evidence ?? []).join(",")}]: `,
      { fallback: defaults.supporting_evidence ?? [] },
    ),
    contradicting_evidence: parseCommaList(await prompter.ask(
      `Additional contradicting evidence (already preserved: ${(defaults.contradicting_evidence ?? []).join(",")}; blank for none): `,
    )),
    reflection: await askRequired(prompter, "What did the result teach us? "),
    reusable_lesson: await askRequired(prompter, "Reusable bounded lesson: "),
    confidence_update: await askGuidedNumber(prompter, "Updated confidence (0-1): ", {
      fallback: Number.NaN,
      maximum: 1,
    }),
    valid_from: defaults.valid_from,
    valid_until: await askRequired(prompter, `Lesson valid until [${defaults.valid_until}]: `, defaults.valid_until),
    reuse_evidence: parseCommaList(await prompter.ask("Prior reuse evidence (comma-separated; blank for none): ")),
  };
}

async function gatherOutcomeDecisionInput(prompter, guidance) {
  const defaults = guidance.defaults ?? {};
  return {
    approver_principal_id: defaults.approver_principal_id ?? "genesis-owner",
    actor: defaults.actor ?? "analyst",
    outcome: await prompter.choose("Human Authority outcome decision:", defaults.allowed_outcomes),
    rationale: await askRequired(prompter, "Outcome rationale: "),
    constitution_review: await askRequired(prompter, "Constitution review conclusion: "),
    evidence_review: await askRequired(prompter, "Evidence and counterevidence review conclusion: "),
    ceo_recommendation: await askRequired(prompter, "CEO recommendation: "),
    effective_at: defaults.effective_at,
    expires_at: defaults.expires_at,
    review_at: defaults.review_at,
    guided: true,
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
  const rawArgs = [...argv];
  if (rawArgs[0] === "genesis") {
    rawArgs.shift();
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
    if (proposal.guided && proposal.command === "decide-experiment") {
      writeLine(output, renderOutcomeDecisionProposal(proposal));
      return prompter.confirm("Human Authority genesis-owner — approve this exact outcome? [y/N] ");
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
    const options = parseCliOptions(rawArgs);
    const args = options.positional;
    const [command, businessId] = args;
    if (!command || command === "--help" || command === "-h" || command === "help") {
      usage(output);
      return 0;
    }
    const jsonCommands = new Set(["list", "status", "next", "review-experiment", "rebuild-index"]);
    if (options.json && !jsonCommands.has(command)) {
      throw new GenesisError("JSON_OUTPUT_UNSUPPORTED", "JSON output is limited to read-only and rebuild commands", {
        path: "/options/json",
        correction: "Use --json with list, status, next, review-experiment, or rebuild-index",
        escalation: "operator",
      });
    }
    const structuredInput = options.inputPath
      ? readStructuredInput(projectRoot, options.inputPath)
      : null;
    const inputUnsupportedCommands = new Set(["list", "status", "review-experiment", "rebuild-index"]);
    if (structuredInput && inputUnsupportedCommands.has(command)) {
      throw new GenesisError("INPUT_FILE_UNSUPPORTED", "This command does not accept proposal input", {
        path: "/options/input",
        correction: "Remove --input from read-only and rebuild commands",
        escalation: "operator",
      });
    }

    if (command === "start-business") {
      const inputData = structuredInput ?? await gatherStartBusinessInput(prompter, output);
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

    if (command === "start-follow-up") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const guidance = await service.next(businessId);
      writeLine(output, renderNextGuidance(guidance));
      const result = await service.startFollowUp(
        businessId,
        structuredInput ?? await gatherFollowUpInput(prompter, guidance),
      );
      writeMutationResult(result, output, errorOutput);
      return 0;
    }

    if (command === "start-learning-lab") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const guidance = await service.next(businessId);
      writeLine(output, renderNextGuidance(guidance));
      const result = await service.startLearningLab(
        businessId,
        structuredInput ?? await gatherLearningLabInput(prompter, guidance),
      );
      writeMutationResult(result, output, errorOutput);
      return 0;
    }

    if (command === "add-evidence") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const inputData = structuredInput ?? await gatherAddEvidenceInput(prompter, output);
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
      if (options.json) writeJson(output, status);
      else writeLine(output, renderStatus(status));
      return 0;
    }

    if (command === "list") {
      const result = await service.list();
      if (options.json) writeJson(output, result);
      else writeLine(output, renderOpportunityList(result));
      return 0;
    }

    if (command === "next") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const guidance = await service.next(businessId);
      if (options.json) {
        writeJson(output, guidance);
        return 0;
      }
      writeLine(output, renderNextGuidance(guidance));

      if (guidance.action === "plan_experiment") {
        const result = await service.planExperiment(
          businessId,
          structuredInput ?? await gatherGuidedExperimentInput(prompter, guidance),
        );
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "resolve_discover_blocker") {
        const result = await service.addEvidence(
          businessId,
          structuredInput ?? await gatherGuidedDiscoverCorrection(prompter, guidance, output),
        );
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "review_experiment") {
        const decision = structuredInput?.decision ?? await prompter.choose("Human Authority decision:", [
          { label: "approve", value: "approved" },
          { label: "deny", value: "denied" },
        ]);
        const rationale = structuredInput?.rationale
          ?? await askRequired(prompter, `${decision === "approved" ? "Approval" : "Denial"} rationale: `);
        const inputData = {
          ...guidance.defaults,
          ...(structuredInput ?? {}),
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
          actor: structuredInput?.actor ?? guidance.defaults.actor,
        });
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "record_execution") {
        const result = await service.recordExecution(
          businessId,
          structuredInput ?? await gatherExecutionInput(prompter, guidance),
        );
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "record_measurement") {
        const result = await service.recordMeasurement(
          businessId,
          structuredInput ?? await gatherMeasurementInput(prompter, guidance),
        );
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "record_reflection") {
        const result = await service.recordReflection(
          businessId,
          structuredInput ?? await gatherReflectionInput(prompter, guidance),
        );
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "decide_experiment") {
        const result = await service.decideExperiment(
          businessId,
          structuredInput ?? await gatherOutcomeDecisionInput(prompter, guidance),
        );
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "close_experiment") {
        const result = await service.closeExperiment(businessId, {
          actor: structuredInput?.actor ?? guidance.defaults.actor,
        });
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "start_follow_up") {
        const result = await service.startFollowUp(
          businessId,
          structuredInput ?? await gatherFollowUpInput(prompter, guidance),
        );
        writeMutationResult(result, output, errorOutput);
        return 0;
      }

      if (guidance.action === "start_learning_lab") {
        const result = await service.startLearningLab(
          businessId,
          structuredInput ?? await gatherLearningLabInput(prompter, guidance),
        );
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
      const inputData = structuredInput ?? await gatherPlanExperimentInput(prompter, output, currentDecisionId);
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
      if (options.json) writeJson(output, review);
      else writeLine(output, renderApprovalReview(review));
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
      const inputData = structuredInput ?? await gatherApprovalDecisionInput(prompter, review.experiment, decision);
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
      const actor = structuredInput?.actor ?? (
        await prompter.ask(`Experiment actor [${review.approval?.actor ?? review.experiment.owner}]: `)
        || review.approval?.actor
        || review.experiment.owner
      );
      const result = await service.startExperiment(businessId, { actor });
      if (!result.changed) {
        writeLine(output, "Cancelled.");
        return 0;
      }
      if (result.warning) writeLine(errorOutput, renderCliError(result.warning));
      writeLine(output, renderStatus(result.status));
      return 0;
    }

    if (command === "record-execution" || command === "record-measurement") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const guidance = await service.next(businessId);
      writeLine(output, renderNextGuidance(guidance));
      const result = command === "record-execution"
        ? await service.recordExecution(businessId, structuredInput ?? await gatherExecutionInput(prompter, guidance))
        : await service.recordMeasurement(businessId, structuredInput ?? await gatherMeasurementInput(prompter, guidance));
      writeMutationResult(result, output, errorOutput);
      return 0;
    }

    if (["record-reflection", "decide-experiment", "close-experiment"].includes(command)) {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const guidance = await service.next(businessId);
      writeLine(output, renderNextGuidance(guidance));
      let result;
      if (command === "record-reflection") {
        result = await service.recordReflection(businessId, structuredInput ?? await gatherReflectionInput(prompter, guidance));
      } else if (command === "decide-experiment") {
        result = await service.decideExperiment(businessId, structuredInput ?? await gatherOutcomeDecisionInput(prompter, guidance));
      } else {
        result = await service.closeExperiment(businessId, structuredInput ?? { actor: guidance.defaults.actor });
      }
      writeMutationResult(result, output, errorOutput);
      return 0;
    }

    if (command === "revoke-approval") {
      if (!businessId) {
        usage(output);
        return 2;
      }
      const review = await service.reviewExperiment(businessId);
      writeLine(output, renderApprovalReview(review));
      const inputData = structuredInput ?? await gatherRevocationInput(prompter);
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
      if (options.json) writeJson(output, result);
      else writeLine(output, renderRebuildResult(result));
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
