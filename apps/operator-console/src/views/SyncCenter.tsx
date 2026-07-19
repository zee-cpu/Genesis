import { useApi } from "../api";
import { CommandCopy, EmptyState, ErrorPanel, Pill, Skeleton } from "../components";

interface SyncPayload {
  workspace_ready: boolean;
  guidance?: { message: string; suggested_commands: string[] };
  sync?: {
    local_resources: number;
    sync_events: number;
    missing_events: number;
    pending_resources: number;
    conflicts: Array<{
      logical_path?: string;
      path?: string;
      digests?: string[];
      candidates?: Array<{ digest?: string }>;
      reason?: string;
    }>;
    ready_to_apply: boolean;
  };
  suggested_commands?: string[];
}

export default function SyncCenter() {
  const { data, error, loading } = useApi<SyncPayload>("/api/sync");

  if (loading && !data) return <Skeleton height={280} />;
  if (error) return <ErrorPanel error={error} />;
  if (!data) return null;
  if (!data.workspace_ready) {
    return (
      <div className="panel">
        <EmptyState title={data.guidance?.message ?? "No workspace"} commands={data.guidance?.suggested_commands} />
      </div>
    );
  }

  const sync = data.sync!;
  const conflicts = sync.conflicts ?? [];

  return (
    <div className="panel-grid">
      <section className="panel" aria-label="Sync state">
        <h2>Conflict-safe sync state</h2>
        <div className="panel-grid cols-4">
          <div className="stat">
            <span className="value">{sync.local_resources}</span>
            <span className="label">local canonical resources</span>
            <span className="source">genesis sync status --json</span>
          </div>
          <div className="stat">
            <span className="value">{sync.sync_events}</span>
            <span className="label">content-addressed events</span>
            <span className="source">.genesis/sync/events</span>
          </div>
          <div className="stat">
            <span className="value">{sync.missing_events}</span>
            <span className="label">local resources awaiting preparation</span>
            <span className="source">genesis sync prepare</span>
          </div>
          <div className="stat">
            <span className="value">{sync.pending_resources}</span>
            <span className="label">incoming resources ready to apply</span>
            <span className="source">genesis sync apply</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <Pill tone={conflicts.length > 0 ? "red" : "emerald"}>
            {conflicts.length > 0 ? `${conflicts.length} conflict(s)` : "no conflicts"}
          </Pill>
          <Pill tone={sync.ready_to_apply ? "emerald" : "amber"}>
            {sync.ready_to_apply ? "ready to apply" : "not ready to apply"}
          </Pill>
        </div>
      </section>

      <section className="panel" aria-label="Suggested commands">
        <h2>Suggested CLI commands</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          The console never executes sync. Run these in the workspace directory; each shows its own preview and confirmation.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          {(data.suggested_commands ?? []).map((command) => <CommandCopy key={command} command={command} />)}
        </div>
      </section>

      {conflicts.length > 0 ? (
        <section className="panel" aria-label="Sync conflicts">
          <h2>Conflicts — Human Authority reconciliation required</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {conflicts.map((conflict, index) => (
              <div key={index} style={{ border: "1px solid color-mix(in srgb, var(--red) 40%, transparent)", background: "var(--red-dim)", borderRadius: 8, padding: 14 }}>
                <div className="mono" style={{ fontSize: 12.5, marginBottom: 6 }}>
                  {conflict.logical_path ?? conflict.path ?? "unknown logical path"}
                </div>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>
                  {(conflict.digests ?? conflict.candidates?.map((candidate) => candidate.digest) ?? [])
                    .filter(Boolean)
                    .map((digest) => <div key={String(digest)}>candidate digest: {String(digest)}</div>)}
                </div>
                <p style={{ fontSize: 13 }}>
                  {conflict.reason ?? "Two peers created different payloads for the same immutable logical version."}
                </p>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
                  Genesis selected no winner. Both events are preserved. Escalate to <strong>Human Authority</strong> for a separate reconciliation decision.
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
