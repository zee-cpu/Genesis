import { GenesisError } from "./errors.mjs";

const RISK_LEVELS = ["low", "medium", "high", "critical"];

export function experimentApprovalAction(experimentId) {
  return `start_experiment:${experimentId}`;
}

export function outcomeApprovalAction(experimentId, outcome) {
  return `close_experiment:${experimentId}:${outcome}`;
}

export function actionClassForLimits(limits) {
  if (["high", "critical"].includes(limits?.risk_level)) {
    return "protected_action";
  }
  if (limits?.cash_usd > 5000 || limits?.duration_days > 30) {
    return "major_bet";
  }
  if (limits?.risk_level === "medium" || limits?.cash_usd > 500 || limits?.duration_days > 7) {
    return "experiment";
  }
  return "micro_experiment";
}

function limitMismatch(approved, requested) {
  if (!approved || !requested) return true;
  for (const field of ["cash_usd", "labor_hours", "duration_days"]) {
    if (!Number.isFinite(approved[field]) || requested[field] > approved[field]) return true;
  }
  if (
    !Array.isArray(approved.data_classes)
    || !Array.isArray(requested.data_classes)
    || requested.data_classes.some((value) => !approved.data_classes.includes(value))
  ) return true;
  const approvedRisk = RISK_LEVELS.indexOf(approved.risk_level);
  const requestedRisk = RISK_LEVELS.indexOf(requested.risk_level);
  return approvedRisk < 0 || requestedRisk < 0 || requestedRisk > approvedRisk;
}

function blocker(code, message, path, correction) {
  return { code, message, path, correction, escalation: "human_authority" };
}

export function evaluateExperimentApproval({ approval, experiment, actor, now, signatureValidity }) {
  const blockers = [];
  if (!approval) {
    return {
      valid: false,
      blockers: [blocker("APPROVAL_MISSING", "Experiment approval is missing", "/approval", "Record an explicit approval before starting the experiment")],
    };
  }
  if (approval.revoked === true || approval.status === "revoked") {
    blockers.push(blocker("APPROVAL_REVOKED", "Experiment approval is revoked", "/revoked", "Obtain a new explicit Human Authority approval"));
  }
  if (approval.status !== "active" || approval.decision !== "approved") {
    blockers.push(blocker("APPROVAL_NOT_ACTIVE", "Experiment approval is not active and approved", "/status", "Use an active approved record"));
  }
  if (approval.approver_role !== "human_authority" || approval.approver_principal_id !== "genesis-owner") {
    blockers.push(blocker("APPROVAL_APPROVER_INVALID", "Approval was not issued by Genesis Human Authority", "/approver_principal_id", "Use genesis-owner as Human Authority"));
  }
  if (signatureValidity && !signatureValidity.valid) {
    blockers.push(blocker(
      signatureValidity.code ?? "APPROVAL_SIGNATURE_INVALID",
      signatureValidity.message ?? "Human Authority signature is invalid",
      "/signature",
      signatureValidity.legacy
        ? "Issue a new approval with the registered Human Authority SSH key"
        : "Verify the Human Authority identity and approval signature",
    ));
  }
  if (approval.requester === approval.approver_principal_id) {
    blockers.push(blocker("SEPARATION_OF_DUTIES_REQUIRED", "Approval requester and approver are not separated", "/requester", "Use a requester distinct from genesis-owner"));
  }
  const action = experimentApprovalAction(experiment?.id);
  if (approval.scope?.wildcard === true || !approval.scope?.actions?.includes(action)) {
    blockers.push(blocker("APPROVAL_SCOPE_MISMATCH", "Approval does not authorize this experiment start", "/scope/actions", `Authorize exactly ${action}`));
  }
  if (!approval.related_records?.includes(experiment?.id)) {
    blockers.push(blocker("APPROVAL_EXPERIMENT_MISMATCH", "Approval is not linked to this experiment", "/related_records", `Link approval to ${experiment?.id}`));
  }
  if (approval.actor !== actor) {
    blockers.push(blocker("APPROVAL_ACTOR_MISMATCH", "Approval actor does not match the requested actor", "/actor", `Use the approved actor ${approval.actor ?? "missing"}`));
  }
  if (limitMismatch(approval.limits, experiment?.limits)) {
    blockers.push(blocker("APPROVAL_LIMIT_MISMATCH", "Experiment exceeds the approved envelope", "/limits", "Approve limits covering the complete experiment envelope"));
  }

  const currentTime = Date.parse(now);
  const effectiveTime = Date.parse(approval.effective_at);
  const expiryTime = Date.parse(approval.expires_at);
  if (!Number.isFinite(currentTime) || !Number.isFinite(effectiveTime) || currentTime < effectiveTime) {
    blockers.push(blocker("APPROVAL_NOT_EFFECTIVE", "Experiment approval is not yet effective", "/effective_at", "Wait until the approval is effective or issue a corrected record"));
  }
  if (!Number.isFinite(expiryTime) || !Number.isFinite(currentTime) || currentTime >= expiryTime) {
    blockers.push(blocker("APPROVAL_EXPIRED", "Experiment approval has expired", "/expires_at", "Obtain a new unexpired approval"));
  }
  return { valid: blockers.length === 0, blockers };
}

