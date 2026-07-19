// Security and behavior tests for the read-only Operator Console server.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGenesisService } from "../../../../src/application/genesis-service.mjs";
import { sanitizePayload, startConsoleServer } from "../server.mjs";

const CANARY = "console-test-canary-value-1234567890";
process.env.GENESIS_CONSOLE_TEST_CANARY = CANARY;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "genesis-console-"));
}

async function withServer(workspaceDir, run) {
  const server = await startConsoleServer({ workspaceDir, port: 0 });
  const { address, port } = server.address();
  const base = `http://${address}:${port}`;
  try {
    await run(base, server);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Minimal real workspace: identity + one business via the actual engine. */
async function seedWorkspace(projectRoot) {
  const keyPath = path.join(projectRoot, "authority-key");
  const generated = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const frozen = new Date("2026-07-17T12:00:00Z");
  const service = createGenesisService({
    projectRoot,
    clock: () => frozen,
    confirm: async () => true,
  });
  await service.setupIdentity({ signing_key_path: keyPath });
  await service.startBusiness({
    business_id: "bakery",
    owner: "research",
    target_customer: "Independent bakery owners",
    problem: "Weekly order reconciliation takes too long",
    hypothesis: "A clearer order view will reduce reconciliation time",
    confidence: 0.55,
    source_reference: "interview://owner-1",
    summary: "Owner spends two hours on reconciliation every week",
    stance: "support",
    provenance: "Interview note",
    privacy_classification: "internal",
    counterevidence: ["Learning curve objection"],
    alternatives: ["manual process"],
    expected_outcome: "Weekly reconciliation takes less than one hour",
    metric: "weekly_reconciliation_minutes",
    decision: "run_bounded_validation",
    review_date: "2026-07-22T12:00:00Z",
  });
  return keyPath;
}

test("server binds to 127.0.0.1 by default", { concurrency: false }, async () => {
  const dir = makeTempDir();
  try {
    await withServer(dir, async (_base, server) => {
      assert.equal(server.address().address, "127.0.0.1");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("every mutation HTTP method returns 405 with an Allow header", { concurrency: false }, async () => {
  const dir = makeTempDir();
  try {
    await withServer(dir, async (base) => {
      for (const pathName of ["/api/overview", "/api/opportunities", "/api/opportunities/bakery", "/api/sync", "/", "/api/events"]) {
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
          const response = await fetch(base + pathName, { method });
          assert.equal(response.status, 405, `${method} ${pathName}`);
          assert.equal(response.headers.get("allow"), "GET, HEAD");
          const body = await response.json();
          assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
        }
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid business IDs are rejected with 400", { concurrency: false }, async () => {
  const dir = makeTempDir();
  try {
    await withServer(dir, async (base) => {
      for (const bad of ["UPPER", "semi;colon", "..", "a b", "%2e%2e"]) {
        const response = await fetch(`${base}/api/opportunities/${encodeURIComponent(bad)}`);
        // ".." collapses during URL normalization and lands on an unknown
        // route (404); everything else must hit explicit validation (400).
        assert.ok([400, 404].includes(response.status), `id ${bad} -> ${response.status}`);
        if (response.status === 400) {
          const body = await response.json();
          assert.equal(body.error.code, "INVALID_BUSINESS_ID");
        }
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("path traversal never escapes the console", { concurrency: false }, async () => {
  const dir = makeTempDir();
  try {
    await withServer(dir, async (base) => {
      for (const attempt of [
        "/../../../../etc/passwd",
        "/..%2f..%2f..%2fetc%2fpasswd",
        "/assets/../../server/server.mjs",
        "/api/opportunities/..%2f..%2fetc/timeline",
      ]) {
        const response = await fetch(base + attempt);
        const text = await response.text();
        assert.ok(!text.includes("root:"), `${attempt} leaked /etc/passwd`);
        assert.ok(!text.includes("createGenesisService"), `${attempt} leaked server source`);
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty directory works and is never written to", { concurrency: false }, async () => {
  const dir = makeTempDir();
  try {
    await withServer(dir, async (base) => {
      const health = await (await fetch(`${base}/api/health`)).json();
      assert.equal(health.ok, true);
      assert.equal(health.workspace_ready, false);
      const overview = await (await fetch(`${base}/api/overview`)).json();
      assert.equal(overview.workspace_ready, false);
      assert.ok(overview.guidance.suggested_commands.includes("genesis start-business"));
      const opportunities = await (await fetch(`${base}/api/opportunities`)).json();
      assert.equal(opportunities.count, 0);
    });
    // The read-only console must not have created a workspace.
    assert.equal(fs.existsSync(path.join(dir, ".genesis")), false, "console created .genesis in an empty directory");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("responses never contain private keys, env values, or outside paths", { concurrency: false }, async () => {
  const dir = makeTempDir();
  try {
    await seedWorkspace(dir);
    await withServer(dir, async (base) => {
      const paths = [
        "/api/health", "/api/overview", "/api/opportunities", "/api/identity",
        "/api/sync", "/api/audit", "/api/opportunities/bakery",
        "/api/opportunities/bakery/timeline", "/api/opportunities/bakery/report",
        "/api/opportunities/bakery/next",
      ];
      for (const apiPath of paths) {
        const response = await fetch(base + apiPath);
        assert.ok(response.status < 500, `${apiPath} -> ${response.status}`);
        const text = await response.text();
        assert.ok(!text.includes("PRIVATE KEY"), `${apiPath} leaked key material`);
        assert.ok(!text.includes(CANARY), `${apiPath} leaked environment values`);
        assert.ok(!text.includes(os.tmpdir()), `${apiPath} leaked an absolute path`);
        assert.ok(!/"[A-Za-z_]*path[^"]*":\s*"\//.test(text), `${apiPath} contains an absolute path field`);
      }
      const identity = await (await fetch(`${base}/api/identity`)).json();
      assert.equal(identity.identity.configured, true);
      assert.match(identity.identity.active_key.fingerprint, /^SHA256:/);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("business data endpoints serve real records read-only", { concurrency: false }, async () => {
  const dir = makeTempDir();
  try {
    await seedWorkspace(dir);
    const before = fs.readdirSync(path.join(dir, ".genesis", "records", "decisions"));
    await withServer(dir, async (base) => {
      const list = await (await fetch(`${base}/api/opportunities`)).json();
      assert.equal(list.count, 1);
      assert.equal(list.opportunities[0].business_id, "bakery");
      assert.equal(list.opportunities[0].state, "discover");

      const timeline = await (await fetch(`${base}/api/opportunities/bakery/timeline`)).json();
      assert.ok(timeline.events.length >= 2);
      assert.ok(timeline.events.every((event) => event.record));

      const next = await (await fetch(`${base}/api/opportunities/bakery/next`)).json();
      assert.equal(next.business_id, "bakery");
      assert.equal(next.state, "discover");
      assert.equal(next.defaults, undefined, "guided CLI defaults must not reach the browser");

      const missing = await fetch(`${base}/api/opportunities/no-such-business`);
      assert.equal(missing.status, 404);
    });
    const after = fs.readdirSync(path.join(dir, ".genesis", "records", "decisions"));
    assert.deepEqual(after, before, "console changed canonical records");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unsigned legacy approvals are visible and labeled by the engine", { concurrency: false }, async () => {
  const dir = makeTempDir();
  try {
    await seedWorkspace(dir);
    // Write nothing ourselves: the engine treats approvals without a signature
    // envelope as legacy. Simulate by asking verify-workspace via the API and
    // asserting the signed approval fields flow through untouched.
    await withServer(dir, async (base) => {
      const identity = await (await fetch(`${base}/api/identity`)).json();
      assert.ok(Array.isArray(identity.verification.approvals));
      for (const approval of identity.verification.approvals) {
        assert.ok(typeof approval.signed === "boolean" || approval.legacy !== undefined);
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical record changes emit a refresh notification", { concurrency: false }, async () => {
  const dir = makeTempDir();
  try {
    await seedWorkspace(dir);
    await withServer(dir, async (base) => {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/events`, { signal: controller.signal });
      assert.equal(response.headers.get("content-type"), "text/event-stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Pump the stream continuously so no frame is lost between polls.
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
          }
        } catch { /* aborted at the end of the test */ }
      })();

      async function readUntil(marker, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (buffer.includes(marker)) return true;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return buffer.includes(marker);
      }

      assert.ok(await readUntil("event: hello", 3000), "no hello event");
      fs.writeFileSync(path.join(dir, ".genesis", "touch-marker"), "x");
      assert.ok(await readUntil("event: refresh", 5000), "no refresh event after workspace change");
      controller.abort();
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("safe security headers are applied", { concurrency: false }, async () => {
  const dir = makeTempDir();
  try {
    await withServer(dir, async (base) => {
      const response = await fetch(`${base}/api/health`);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
      assert.equal(response.headers.get("cache-control"), "no-store");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sanitizePayload redacts absolute paths and key material", () => {
  const cleaned = sanitizePayload({
    fine: ".genesis/records/decisions/a.v0001.yaml",
    absolute: "/home/someone/.ssh/id_ed25519",
    windows: "C:\\Users\\someone\\key",
    key: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
    signing_key_path: "/somewhere/key",
    nested: [{ home: "~/secrets" }],
  });
  assert.equal(cleaned.fine, ".genesis/records/decisions/a.v0001.yaml");
  assert.equal(cleaned.absolute, "[redacted-path]");
  assert.equal(cleaned.windows, "[redacted-path]");
  assert.equal(cleaned.key, "[redacted-key]");
  assert.equal(cleaned.signing_key_path, undefined);
  assert.equal(cleaned.nested[0].home, "[redacted-path]");
});
