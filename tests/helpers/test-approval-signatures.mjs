export function testApprovalSigner({ record, clock }) {
  return {
    ...record,
    signature: {
      scheme: "sshsig",
      namespace: "genesis-approval-v1",
      canonicalization: "RFC8785",
      digest_algorithm: "sha256",
      payload_digest: `sha256:${"a".repeat(64)}`,
      principal_id: "genesis-owner",
      key_fingerprint: "SHA256:dGVzdC1odW1hbi1hdXRob3JpdHk",
      signed_at: clock().toISOString(),
      signature: "-----BEGIN SSH SIGNATURE-----\ndGVzdA==\n-----END SSH SIGNATURE-----",
    },
  };
}

export function testApprovalVerifier() {
  return { valid: true, code: null, message: "Test signature accepted", legacy: false };
}
