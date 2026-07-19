import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GenesisError } from "../core/errors.mjs";
import { canonicalDigest, canonicalizeJson } from "./canonical-json.mjs";

export const APPROVAL_SIGNATURE_NAMESPACE = "genesis-approval-v1";
export const IDENTITY_SIGNATURE_NAMESPACE = "genesis-identity-v1";

function securityError(code, message, correction, cause) {
  return new GenesisError(code, message, {
    path: "/signature",
    correction,
    escalation: "human_authority",
    cause,
  });
}

function runSshKeygen(args, options = {}) {
  const result = spawnSync("ssh-keygen", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    ...options,
  });
  if (result.error?.code === "ENOENT") {
    throw securityError("SSH_SIGNING_UNAVAILABLE", "OpenSSH signing is unavailable", "Install OpenSSH with ssh-keygen support", result.error);
  }
  return result;
}

function withTemporaryDirectory(operation) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-signature-"));
  try {
    return operation(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function normalizePublicKey(publicKey) {
  const fields = String(publicKey ?? "").trim().split(/\s+/);
  if (fields.length < 2 || !/^(?:ssh-|sk-)/.test(fields[0]) || !/^[A-Za-z0-9+/=]+$/.test(fields[1])) {
    throw securityError("SSH_PUBLIC_KEY_INVALID", "The SSH public key is invalid", "Provide an OpenSSH public key", undefined);
  }
  return `${fields[0]} ${fields[1]}`;
}

function publicSigningKey(signingKeyPath) {
  const resolved = path.resolve(signingKeyPath);
  if (resolved.endsWith(".pub")) {
    try {
      return {
        publicKey: normalizePublicKey(fs.readFileSync(resolved, "utf8")),
        signingPath: resolved,
        useAgent: true,
      };
    } catch (cause) {
      throw securityError("SSH_PUBLIC_KEY_INVALID", "Genesis could not read the SSH public key", "Choose the .pub file for a key loaded in ssh-agent", cause);
    }
  }
  const result = runSshKeygen(["-y", "-f", resolved]);
  if (result.status !== 0) {
    throw securityError("SSH_SIGNING_KEY_INVALID", "Genesis could not read the SSH signing key", "Unlock it with ssh-add, then provide its .pub path; or choose a readable private-key path", result.stderr);
  }
  return {
    publicKey: normalizePublicKey(result.stdout),
    signingPath: resolved,
    useAgent: false,
  };
}

export function publicKeyFromPrivateKey(signingKeyPath) {
  return publicSigningKey(signingKeyPath).publicKey;
}

export function publicKeyFingerprint(publicKey) {
  return withTemporaryDirectory((directory) => {
    const publicPath = path.join(directory, "identity.pub");
    fs.writeFileSync(publicPath, `${normalizePublicKey(publicKey)}\n`, { mode: 0o600 });
    const result = runSshKeygen(["-lf", publicPath, "-E", "sha256"]);
    if (result.status !== 0) {
      throw securityError("SSH_PUBLIC_KEY_INVALID", "Genesis could not fingerprint the SSH public key", "Provide an OpenSSH public key", result.stderr);
    }
    const match = result.stdout.match(/\bSHA256:[A-Za-z0-9+/]+/);
    if (!match) {
      throw securityError("SSH_PUBLIC_KEY_INVALID", "Genesis could not identify the SSH public key", "Provide an OpenSSH public key", result.stdout);
    }
    return match[0];
  });
}

export function signCanonicalPayload({ payload, principalId, signingKeyPath, namespace, signedAt }) {
  const canonical = canonicalizeJson(payload);
  const signingKey = publicSigningKey(signingKeyPath);
  const publicKey = signingKey.publicKey;
  const keyFingerprint = publicKeyFingerprint(publicKey);
  return withTemporaryDirectory((directory) => {
    const messagePath = path.join(directory, "payload.json");
    fs.writeFileSync(messagePath, canonical, { mode: 0o600 });
    const args = ["-Y", "sign", "-f", signingKey.signingPath, "-n", namespace];
    if (signingKey.useAgent) args.push("-U");
    args.push(messagePath);
    const result = runSshKeygen(args);
    if (result.status !== 0) {
      throw securityError("SSH_SIGNATURE_FAILED", "The physical signing step did not complete", signingKey.useAgent
        ? "Run ssh-add with the matching private key, then retry with this .pub path"
        : "Unlock or touch the selected key, then try again", result.stderr);
    }
    const signaturePath = `${messagePath}.sig`;
    if (!fs.existsSync(signaturePath)) {
      throw securityError("SSH_SIGNATURE_FAILED", "OpenSSH did not produce a signature", "Retry with a supported SSH signing key", undefined);
    }
    return {
      scheme: "sshsig",
      namespace,
      canonicalization: "RFC8785",
      digest_algorithm: "sha256",
      payload_digest: canonicalDigest(payload),
      principal_id: principalId,
      key_fingerprint: keyFingerprint,
      signed_at: signedAt,
      signature: fs.readFileSync(signaturePath, "utf8").trim(),
    };
  });
}

export function verifyCanonicalPayload({ payload, envelope, publicKey }) {
  if (!envelope || envelope.payload_digest !== canonicalDigest(payload)) {
    return { valid: false, code: "SIGNATURE_DIGEST_MISMATCH", message: "The signed record content has changed" };
  }
  if (publicKeyFingerprint(publicKey) !== envelope.key_fingerprint) {
    return { valid: false, code: "SIGNATURE_KEY_MISMATCH", message: "The signature key is not the trusted identity key" };
  }
  return withTemporaryDirectory((directory) => {
    const allowedPath = path.join(directory, "allowed_signers");
    const signaturePath = path.join(directory, "payload.sig");
    const messagePath = path.join(directory, "payload.json");
    fs.writeFileSync(allowedPath, `${envelope.principal_id} ${normalizePublicKey(publicKey)}\n`, { mode: 0o600 });
    fs.writeFileSync(signaturePath, `${envelope.signature.trim()}\n`, { mode: 0o600 });
    fs.writeFileSync(messagePath, canonicalizeJson(payload), { mode: 0o600 });
    const inputHandle = fs.openSync(messagePath, "r");
    let result;
    try {
      result = runSshKeygen([
        "-Y", "verify", "-f", allowedPath, "-I", envelope.principal_id,
        "-n", envelope.namespace, "-s", signaturePath,
      ], { stdio: [inputHandle, "pipe", "pipe"] });
    } finally {
      fs.closeSync(inputHandle);
    }
    if (result.status !== 0) {
      return { valid: false, code: "SIGNATURE_INVALID", message: "OpenSSH could not verify the signature" };
    }
    return { valid: true, code: null, message: "Signature verified" };
  });
}

export function unsignedRecord(record) {
  const value = structuredClone(record);
  delete value.signature;
  return value;
}
