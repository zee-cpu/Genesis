import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { TimelineEvent, formatTime, useApi } from "../api";
import {
  CommandCopy, Drawer, EmptyState, ErrorPanel, EventDetail, Pill,
  SignatureBadge, Skeleton, Sparkline, StatePill,
} from "../components";

interface DetailPayload {
  business_id: string;
  status: {
    state: string;
    next_command: string | null;
    evidence_count: number;
    decision_versions: number;
    experiment_versions: number;
    approval_versions: number;
    limits: Record<string, unknown> | null;
    approval: Record<string, unknown> | null;
    approval_validity: { valid: boolean; blockers: Array<{ code: string; message: string }> } | null;
    approval_signature_validity: { valid?: boolean; reason?: string } | null;
    projection_consistent: boolean;
    metrics: {
      supporting_evidence_count: number;
      contradicting_evidence_count: number;
      confidence_history: number[];
      preregistration_completeness: number;
    };
  };
  review: {
    experiment: Record<string, unknown>;
    approval: Record<string, unknown> | null;
    approval_history: Array<Record<string, unknown>>;
    approval_validity: { valid: boolean; blockers: Array<{ code: string; message: string }> };
  } | null;
}

interface TimelinePayload {
  business_id: string;
  lifecycle: { state: string; metrics: Record<string, unknown> };
  events: TimelineEvent[];
}

interface NextPayload {
  business_id: string;
  state: string;
  projected_state: string;
  action?: string | null;
  message?: string | null;
  cli_command?: string | null;
  command?: string | null;
  blocker?: { code?: string; message?: string; correction?: string } | null;
  status?: { next_command?: string | null };
}

const TABS = ["timeline", "experiment", "evidence", "approvals"] as const;
type Tab = typeof TABS[number];

