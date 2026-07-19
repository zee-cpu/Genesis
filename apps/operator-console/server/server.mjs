// Genesis Operator Console — read-only local API server.
//
// This server is a visualization layer over the Genesis engine. It exposes
// GET endpoints only, rejects every mutation method with 405, binds to
// 127.0.0.1 by default, and never writes to the Genesis workspace. All
// signature, schema, lifecycle, and projection evaluations come from the
// trusted Genesis service; the browser only renders their results.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGenesisService } from "../../../src/application/genesis-service.mjs";
import { listRecords, readRecord } from "../../../src/storage/yaml-record-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
const DIST_DIR = path.resolve(HERE, "../dist");

const BUSINESS_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ALLOWED_METHODS = new Set(["GET", "HEAD"]);

const CONTENT_TYPES = new Map(Object.entries({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
}));

/** Redact absolute filesystem paths and key material from API payloads.
 *  Workspace-relative paths (".genesis/...") are allowed; anything that
 *  looks like an absolute path or SSH key body is removed. */
export function sanitizePayload(value) {
  if (typeof value === "string") {
    if (/^(?:[A-Za-z]:[\\/]|\/|~\/)/.test(value)) return "[redacted-path]";
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return "[redacted-key]";
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/(private|signing)_?key/i.test(key) && !/fingerprint|status|valid/i.test(key)) continue;
      out[key] = sanitizePayload(item);
    }
    return out;
  }
  return value;
}

function safeHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
      + "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...extra,
  };
}

function sendJson(res, statusCode, payload, { head = false } = {}) {
  const body = JSON.stringify(sanitizePayload(payload), null, 1);
  res.writeHead(statusCode, safeHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  }));
  res.end(head ? undefined : body);
}

function errorStatusFor(code) {
  if (code === "BUSINESS_NOT_FOUND" || code === "EXPERIMENT_NOT_FOUND") return 404;
  if (code === "WORKSPACE_LOCKED") return 503;
  if (code === "INVALID_BUSINESS_ID") return 400;
  return 500;
}

function toErrorPayload(error) {
  const code = error?.code ?? "UNEXPECTED_ERROR";
  return {
    error: {
      code,
      message: error?.message ?? "Unexpected error",
      path: error?.details?.path ?? null,
      correction: error?.details?.correction
        ?? (code === "WORKSPACE_LOCKED"
          ? "Another Genesis command holds the workspace lock; retry after it finishes"
          : null),
      escalation: error?.details?.escalation ?? null,
    },
  };
}

const RECORD_STATE_FIELDS = ["status", "decision", "stance", "outcome"];

function timelineEventFromRecord(recordType, record) {
  const state = RECORD_STATE_FIELDS.map((field) => record?.[field]).find((value) => typeof value === "string") ?? null;
  return {
    record_id: record?.id ?? null,
    record_type: recordType,
    version: record?.version ?? null,
    created_at: record?.created_at ?? record?.collected_at ?? record?.issued_at ?? null,
    actor: record?.actor ?? record?.approver_principal_id ?? record?.owner ?? null,
    owner: record?.owner ?? null,
    status: state,
    privacy_classification: record?.privacy_classification ?? null,
    signature: record?.signature
      ? { present: true, principal_id: record.signature.principal_id ?? null, namespace: record.signature.namespace ?? null }
      : { present: false },
    evidence_references: record?.evidence_references ?? record?.evidence ?? null,
    immutable_history_refs: record?.immutable_history_refs ?? null,
    record,
  };
}

function sortEvents(events) {
  events.sort((a, b) => {
    const at = Date.parse(a.created_at ?? "") || 0;
    const bt = Date.parse(b.created_at ?? "") || 0;
    if (at !== bt) return at - bt;
    return (a.version ?? 0) - (b.version ?? 0);
  });
  return events;
}

/** Read every canonical record version for the timeline and audit views,
 *  using the engine's own read-only store functions. */
