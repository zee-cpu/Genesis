import { useMemo, useState } from "react";

import { TimelineEvent, formatTime, useApi } from "../api";
import { Drawer, EmptyState, ErrorPanel, EventDetail, Pill, SignatureBadge, Skeleton } from "../components";

interface AuditPayload {
  workspace_ready: boolean;
  count: number;
  events: TimelineEvent[];
  guidance?: { message: string; suggested_commands: string[] };
}

const RECORD_TYPES = ["decision", "evidence", "experiment", "approval", "experience"];
const PRIVACY = ["public", "internal", "confidential"];

export default function Audit() {
  const [business, setBusiness] = useState("");
  const [type, setType] = useState("");
  const [actor, setActor] = useState("");
  const [signature, setSignature] = useState("");
  const [privacy, setPrivacy] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<TimelineEvent | null>(null);
  const [compareWith, setCompareWith] = useState<TimelineEvent | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (business) params.set("business", business);
    if (type) params.set("type", type);
    if (actor) params.set("actor", actor);
    if (signature) params.set("signature", signature);
    if (privacy) params.set("privacy", privacy);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const suffix = params.toString();
    return `/api/audit${suffix ? `?${suffix}` : ""}`;
  }, [business, type, actor, signature, privacy, from, to]);

  const { data, error, loading } = useApi<AuditPayload>(query);
  const businesses = useMemo(
    () => Array.from(new Set((data?.events ?? []).map((event) => event.business_id))).sort(),
    [data],
  );

  return (
    <div className="panel-grid">
      <section className="panel" aria-label="Audit filters">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Business
            <select value={business} onChange={(event) => setBusiness(event.target.value)}>
              <option value="">all</option>
              {businesses.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Type
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="">all</option>
              {RECORD_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <input
            type="search"
            placeholder="Actor…"
            aria-label="Filter by actor"
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            style={{ width: 130 }}
          />
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Signature
            <select value={signature} onChange={(event) => setSignature(event.target.value)}>
              <option value="">any</option>
              <option value="signed">signed</option>
              <option value="unsigned">unsigned</option>
            </select>
          </label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Privacy
            <select value={privacy} onChange={(event) => setPrivacy(event.target.value)}>
              <option value="">any</option>
              {PRIVACY.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            From
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" />
          </label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            To
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" />
          </label>
        </div>
      </section>

      <section className="panel" aria-label="Audit trail">
        <h2>Audit trail {data ? `(${data.count} record versions)` : ""}</h2>
        {loading && !data ? <Skeleton height={260} /> : null}
        {error ? <ErrorPanel error={error} /> : null}
        {data && !data.workspace_ready ? (
          <EmptyState title={data.guidance?.message ?? "No workspace"} commands={data.guidance?.suggested_commands} />
        ) : null}
        {data?.workspace_ready && data.count === 0 ? (
          <EmptyState title="No records match these filters." />
        ) : null}
        {data?.workspace_ready && data.count > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Business</th>
                  <th scope="col">Record</th>
                  <th scope="col">Version</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Status</th>
                  <th scope="col">Signature</th>
                  <th scope="col">Privacy</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((event) => (
                  <tr key={`${event.record_id}-v${event.version}`} onClick={() => { setSelected(event); setCompareWith(null); }}>
                    <td className="mono" style={{ fontSize: 12 }}>{formatTime(event.created_at)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{event.business_id}</td>
                    <td>
                      <button
                        type="button"
                        className="row-link"
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                        onClick={(clickEvent) => { clickEvent.stopPropagation(); setSelected(event); setCompareWith(null); }}
                      >
                        {event.record_id}
                      </button>
                      <div style={{ fontSize: 11, color: "var(--faint)" }}>{event.record_type}</div>
                    </td>
                    <td className="mono">v{event.version}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{event.actor ?? "—"}</td>
                    <td>{event.status ? <Pill>{event.status}</Pill> : "—"}</td>
                    <td><SignatureBadge event={event} /></td>
                    <td>{event.privacy_classification ? <Pill>{event.privacy_classification}</Pill> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 10 }}>
          Records are append-only. There is no edit here by design: corrections happen through the CLI as new superseding versions.
        </p>
      </section>

      {selected ? (
        <Drawer
          title={`${selected.record_id ?? selected.record_type} v${selected.version}`}
          onClose={() => { setSelected(null); setCompareWith(null); }}
        >
          {compareWith ? (
            <CompareBlock left={compareWith} right={selected} />
          ) : (
            <>
              <EventDetail event={selected} />
              {(data?.events ?? []).some((event) => event.record_id === selected.record_id && event.version !== selected.version) ? (
                <div>
                  <h3 style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Compare side-by-side with</h3>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(data?.events ?? [])
                      .filter((event) => event.record_id === selected.record_id && event.version !== selected.version)
                      .map((event) => (
                        <button key={`v${event.version}`} type="button" className="btn" onClick={() => setCompareWith(event)}>
                          v{event.version}
                        </button>
                      ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </Drawer>
      ) : null}
    </div>
  );
}

function CompareBlock({ left, right }: { left: TimelineEvent; right: TimelineEvent }) {
  const keys = Array.from(new Set([
    ...Object.keys(left.record ?? {}),
    ...Object.keys(right.record ?? {}),
  ])).sort();
  return (
    <div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
        <span className="mono">v{left.version}</span> → <span className="mono">v{right.version}</span> — changed fields highlighted.
      </p>
      <dl className="kv">
        {keys.map((key) => {
          const before = JSON.stringify((left.record as Record<string, unknown>)[key] ?? null);
          const after = JSON.stringify((right.record as Record<string, unknown>)[key] ?? null);
          const changed = before !== after;
          return (
            <div key={key} style={{ display: "contents" }}>
              <dt>{key}</dt>
              <dd>
                <span className="diff-field" data-changed={changed}>
                  {changed ? `${short(before)} → ${short(after)}` : short(after)}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function short(value: string): string {
  return value.length > 100 ? `${value.slice(0, 97)}…` : value;
}
