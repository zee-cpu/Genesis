import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { OpportunityRow, formatTime, useApi } from "../api";
import { EmptyState, ErrorPanel, Pill, Skeleton, StatePill } from "../components";

interface ListPayload {
  workspace_ready: boolean;
  projection_consistent: boolean | null;
  count: number;
  total_count: number;
  opportunities: OpportunityRow[];
  guidance: { message: string; suggested_commands: string[] } | null;
}

const STATES = [
  "discover", "approval_pending", "approved", "active", "measurement",
  "reflection", "decision", "outcome_approved", "closed",
  "approval_denied", "approval_revoked", "superseded",
];

export default function Opportunities() {
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [review, setReview] = useState("");
  const [sort, setSort] = useState("updated_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const navigate = useNavigate();

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (state) params.set("state", state);
    if (blockedOnly) params.set("blocked", "1");
    if (review) params.set("review", review);
    params.set("sort", sort);
    params.set("order", order);
    return `/api/opportunities?${params.toString()}`;
  }, [q, state, blockedOnly, review, sort, order]);

  const { data, error, loading } = useApi<ListPayload>(query);

  return (
    <div className="panel-grid">
      <section className="panel" aria-label="Opportunity filters">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <input
            type="search"
            placeholder="Search business IDs…"
            aria-label="Search business IDs"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            style={{ flex: "1 1 200px" }}
          />
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            State
            <select value={state} onChange={(event) => setState(event.target.value)} aria-label="Filter by lifecycle state">
              <option value="">all</option>
              {STATES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Review
            <select value={review} onChange={(event) => setReview(event.target.value)} aria-label="Filter by review status">
              <option value="">any</option>
              <option value="due">due</option>
              <option value="overdue">overdue</option>
              <option value="upcoming">upcoming</option>
            </select>
          </label>
          <button
            type="button"
            className="btn"
            data-active={blockedOnly}
            aria-pressed={blockedOnly}
            onClick={() => setBlockedOnly((value) => !value)}
          >
            Blocked only
          </button>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Sort
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort field">
              <option value="updated_at">updated</option>
              <option value="review_due_at">review date</option>
              <option value="confidence">confidence</option>
              <option value="state">state</option>
              <option value="business_id">id</option>
            </select>
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => setOrder((value) => (value === "asc" ? "desc" : "asc"))}
            aria-label={`Toggle sort order, currently ${order === "asc" ? "ascending" : "descending"}`}
          >
            {order === "asc" ? "↑ asc" : "↓ desc"}
          </button>
        </div>
      </section>

      <section className="panel" aria-label="Opportunities">
        {loading && !data ? <Skeleton height={220} /> : null}
        {error ? <ErrorPanel error={error} /> : null}
        {data && !data.workspace_ready ? (
          <EmptyState
            title={data.guidance?.message ?? "No workspace"}
            commands={data.guidance?.suggested_commands}
          />
        ) : null}
        {data?.workspace_ready && data.count === 0 ? (
          <EmptyState title="No opportunities match these filters." commands={["genesis list"]} />
        ) : null}
        {data?.workspace_ready && data.count > 0 ? (
          <div className="table-wrap">
            <table>
              <caption className="skip-link">Opportunities with lifecycle state and next action</caption>
              <thead>
                <tr>
                  <th scope="col">Business</th>
                  <th scope="col">State</th>
                  <th scope="col">Confidence</th>
                  <th scope="col">Next action</th>
                  <th scope="col">Review</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Blocker</th>
                </tr>
              </thead>
              <tbody>
                {data.opportunities.map((row) => {
                  const blocker = typeof row.blocker === "string"
                    ? row.blocker
                    : row.blocker?.code ?? null;
                  return (
                    <tr
                      key={row.business_id}
                      onClick={() => navigate(`/opportunities/${row.business_id}`)}
                    >
                      <td>
                        <Link
                          className="row-link"
                          to={`/opportunities/${row.business_id}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {row.business_id}
                        </Link>
                      </td>
                      <td><StatePill state={row.state} /></td>
                      <td className="mono">{row.confidence ?? "—"}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{row.next_command ?? "—"}</td>
                      <td>
                        {row.review_status ? (
                          <Pill tone={row.review_status === "overdue" ? "red" : row.review_status === "due" ? "amber" : undefined}>
                            {row.review_status}
                          </Pill>
                        ) : "—"}
                        <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)" }}>
                          {formatTime(row.review_due_at)}
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{formatTime(row.updated_at)}</td>
                      <td>{blocker ? <Pill tone="red">{blocker}</Pill> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
