import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import * as validator from "../scripts/validate-genesis.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RECORD_IDS = [
  "approval_record",
  "decision_record",
  "experiment_record",
  "experience_record",
  "constitutional_amendment",
];

function templatePath(recordId) {
  return path.join(ROOT, "templates", `${recordId.replaceAll("_", "-")}.yaml`);
}

function schemaPath(recordId) {
  return path.join(ROOT, "schemas", "records", `${recordId.replaceAll("_", "-")}.schema.json`);
}

function loadTemplate(recordId) {
  return validator.parseYamlFile(templatePath(recordId));
}

function compileSchema(recordId) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(schemaPath(recordId), "utf8")));
}

function assertSchemaPath(recordId, mutate, expectedPath) {
  const record = structuredClone(loadTemplate(recordId));
  mutate(record);
  const validate = compileSchema(recordId);
  assert.equal(validate(record), false);
  const errorPaths = validate.errors.map((error) => (
    error.keyword === "required"
      ? `${error.instancePath}/${error.params.missingProperty}`
      : error.instancePath
  ));
  assert.equal(
    errorPaths.includes(expectedPath),
    true,
    JSON.stringify(validate.errors, null, 2),
  );
}

test("every manifest record template loads and passes its schema", async () => {
  const result = await validator.validatePolicySet(ROOT);
  assert.deepEqual([...result.policySet.templates.keys()], RECORD_IDS);
  assert.deepEqual(result.errors.filter((error) => error.code === "SCHEMA_TEMPLATE"), []);
  assert.deepEqual(
    result.errors.filter((error) => (
      error.code === "FILE_MISSING" && error.path.startsWith("/record_templates/")
    )),
    [],
  );
});

test("record schemas accept operational records without the template-only marker", () => {
  for (const recordId of RECORD_IDS) {
    const record = structuredClone(loadTemplate(recordId));
    delete record.example_only;
    const validate = compileSchema(recordId);
    assert.equal(validate(record), true, `${recordId}: ${JSON.stringify(validate.errors)}`);
  }
});

test("record schemas reject missing shared and type-specific fields at exact paths", () => {
  assertSchemaPath("decision_record", (record) => delete record.owner, "/owner");
  assertSchemaPath("experiment_record", (record) => { record.evidence_references = []; }, "/evidence_references");
  assertSchemaPath("approval_record", (record) => delete record.expires_at, "/expires_at");
  assertSchemaPath("experiment_record", (record) => delete record.decision_date, "/decision_date");
  assertSchemaPath("experience_record", (record) => delete record.policy_version, "/policy_version");
  assertSchemaPath("decision_record", (record) => delete record.privacy_classification, "/privacy_classification");
});

test("Experience corrections require a supersession link", () => {
  assertSchemaPath("experience_record", (record) => {
    record.is_correction = true;
    record.supersedes = [];
  }, "/supersedes");
});

test("expired approval fails closed", () => {
  assert.equal(typeof validator.validateApproval, "function");
  const record = validator.parseYamlFile(path.join(ROOT, "tests/fixtures/invalid/expired-approval.yaml"));
  const issues = validator.validateApproval(record, {
    now: "2026-07-18T00:00:00Z",
    action: "production_deployment",
    actor: "builder-agent",
  });
  assert.equal(issues.some((issue) => issue.code === "APPROVAL_EXPIRED"), true);
});

test("revoked approval fails before scope checks", () => {
  assert.equal(typeof validator.validateApproval, "function");
  const record = validator.parseYamlFile(path.join(ROOT, "tests/fixtures/invalid/revoked-approval.yaml"));
  const issues = validator.validateApproval(record, {
    now: "2026-07-18T00:00:00Z",
    action: "different_action",
    actor: "builder-agent",
  });
  assert.equal(issues[0].code, "APPROVAL_REVOKED");
  assert.equal(issues.some((issue) => issue.code === "APPROVAL_SCOPE_MISMATCH"), true);
});

test("approval scope and actor match exactly", () => {
  assert.equal(typeof validator.validateApproval, "function");
  const record = loadTemplate("approval_record");
  const validContext = {
    now: "2026-07-18T00:00:00Z",
    action: "production_deployment",
    actor: "builder-agent",
  };
  assert.deepEqual(validator.validateApproval(record, validContext), []);
  assert.equal(
    validator.validateApproval(record, { ...validContext, action: "payment" })
      .some((issue) => issue.code === "APPROVAL_SCOPE_MISMATCH"),
    true,
  );
  assert.equal(
    validator.validateApproval(record, { ...validContext, actor: "other-agent" })
      .some((issue) => issue.code === "APPROVAL_ACTOR_MISMATCH"),
    true,
  );
});

