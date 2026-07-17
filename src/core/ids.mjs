import { GenesisError } from "./errors.mjs";

const CANONICAL_ID = /^[a-z0-9][a-z0-9-]*$/;

export function normalizeBusinessId(value) {
  const normalized = typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    : "";

  if (!CANONICAL_ID.test(normalized)) {
    throw new GenesisError("BUSINESS_ID_INVALID", "Business ID is invalid", {
      path: "/business_id",
      correction: "Enter a business ID containing at least one letter or number",
      escalation: "operator",
    });
  }

  return normalized;
}

export function versionFileName(id, version) {
  if (!Number.isInteger(version) || version <= 0) {
    throw new GenesisError("RECORD_VERSION_INVALID", "Record version is invalid", {
      path: "/version",
      correction: "Use a positive integer record version",
      escalation: "operator",
    });
  }

  return `${id}.v${String(version).padStart(4, "0")}.yaml`;
}
