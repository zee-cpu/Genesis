// Shared presentational components for the Operator Console.
import { ReactNode, useEffect, useRef, useState } from "react";

import { TimelineEvent, formatTime, stateTone } from "./api";

export function Pill({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className="pill" data-tone={tone}>{children}</span>;
}

export function StatePill({ state }: { state: string | null | undefined }) {
  if (!state) return <Pill>unknown</Pill>;
  return <Pill tone={stateTone(state)}>{state}</Pill>;
}

/** The only "action" in this console: copy a CLI command to the clipboard. */
export function CommandCopy({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="cmd-copy">
      <span className="cmd">{command}</span>
      <button
        type="button"
        aria-label={`Copy CLI command: ${command}`}
        onClick={() => {
          navigator.clipboard.writeText(command).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? "copied" : "Copy CLI command"}
      </button>
    </span>
  );
}

export function Skeleton({ height = 120 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} aria-hidden="true" />;
}

export function EmptyState({ title, commands }: { title: string; commands?: string[] }) {
  return (
    <div className="empty" role="status">
      <p>{title}</p>
      {commands?.map((command) => <CommandCopy key={command} command={command} />)}
    </div>
  );
}

export function ErrorPanel({ error }: { error: { message: string; detail?: unknown } | { status: number; detail: { message?: string; correction?: string | null } | null } }) {
  const detail = "detail" in error ? error.detail as { message?: string; correction?: string | null } | null : null;
  return (
    <div className="panel" role="alert">
      <h3>Problem loading data</h3>
      <p>{detail?.message ?? ("message" in error ? error.message : "Request failed")}</p>
      {detail?.correction ? <p style={{ color: "var(--muted)", marginTop: 6 }}>{detail.correction}</p> : null}
    </div>
  );
}

export function SignatureBadge({ event }: { event: Pick<TimelineEvent, "record_type" | "signature"> }) {
  if (event.record_type !== "approval") return null;
  if (event.signature?.present) return <Pill tone="emerald">signed</Pill>;
  return <Pill tone="amber">unsigned legacy</Pill>;
}

/** Accessible horizontal bar chart with a text summary for screen readers. */
export function BarChart({ rows, tone = "var(--cyan)" }: { rows: Array<{ label: string; count: number; tone?: string }>; tone?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  const summary = rows.map((row) => `${row.label}: ${row.count}`).join(", ");
  return (
    <div role="img" aria-label={`Distribution — ${summary}`}>
      {rows.map((row) => (
        <div className="bar-row" key={row.label}>
          <span className="bar-label">{row.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(row.count / max) * 100}%`, background: row.tone ?? tone }} />
          </span>
          <span className="bar-count">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

/** Confidence history sparkline with text alternative. */
export function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return null;
  const width = 160;
  const height = 36;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const y = (value: number) => height - ((value - min) / (max - min || 1)) * (height - 6) - 3;
  const points = values.map((value, index) => `${index * step},${y(value)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <span role="img" aria-label={`Confidence history: ${values.join(", ")} — now ${last}`}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <polyline points={points} fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={(values.length - 1) * step} cy={y(last)} r="3" fill="var(--cyan)" />
      </svg>
    </span>
  );
}

/** Side drawer with focus management and Escape-to-close. */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h3>{title}</h3>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </header>
        <div className="body">{children}</div>
      </aside>
    </>
  );
}

const HIDDEN_DETAIL_KEYS = new Set(["record"]);

export function EventDetail({ event }: { event: TimelineEvent }) {
  const entries: Array<[string, ReactNode]> = [
    ["Record ID", event.record_id],
    ["Record type", event.record_type],
    ["Version", event.version],
    ["Timestamp", formatTime(event.created_at)],
    ["Actor", event.actor ?? "—"],
    ["Owner", event.owner ?? "—"],
    ["Status", event.status ?? "—"],
    ["Privacy class", event.privacy_classification ?? "—"],
    ["Path", event.path ?? "—"],
  ];
  return (
    <>
      <dl className="kv">
        {entries.map(([key, value]) => (
          <div key={key} style={{ display: "contents" }}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div style={{ display: "contents" }}>
          <dt>Signature</dt>
          <dd>
            {event.record_type === "approval"
              ? (event.signature?.present
                  ? `signed by ${event.signature.principal_id ?? "unknown"} (${event.signature.namespace ?? ""})`
                  : "unsigned legacy record — evidence only, grants no authority")
              : "not applicable"}
          </dd>
        </div>
      </dl>
      {event.evidence_references?.length ? (
        <div>
          <h3 style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Evidence references</h3>
          <ul style={{ paddingLeft: 18, fontFamily: "var(--mono)", fontSize: 12 }}>
            {event.evidence_references.map((reference) => <li key={reference}>{reference}</li>)}
          </ul>
        </div>
      ) : null}
      {event.immutable_history_refs?.length ? (
        <div>
          <h3 style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Immutable history</h3>
          <ul style={{ paddingLeft: 18, fontFamily: "var(--mono)", fontSize: 12 }}>
            {event.immutable_history_refs.map((reference) => <li key={reference}>{reference}</li>)}
          </ul>
        </div>
      ) : null}
      <details className="raw">
        <summary>Complete record ({Object.keys(event.record ?? {}).filter((key) => !HIDDEN_DETAIL_KEYS.has(key)).length} fields)</summary>
        <pre>{JSON.stringify(event.record, null, 2)}</pre>
      </details>
    </>
  );
}