test("only active canonical approval records validate", () => {
  const validContext = {
    now: "2026-07-18T00:00:00Z",
    action: "production_deployment",
    actor: "builder-agent",
  };

  for (const status of ["draft", "closed", "superseded"]) {
    const record = loadTemplate("approval_record");
    record.status = status;
    assert.equal(
      validator.validateApproval(record, validContext).some((issue) => (
        issue.code === "APPROVAL_STATUS_INVALID" && issue.path === "/status"
      )),
      true,
      status,
    );
  }

  const statusless = loadTemplate("approval_record");
  delete statusless.status;
  assert.equal(
    validator.validateApproval(statusless, validContext).some((issue) => (
      issue.code === "APPROVAL_STATUS_INVALID" && issue.path === "/status"
    )),
    true,
  );

  const noncanonical = loadTemplate("approval_record");
  noncanonical.record_type = "decision_record";
  assert.equal(
    validator.validateApproval(noncanonical, validContext).some((issue) => (
      issue.code === "APPROVAL_RECORD_INVALID" && issue.path === "/record_type"
    )),
    true,
  );
});

test("approval limits cannot exceed the canonical envelope", () => {
  assert.equal(typeof validator.validateApproval, "function");
  const record = loadTemplate("approval_record");
  const validContext = {
    now: "2026-07-18T00:00:00Z",
    action: "production_deployment",
    actor: "builder-agent",
  };
  const mismatches = [
    { cash_usd: record.limits.cash_usd + 1 },
    { labor_hours: record.limits.labor_hours + 1 },
    { duration_days: record.limits.duration_days + 1 },
    { data_classes: [...record.limits.data_classes, "public"] },
    { data_classes: ["unknown"] },
    { risk_level: "critical" },
  ];

  for (const limits of mismatches) {
    assert.equal(
      validator.validateApproval(record, { ...validContext, limits })
        .some((issue) => issue.code === "APPROVAL_LIMIT_MISMATCH"),
      true,
      JSON.stringify(limits),
    );
  }

  const unknownApprovedClass = loadTemplate("approval_record");
  unknownApprovedClass.limits.data_classes = ["unknown"];
  assert.equal(
    validator.validateApproval(unknownApprovedClass, validContext)
      .some((issue) => issue.code === "APPROVAL_LIMIT_MISMATCH"),
    true,
  );
});

test("approval and experiment limit data classes use the privacy enum", () => {
  for (const recordId of ["approval_record", "experiment_record"]) {
    const record = loadTemplate(recordId);
    record.limits.data_classes = ["unknown"];
    const validate = compileSchema(recordId);
    assert.equal(validate(record), false, recordId);
  }
});

test("draft experiment requires preregistration but not closure fields", async () => {
  const draft = loadTemplate("experiment_record");
  draft.status = "draft";
  draft.approval_references = [];
  for (const field of ["actual_cost", "results", "reflection", "outcome", "experience_reference", "confidence_update", "decision_outcome"]) {
    delete draft[field];
  }
  assert.equal(compileSchema("experiment_record")(draft), true);
});

test("measurement and reflection states require separate execution and result evidence", () => {
  const measurement = loadTemplate("experiment_record");
  measurement.status = "measurement";
  delete measurement.execution_log;
  assert.equal(compileSchema("experiment_record")(measurement), false);

  const reflection = loadTemplate("experiment_record");
  reflection.status = "reflection";
  delete reflection.actual_result;
  assert.equal(compileSchema("experiment_record")(reflection), false);
});

test("closed validation experiment requires closure and validation outcome", async () => {
  const closed = loadTemplate("experiment_record");
  delete closed.validation_outcome;
  assert.equal(compileSchema("experiment_record")(closed), false);
  closed.validation_outcome = "passed";
  assert.equal(compileSchema("experiment_record")(closed), true);
});

test("decision record carries the target customer", async () => {
  const decision = loadTemplate("decision_record");
  delete decision.target_customer;
  assert.equal(compileSchema("decision_record")(decision), false);
});

test("Major Bet decisions require reviews, recommendation, and approval", () => {
  const decision = loadTemplate("decision_record");
  decision.decision_class = "major_bet";
  decision.approval_references = ["example-approval-001"];
  const validate = compileSchema("decision_record");
  assert.equal(validate(decision), false);
  const missing = validate.errors
    .filter((error) => error.keyword === "required")
    .map((error) => error.params.missingProperty);
  assert.equal(missing.includes("constitution_review"), true);
  assert.equal(missing.includes("evidence_review"), true);
  assert.equal(missing.includes("ceo_recommendation"), true);
});

test("record references use declared record identifiers", async () => {
  const policySet = await validator.loadPolicySet(ROOT);
  const record = policySet.templates.get("decision_record");
  record.related_records = ["not a valid reference"];
  assert.equal(
    validator.validateInvariants(policySet)
      .some((issue) => issue.code === "RECORD_REFERENCE_INVALID"),
    true,
  );
});