function readAllRecordEvents(projectRoot, businessId = null) {
  const events = [];
  for (const item of listRecords(projectRoot)) {
    const absolutePath = item.absolutePath ?? path.join(projectRoot, item.relativePath);
    let record;
    try {
      record = readRecord(absolutePath);
    } catch {
      continue; // partially written or foreign file; the CLI reports these
    }
    const owningBusiness = record?.affected_business ?? record?.business_id ?? null;
    if (businessId && owningBusiness !== businessId && !String(item.id).startsWith(`${businessId}-`)) continue;
    events.push({
      business_id: owningBusiness ?? (String(item.id).split("-").slice(0, -1).join("-") || item.id),
      path: item.relativePath ?? null,
      ...timelineEventFromRecord(item.kind, { ...record, version: record?.version ?? item.version }),
    });
  }
  return sortEvents(events);
}

export function createConsoleApp({ workspaceDir, repoRoot = REPO_ROOT, distDir = DIST_DIR }) {
  const projectRoot = path.resolve(workspaceDir);

  // Defense in depth: the console's service instance can never confirm a
  // proposal, so even a coding mistake that reached a mutation method would
  // cancel instead of writing.
  const rawService = createGenesisService({
    projectRoot,
    repoRoot,
    confirm: async () => false,
  });

  // Every Genesis operation takes an exclusive workspace lock, so concurrent
  // HTTP requests must serialize or they would starve each other out with
  // WORKSPACE_LOCKED. A caller-visible lock error then only means the CLI
  // itself is running.
  let queue = Promise.resolve();
  function serialized(fn) {
    const run = queue.then(fn, fn);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }
  const service = new Proxy(rawService, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== "function") return value;
      return (...args) => serialized(() => value.apply(target, args));
    },
  });

  const sseClients = new Set();
  let watcher = null;
  let watcherTimer = null;
  let debounceTimer = null;

  function workspaceReady() {
    return fs.existsSync(path.join(projectRoot, ".genesis", "records"));
  }

  function broadcastRefresh() {
    const frame = `event: refresh\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`;
    for (const client of sseClients) client.write(frame);
  }

  function attachWatcher() {
    if (watcher) return;
    const genesisDir = path.join(projectRoot, ".genesis");
    if (!fs.existsSync(genesisDir)) return;
    try {
      watcher = fs.watch(genesisDir, { recursive: true }, () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(broadcastRefresh, 400);
      });
      watcher.on("error", () => { watcher = null; });
    } catch {
      watcher = null;
    }
  }

  function ensureWatcherLoop() {
    attachWatcher();
    if (!watcher && !watcherTimer) {
      watcherTimer = setInterval(() => {
        attachWatcher();
        if (watcher) {
          clearInterval(watcherTimer);
          watcherTimer = null;
        }
      }, 5000);
      watcherTimer.unref?.();
    }
  }

  async function listSafe() {
    if (!workspaceReady()) {
      return { generated_at: new Date().toISOString(), projection_consistent: true, count: 0, opportunities: [], workspace_ready: false };
    }
    const result = await service.list();
    return { ...result, workspace_ready: true };
  }

  const EMPTY_GUIDANCE = {
    message: "No Genesis workspace found in this directory.",
    suggested_commands: ["genesis start-business"],
  };

  const handlers = {
    "/api/health": async () => ({
      ok: true,
      workspace_ready: workspaceReady(),
      workspace_name: path.basename(projectRoot),
      read_only: true,
      generated_at: new Date().toISOString(),
    }),

    "/api/overview": async () => {
      const list = await listSafe();
      if (!list.workspace_ready) {
        return {
          workspace_ready: false,
          guidance: EMPTY_GUIDANCE,
          totals: { opportunities: 0 },
          states: {},
          sources: { totals: "genesis list --json" },
        };
      }
      const [verify, sync, identity] = await Promise.all([
        service.verifyWorkspace(),
        service.syncStatus(),
        service.identityStatus(),
      ]);
      const states = {};
      let awaitingApproval = 0;
      let active = 0;
      let closed = 0;
      let reviewsDue = 0;
      let reviewsOverdue = 0;
      let blocked = 0;
      for (const item of list.opportunities) {
        states[item.state] = (states[item.state] ?? 0) + 1;
        if (item.state === "approval_pending") awaitingApproval += 1;
        if (["active", "measurement", "reflection", "decision", "outcome_approved"].includes(item.state)) active += 1;
        if (item.state === "closed") closed += 1;
        if (item.review_status === "due") reviewsDue += 1;
        if (item.review_status === "overdue") reviewsOverdue += 1;
        if (item.blocker) blocked += 1;
      }
      return {
        workspace_ready: true,
        generated_at: list.generated_at,
        totals: {
          opportunities: list.opportunities.length,
          awaiting_approval: awaitingApproval,
          in_flight: active,
          closed,
          reviews_due: reviewsDue,
          reviews_overdue: reviewsOverdue,
          blocked,
        },
        states,
        approval_health: sanitizePayload(verify),
        sync_health: sanitizePayload(sync),
        identity: sanitizePayload(identity),
        projection_consistent: list.projection_consistent ?? null,
        sources: {
          totals: "genesis list --json",
          approval_health: "genesis verify-workspace",
          sync_health: "genesis sync status --json",
          identity: "genesis identity status",
        },
      };
    },

    "/api/opportunities": async (query) => {
      const list = await listSafe();
      let rows = list.opportunities ?? [];
      const q = (query.get("q") ?? "").trim().toLowerCase();
      if (q) rows = rows.filter((row) => row.business_id.includes(q));
      const state = query.get("state");
      if (state) rows = rows.filter((row) => row.state === state);
      if (query.get("blocked") === "1") rows = rows.filter((row) => Boolean(row.blocker));
      const review = query.get("review");
      if (review) rows = rows.filter((row) => row.review_status === review);
      const sort = query.get("sort") ?? "updated_at";
      const order = query.get("order") === "asc" ? 1 : -1;
      const keyFor = (row) => {
        if (sort === "review_due_at") return Date.parse(row.review_due_at ?? "") || 0;
        if (sort === "confidence") return row.confidence ?? 0;
        if (sort === "state") return row.state ?? "";
        if (sort === "business_id") return row.business_id;
        return Date.parse(row.updated_at ?? "") || 0;
      };
      rows = [...rows].sort((a, b) => {
        const ka = keyFor(a);
        const kb = keyFor(b);
        if (ka < kb) return -1 * order;
        if (ka > kb) return 1 * order;
        return a.business_id.localeCompare(b.business_id);
      });
      return {
        generated_at: list.generated_at,
        workspace_ready: list.workspace_ready,
        projection_consistent: list.projection_consistent ?? null,
        count: rows.length,
        total_count: list.opportunities?.length ?? 0,
        opportunities: rows,
        guidance: list.workspace_ready ? null : EMPTY_GUIDANCE,
      };
    },

    "/api/identity": async () => {
      if (!workspaceReady()) return { workspace_ready: false, guidance: EMPTY_GUIDANCE };
      const [identity, verify] = await Promise.all([
        service.identityStatus(),
        service.verifyWorkspace(),
      ]);
      return { workspace_ready: true, identity, verification: verify };
    },

    "/api/sync": async () => {
      if (!workspaceReady()) return { workspace_ready: false, guidance: EMPTY_GUIDANCE };
      const sync = await service.syncStatus();
      return {
        workspace_ready: true,
        sync,
        suggested_commands: ["genesis sync status", "genesis sync prepare", "genesis sync apply", "genesis verify-workspace"],
      };
    },

    "/api/audit": async (query) => {
      if (!workspaceReady()) return { workspace_ready: false, events: [], guidance: EMPTY_GUIDANCE };
      const businessFilter = query.get("business");
      let rows = readAllRecordEvents(projectRoot, businessFilter || null);
      const type = query.get("type");
      if (type) rows = rows.filter((row) => row.record_type === type);
      const actor = query.get("actor");
      if (actor) rows = rows.filter((row) => (row.actor ?? "").includes(actor));
      const privacy = query.get("privacy");
      if (privacy) rows = rows.filter((row) => row.privacy_classification === privacy);
      const signature = query.get("signature");
      if (signature === "signed") rows = rows.filter((row) => row.signature?.present);
      if (signature === "unsigned") rows = rows.filter((row) => !row.signature?.present);
      const from = Date.parse(query.get("from") ?? "");
      if (Number.isFinite(from)) rows = rows.filter((row) => (Date.parse(row.created_at ?? "") || 0) >= from);
      const to = Date.parse(query.get("to") ?? "");
      if (Number.isFinite(to)) rows = rows.filter((row) => (Date.parse(row.created_at ?? "") || 0) <= to);
      rows.sort((a, b) => (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0));
      return { workspace_ready: true, count: rows.length, events: rows };
    },
  };

  async function handleBusinessRoute(businessId, tail, query) {
    if (!BUSINESS_ID_PATTERN.test(businessId)) {
      const error = new Error("Business IDs are lowercase letters, digits, and hyphens");
      error.code = "INVALID_BUSINESS_ID";
      throw error;
    }
    if (tail === "") {
      const status = await service.status(businessId);
      let review = null;
      try {
        review = await service.reviewExperiment(businessId);
      } catch (error) {
        if (error?.code !== "EXPERIMENT_NOT_FOUND") throw error;
      }
      return { business_id: businessId, status, review };
    }
    if (tail === "/timeline") {
      const report = await service.exportReport(businessId);
      return {
        business_id: businessId,
        generated_at: report.generated_at,
        lifecycle: report.lifecycle,
        events: readAllRecordEvents(projectRoot, businessId),
        audit: report.audit,
      };
    }
    if (tail === "/report") {
      return service.exportReport(businessId);
    }
    if (tail === "/next") {
      const guidance = await service.next(businessId);
      return sanitizeNext(guidance, query);
    }
    return null;
  }

  function sanitizeNext(guidance) {
    // The guided payload includes prompts/defaults for the CLI; the console
    // shows state, reasoning, and the suggested command, never an input form.
    const { defaults: _defaults, ...rest } = guidance ?? {};
    return rest;
  }

  async function apiRouter(pathname, query) {
    if (handlers[pathname]) return handlers[pathname](query);
    const match = pathname.match(/^\/api\/opportunities\/([^/]+)(\/(?:timeline|report|next))?$/);
    if (match) {
      return handleBusinessRoute(decodeURIComponent(match[1]), match[2] ?? "", query);
    }
    return null;
  }

  function serveStatic(req, res, pathname) {
    if (!fs.existsSync(distDir)) {
      const body = "Operator Console UI is not built. Run: npm run web:build";
      res.writeHead(503, safeHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    let relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    let filePath = path.resolve(distDir, relative);
    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
      sendJson(res, 400, { error: { code: "INVALID_PATH", message: "Path traversal rejected" } });
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // Single-page app fallback for client-side routes.
      filePath = path.join(distDir, "index.html");
    }
    const type = CONTENT_TYPES.get(path.extname(filePath)) ?? "application/octet-stream";
    const body = fs.readFileSync(filePath);
    res.writeHead(200, safeHeaders({
      "Content-Type": type,
      "Content-Length": body.byteLength,
      "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=3600",
    }));
    res.end(req.method === "HEAD" ? undefined : body);
  }

  async function requestListener(req, res) {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    if (!ALLOWED_METHODS.has(req.method)) {
      res.writeHead(405, safeHeaders({
        Allow: "GET, HEAD",
        "Content-Type": "application/json; charset=utf-8",
      }));
      res.end(JSON.stringify({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "The Operator Console is read-only. Use the Genesis CLI for every mutation.",
        },
      }));
      return;
    }

    if (pathname === "/api/events") {
      res.writeHead(200, safeHeaders({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      }));
      res.write(`event: hello\ndata: ${JSON.stringify({ read_only: true })}\n\n`);
      if (req.method === "HEAD") { res.end(); return; }
      sseClients.add(res);
      ensureWatcherLoop();
      const heartbeat = setInterval(() => res.write(":keepalive\n\n"), 30000);
      req.on("close", () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      });
      return;
    }

    if (pathname.startsWith("/api/")) {
      try {
        const payload = await apiRouter(pathname, url.searchParams);
        if (payload === null) {
          sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Unknown API route" } }, { head: req.method === "HEAD" });
          return;
        }
        sendJson(res, 200, payload, { head: req.method === "HEAD" });
      } catch (error) {
        sendJson(res, errorStatusFor(error?.code), toErrorPayload(error), { head: req.method === "HEAD" });
      }
      return;
    }

    serveStatic(req, res, pathname);
  }

  return {
    requestListener,
    close() {
      watcher?.close();
      if (watcherTimer) clearInterval(watcherTimer);
      clearTimeout(debounceTimer);
      for (const client of sseClients) client.end();
      sseClients.clear();
    },
  };
}

export function startConsoleServer({
  workspaceDir,
  port = 3000,
  host = "127.0.0.1",
  distDir,
  repoRoot,
} = {}) {
  const app = createConsoleApp({ workspaceDir, distDir, repoRoot });
  const server = http.createServer(app.requestListener);
  server.on("close", () => app.close());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