export default function OpportunityDetail() {
  const { businessId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (TABS.includes(searchParams.get("tab") as Tab) ? searchParams.get("tab") : "timeline") as Tab;
  const [selected, setSelected] = useState<TimelineEvent | null>(null);
  const [compareWith, setCompareWith] = useState<TimelineEvent | null>(null);

  const detail = useApi<DetailPayload>(`/api/opportunities/${businessId}`);
  const timeline = useApi<TimelinePayload>(`/api/opportunities/${businessId}/timeline`);
  const next = useApi<NextPayload>(`/api/opportunities/${businessId}/next`);

  const events = timeline.data?.events ?? [];
  const evidenceEvents = useMemo(() => events.filter((event) => event.record_type === "evidence"), [events]);
  const approvalEvents = useMemo(() => events.filter((event) => event.record_type === "approval"), [events]);
  const experiment = detail.data?.review?.experiment ?? null;

  if (detail.error?.status === 404) {
    return (
      <div className="panel">
        <EmptyState title={`No business named “${businessId}” exists in this workspace.`} commands={["genesis list"]} />
      </div>
    );
  }
  if (detail.error) return <ErrorPanel error={detail.error} />;
  if (!detail.data) return <Skeleton height={420} />;

  const status = detail.data.status;
  const nextCommand = nextCliCommand(next.data, businessId, status.next_command);

  return (
    <div className="panel-grid">
      <section className="panel" aria-label="Opportunity summary">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <h2 style={{ all: "unset", fontFamily: "var(--mono)", fontSize: 18, fontWeight: 700 }}>{businessId}</h2>
          <StatePill state={status.state} />
          {status.projection_consistent === false ? <Pill tone="red">projection stale</Pill> : null}
          <span style={{ marginLeft: "auto" }}>
            <Link to="/opportunities">← All opportunities</Link>
          </span>
        </div>

        <div className="panel-grid cols-4" style={{ marginTop: 14 }}>
          <div className="stat">
            <span className="value">{status.evidence_count}</span>
            <span className="label">
              evidence ({status.metrics.supporting_evidence_count} support / {status.metrics.contradicting_evidence_count} contradict)
            </span>
          </div>
          <div className="stat">
            <span className="value">{status.decision_versions}</span>
            <span className="label">decision versions</span>
          </div>
          <div className="stat">
            <span className="value">{status.experiment_versions}</span>
            <span className="label">experiment versions</span>
          </div>
          <div className="stat">
            <Sparkline values={status.metrics.confidence_history ?? []} />
            <span className="label">confidence history</span>
          </div>
        </div>
      </section>

      <section className="panel" aria-label="Guided next action">
        <h2>Guided next action</h2>
        {next.data ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p>
              <strong>{next.data.message ?? "State evaluated by the engine."}</strong>
            </p>
            <p style={{ color: "var(--muted)", fontSize: 13 }}>
              Current state <span className="mono">{next.data.state}</span>
              {next.data.action ? <> · guided action <span className="mono">{String(next.data.action)}</span></> : null}
            </p>
            {next.data.blocker?.code ? (
              <p>
                <Pill tone="red">{next.data.blocker.code}</Pill>{" "}
                <span style={{ fontSize: 13 }}>{next.data.blocker.message ?? ""} {next.data.blocker.correction ?? ""}</span>
              </p>
            ) : null}
            {nextCommand ? <CommandCopy command={nextCommand} /> : null}
            <p style={{ fontSize: 12, color: "var(--faint)" }}>
              The console never runs commands. Copy this into your terminal; the CLI keeps its own preview and confirmation.
            </p>
          </div>
        ) : next.error ? <ErrorPanel error={next.error} /> : <Skeleton height={80} />}
      </section>

      <nav aria-label="Detail sections" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            className="btn"
            data-active={tab === name}
            aria-pressed={tab === name}
            onClick={() => setSearchParams({ tab: name })}
          >
            {name}
          </button>
        ))}
      </nav>

      {tab === "timeline" ? (
        <section className="panel" aria-label="Lifecycle timeline">
          <h2>Lifecycle timeline</h2>
          {timeline.loading && !timeline.data ? <Skeleton height={200} /> : null}
          {timeline.error ? <ErrorPanel error={timeline.error} /> : null}
          <ol className="timeline" style={{ listStyle: "none" }}>
            {events.map((event) => (
              <li className="timeline-event" data-kind={event.record_type} key={`${event.record_id}-v${event.version}`}>
                <button type="button" className="event-card" onClick={() => { setSelected(event); setCompareWith(null); }}>
                  <span className="event-time">{formatTime(event.created_at)}</span>
                  <span className="event-title">{event.record_type} <span className="mono">v{event.version}</span></span>
                  {event.status ? <Pill tone={toneForEvent(event)}>{event.status}</Pill> : null}
                  <SignatureBadge event={event} />
                  {event.privacy_classification ? <Pill>{event.privacy_classification}</Pill> : null}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {tab === "experiment" ? (
        <section className="panel" aria-label="Experiment">
          <h2>Experiment preregistration and outcome</h2>
          {experiment ? <ExperimentView experiment={experiment} /> : (
            <EmptyState title="No experiment exists yet for this opportunity." commands={[`genesis plan-experiment ${businessId}`]} />
          )}
        </section>
      ) : null}

      {tab === "evidence" ? (
        <section className="panel" aria-label="Evidence">
          <h2>Evidence and counterevidence</h2>
          <EvidenceView events={evidenceEvents} onSelect={(event) => { setSelected(event); setCompareWith(null); }} />
        </section>
      ) : null}

      {tab === "approvals" ? (
        <section className="panel" aria-label="Approvals">
          <h2>Approval history</h2>
          <ApprovalsView
            events={approvalEvents}
            validity={detail.data.review?.approval_validity ?? status.approval_validity}
            signatureValidity={status.approval_signature_validity}
            onSelect={(event) => { setSelected(event); setCompareWith(null); }}
          />
        </section>
      ) : null}

      {selected ? (
        <Drawer
          title={`${selected.record_id ?? selected.record_type} v${selected.version}`}
          onClose={() => { setSelected(null); setCompareWith(null); }}
        >
          {compareWith ? (
            <VersionCompare left={compareWith} right={selected} />
          ) : (
            <>
              <EventDetail event={selected} />
              {events.some((event) => event.record_id === selected.record_id && event.version !== selected.version) ? (
                <div>
                  <h3 style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Compare with version</h3>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {events
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

function nextCliCommand(payload: NextPayload | null, businessId: string, fallback: string | null): string | null {
  if (payload?.cli_command) return payload.cli_command;
  if (payload?.command) return String(payload.command);
  const command = fallback ?? payload?.status?.next_command;
  if (!command) return null;
  const noArgument = new Set(["list", "rebuild-index"]);
  return noArgument.has(command) ? `genesis ${command}` : `genesis ${command} ${businessId}`;
}

function toneForEvent(event: TimelineEvent): string {
  const value = event.status ?? "";
  if (["approved", "active", "completed", "passed", "support", "closed"].includes(value)) return "emerald";
  if (["denied", "revoked", "superseded", "failed", "contradict"].includes(value)) return "red";
  if (["draft", "approval_pending", "pending"].includes(value)) return "amber";
  return "cyan";
}

function ExperimentView({ experiment }: { experiment: Record<string, unknown> }) {
  const limits = (experiment.limits ?? {}) as Record<string, unknown>;
  const actual = (experiment.actual ?? experiment.execution ?? {}) as Record<string, unknown>;
  const measurement = (experiment.measurement ?? {}) as Record<string, unknown>;
  const calculation = (experiment.measurement_calculation ?? {}) as Record<string, unknown>;

  const planned: Array<[string, unknown]> = [
    ["Hypothesis", experiment.hypothesis],
    ["Baseline", experiment.baseline],
    ["Metric formula", experiment.metric_formula ?? experiment.metric],
    ["Population", experiment.population],
    ["Denominator", experiment.denominator],
    ["Data source", experiment.data_source],
    ["Minimum meaningful effect", experiment.minimum_meaningful_effect ?? experiment.expected_outcome],
    ["Evaluation criteria", experiment.evaluation_criteria ?? experiment.success_condition],
    ["Failure condition", experiment.failure_condition],
    ["Stop conditions", experiment.stop_conditions],
    ["Max cash (USD)", limits.cash_usd],
    ["Max labor (hours)", limits.labor_hours],
    ["Max duration (days)", limits.duration_days],
    ["Data classes", limits.data_classes],
    ["Risk level", limits.risk_level],
  ];

  const actuals: Array<[string, unknown]> = [
    ["Status", experiment.status],
    ["Actual cash (USD)", actual.cash_usd ?? actual.actual_cash_usd],
    ["Actual labor (hours)", actual.labor_hours ?? actual.actual_labor_hours],
    ["Execution summary", actual.summary ?? experiment.execution_summary],
    ["Observed result", measurement.observed_result ?? experiment.observed_result],
    ["Calculated value", calculation.observed_value],
    ["Calculated outcome", calculation.calculated_outcome],
    ["Threshold met", calculation.threshold_met],
    ["Comparison", measurement.comparison ?? experiment.comparison],
    ["Data quality", measurement.data_quality ?? experiment.data_quality],
    ["Limitations", measurement.limitations ?? experiment.limitations],
    ["Confidence update", experiment.confidence_update],
    ["Outcome", experiment.outcome ?? experiment.decision_outcome],
  ];

  return (
    <div className="compare-grid">
      <div>
        <h3 style={{ fontSize: 12, color: "var(--cyan)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Planned (preregistered)</h3>
        <FieldList fields={planned} />
      </div>
      <div>
        <h3 style={{ fontSize: 12, color: "var(--violet)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Actual (recorded)</h3>
        <FieldList fields={actuals} />
      </div>
    </div>
  );
}

function FieldList({ fields }: { fields: Array<[string, unknown]> }) {
  return (
    <dl className="kv">
      {fields.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => (
        <div key={key} style={{ display: "contents" }}>
          <dt>{key}</dt>
          <dd>{Array.isArray(value) ? value.join(", ") : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function EvidenceView({ events, onSelect }: { events: TimelineEvent[]; onSelect: (event: TimelineEvent) => void }) {
  const [query, setQuery] = useState("");
  const filtered = events.filter((event) => {
    if (!query) return true;
    const record = event.record as { summary?: string; source_reference?: string };
    return `${record.summary ?? ""} ${record.source_reference ?? ""}`.toLowerCase().includes(query.toLowerCase());
  });
  const support = filtered.filter((event) => event.status === "support");
  const contradict = filtered.filter((event) => event.status !== "support");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <input
        type="search"
        placeholder="Literal search in summaries and sources…"
        aria-label="Search evidence"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="compare-grid">
        <EvidenceColumn title="Supporting" tone="emerald" events={support} onSelect={onSelect} />
        <EvidenceColumn title="Contradicting" tone="red" events={contradict} onSelect={onSelect} />
      </div>
      <p style={{ fontSize: 12, color: "var(--faint)" }}>
        Evidence informs decisions; retrieved content is never authority. Contradicting evidence is preserved as data, not failure.
      </p>
    </div>
  );
}

function EvidenceColumn({ title, tone, events, onSelect }: {
  title: string; tone: string; events: TimelineEvent[]; onSelect: (event: TimelineEvent) => void;
}) {
  return (
    <div>
      <h3 style={{ fontSize: 12, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em", color: `var(--${tone === "emerald" ? "emerald" : "red"})` }}>
        {title} ({events.length})
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {events.length === 0 ? <p style={{ color: "var(--faint)", fontSize: 13 }}>None recorded.</p> : null}
        {events.map((event) => {
          const record = event.record as { summary?: string; source_reference?: string; provenance?: string; collected_at?: string };
          return (
            <button
              key={`${event.record_id}-v${event.version}`}
              type="button"
              className="event-card"
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", textAlign: "left", cursor: "pointer", background: "var(--panel)", display: "block" }}
              onClick={() => onSelect(event)}
            >
              <div style={{ fontSize: 13, marginBottom: 4 }}>{record.summary ?? event.record_id}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--faint)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span>{record.source_reference}</span>
                <span>{record.provenance}</span>
                <span>{formatTime(record.collected_at ?? event.created_at)}</span>
                {event.privacy_classification ? <Pill>{event.privacy_classification}</Pill> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ApprovalsView({ events, validity, signatureValidity, onSelect }: {
  events: TimelineEvent[];
  validity: { valid: boolean; blockers: Array<{ code: string; message: string }> } | null;
  signatureValidity: { valid?: boolean; reason?: string } | null;
  onSelect: (event: TimelineEvent) => void;
}) {
  if (events.length === 0) {
    return <EmptyState title="No approval records exist yet." />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {validity ? (
          <Pill tone={validity.valid ? "emerald" : "red"}>
            {validity.valid ? "latest approval valid" : "latest approval not valid"}
          </Pill>
        ) : null}
        {signatureValidity ? (
          <Pill tone={signatureValidity.valid ? "emerald" : "amber"}>
            {signatureValidity.valid ? "signature verified" : signatureValidity.reason ?? "signature attention"}
          </Pill>
        ) : null}
        {validity?.blockers?.map((blocker) => (
          <Pill key={blocker.code} tone="red">{blocker.code}</Pill>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {events.map((event) => {
          const record = event.record as {
            decision?: string; approver_principal_id?: string; actor?: string;
            effective_at?: string; expires_at?: string; revoked?: boolean; rationale?: string;
            scope?: { actions?: string[] };
            limits?: Record<string, unknown>;
          };
          const tone = record.revoked ? "red" : record.decision === "approved" ? "emerald" : record.decision === "denied" ? "red" : "amber";
          return (
            <button
              key={`${event.record_id}-v${event.version}`}
              type="button"
              className="event-card"
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", textAlign: "left", cursor: "pointer", background: "var(--panel)", display: "block" }}
              onClick={() => onSelect(event)}
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                <span className="event-title">v{event.version} — {record.decision ?? "?"}</span>
                <Pill tone={tone}>{record.revoked ? "revoked" : record.decision ?? "?"}</Pill>
                <SignatureBadge event={event} />
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>by {record.approver_principal_id}</span>
                <span>actor {record.actor}</span>
                <span>effective {formatTime(record.effective_at)}</span>
                <span>expires {formatTime(record.expires_at)}</span>
              </div>
              {record.rationale ? <p style={{ fontSize: 12.5, marginTop: 6, color: "var(--muted)" }}>{record.rationale}</p> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VersionCompare({ left, right }: { left: TimelineEvent; right: TimelineEvent }) {
  const keys = Array.from(new Set([
    ...Object.keys(left.record ?? {}),
    ...Object.keys(right.record ?? {}),
  ])).sort();
  return (
    <div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
        Comparing <span className="mono">v{left.version}</span> → <span className="mono">v{right.version}</span>.
        Changed fields are highlighted. Records are immutable: newer versions supersede, never replace.
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
                  {changed ? `${truncate(before)} → ${truncate(after)}` : truncate(after)}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function truncate(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}…` : value;
}
