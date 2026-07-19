import fs from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";

import { GenesisError } from "./errors.mjs";

function resolveInsideRepo(repoRoot, relativePath) {
  const resolved = path.resolve(repoRoot, relativePath);
  const rootReal = fs.realpathSync(repoRoot);
  const resolvedReal = fs.realpathSync(resolved);
  if (resolvedReal !== rootReal && !resolvedReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new GenesisError("RECORD_SCHEMA_INVALID", "Record failed its registered schema", {
      path: "/record_templates",
      correction: `schema path must remain inside the repository: ${relativePath}`,
      escalation: "builder",
    });
  }
  return resolved;
}

function readManifest(manifestPath) {
  const document = YAML.parseDocument(fs.readFileSync(manifestPath, "utf8"), {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw document.errors[0];
  }
  return document.toJS({ mapAsMap: false });
}

function validationError(errors) {
  const ajvErrors = errors ?? [];
  const first = ajvErrors[0];
  return new GenesisError("RECORD_SCHEMA_INVALID", "Record failed its registered schema", {
    path: first?.instancePath ?? "",
    correction: ajvErrors.map((error) => {
      const extra = error.keyword === "additionalProperties" && error.params?.additionalProperty
        ? ` (unexpected ${error.params.additionalProperty})`
        : "";
      return `${error.instancePath || "/"} ${error.keyword}${extra}: ${error.message ?? "invalid value"}`;
    }).join("; "),
    escalation: "builder",
  });
}

export function createSchemaRegistry(repoRoot) {
  const root = path.resolve(repoRoot);
  const manifest = readManifest(path.join(root, "genesis.yaml"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const recordValidators = new Map();
  for (const descriptor of manifest.record_templates ?? []) {
    const schemaPath = resolveInsideRepo(root, descriptor.schema);
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    recordValidators.set(descriptor.id, ajv.compile(schema));
  }

  const evidencePath = resolveInsideRepo(root, "schemas/runtime/evidence-entry.schema.json");
  const evidenceValidator = ajv.compile(JSON.parse(fs.readFileSync(evidencePath, "utf8")));
  const identityPath = resolveInsideRepo(root, "schemas/runtime/identity-event.schema.json");
  const identityValidator = ajv.compile(JSON.parse(fs.readFileSync(identityPath, "utf8")));
  const syncEventPath = resolveInsideRepo(root, "schemas/runtime/sync-event.schema.json");
  const syncEventValidator = ajv.compile(JSON.parse(fs.readFileSync(syncEventPath, "utf8")));

  function validate(validator, value) {
    if (!validator || !validator(value)) {
      throw validationError(validator?.errors ?? [{
        instancePath: "/record_type",
        message: "must identify a manifest-registered record type",
      }]);
    }
    return value;
  }

  return Object.freeze({
    validateRecord(recordType, value) {
      return validate(recordValidators.get(recordType), value);
    },
    validateEvidence(value) {
      return validate(evidenceValidator, value);
    },
    validateIdentityEvent(value) {
      return validate(identityValidator, value);
    },
    validateSyncEvent(value) {
      return validate(syncEventValidator, value);
    },
  });
}
