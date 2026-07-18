import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createPrompter } from "../src/cli/prompter.mjs";
import { formatError, GenesisError } from "../src/core/errors.mjs";
import { normalizeBusinessId, versionFileName } from "../src/core/ids.mjs";
import { suggestionsFor } from "../src/core/suggestions.mjs";

test("business IDs and version paths are deterministic", () => {
  assert.equal(normalizeBusinessId("  Local Bakery CRM  "), "local-bakery-crm");
  assert.equal(versionFileName("local-bakery-crm-decision", 2), "local-bakery-crm-decision.v0002.yaml");
  assert.throws(() => normalizeBusinessId("---"), { code: "BUSINESS_ID_INVALID" });
});

test("errors render actionable fail-closed fields", () => {
  const error = new GenesisError("RECORD_SCHEMA_INVALID", "Record is invalid", {
    path: "/confidence", correction: "Enter a number from 0 to 1", escalation: "human_authority",
  });
  assert.match(formatError(error), /RECORD_SCHEMA_INVALID/);
  assert.match(formatError(error), /Enter a number from 0 to 1/);
});

test("suggestions are stable, offline, and immutable", () => {
  const first = suggestionsFor("validation_methods");
  assert.deepEqual(first, suggestionsFor("validation_methods"));
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(suggestionsFor("constructor"), []);
  assert.equal(Object.isFrozen(suggestionsFor("unsupported_topic")), true);
});

test("interactive choices reprompt instead of accepting unknown input", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk; });
  const prompter = createPrompter({ input, output });
  const selected = prompter.choose("Evidence stance:", ["support", "contradict"]);
  input.write("not-a-choice\n");
  await new Promise((resolve) => setImmediate(resolve));
  input.write("2\n");
  assert.equal(await selected, "contradict");
  assert.match(rendered, /Invalid choice/);
  input.end();
  await prompter.close();
});
