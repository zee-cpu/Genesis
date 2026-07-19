import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadPolicySet,
  parseYamlFile,
  validateInvariants,
  validatePolicySet,
} from "../scripts/validate-genesis.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

test("normative manifest loads and identifies version 2.0.1", async () => {
  const policySet = await loadPolicySet(ROOT);
  assert.equal(policySet.manifest.version, "2.0.1");
  assert.equal(policySet.manifest.authority, "normative");
});

test("manifest passes its JSON Schema", async () => {
  const result = await validatePolicySet(ROOT);
  assert.deepEqual(result.errors.filter((issue) => issue.code.startsWith("SCHEMA_")), []);
});

test("duplicate YAML keys are rejected", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "genesis-yaml-"));
  const file = path.join(directory, "duplicate.yaml");
  await writeFile(file, "version: 1\nversion: 2\n", "utf8");
  assert.throws(() => parseYamlFile(file), /Map keys must be unique/);
});

for (const {
  collection,
  duplicateIndex,
  replacement,
} of [
  {
    collection: "policies",
    duplicateIndex: 11,
    replacement: {
      path: "config/duplicate-governance.yaml",
      schema: "schemas/duplicate-governance.schema.json",
    },
  },
  {
    collection: "record_templates",
    duplicateIndex: 5,
    replacement: {
      path: "templates/duplicate-approval-record.yaml",
      schema: "schemas/records/duplicate-approval-record.schema.json",
    },
  },
  {
    collection: "documents",
    duplicateIndex: 3,
    replacement: {
      path: "docs/duplicate-constitution.md",
    },
  },
]) {
  test(`${collection} rejects duplicate descriptor IDs`, async () => {
    const policySet = await loadPolicySet(ROOT);
    const first = policySet.manifest[collection][0];
    policySet.manifest[collection].push({ ...first, ...replacement });

    assert.deepEqual(validateInvariants(policySet), [
      {
        code: "DUPLICATE_DESCRIPTOR_ID",
        file: "genesis.yaml",
        path: `/${collection}/${duplicateIndex}/id`,
        message: `duplicate descriptor id "${first.id}"; first declared at /${collection}/0/id`,
      },
    ]);
  });
}

test("every registered document is explanatory and matches policy version 2.0.1", async () => {
  const policySet = await loadPolicySet(ROOT);
  assert.deepEqual([...policySet.documents.keys()], [
    "constitution",
    "configuration_guide",
    "agent_instructions",
  ]);
  for (const [documentId, content] of policySet.documents.entries()) {
    assert.match(content, /^Policy-Version: 2\.0\.1$/m, documentId);
    assert.match(content, /^Authority: Explanatory$/m, documentId);
  }
  assert.deepEqual(
    validateInvariants(policySet).filter((issue) => issue.code.startsWith("DOC_")),
    [],
  );
});

test("Constitution places Human Authority above CEO and links normative policy", async () => {
  const policySet = await loadPolicySet(ROOT);
  const constitution = policySet.documents.get("constitution");
  assert.match(constitution, /Human Authority is above the CEO/i);
  assert.match(constitution, /\[genesis\.yaml\]\(genesis\.yaml\)/);
  assert.match(constitution, /YAML.*normative/i);
});

test("configuration guide identifies genesis.yaml and YAML precedence", async () => {
  const policySet = await loadPolicySet(ROOT);
  const guide = policySet.documents.get("configuration_guide");
  assert.match(guide, /CLI runtime guide/);
  assert.match(guide, /\[genesis\.yaml\]\(genesis\.yaml\)/);
  assert.match(guide, /YAML wins over Markdown/i);
  assert.match(guide, /non-normative/i);
});

test("active agent instructions require normative YAML and fail closed", async () => {
  const policySet = await loadPolicySet(ROOT);
  const instructions = policySet.documents.get("agent_instructions");
  assert.match(instructions, /YAML.*normative/i);
  assert.match(instructions, /fail closed/i);
  assert.match(instructions, /approval cannot be inferred/i);
  assert.match(instructions, /Human Authority/i);
});