export function requireExperimentApproval(input) {
  const result = evaluateExperimentApproval(input);
  if (!result.valid) {
    const first = result.blockers[0];
    throw new GenesisError(first.code, first.message, first);
  }
  return input.approval;
}

export function evaluateOutcomeApproval({ approval, experiment, experience, decision, actor, outcome, now, signatureValidity }) {
  const blockers = [];
  if (!approval) {
    return {
      valid: false,
      blockers: [blocker("APPROVAL_MISSING", "Outcome approval is missing", "/approval", "Record explicit Human Authority approval for the exact outcome")],
    };
  }
  if (approval.revoked === true || approval.status === "revoked") {
    blockers.push(blocker("APPROVAL_REVOKED", "Outcome approval is revoked", "/revoked", "Obtain a new explicit Human Authority approval"));
  }
  if (approval.status !== "active" || approval.decision !== "approved") {
    blockers.push(blocker("APPROVAL_NOT_ACTIVE", "Outcome approval is not active and approved", "/status", "Use an active approved record"));
  }
  if (approval.approver_role !== "human_authority" || approval.approver_principal_id !== "genesis-owner") {
    blockers.push(blocker("APPROVAL_APPROVER_INVALID", "Outcome was not approved by Genesis Human Authority", "/approver_principal_id", "Use genesis-owner as Human Authority"));
  }
  if (signatureValidity && !signatureValidity.valid) {
    blockers.push(blocker(
      signatureValidity.code ?? "APPROVAL_SIGNATURE_INVALID",
      signatureValidity.message ?? "Human Authority signature is invalid",
      "/signature",
      signatureValidity.legacy
        ? "Issue a new approval with the registered Human Authority SSH key"
        : "Verify the Human Authority identity and approval signature",
    ));
  }
  if (approval.requester === approval.approver_principal_id) {
    blockers.push(blocker("SEPARATION_OF_DUTIES_REQUIRED", "Outcome requester and approver are not separated", "/requester", "Use a requester distinct from genesis-owner"));
  }
  const action = outcomeApprovalAction(experiment?.id, outcome);
  if (approval.scope?.wildcard === true || !approval.scope?.actions?.includes(action)) {
    blockers.push(blocker("APPROVAL_SCOPE_MISMATCH", "Approval does not authorize this exact experiment outcome", "/scope/actions", `Authorize exactly ${action}`));
  }
  for (const record of [experiment, experience, decision]) {
    if (!record?.id || !approval.related_records?.includes(record.id)) {
      blockers.push(blocker("APPROVAL_RECORD_MISMATCH", "Approval is not linked to every closure record", "/related_records", "Link the experiment, experience, and decision records"));
      break;
    }
  }
  if (approval.actor !== actor) {
    blockers.push(blocker("APPROVAL_ACTOR_MISMATCH", "Approval actor does not match the closure actor", "/actor", `Use the approved actor ${approval.actor ?? "missing"}`));
  }
  if (approval.action_class !== "major_bet") {
    blockers.push(blocker("APPROVAL_CLASS_MISMATCH", "Outcome decision is not approved as a Major Bet", "/action_class", "Use major_bet for the outcome decision"));
  }
  const currentTime = Date.parse(now);
  const effectiveTime = Date.parse(approval.effective_at);
  const expiryTime = Date.parse(approval.expires_at);
  if (!Number.isFinite(currentTime) || !Number.isFinite(effectiveTime) || currentTime < effectiveTime) {
    blockers.push(blocker("APPROVAL_NOT_EFFECTIVE", "Outcome approval is not yet effective", "/effective_at", "Wait until the approval is effective or issue a corrected record"));
  }
  if (!Number.isFinite(expiryTime) || !Number.isFinite(currentTime) || currentTime >= expiryTime) {
    blockers.push(blocker("APPROVAL_EXPIRED", "Outcome approval has expired", "/expires_at", "Obtain a new unexpired approval"));
  }
  return { valid: blockers.length === 0, blockers };
}

export function requireOutcomeApproval(input) {
  const result = evaluateOutcomeApproval(input);
  if (!result.valid) {
    const first = result.blockers[0];
    throw new GenesisError(first.code, first.message, first);
  }
  return input.approval;
}
