import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

import { GenesisError } from "../core/errors.mjs";
import { canonicalDigest } from "./canonical-json.mjs";
import {
  IDENTITY_SIGNATURE_NAMESPACE,
  publicKeyFingerprint,
  publicKeyFromPrivateKey,
  signCanonicalPayload,
  unsignedRecord,
  verifyCanonicalPayload,
} from "./ssh-signatures.mjs";
import { ensureWorkspace, workspacePaths } from "../storage/workspace.mjs";

const IDENTITY_ID = "genesis-owner-identity";
const FILE_PATTERN = /^genesis-owner-identity\.v(?<version>\d{4})\.yaml$/;

function identityError(code, message, correction, path_ = "/identity") {
  return new GenesisError(code, message, {
    path: path_,
    correction,
    escalation: "human_authority",
  });
}

function identityPath(projectRoot, version) {
  return path.join(workspacePaths(projectRoot).identities, `${IDENTITY_ID}.v${String(version).padStart(4, "0")}.yaml`);
}

function parseIdentity(filePath) {
  const document = YAML.parseDocument(fs.readFileSync(filePath, "utf8"), {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw identityError("IDENTITY_RECORD_INVALID", "The Human Authority identity record is invalid", "Preserve the file and repair identity history through an authorized recovery", filePath);
  }
  return document.toJS({ mapAsMap: false });
}

export function listIdentityEvents(projectRoot, registry) {
  const paths = ensureWorkspace(projectRoot);
  return fs.readdirSync(paths.identities, { withFileTypes: true })
    .filter((entry) => entry.isFile() && FILE_PATTERN.test(entry.name))
    .map((entry) => {
      const match = entry.name.match(FILE_PATTERN);
      const filePath = path.join(paths.identities, entry.name);
      const event = parseIdentity(filePath);
      registry.validateIdentityEvent(event);
      if (event.version !== Number(match.groups.version)) {
        throw identityError("IDENTITY_VERSION_MISMATCH", "The identity filename and record version disagree", "Preserve the file and restore the correct versioned identity event", filePath);
      }
      return { path: filePath, relativePath: path.relative(projectRoot, filePath), event };
    })
    .sort((left, right) => left.event.version - right.event.version);
}

async function writeIdentityEvent(projectRoot, event) {
  ensureWorkspace(projectRoot);
  const filePath = identityPath(projectRoot, event.version);
  let handle;
  try {
    handle = await fs.promises.open(filePath, "wx", 0o600);
    await handle.writeFile(`${YAML.stringify(event)}\n`);
    await handle.sync();
  } catch (cause) {
    if (cause?.code === "EEXIST") {
      throw identityError("IDENTITY_VERSION_EXISTS", "This identity event already exists", "Verify the existing identity history instead of overwriting it", filePath);
    }
    throw cause;
  } finally {
    await handle?.close().catch(() => {});
  }
  return path.relative(projectRoot, filePath);
}

export function inspectHumanAuthorityIdentity(projectRoot, registry) {
  const entries = listIdentityEvents(projectRoot, registry);
  if (entries.length === 0) {
    return {
      configured: false,
      valid: false,
      principal_id: "genesis-owner",
      active_key: null,
      events: [],
      blocker: {
        code: "IDENTITY_SETUP_REQUIRED",
        correction: "Run genesis identity setup and choose the Human Authority SSH key",
      },
    };
  }

  let activeKey = null;
  let previous = null;
  for (const [index, entry] of entries.entries()) {
    const { event } = entry;
    if (event.version !== index + 1) {
      return { configured: true, valid: false, principal_id: "genesis-owner", active_key: null, events: entries, blocker: { code: "IDENTITY_HISTORY_GAP", correction: "Restore every immutable identity event version" } };
    }
    if (index === 0) {
      if (event.action !== "bootstrap" || event.previous_event_digest !== null) {
        return { configured: true, valid: false, principal_id: "genesis-owner", active_key: null, events: entries, blocker: { code: "IDENTITY_BOOTSTRAP_INVALID", correction: "Restore the original Human Authority bootstrap event" } };
      }
      const verified = verifyCanonicalPayload({ payload: unsignedRecord(event), envelope: event.signature, publicKey: event.key.public_key });
      if (!verified.valid || publicKeyFingerprint(event.key.public_key) !== event.key.fingerprint) {
        return { configured: true, valid: false, principal_id: "genesis-owner", active_key: null, events: entries, blocker: { code: verified.code ?? "IDENTITY_KEY_MISMATCH", correction: "Restore the original signed Human Authority bootstrap event" } };
      }
      activeKey = event.key;
    } else {
      if (event.previous_event_digest !== canonicalDigest(previous.event)) {
        return { configured: true, valid: false, principal_id: "genesis-owner", active_key: null, events: entries, blocker: { code: "IDENTITY_CHAIN_BROKEN", correction: "Restore the missing or unchanged identity event chain" } };
      }
      const verified = verifyCanonicalPayload({ payload: unsignedRecord(event), envelope: event.signature, publicKey: activeKey.public_key });
      if (!verified.valid || event.key.fingerprint !== activeKey.fingerprint) {
        return { configured: true, valid: false, principal_id: "genesis-owner", active_key: null, events: entries, blocker: { code: verified.code ?? "IDENTITY_KEY_MISMATCH", correction: "Restore the authorized identity event chain" } };
      }
      if (event.action === "revoke") activeKey = null;
    }
    previous = entry;
  }

  return {
    configured: true,
    valid: activeKey !== null,
    principal_id: "genesis-owner",
    active_key: activeKey,
    events: entries.map(({ relativePath, event }) => ({
      version: event.version,
      action: event.action,
      created_at: event.created_at,
      fingerprint: event.key.fingerprint,
      path: relativePath,
    })),
    blocker: activeKey ? null : {
      code: "IDENTITY_KEY_REVOKED",
      correction: "Use an authorized recovery process to establish a replacement Human Authority key",
    },
  };
}

export async function bootstrapHumanAuthority({ projectRoot, registry, signingKeyPath, clock }) {
  if (listIdentityEvents(projectRoot, registry).length > 0) {
    throw identityError("IDENTITY_ALREADY_CONFIGURED", "Human Authority identity is already configured", "Use genesis identity status; never replace bootstrap history");
  }
  const now = clock().toISOString();
  const publicKey = publicKeyFromPrivateKey(signingKeyPath);
  const fingerprint = publicKeyFingerprint(publicKey);
  const unsigned = {
    id: IDENTITY_ID,
    record_type: "identity_event",
    schema_version: "1.0.0",
    version: 1,
    principal_id: "genesis-owner",
    role: "human_authority",
    action: "bootstrap",
    created_at: now,
    previous_event_digest: null,
    key: { fingerprint, public_key: publicKey },
    reason: null,
  };
  const event = {
    ...unsigned,
    signature: signCanonicalPayload({
      payload: unsigned,
      principalId: "genesis-owner",
      signingKeyPath,
      namespace: IDENTITY_SIGNATURE_NAMESPACE,
      signedAt: now,
    }),
  };
  registry.validateIdentityEvent(event);
  const savedPath = await writeIdentityEvent(projectRoot, event);
  return { changed: true, principal_id: "genesis-owner", fingerprint, path: savedPath };
}

export async function revokeHumanAuthorityKey({ projectRoot, registry, signingKeyPath, reason, clock }) {
  const status = inspectHumanAuthorityIdentity(projectRoot, registry);
  if (!status.valid || !status.active_key) {
    throw identityError(status.blocker?.code ?? "IDENTITY_INVALID", "Human Authority identity is not currently valid", status.blocker?.correction ?? "Repair identity history first");
  }
  if (!String(reason ?? "").trim()) {
    throw identityError("REVOCATION_REASON_REQUIRED", "Key revocation needs a reason", "Explain why the Human Authority key must no longer authorize approvals", "/reason");
  }
  const signerPublicKey = publicKeyFromPrivateKey(signingKeyPath);
  if (publicKeyFingerprint(signerPublicKey) !== status.active_key.fingerprint) {
    throw identityError("SIGNING_KEY_MISMATCH", "The selected key is not the active Human Authority key", "Choose the key shown by genesis identity status", "/signing_key");
  }
  const entries = listIdentityEvents(projectRoot, registry);
  const previous = entries.at(-1).event;
  const now = clock().toISOString();
  const unsigned = {
    id: IDENTITY_ID,
    record_type: "identity_event",
    schema_version: "1.0.0",
    version: previous.version + 1,
    principal_id: "genesis-owner",
    role: "human_authority",
    action: "revoke",
    created_at: now,
    previous_event_digest: canonicalDigest(previous),
    key: structuredClone(status.active_key),
    reason: String(reason).trim(),
  };
  const event = {
    ...unsigned,
    signature: signCanonicalPayload({
      payload: unsigned,
      principalId: "genesis-owner",
      signingKeyPath,
      namespace: IDENTITY_SIGNATURE_NAMESPACE,
      signedAt: now,
    }),
  };
  registry.validateIdentityEvent(event);
  const savedPath = await writeIdentityEvent(projectRoot, event);
  return { changed: true, principal_id: "genesis-owner", fingerprint: status.active_key.fingerprint, path: savedPath, revoked: true };
}