test("legacy codex instructions are only a deprecation notice", async () => {
  const content = await import("node:fs/promises").then(({ readFile }) => (
    readFile(path.join(ROOT, "codex.md.md"), "utf8")
  ));
  assert.equal(content.trim(), [
    "# Deprecated Agent Instructions",
    "",
    "Policy-Version: 2.0.1",
    "Authority: Explanatory",
    "",
    "This file is inactive. Repository agent instructions are defined in [AGENTS.md](AGENTS.md). Normative policy is defined by [genesis.yaml](genesis.yaml) and its referenced YAML files.",
  ].join("\n"));
});

test("documentation validation rejects version, authority, and agent conflicts", async () => {
  const policySet = await loadPolicySet(ROOT);
  policySet.documents.set("constitution", policySet.documents.get("constitution")
    .replace("Policy-Version: 2.0.1", "Policy-Version: 1.0.0"));
  policySet.documents.set("configuration_guide", policySet.documents.get("configuration_guide")
    .replace("Authority: Explanatory", "Authority: Normative"));
  policySet.documents.set("agent_instructions", "Policy-Version: 2.0.1\nAuthority: Explanatory\nApproval may be inferred.\n");
  const codes = validateInvariants(policySet).map((issue) => issue.code);
  assert.equal(codes.includes("DOC_VERSION_MISMATCH"), true);
  assert.equal(codes.includes("DOC_AUTHORITY_CONFLICT"), true);
  assert.equal(codes.includes("AGENT_INSTRUCTIONS_CONFLICT"), true);
});

test("version 1.0 review artifacts are archived as historical non-normative evidence", async () => {
  const reviewDirectory = path.join(ROOT, "docs", "reviews");
  const artifactPath = path.join(reviewDirectory, "2026-07-17-genesis-v1-review-artifact.json");
  const reportPath = path.join(reviewDirectory, "2026-07-17-genesis-v1-system-review.html");
  const readmePath = path.join(reviewDirectory, "README.md");
  await Promise.all([access(artifactPath), access(reportPath), access(readmePath)]);

  const [artifact, readme] = await Promise.all([
    readFile(artifactPath, "utf8").then(JSON.parse),
    readFile(readmePath, "utf8"),
  ]);
  assert.match(artifact.manifest.title, /Historical.*Version 1\.0/i);
  assert.match(artifact.manifest.description, /historical.*version 1\.0.*non-normative/i);
  assert.match(readme, /^Policy-Version: 2\.0\.0$/m);
  assert.match(readme, /^Authority: Explanatory$/m);
  assert.match(readme, /historical/i);
  assert.match(readme, /non-normative/i);
  assert.match(readme, /Reviewed-Version: 1\.0/m);

  await assert.rejects(access(path.join(ROOT, "genesis-review-artifact.json")));
  await assert.rejects(access(path.join(ROOT, "genesis-system-review.html")));
});

test("GitHub Actions runs the locked Genesis validation gate", async () => {
  const workflow = await readFile(
    path.join(ROOT, ".github", "workflows", "validate-genesis.yml"),
    "utf8",
  );
  assert.match(workflow, /^name: Validate Genesis$/m);
  assert.match(workflow, /^  validate-genesis:$/m);
  assert.match(workflow, /uses: actions\/checkout@v4/);
  assert.match(workflow, /uses: actions\/setup-node@v4/);
  assert.match(workflow, /node-version: 22/);
  for (const command of ["npm ci", "npm run validate", "npm test"]) {
    assert.match(workflow, new RegExp(`- run: ${command.replaceAll(" ", "\\s")}`));
  }
});

