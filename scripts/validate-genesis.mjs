import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";

export function parseYamlFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const document = YAML.parseDocument(source, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length) {
    throw new Error(`${filePath}: ${document.errors.map((error) => error.message).join("; ")}`);
  }
  return document.toJS({ mapAsMap: false });
}

export function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function classifyDecision({
  cashUsd,
  durationDays,
  capacityShare,
  riskLevel,
  protectedAction,
  constitutionalChange,
  strategicallyDifficultReversal = false,
  multiBusinessMaterialChange = false,
}) {
  for (const [name, value] of Object.entries({ cashUsd, durationDays, capacityShare })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a finite non-negative number`);
    }
  }
  if (!["low", "medium", "high", "critical"].includes(riskLevel)) {
    throw new TypeError("riskLevel must be low, medium, high, or critical");
  }
  for (const [name, value] of Object.entries({
    protectedAction,
    constitutionalChange,
    strategicallyDifficultReversal,
    multiBusinessMaterialChange,
  })) {
    if (typeof value !== "boolean") {
      throw new TypeError(`${name} must be a boolean`);
    }
  }

  if (constitutionalChange) {
    return "constitutional_action";
  }
  if (protectedAction) {
    return "protected_action";
  }
  if (
    cashUsd > 5000
    || durationDays > 30
    || capacityShare > 0.20
    || strategicallyDifficultReversal
    || multiBusinessMaterialChange
    || riskLevel === "high"
    || riskLevel === "critical"
  ) {
    return "major_bet";
  }
  if (cashUsd > 500 || durationDays > 7 || riskLevel === "medium") {
    return "experiment";
  }
  if (cashUsd === 0 && durationDays === 0 && capacityShare === 0) {
    return "routine";
  }
  return "micro_experiment";
}

function issue(code, file, pointer, message) {
  return { code, file: path.relative(process.cwd(), file), path: pointer, message };
}

function resolveInsideRoot(rootDir, relativePath) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function loadManifestCollection(policySet, collectionName, targetMap, format) {
  const descriptors = policySet.manifest[collectionName];
  if (!Array.isArray(descriptors)) {
    return;
  }

  for (const [index, descriptor] of descriptors.entries()) {
    if (!descriptor || typeof descriptor.id !== "string" || typeof descriptor.path !== "string") {
      continue;
    }

    const pointer = `/${collectionName}/${index}/path`;
    const filePath = resolveInsideRoot(policySet.rootDir, descriptor.path);
    if (!filePath) {
      policySet.loadErrors.push(issue(
        "PATH_TRAVERSAL",
        policySet.manifestPath,
        pointer,
        `path must remain inside the repository: ${descriptor.path}`,
      ));
      continue;
    }
    policySet.sourceFiles[collectionName].set(descriptor.id, filePath);

    if (!fs.existsSync(filePath)) {
      policySet.loadErrors.push(issue(
        "FILE_MISSING",
        policySet.manifestPath,
        pointer,
        `referenced file does not exist: ${descriptor.path}`,
      ));
    } else {
      try {
        const value = format === "yaml"
          ? parseYamlFile(filePath)
          : fs.readFileSync(filePath, "utf8");
        targetMap.set(descriptor.id, value);
      } catch (error) {
        policySet.loadErrors.push(issue(
          "FILE_INVALID",
          filePath,
          "",
          error instanceof Error ? error.message : String(error),
        ));
      }
    }

    if (format !== "yaml" || typeof descriptor.schema !== "string") {
      continue;
    }

    const schemaPointer = `/${collectionName}/${index}/schema`;
    const schemaPath = resolveInsideRoot(policySet.rootDir, descriptor.schema);
    if (!schemaPath) {
      policySet.loadErrors.push(issue(
        "PATH_TRAVERSAL",
        policySet.manifestPath,
        schemaPointer,
        `schema path must remain inside the repository: ${descriptor.schema}`,
      ));
      continue;
    }
    policySet.schemaFiles[collectionName].set(descriptor.id, schemaPath);
    if (!fs.existsSync(schemaPath)) {
      policySet.loadErrors.push(issue(
        "FILE_MISSING",
        policySet.manifestPath,
        schemaPointer,
        `referenced schema does not exist: ${descriptor.schema}`,
      ));
    }
  }
}

export async function loadPolicySet(rootDir) {
  const manifestPath = path.join(rootDir, "genesis.yaml");
  const manifest = parseYamlFile(manifestPath);
  const policySet = {
    rootDir,
    manifestPath,
    manifest,
    policies: new Map(),
    templates: new Map(),
    documents: new Map(),
    loadErrors: [],
    sourceFiles: {
      policies: new Map(),
      record_templates: new Map(),
      documents: new Map(),
    },
    schemaFiles: {
      policies: new Map(),
      record_templates: new Map(),
    },
  };

  loadManifestCollection(policySet, "policies", policySet.policies, "yaml");
  loadManifestCollection(policySet, "record_templates", policySet.templates, "yaml");
  loadManifestCollection(policySet, "documents", policySet.documents, "text");

  return policySet;
}

function validateDescriptorIds(policySet) {
  const errors = [];

  for (const collection of ["policies", "record_templates", "documents"]) {
    const descriptors = policySet.manifest[collection];
    if (!Array.isArray(descriptors)) {
      continue;
    }

    const firstIndexById = new Map();
    for (const [index, descriptor] of descriptors.entries()) {
      if (!descriptor || typeof descriptor.id !== "string") {
        continue;
      }

      const firstIndex = firstIndexById.get(descriptor.id);
      if (firstIndex !== undefined) {
        errors.push(issue(
          "DUPLICATE_DESCRIPTOR_ID",
          policySet.manifestPath,
          `/${collection}/${index}/id`,
          `duplicate descriptor id "${descriptor.id}"; first declared at /${collection}/${firstIndex}/id`,
        ));
        continue;
      }

      firstIndexById.set(descriptor.id, index);
    }
  }

  return errors;
}

function policySource(policySet, policyId) {
  return policySet.sourceFiles.policies.get(policyId) ?? policySet.manifestPath;
}

export function validateAuthority(policySet) {
  const errors = [];
  const governance = policySet.policies.get("governance");
  const organization = policySet.policies.get("organization");
  const permissions = policySet.policies.get("permissions");

  if (governance) {
    const authority = governance.human_authority;
    if (
      !authority
      || authority.principal_type !== "human"
      || authority.principal_id !== policySet.manifest.human_authority_principal_id
    ) {
      errors.push(issue(
        "AUTH_HUMAN_REQUIRED",
        policySource(policySet, "governance"),
        "/human_authority",
        `Human Authority must be the human principal ${policySet.manifest.human_authority_principal_id}`,
      ));
    }
    if (!authority || authority.delegable !== false) {
      errors.push(issue(
        "AUTH_DELEGATION_FORBIDDEN",
        policySource(policySet, "governance"),
        "/human_authority/delegable",
        "Human Authority cannot be delegated",
      ));
    }
  }

  if (organization && Array.isArray(organization.roles)) {
    const roles = new Map(organization.roles.map((role) => [role.id, role]));
    const expectedParents = new Map([
      ["human_authority", null],
      ["ceo", "human_authority"],
      ["research", "ceo"],
      ["builder", "ceo"],
      ["operator", "ceo"],
      ["analyst", "ceo"],
    ]);
    for (const [roleId, expectedParent] of expectedParents) {
      const role = roles.get(roleId);
      if (
        !role
        || role.reports_to !== expectedParent
        || (roleId === "human_authority" && role.principal_type !== "human")
      ) {
        const index = organization.roles.findIndex((candidate) => candidate.id === roleId);
        errors.push(issue(
          "AUTH_HIERARCHY_INVALID",
          policySource(policySet, "organization"),
          index >= 0 ? `/roles/${index}` : "/roles",
          `${roleId} must report to ${expectedParent ?? "no parent"}`,
        ));
      }
    }
  }

  if (permissions && Array.isArray(permissions.protected_actions)) {
    for (const [index, action] of permissions.protected_actions.entries()) {
      if (action.required_approver !== "human_authority") {
        errors.push(issue(
          "PROTECTED_APPROVAL_REQUIRED",
          policySource(policySet, "permissions"),
          `/protected_actions/${index}/required_approver`,
          `protected action ${action.id ?? index} requires Human Authority approval`,
        ));
      }
    }
  }

  return errors;
}

export function validateReferences(policySet) {
  const errors = [];
  const organization = policySet.policies.get("organization");
  if (!organization || !Array.isArray(organization.roles)) {
    return errors;
  }

  const roleIds = new Set(organization.roles.map((role) => role.id));
  for (const [index, role] of organization.roles.entries()) {
    for (const field of ["reports_to", "escalates_to"]) {
      const referencedRole = role[field];
      if (referencedRole !== null && !roleIds.has(referencedRole)) {
        errors.push(issue(
          "REFERENCE_ROLE_UNKNOWN",
          policySource(policySet, "organization"),
          `/roles/${index}/${field}`,
          `unknown role reference: ${referencedRole}`,
        ));
      }
    }
  }

  for (const [field, referencedRole] of Object.entries(organization.escalation ?? {})) {
    if (!roleIds.has(referencedRole)) {
      errors.push(issue(
        "REFERENCE_ROLE_UNKNOWN",
        policySource(policySet, "organization"),
        `/escalation/${field}`,
        `unknown role reference: ${referencedRole}`,
      ));
    }
  }

  const permissions = policySet.policies.get("permissions");
  if (permissions && Array.isArray(permissions.low_risk_permissions)) {
    for (const [permissionIndex, permission] of permissions.low_risk_permissions.entries()) {
      for (const [roleIndex, roleId] of (permission.allowed_roles ?? []).entries()) {
        if (!roleIds.has(roleId)) {
          errors.push(issue(
            "REFERENCE_ROLE_UNKNOWN",
            policySource(policySet, "permissions"),
            `/low_risk_permissions/${permissionIndex}/allowed_roles/${roleIndex}`,
            `unknown role reference: ${roleId}`,
          ));
        }
      }
    }
  }

  return errors;
}

export function validateDecisionPortfolio(policySet) {
  const errors = [];
  const decisionPolicy = policySet.policies.get("decision_policy");
  const portfolioPolicy = policySet.policies.get("portfolio_policy");

  if (decisionPolicy?.classes) {
    const thresholds = [
      ["micro_experiment", "cash", "max_usd", 500],
      ["micro_experiment", "duration", "max_days", 7],
      ["experiment", "cash", "max_usd", 5000],
      ["experiment", "duration", "max_days", 30],
    ];
    for (const [classId, limitType, field, expected] of thresholds) {
      const limit = decisionPolicy.classes[classId]?.[limitType];
      if (!limit || limit[field] !== expected || limit.inclusive !== true) {
        errors.push(issue(
          "DECISION_THRESHOLD_INVALID",
          policySource(policySet, "decision_policy"),
          `/classes/${classId}/${limitType}`,
          `${classId} ${limitType} limit must be inclusive at ${expected}`,
        ));
      }
    }

    const triggers = decisionPolicy.classes.major_bet?.triggers;
    if (
      !triggers
      || triggers.cash_over_usd !== 5000
      || triggers.duration_over_days !== 30
      || triggers.capacity_share_over !== 0.20
      || triggers.strategically_difficult_reversal !== true
      || triggers.multi_business_material_change !== true
      || JSON.stringify(triggers.risk_levels) !== JSON.stringify(["high", "critical"])
    ) {
      errors.push(issue(
        "DECISION_THRESHOLD_INVALID",
        policySource(policySet, "decision_policy"),
        "/classes/major_bet/triggers",
        "Major Bet triggers must match the approved thresholds",
      ));
    }

    if (decisionPolicy.classes.major_bet?.required_approver !== "human_authority") {
      errors.push(issue(
        "MAJOR_BET_HUMAN_REQUIRED",
        policySource(policySet, "decision_policy"),
        "/classes/major_bet/required_approver",
        "Major Bets require Human Authority approval",
      ));
    }
  }

  if (portfolioPolicy?.modes) {
    for (const [modeId, mode] of Object.entries(portfolioPolicy.modes)) {
      const shares = Object.values(mode.allocations ?? {});
      const total = shares.reduce((sum, share) => sum + share, 0);
      if (
        shares.length === 0
        || shares.some((share) => !Number.isFinite(share) || share < 0)
        || Math.abs(total - 1) > 1e-9
      ) {
        errors.push(issue(
          "ALLOCATION_TOTAL_INVALID",
          policySource(policySet, "portfolio_policy"),
          `/modes/${modeId}/allocations`,
          `${modeId} allocation shares must total exactly 1`,
        ));
      }
    }

    const bootstrap = portfolioPolicy.modes.bootstrap;
    if (
      !bootstrap
      || !Number.isFinite(bootstrap.system_meta_work_max_share)
      || bootstrap.system_meta_work_max_share < 0
      || bootstrap.system_meta_work_max_share > 0.10
    ) {
      errors.push(issue(
        "META_WORK_LIMIT_INVALID",
        policySource(policySet, "portfolio_policy"),
        "/modes/bootstrap/system_meta_work_max_share",
        "Bootstrap system meta-work share cannot exceed 0.10",
      ));
    }
    if (!bootstrap || bootstrap.active_business_opportunities !== 1) {
      errors.push(issue(
        "WIP_LIMIT_INVALID",
        policySource(policySet, "portfolio_policy"),
        "/modes/bootstrap/active_business_opportunities",
        "Bootstrap mode permits exactly one active business opportunity",
      ));
    }
  }

  if (
    portfolioPolicy
    && portfolioPolicy.automation?.minimum_repeated_material_manual_failures !== 3
  ) {
    errors.push(issue(
      "DECISION_THRESHOLD_INVALID",
      policySource(policySet, "portfolio_policy"),
      "/automation/minimum_repeated_material_manual_failures",
      "automation requires at least three repeated material manual failures",
    ));
  }

  return errors;
}

function workflowState(workflow, stateId) {
  return workflow?.states?.find((state) => state.id === stateId);
}

function validApproval(approvals, approver, action) {
  return typeof approver === "string" && Array.isArray(approvals) && approvals.some((approval) => (
    approval
    && approval.approver === approver
    && approval.valid === true
    && (action === undefined || approval.action === action)
  ));
}

export function validateTransition(policySet, workflowId, from, to, context = {}) {
  const errors = [];
  const workflow = policySet.policies.get(workflowId);
  const source = policySource(policySet, workflowId);
  const fromState = workflowState(workflow, from);
  const toState = workflowState(workflow, to);
  const fromIndex = workflow?.states?.findIndex((state) => state.id === from) ?? -1;

  if (!workflow || !fromState || !toState || !fromState.next_states.includes(to)) {
    errors.push(issue(
      "WORKFLOW_TRANSITION_INVALID",
      source,
      fromIndex >= 0 ? `/states/${fromIndex}/next_states` : "/states",
      `transition ${workflowId}:${from} -> ${to} is not allowed`,
    ));
    return errors;
  }

  if (workflowId === "business_lifecycle" && from === "validate" && to === "build") {
    const passedValidation = Array.isArray(context.recordTypes)
      && context.recordTypes.some((record) => (
        record
        && typeof record === "object"
        && record.id === "experiment_record"
        && record.subtype === "validation"
        && record.status === "passed"
      ));
    const prototype = context.learningPrototype;
    const now = Date.parse(context.now ?? new Date().toISOString());
    const expiry = Date.parse(prototype?.expiresAt);
    const validException = validApproval(
      context.approvals,
      "human_authority",
      "learning_prototype_exception",
    )
      && prototype?.budgetCapped === true
      && prototype?.nonProduction === true
      && Number.isFinite(expiry)
      && Number.isFinite(now)
      && expiry > now;

    if (!passedValidation && !validException) {
      errors.push(issue(
        "BUILD_VALIDATION_REQUIRED",
        source,
        `/states/${fromIndex}/next_states`,
        "Build requires a passed validation record or a current bounded Human-approved learning-prototype exception",
      ));
    }
  }

  if (
    workflowId === "business_lifecycle"
    && from === "build"
    && to === "launch"
    && !validApproval(context.approvals, "human_authority", "launch")
  ) {
    errors.push(issue(
      "LAUNCH_HUMAN_APPROVAL_REQUIRED",
      source,
      `/states/${fromIndex}/next_states`,
      "Launch requires a valid Human Authority approval",
    ));
  }

  if (workflowId === "experiment_lifecycle" && from === "approval" && to === "running") {
    const requiredFields = workflow.preregistration_required_fields ?? [];
    const suppliedFields = new Set(context.preregistrationFields ?? []);
    const missingFields = requiredFields.filter((field) => !suppliedFields.has(field));
    const requiredApprover = policySet.policies
      .get("decision_policy")?.classes?.[fromState.approval_class]?.required_approver;
    if (missingFields.length > 0 || !validApproval(context.approvals, requiredApprover, "experiment")) {
      errors.push(issue(
        "EXPERIMENT_PREREGISTRATION_INCOMPLETE",
        source,
        `/states/${fromIndex}/next_states`,
        `experiment start requires ${requiredApprover ?? "the configured approver"} approval and every preregistration field; missing: ${missingFields.join(", ") || "none"}`,
      ));
    }
  }

  if (workflowId === "experiment_lifecycle" && from === "decision" && to === "closed") {
    const suppliedFields = new Set(context.closureFields ?? []);
    const missingFields = (workflow.closure_required_fields ?? [])
      .filter((field) => !suppliedFields.has(field));
    if (missingFields.length > 0) {
      errors.push(issue(
        "WORKFLOW_TRANSITION_INVALID",
        source,
        `/states/${fromIndex}/next_states`,
        `experiment closure is incomplete; missing: ${missingFields.join(", ")}`,
      ));
    }
  }

  return errors;
}

export function validateWorkflows(policySet) {
  const errors = [];
  const organization = policySet.policies.get("organization");
  const roleIds = new Set((organization?.roles ?? []).map((role) => role.id));
  const recordIds = new Set(
    (policySet.manifest.record_templates ?? []).map((descriptor) => descriptor.id),
  );

  for (const workflowId of ["business_lifecycle", "experiment_lifecycle"]) {
    const workflow = policySet.policies.get(workflowId);
    if (!workflow || !Array.isArray(workflow.states)) {
      continue;
    }
    const source = policySource(policySet, workflowId);
    const stateIds = new Set();

    for (const [stateIndex, state] of workflow.states.entries()) {
      if (stateIds.has(state.id)) {
        errors.push(issue(
          "WORKFLOW_TRANSITION_INVALID",
          source,
          `/states/${stateIndex}/id`,
          `duplicate workflow state: ${state.id}`,
        ));
      }
      stateIds.add(state.id);

      for (const field of ["accountable_role", "responsible_role"]) {
        if (!roleIds.has(state[field])) {
          errors.push(issue(
            "WORKFLOW_ROLE_UNKNOWN",
            source,
            `/states/${stateIndex}/${field}`,
            `unknown workflow role: ${state[field]}`,
          ));
        }
      }

      for (const [inputIndex, recordId] of (state.required_inputs ?? []).entries()) {
        if (!recordIds.has(recordId)) {
          errors.push(issue(
            "WORKFLOW_RECORD_UNKNOWN",
            source,
            `/states/${stateIndex}/required_inputs/${inputIndex}`,
            `unknown workflow record type: ${recordId}`,
          ));
        }
      }
      if (!recordIds.has(state.output_record)) {
        errors.push(issue(
          "WORKFLOW_RECORD_UNKNOWN",
          source,
          `/states/${stateIndex}/output_record`,
          `unknown workflow record type: ${state.output_record}`,
        ));
      }
    }

    const referencedStates = [workflow.initial_state, ...(workflow.terminal_states ?? [])];
    for (const [referenceIndex, stateId] of referencedStates.entries()) {
      if (!stateIds.has(stateId)) {
        errors.push(issue(
          "WORKFLOW_TRANSITION_INVALID",
          source,
          referenceIndex === 0 ? "/initial_state" : `/terminal_states/${referenceIndex - 1}`,
          `unknown workflow state: ${stateId}`,
        ));
      }
    }
    for (const [stateIndex, state] of workflow.states.entries()) {
      for (const [nextIndex, nextState] of (state.next_states ?? []).entries()) {
        if (!stateIds.has(nextState)) {
          errors.push(issue(
            "WORKFLOW_TRANSITION_INVALID",
            source,
            `/states/${stateIndex}/next_states/${nextIndex}`,
            `unknown next state: ${nextState}`,
          ));
        }
      }
    }

    if (workflowId === "business_lifecycle") {
      const launchIndex = workflow.states.findIndex((state) => state.id === "launch");
      const launch = workflow.states[launchIndex];
      const approver = policySet.policies
        .get("decision_policy")?.classes?.[launch?.approval_class]?.required_approver;
      if (launchIndex < 0 || approver !== "human_authority") {
        errors.push(issue(
          "LAUNCH_HUMAN_APPROVAL_REQUIRED",
          source,
          launchIndex < 0 ? "/states" : `/states/${launchIndex}/approval_class`,
          "Launch must use an approval class requiring Human Authority",
        ));
      }
      const prototypeException = workflow.learning_prototype_exception;
      if (
        prototypeException?.required_approver !== "human_authority"
        || prototypeException?.budget_capped !== true
        || prototypeException?.non_production !== true
        || prototypeException?.expiry_required !== true
      ) {
        errors.push(issue(
          "BUILD_VALIDATION_REQUIRED",
          source,
          "/learning_prototype_exception",
          "the learning-prototype exception must be bounded, non-production, expiring, and Human-approved",
        ));
      }
    }

    if (workflowId === "experiment_lifecycle") {
      const required = [
        "problem", "supported_decision", "hypothesis", "confidence", "evidence",
        "counterevidence", "baseline", "comparison_method", "metric_formula",
        "metric_population", "metric_denominator", "metric_data_source", "expected_outcome",
        "minimum_meaningful_effect", "failure_conditions", "stop_conditions", "maximum_cash",
        "maximum_labor", "maximum_duration", "maximum_data", "maximum_risk", "owner",
        "decision_date", "allowed_outcomes",
      ];
      const configured = new Set(workflow.preregistration_required_fields ?? []);
      const missing = required.filter((field) => !configured.has(field));
      if (missing.length > 0) {
        errors.push(issue(
          "EXPERIMENT_PREREGISTRATION_INCOMPLETE",
          source,
          "/preregistration_required_fields",
          `missing required preregistration fields: ${missing.join(", ")}`,
        ));
      }
      const requiredClosureFields = [
        "actual_cost", "outcome", "reflection", "confidence_update", "decision_outcome",
        "linked_experience_record",
      ];
      const configuredClosureFields = new Set(workflow.closure_required_fields ?? []);
      const missingClosureFields = requiredClosureFields
        .filter((field) => !configuredClosureFields.has(field));
      if (missingClosureFields.length > 0) {
        errors.push(issue(
          "WORKFLOW_TRANSITION_INVALID",
          source,
          "/closure_required_fields",
          `missing required closure fields: ${missingClosureFields.join(", ")}`,
        ));
      }
    }
  }

  return errors;
}

export function validateExperienceRiskMetrics(policySet) {
  const errors = [];
  const organization = policySet.policies.get("organization");
  const roleIds = new Set((organization?.roles ?? []).map((role) => role.id));
  const experience = policySet.policies.get("experience_policy");
  const risk = policySet.policies.get("risk_policy");
  const metricsPolicy = policySet.policies.get("metrics_policy");

  if (experience) {
    const expectedOrder = ["raw_event", "reviewed_experience", "validated_lesson", "principle"];
    const principle = experience.promotion?.principle;
    if (
      JSON.stringify(experience.promotion_order) !== JSON.stringify(expectedOrder)
      || principle?.replicated_evidence_or_human_approval_required !== true
      || principle?.explicit_human_approver !== "human_authority"
      || principle?.single_event_auto_promotion_forbidden !== true
      || principle?.evidence_quality_limitations_preserved !== true
      || principle?.human_approval_does_not_upgrade_evidence_quality !== true
    ) {
      errors.push(issue(
        "EXPERIENCE_PROMOTION_UNSAFE",
        policySource(policySet, "experience_policy"),
        "/promotion/principle",
        "Experience promotion must follow the approved order and keep broad principles evidence-safe",
      ));
    }

    const corrections = experience.immutable_evidence?.corrections;
    if (
      experience.immutable_evidence?.append_only !== true
      || experience.immutable_evidence?.silent_rewrite_forbidden !== true
      || corrections?.create_new_record !== true
      || corrections?.require_supersedes !== true
      || corrections?.preserve_prior_record !== true
    ) {
      errors.push(issue(
        "EXPERIENCE_SUPERSESSION_REQUIRED",
        policySource(policySet, "experience_policy"),
        "/immutable_evidence/corrections",
        "Experience corrections must create a new superseding record and preserve prior evidence",
      ));
    }
  }

  if (risk) {
    const permissions = policySet.policies.get("permissions");
    const protectedRiskAction = permissions?.protected_actions
      ?.find((action) => action.id === "high_or_critical_risk");
    const expectedLevelIds = ["low", "medium", "high", "critical"];
    const levelIds = (risk.levels ?? []).map((level) => level.id);
    const levels = new Map((risk.levels ?? []).map((level) => [level.id, level]));
    const protectedLevelsValid = ["high", "critical"].every((levelId) => {
      const level = levels.get(levelId);
      return level?.protected_action === true && level.required_approver === "human_authority";
    });
    if (
      JSON.stringify(levelIds) !== JSON.stringify(expectedLevelIds)
      || !protectedLevelsValid
      || protectedRiskAction?.required_approver !== "human_authority"
      || (permissions?.protected_actions ?? [])
        .some((action) => !expectedLevelIds.includes(action.risk_floor))
      || !Number.isInteger(risk.unresolved_material_uncertainty?.minimum_level_increase)
      || risk.unresolved_material_uncertainty.minimum_level_increase < 1
    ) {
      errors.push(issue(
        "RISK_PROTECTED_MISMATCH",
        policySource(policySet, "risk_policy"),
        "/levels",
        "high and critical risk must be protected and material uncertainty must raise risk by at least one level",
      ));
    }

    const expectedControlDomains = [
      "legal_and_contractual", "privacy", "secrets_and_access", "production", "financial",
      "customer_experiments", "regulated_activity", "ai",
    ];
    if (
      JSON.stringify((risk.control_domains ?? []).map((domain) => domain.id))
      !== JSON.stringify(expectedControlDomains)
    ) {
      errors.push(issue(
        "RISK_PROTECTED_MISMATCH",
        policySource(policySet, "risk_policy"),
        "/control_domains",
        "risk policy must cover every approved control domain exactly once",
      ));
    }

    const requiredAiContext = [
      "model_identity", "model_version", "material_tool_context", "evidence_sources",
      "reviewer", "verification_outcome",
    ];
    if (
      JSON.stringify(risk.consequential_ai?.required_context) !== JSON.stringify(requiredAiContext)
      || !roleIds.has(risk.consequential_ai?.reviewer_role)
      || risk.consequential_ai?.human_accountability_preserved !== true
      || risk.consequential_ai?.unverified_action_forbidden !== true
    ) {
      errors.push(issue(
        "RISK_PROTECTED_MISMATCH",
        policySource(policySet, "risk_policy"),
        "/consequential_ai",
        "consequential AI actions require complete model, tool, evidence, review, and verification context",
      ));
    }
  }

  if (metricsPolicy) {
    const requiredMetricIds = [
      "forecast_calibration", "decision_cycle_time", "assumptions_tested_before_build",
      "avoidable_rework", "realized_value_per_experiment", "lesson_reuse_rate",
      "experience_retrieval_success", "system_overhead_ratio", "customer_reality_ratio",
      "policy_exception_rate", "protected_action_denial_and_escalation",
    ];
    const requiredFields = [
      "formula", "unit", "population", "denominator", "source", "cadence", "owner",
      "baseline", "target", "guardrails",
    ];
    const metrics = metricsPolicy.metrics ?? [];
    const idsValid = JSON.stringify(metrics.map((metric) => metric.id))
      === JSON.stringify(requiredMetricIds);
    for (const [metricIndex, metric] of metrics.entries()) {
      const complete = requiredFields.every((field) => {
        const value = metric[field];
        return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.length > 0;
      }) && roleIds.has(metric.owner);
      if (!complete) {
        errors.push(issue(
          "METRIC_DEFINITION_INCOMPLETE",
          policySource(policySet, "metrics_policy"),
          `/metrics/${metricIndex}`,
          `metric ${metric.id ?? metricIndex} requires complete calculation metadata and a known owner`,
        ));
      }
    }
    if (!idsValid) {
      errors.push(issue(
        "METRIC_DEFINITION_INCOMPLETE",
        policySource(policySet, "metrics_policy"),
        "/metrics",
        "the complete approved metric set is required",
      ));
    }

    const experiment = metricsPolicy.genesis_experiment_001;
    if (
      experiment?.pre_use_required !== true
      || typeof experiment?.baseline_period !== "string"
      || experiment.baseline_period.length === 0
      || typeof experiment?.comparator !== "string"
      || experiment.comparator.length === 0
      || experiment?.adjudicator !== "human_authority"
      || !experiment?.excluded_success_measures?.includes("documentation_volume")
      || JSON.stringify(experiment?.metric_ids) !== JSON.stringify(requiredMetricIds)
    ) {
      errors.push(issue(
        "EXPERIMENT_001_BASELINE_REQUIRED",
        policySource(policySet, "metrics_policy"),
        "/genesis_experiment_001",
        "Genesis Experiment #001 requires a pre-use baseline, comparator, Human adjudicator, approved metrics, and exclusion of documentation volume",
      ));
    }
  }

  return errors;
}

function approvalIssue(code, pointer, message) {
  return issue(code, path.join(process.cwd(), "approval_record"), pointer, message);
}

function parseApprovalDate(value) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return Number.NaN;
  }
  return Date.parse(value);
}

export function validateApproval(record, { now, action, actor }) {
  const errors = [];

  if (record?.revoked === true) {
    errors.push(approvalIssue(
      "APPROVAL_REVOKED",
      "/revoked",
      `approval is revoked${record.revocation_reference ? `: ${record.revocation_reference}` : ""}`,
    ));
  }

  const times = {
    issued: parseApprovalDate(record?.issued_at),
    effective: parseApprovalDate(record?.effective_at),
    expires: parseApprovalDate(record?.expires_at),
    review: parseApprovalDate(record?.review_at),
    now: parseApprovalDate(now),
  };
  if (
    Object.values(times).some((value) => !Number.isFinite(value))
    || times.issued > times.effective
    || times.effective >= times.expires
    || times.review < times.issued
    || times.review > times.expires
    || times.now < times.effective
    || times.now >= times.expires
  ) {
    errors.push(approvalIssue(
      "APPROVAL_EXPIRED",
      "/expires_at",
      "approval timestamps must be valid and the approval must be effective and unexpired",
    ));
  }

  const actions = record?.scope?.actions;
  const wildcardAllowed = record?.scope?.wildcard === true
    && Array.isArray(actions)
    && actions.includes("*");
  if (
    record?.decision !== "approved"
    || (record?.approver_role === "human_authority" && record?.approver_principal_id !== "genesis-owner")
    || (!wildcardAllowed && (!Array.isArray(actions) || !actions.includes(action)))
  ) {
    errors.push(approvalIssue(
      "APPROVAL_SCOPE_MISMATCH",
      "/scope",
      `approval does not authorize action ${action}`,
    ));
  }

  if (record?.actor !== actor) {
    errors.push(approvalIssue(
      "APPROVAL_ACTOR_MISMATCH",
      "/actor",
      `approval actor ${record?.actor ?? "missing"} does not match ${actor}`,
    ));
  }

  return errors;
}

export function validateRecordReferences(policySet) {
  const errors = [];
  const recordIds = new Set(
    [...policySet.templates.values()]
      .map((record) => record?.id)
      .filter((recordId) => typeof recordId === "string"),
  );
  const arrayFields = [
    "related_records", "approval_references", "related", "duplicate", "contradicts",
    "supersedes",
  ];
  const scalarFields = [
    "supported_decision", "experience_reference", "human_approval_reference",
  ];

  for (const [templateId, record] of policySet.templates.entries()) {
    const source = policySet.sourceFiles.record_templates.get(templateId) ?? policySet.manifestPath;
    for (const field of arrayFields) {
      for (const [referenceIndex, reference] of (record[field] ?? []).entries()) {
        if (typeof reference !== "string" || !recordIds.has(reference)) {
          errors.push(issue(
            "RECORD_REFERENCE_INVALID",
            source,
            `/${field}/${referenceIndex}`,
            `record reference does not resolve: ${reference}`,
          ));
        }
      }
    }
    for (const field of scalarFields) {
      const reference = record[field];
      if (reference !== undefined && (typeof reference !== "string" || !recordIds.has(reference))) {
        errors.push(issue(
          "RECORD_REFERENCE_INVALID",
          source,
          `/${field}`,
          `record reference does not resolve: ${reference}`,
        ));
      }
    }
  }
  return errors;
}

export function validateDocumentation(policySet) {
  const errors = [];
  const descriptors = new Map(
    (policySet.manifest.documents ?? []).map((descriptor) => [descriptor.id, descriptor]),
  );

  for (const [documentId, content] of policySet.documents.entries()) {
    const descriptor = descriptors.get(documentId);
    const source = policySet.sourceFiles.documents.get(documentId) ?? policySet.manifestPath;
    const expectedVersion = descriptor?.required_policy_version ?? policySet.manifest.version;
    if (!new RegExp(`^Policy-Version: ${expectedVersion.replaceAll(".", "\\.")}$`, "m").test(content)) {
      errors.push(issue(
        "DOC_VERSION_MISMATCH",
        source,
        "",
        `document must declare Policy-Version: ${expectedVersion}`,
      ));
    }
    if (
      !/^Authority: Explanatory$/m.test(content)
      || /^Authority: Normative$/m.test(content)
      || /(?:this document|markdown) is normative/i.test(content)
    ) {
      errors.push(issue(
        "DOC_AUTHORITY_CONFLICT",
        source,
        "",
        "registered Markdown must declare explanatory authority and cannot claim normative authority",
      ));
    }
  }

  const constitution = policySet.documents.get("constitution");
  if (constitution && (
    !/Human Authority is above the CEO/i.test(constitution)
    || !/\[genesis\.yaml\]\(genesis\.yaml\)/.test(constitution)
    || !/YAML[^\n]*normative/i.test(constitution)
  )) {
    errors.push(issue(
      "DOC_AUTHORITY_CONFLICT",
      policySet.sourceFiles.documents.get("constitution") ?? policySet.manifestPath,
      "",
      "Constitution must place Human Authority above CEO and identify normative YAML",
    ));
  }

  const configurationGuide = policySet.documents.get("configuration_guide");
  if (configurationGuide && (
    !/\[genesis\.yaml\]\(genesis\.yaml\)/.test(configurationGuide)
    || !/YAML wins over Markdown/i.test(configurationGuide)
    || !/non-normative/i.test(configurationGuide)
  )) {
    errors.push(issue(
      "DOC_AUTHORITY_CONFLICT",
      policySet.sourceFiles.documents.get("configuration_guide") ?? policySet.manifestPath,
      "",
      "configuration guide must identify genesis.yaml, YAML precedence, and non-normative status",
    ));
  }

  const instructions = policySet.documents.get("agent_instructions");
  if (instructions && (
    !/YAML[^\n]*normative/i.test(instructions)
    || !/fail closed/i.test(instructions)
    || !/approval cannot be inferred/i.test(instructions)
    || !/Human Authority/i.test(instructions)
    || /approval may be inferred/i.test(instructions)
  )) {
    errors.push(issue(
      "AGENT_INSTRUCTIONS_CONFLICT",
      policySet.sourceFiles.documents.get("agent_instructions") ?? policySet.manifestPath,
      "",
      "agent instructions must preserve normative YAML, fail-closed behavior, and explicit Human approval",
    ));
  }

  return errors;
}

export function validateInvariants(policySet) {
  return [
    ...validateDescriptorIds(policySet),
    ...validateAuthority(policySet),
    ...validateReferences(policySet),
    ...validateDecisionPortfolio(policySet),
    ...validateWorkflows(policySet),
    ...validateExperienceRiskMetrics(policySet),
    ...validateRecordReferences(policySet),
    ...validateDocumentation(policySet),
  ];
}

function validateLoadedCollection(
  ajv,
  policySet,
  collectionName,
  values,
  schemaCode,
  validatorsBySchemaPath,
) {
  const errors = [];
  const descriptors = policySet.manifest[collectionName];
  if (!Array.isArray(descriptors)) {
    return errors;
  }

  for (const descriptor of descriptors) {
    const value = values.get(descriptor.id);
    const valuePath = policySet.sourceFiles[collectionName].get(descriptor.id);
    const schemaPath = policySet.schemaFiles[collectionName].get(descriptor.id);
    if (!value || !valuePath || !schemaPath || !fs.existsSync(schemaPath)) {
      continue;
    }

    try {
      let validate;
      if (validatorsBySchemaPath.has(schemaPath)) {
        validate = validatorsBySchemaPath.get(schemaPath);
        if (!validate) {
          continue;
        }
      } else {
        validatorsBySchemaPath.set(schemaPath, null);
        validate = ajv.compile(loadJsonFile(schemaPath));
        validatorsBySchemaPath.set(schemaPath, validate);
      }
      if (!validate(value)) {
        for (const error of validate.errors ?? []) {
          const pointer = error.keyword === "required"
            ? `${error.instancePath}/${error.params.missingProperty}`
            : error.instancePath;
          errors.push(issue(schemaCode, valuePath, pointer, error.message));
        }
      }
    } catch (error) {
      errors.push(issue(
        schemaCode,
        schemaPath,
        "",
        error instanceof Error ? error.message : String(error),
      ));
    }
  }

  return errors;
}

export async function validatePolicySet(rootDir) {
  const policySet = await loadPolicySet(rootDir);
  const errors = [...policySet.loadErrors];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validatorsBySchemaPath = new Map();
  const schemaPath = path.join(rootDir, "schemas/genesis.schema.json");
  const validate = ajv.compile(loadJsonFile(schemaPath));
  if (!validate(policySet.manifest)) {
    for (const error of validate.errors ?? []) {
      errors.push(issue("SCHEMA_MANIFEST", policySet.manifestPath, error.instancePath, error.message));
    }
  }
  errors.push(...validateLoadedCollection(
    ajv,
    policySet,
    "policies",
    policySet.policies,
    "SCHEMA_POLICY",
    validatorsBySchemaPath,
  ));
  errors.push(...validateLoadedCollection(
    ajv,
    policySet,
    "record_templates",
    policySet.templates,
    "SCHEMA_TEMPLATE",
    validatorsBySchemaPath,
  ));
  errors.push(...validateInvariants(policySet));
  return { ok: errors.length === 0, errors, policySet };
}

async function main() {
  const rootDir = path.resolve(process.argv[2] ?? process.cwd());
  const result = await validatePolicySet(rootDir);
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`${error.code} ${error.file}${error.path}: ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Genesis policy ${result.policySet.manifest.version} is valid.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
