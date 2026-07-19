import { useApi } from "../api";
import { CommandCopy, EmptyState, ErrorPanel, Pill, Skeleton } from "../components";
import { formatTime } from "../api";

interface IdentityPayload {
  workspace_ready: boolean;
  guidance?: { message: string; suggested_commands: string[] };
  identity?: {
    configured: boolean;
    valid: boolean;
    principal_id?: string;
    active_key?: { fingerprint?: string; public_key?: string } | null;
    events?: IdentityEvent[];
    event_count?: number;
    action_needed?: string | null;
    blocker?: { code: string; message: string } | null;
  };
  verification?: {
    authorizing_ready?: boolean;
    summary?: Record<string, unknown>;
    identity?: {
      valid?: boolean;
      events?: IdentityEvent[];
      blocker?: { code: string; message: string } | null;
    };
    approvals?: ApprovalCheck[];
  };
}

interface IdentityEvent {
  version?: number;
  action?: string;
  fingerprint?: string;
  created_at?: string;
  path?: string;
  reason?: string;
}

interface ApprovalCheck {
  id?: string;
  version?: number;
  path?: string;
  signed?: boolean;
  valid?: boolean;
  legacy?: boolean;
  code?: string | null;
  message?: string;
}

function approvalTone(approval: ApprovalCheck): { tone: string; label: string } {
  if (approval.legacy || approval.signed === false) return { tone: "amber", label: "unsigned legacy" };
  if (approval.valid === false) return { tone: "red", label: approval.code ?? "invalid" };
  if (approval.valid === true) return { tone: "emerald", label: "verified" };
  return { tone: "amber", label: approval.code ?? "attention" };
}

export default function Identity() {
  const { data, error, loading } = useApi<IdentityPayload>("/api/identity");

  if (loading && !data) return <Skeleton height={320} />;
  if (error) return <ErrorPanel error={error} />;
  if (!data) return null;
  if (!data.workspace_ready) {
    return (
      <div className="panel">
        <EmptyState title={data.guidance?.message ?? "No workspace"} commands={data.guidance?.suggested_commands} />
      </div>
    );
  }

  const identity = data.identity;
  const verification = data.verification;
  const approvals = verification?.approvals ?? [];
  const events = identity?.events ?? verification?.identity?.events ?? [];
  const approvalsAllValid = approvals.every((approval) => approval.valid !== false);
  const workspaceHealthy = Boolean(verification?.authorizing_ready) && approvalsAllValid;

  return (
    <div className="panel-grid">
      <section className="panel" aria-label="Human Authority identity">
        <h2>Human Authority identity</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Pill tone={identity?.valid ? "emerald" : identity?.configured ? "red" : "amber"}>
              {identity?.valid ? "verified" : identity?.configured ? "invalid" : "missing identity"}
            </Pill>
            <span className="mono" style={{ fontSize: 13 }}>{identity?.principal_id ?? "genesis-owner"}</span>
          </div>
          <dl className="kv">
            <div style={{ display: "contents" }}>
              <dt>Active SSH fingerprint</dt>
              <dd>{identity?.active_key?.fingerprint ?? "none — new approvals are blocked"}</dd>
            </div>
            <div style={{ display: "contents" }}>
              <dt>Identity events</dt>
              <dd>{identity?.event_count ?? events.length}</dd>
            </div>
            <div style={{ display: "contents" }}>
              <dt>Action needed</dt>
              <dd>{identity?.action_needed ?? "none"}</dd>
            </div>
          </dl>
          {!identity?.configured ? <CommandCopy command="genesis identity setup" /> : null}
          {identity?.blocker ? (
            <p><Pill tone="red">{identity.blocker.code}</Pill> <span style={{ fontSize: 13 }}>{identity.blocker.message}</span></p>
          ) : null}
          <p style={{ fontSize: 12, color: "var(--faint)" }}>
            Private keys never enter this console. Only fingerprints and verification results computed by the local engine are shown.
          </p>
        </div>
      </section>

      {events.length > 0 ? (
        <section className="panel" aria-label="Identity event chain">
          <h2>Append-only identity chain</h2>
          <ol className="timeline" style={{ listStyle: "none" }}>
            {events.map((event, index) => (
              <li className="timeline-event" data-kind="approval" key={index}>
                <div className="event-card" style={{ cursor: "default" }}>
                  <span className="event-time">{formatTime(event.created_at)}</span>
                  <span className="event-title">{event.action ?? "identity event"} <span className="mono">v{event.version ?? index + 1}</span></span>
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>{event.fingerprint}</span>
                  {event.reason ? <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{event.reason}</span> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="panel" aria-label="Approval signature audit">
        <h2>Approval signature audit</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Pill tone={workspaceHealthy ? "emerald" : "amber"}>
            {workspaceHealthy ? "workspace verification passed" : "verification attention"}
          </Pill>
          <span className="source" style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--faint)" }}>
            source: genesis verify-workspace
          </span>
        </div>
        {approvals.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No runtime approval records to audit yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Approval record</th>
                  <th scope="col">Version</th>
                  <th scope="col">Signature</th>
                  <th scope="col">Engine result</th>
                  <th scope="col">Path</th>
                </tr>
              </thead>
              <tbody>
                {approvals.map((approval, index) => {
                  const { tone, label } = approvalTone(approval);
                  return (
                    <tr key={index} style={{ cursor: "default" }}>
                      <td className="mono" style={{ fontSize: 12 }}>{approval.id ?? `#${index + 1}`}</td>
                      <td className="mono">v{approval.version ?? "?"}</td>
                      <td><Pill tone={tone}>{label}</Pill></td>
                      <td style={{ fontSize: 12.5 }}>{approval.message ?? "—"}</td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--faint)" }}>{approval.path ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <CommandCopy command="genesis verify-workspace" />
        </div>
      </section>
    </div>
  );
}