test("release-candidate packaging is allowlisted, versioned, and non-publishing", async () => {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.name, "genesis-governance");
  assert.equal(packageJson.version, "2.0.0");
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, "Apache-2.0");
  assert.equal(packageJson.repository.url, "git+https://github.com/zee-cpu/Genesis.git");
  assert.equal(packageJson.scripts["release:verify"], "node scripts/verify-package.mjs");
  assert.equal(packageJson.scripts["check:web"], "npm run web:test && npm run web:build");
  for (const required of ["bin/", "src/cli/", "src/security/", "src/sync/", "config/", "schemas/", "templates/", "genesis.yaml", "LICENSE", "NOTICE"]) {
    assert.equal(packageJson.files.includes(required), true, required);
  }
  for (const forbidden of ["site/", "src/experiments/", "records/", "tests/"]) {
    assert.equal(packageJson.files.includes(forbidden), false, forbidden);
  }

  const workflow = await readFile(path.join(ROOT, ".github", "workflows", "package-genesis.yml"), "utf8");
  assert.match(workflow, /^name: Package Genesis CLI$/m);
  assert.match(workflow, /node scripts\/verify-package\.mjs --output artifacts/);
  assert.match(workflow, /npm ci --prefix apps\/operator-console/);
  assert.match(workflow, /npm run check:web/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /npm publish/);

  const releaseGuide = await readFile(path.join(ROOT, "RELEASING.md"), "utf8");
  assert.match(releaseGuide, /^Policy-Version: 2\.0\.0$/m);
  assert.match(releaseGuide, /Human Authority approval record/);
  assert.match(releaseGuide, /Semantic Versioning/);
  assert.match(releaseGuide, /never migrate, delete, or rewrite/i);

  const [license, notice] = await Promise.all([
    readFile(path.join(ROOT, "LICENSE"), "utf8"),
    readFile(path.join(ROOT, "NOTICE"), "utf8"),
  ]);
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(license, /Copyright 2026 zee-cpu/);
  assert.match(notice, /Copyright 2026 zee-cpu/);
});

test("README documents the offline CLI, files, recovery, and limits", async () => {
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
  for (const command of [
    "genesis start-business",
    "genesis start-follow-up <business-id>",
    "genesis start-learning-lab <business-id>",
    "genesis add-evidence <business-id>",
    "genesis import-evidence <business-id> --file <path>",
    "genesis execution-checklist <business-id>",
    "genesis correct-decision <business-id>",
    "genesis list",
    "genesis search <query>",
    "genesis status <business-id>",
    "genesis next <business-id>",
    "genesis plan-experiment <business-id>",
    "genesis revise-experiment <business-id>",
    "genesis review-experiment <business-id>",
    "genesis approve-experiment <business-id>",
    "genesis deny-experiment <business-id>",
    "genesis start-experiment <business-id>",
    "genesis record-execution <business-id>",
    "genesis record-measurement <business-id>",
    "genesis record-reflection <business-id>",
    "genesis decide-experiment <business-id>",
    "genesis close-experiment <business-id>",
    "genesis sync status",
    "genesis sync prepare",
    "genesis sync apply",
    "genesis revoke-approval <business-id>",
    "genesis rebuild-index",
  ]) {
    assert.match(readme, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(readme, /--json/);
  assert.match(readme, /--input <file\.json>/);

  assert.match(readme, /\.genesis\//);
  assert.match(readme, /approval_pending/);
  assert.match(readme, /YAML/i);
  assert.match(readme, /SQLite/i);
  assert.match(readme, /rebuild-index/);
  assert.match(readme, /npm ci/);
  assert.match(readme, /npm start/);
  assert.match(readme, /node bin\/genesis\.mjs/);
  assert.match(readme, /npm link/);
  assert.match(readme, /genesis --version/);
  assert.match(readme, /RELEASING\.md/);
  assert.match(readme, /manually mark an approved experiment `active`/i);
  assert.match(readme, /does not execute the experiment/i);
  assert.match(readme, /does not automatically research, contact customers, run experiment steps, build products, deploy software, bill customers, or operate a business/i);
});

test("package.json exposes a direct start command", async () => {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.start, "node bin/genesis.mjs");
});
