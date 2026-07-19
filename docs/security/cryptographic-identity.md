# Cryptographic Human Authority

Genesis uses an SSH public key to prove that a new Human Authority approval came from the configured `genesis-owner`. The CLI keeps the workflow deliberately small:

```console
genesis identity setup
genesis identity status
genesis approve-experiment <business-id>
genesis verify-workspace
```

`identity setup` asks for a public key, displays its SHA-256 fingerprint, and asks one final question before creating the trust anchor. Review that fingerprint through a separate trusted channel when the workspace will be shared. Genesis stores the public key and signed identity events; it never reads or stores the private key.

Passphrase-protected keys should be unlocked with `ssh-add`. Pass the corresponding `.pub` path to `--signing-key`; OpenSSH asks the agent to perform the signature, so Genesis never receives the passphrase or private-key material.

When an approval is created, Genesis asks for the matching private-key path. OpenSSH signs a deterministic, domain-separated representation of the approval. The signature envelope records the algorithm, namespace, signer fingerprint, canonicalization method, payload digest, and detached signature. Any later field change makes verification fail.

Before an approval can authorize a transition, Genesis verifies all of the following:

- the identity event chain is intact;
- the signing key is the currently active `genesis-owner` key;
- the approval payload digest and SSH signature are valid;
- the approval's actor, scope, limits, effective time, expiry, and revocation state still match.

Use `genesis identity revoke` if the active key is lost or compromised. Revocation must be signed by that active key and blocks it from authorizing new work. Key recovery and rotation are intentionally not automated yet; after revocation, stop and use a separately reviewed constitutional recovery procedure.

## Compatibility and trust boundary

Existing unsigned records remain readable audit history, but they cannot authorize a new protected action after policy version 2.0.1. Genesis never silently upgrades or signs old records.

SSH signatures provide record authenticity and tamper detection. They do not prevent a fully compromised local account from deleting files, prove that a local timestamp came from a trusted timestamp authority, establish the initial key's owner without independent fingerprint review, or resolve concurrent Git edits. Hardware-backed OpenSSH `sk-ssh-ed25519` and `sk-ecdsa` keys are supported when the installed OpenSSH version supports them.

The signed append-only record folder remains the source of truth. SQLite is a rebuildable projection only. Git-compatible event-set synchronization now preserves and verifies Human Authority history, but other operator identities are not yet cryptographically established. Broader operator identity remains required before hosted operation.
