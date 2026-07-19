import { GenesisError } from "../core/errors.mjs";
import { inspectHumanAuthorityIdentity } from "./identity-store.mjs";
import {
  APPROVAL_SIGNATURE_NAMESPACE,
  publicKeyFingerprint,
  publicKeyFromPrivateKey,
  signCanonicalPayload,
  unsignedRecord,
  verifyCanonicalPayload,
} from "./ssh-signatures.mjs";

function approvalSecurityError(code, message, correction, path = "/approval/signature") {
  return new GenesisError(code, message, {
    path,
    correction,
    escalation: "human_authority",
  });
}

export function signApprovalRecord({ projectRoot, registry, record, signingKeyPath, clock }) {
  const identity = inspectHumanAuthorityIdentity(projectRoot, registry);
  if (!identity.valid || !identity.active_key) {
    throw approvalSecurityError(
      identity.blocker?.code ?? "IDENTITY_INVALID",
      "Human Authority identity is not ready to sign",
      identity.blocker?.correction ?? "Run genesis identity status and repair the identity chain",
      "/identity",
    );
  }
  if (!signingKeyPath) {
    throw approvalSecurityError("SIGNING_KEY_REQUIRED", "A physical Human Authority signing key is required", "Choose the SSH key registered by genesis identity setup", "/signing_key");
  }
  const signingPublicKey = publicKeyFromPrivateKey(signingKeyPath);
  if (publicKeyFingerprint(signingPublicKey) !== identity.active_key.fingerprint) {
    throw approvalSecurityError("SIGNING_KEY_MISMATCH", "The selected key is not the registered Human Authority key", `Choose the key with fingerprint ${identity.active_key.fingerprint}`, "/signing_key");
  }
  const unsigned = unsignedRecord(record);
  const signed = {
    ...unsigned,
    signature: signCanonicalPayload({
      payload: unsigned,
      principalId: record.approver_principal_id,
      signingKeyPath,
      namespace: APPROVAL_SIGNATURE_NAMESPACE,
      signedAt: clock().toISOString(),
    }),
  };
  registry.validateRecord("approval_record", signed);
  return signed;
}

export function verifyApprovalRecord({ projectRoot, registry, record }) {
  if (!record?.signature) {
    return { valid: false, code: "APPROVAL_SIGNATURE_MISSING", message: "Approval has no Human Authority signature", legacy: true };
  }
  if (
    record.signature.namespace !== APPROVAL_SIGNATURE_NAMESPACE
    || record.signature.principal_id !== record.approver_principal_id
  ) {
    return { valid: false, code: "APPROVAL_SIGNATURE_CONTEXT_INVALID", message: "Approval signature context does not match the record", legacy: false };
  }
  const identity = inspectHumanAuthorityIdentity(projectRoot, registry);
  if (!identity.valid || !identity.active_key) {
    return { valid: false, code: identity.blocker?.code ?? "IDENTITY_INVALID", message: "Human Authority identity is not currently valid", legacy: false };
  }
  if (identity.active_key.fingerprint !== record.signature.key_fingerprint) {
    return { valid: false, code: "APPROVAL_SIGNER_NOT_ACTIVE", message: "Approval was not signed by the active Human Authority key", legacy: false };
  }
  const verification = verifyCanonicalPayload({
    payload: unsignedRecord(record),
    envelope: record.signature,
    publicKey: identity.active_key.public_key,
  });
  return { ...verification, legacy: false };
}

export function requireApprovalSignature(input) {
  const result = verifyApprovalRecord(input);
  if (!result.valid) {
    throw approvalSecurityError(
      result.code,
      result.message,
      result.code === "APPROVAL_SIGNATURE_MISSING"
        ? "Issue a new approval using the registered Human Authority SSH key"
        : "Run genesis identity status and genesis verify-workspace before retrying",
    );
  }
  return input.record;
}
