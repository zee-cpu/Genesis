import { Link } from "react-router-dom";

import { useApi } from "../api";
import { BarChart, CommandCopy, EmptyState, ErrorPanel, Pill, Skeleton } from "../components";

interface OverviewPayload {
  workspace_ready: boolean;
  generated_at?: string;
  guidance?: { message: string; suggested_commands: string[] };
  totals: Record<string, number>;
  states: Record<string, number>;
  approval_health?: { valid?: boolean; ready?: boolean; blockers?: unknown[]; approvals?: unknown[]; [key: string]: unknown };
  sync_health?: { local_resources?: number; sync_events?: number; pending_resources?: number; conflicts?: unknown[]; ready_to_apply?: boolean };
  identity?: { configured?: boolean; valid?: boolean; principal_id?: string; active_key?: { fingerprint?: string } | null };
  projection_consistent?: boolean | null;
  sources: Record<string, string>;
}

const STATE_TONE_VARS: Record<string, string> = {
  discover: "var(--cyan)",
  approval_pending: "var(--amber)",
  approved: "var(--emerald)",
  active: "var(--cyan)",
  closed: "var(--emerald)",
  approval_denied: "var(--red)",
  approval_revoked: "var(--red)",
  superseded: "var(--red)",
};

export default function Overview() {
  const { data, error, loading } = useApi<OverviewPayload>("/api/overview");

  if (loading && !data) return <Skeleton height={360} />;
  if (error) return <ErrorPanel error={error} />;
  if (!data) return null;

  if (!data.workspace_ready) {
    return (
      <div className="panel">
        <EmptyState
          title="No Genesis workspace found here. Start one with the CLI — the console will pick it up automatically."
          commands={data.guidance?.suggested_commands ?? ["genesis start-business"]}
        />
      </div>
    );
  }

  const totals = data.totals;
  const stats: Array<{ label: string; key: string; source: string }> = [
    { label: "Opportunities", key: "opportunities", source: data.sources.totals },
    { label: "Awaiting approval", key: "awaiting_approval", source: data.sources.totals },
    { label: "In flight", key: "in_flight", source: data.sources.totals },
    { label: "Closed", key: "closed", source: data.sources.totals },
    { label: "Reviews due", key: "reviews_due", source: data.sources.totals },
    { label: "Reviews overdue", key: "reviews_overdue", source: data.sources.totals },
    { label: "Blocked", key: "blocked", source: data.sources.totals },
  ];

  const identity = data.identity;
  const sync = data.sync_health;
  const verification = data.approval_health as {
    authorizing_ready?: boolean;
    approvals?: Array<{ signed?: boolean; valid?: boolean; legacy?: boolean }>;
  } | undefined;
  const approvalsAllValid = (verification?.approvals ?? []).every((approval) => approval.valid !== false);
  const approvalsHealthy = Boolean(verification?.authorizing_ready) && approvalsAllValid;
  const conflicts = (sync?.conflicts as unknown[] | undefined)?.length ?? 0;

  return (
    <div className="panel-grid">
      <section className="panel" aria-labelledby="ov-portfolio">
        <h2 id="ov-portfolio">Portfolio</h2>
        <div className="panel-grid cols-4">
          {stats.map((stat) => (
            <div className="stat" key={stat.key}>
              <span className="value">{totals[stat.key] ?? 0}</span>
              <span className="label">{stat.label}</span>
              <span className="source" title={`Source: ${stat.source}`}>{stat.source}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="panel-grid cols-2">
        <section className="panel" aria-labelledby="ov-states">
          <h2 id="ov-states">Lifecycle states</h2>
          <BarChart
            rows={Object.entries(data.states).map(([label, count]) => ({
              label,
              count,
              tone: STATE_TONE_VARS[label] ?? "var(--cyan)",
            }))}
          />
          <p style={{ marginTop: 10 }}>
            <Link to="/opportunities">Open the opportunity explorer →</Link>
          </p>
        </section>

        <section className="panel" aria-labelledby="ov-health">
          <h2 id="ov-health">Governance health</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Pill tone={identity?.valid ? "emerald" : identity?.configured ? "red" : "amber"}>
                {identity?.valid ? "identity verified" : identity?.configured ? "identity invalid" : "identity not set up"}
              </Pill>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                {identity?.active_key?.fingerprint ?? "no active key"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Pill tone={approvalsHealthy ? "emerald" : "amber"}>
                {approvalsHealthy ? "approvals verified" : "approval verification attention"}
              </Pill>
              <span className="source">{data.sources.approval_health}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Pill tone={conflicts > 0 ? "red" : sync?.ready_to_apply ? "emerald" : "amber"}>
                {conflicts > 0 ? `${conflicts} sync conflict(s)` : sync?.ready_to_apply ? "sync ready" : "sync attention"}
              </Pill>
              <span className="source">{data.sources.sync_health}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Pill tone={data.projection_consistent === false ? "red" : "emerald"}>
                {data.projection_consistent === false ? "SQLite projection stale" : "SQLite projection consistent"}
              </Pill>
              <span className="source">rebuildable via CLI</span>
            </div>
            {data.projection_consistent === false ? (
              <CommandCopy command="genesis rebuild-index" />
            ) : null}
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              Every value above is computed by the trusted local engine, not the browser.
              {" "}<Link to="/identity">Identity audit</Link> · <Link to="/sync">Sync center</Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
