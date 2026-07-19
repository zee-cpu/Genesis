// Read-only API client. Every call is a GET to the local console server;
// there are no mutation helpers by design.
import { createContext, useContext, useEffect, useRef, useState } from "react";

export interface OpportunityRow {
  business_id: string;
  state: string;
  projected_state: string;
  confidence: number | null;
  updated_at: string | null;
  guided_action: string | null;
  next_command: string | null;
  review_type: string | null;
  review_due_at: string | null;
  review_status: string | null;
  blocker: { code?: string; message?: string } | string | null;
}

export interface TimelineEvent {
  business_id: string;
  path: string | null;
  record_id: string | null;
  record_type: string;
  version: number | null;
  created_at: string | null;
  actor: string | null;
  owner: string | null;
  status: string | null;
  privacy_classification: string | null;
  signature: { present: boolean; principal_id?: string | null; namespace?: string | null };
  evidence_references: string[] | null;
  immutable_history_refs: string[] | null;
  record: Record<string, unknown>;
}

export interface ApiError {
  code: string;
  message: string;
  correction?: string | null;
  escalation?: string | null;
}

export class RequestError extends Error {
  status: number;
  detail: ApiError | null;
  constructor(status: number, detail: ApiError | null) {
    super(detail?.message ?? `Request failed with ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: "GET" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RequestError(response.status, body?.error ?? null);
  }
  return body as T;
}

/** Bumps whenever the server reports that canonical records changed. */
export const RefreshContext = createContext<{ version: number; lastRefresh: string | null; connected: boolean }>({
  version: 0,
  lastRefresh: null,
  connected: false,
});

export function useRefreshFeed() {
  const [state, setState] = useState({ version: 0, lastRefresh: null as string | null, connected: false });
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("hello", () => {
      setState((prev) => ({ ...prev, connected: true }));
    });
    source.addEventListener("refresh", () => {
      setState((prev) => ({
        version: prev.version + 1,
        lastRefresh: new Date().toISOString(),
        connected: true,
      }));
    });
    source.onerror = () => setState((prev) => ({ ...prev, connected: false }));
    return () => source.close();
  }, []);
  return state;
}

export interface Loadable<T> {
  data: T | null;
  error: RequestError | null;
  loading: boolean;
  reload: () => void;
}

/** Fetch on mount and whenever the workspace refresh feed fires. */
export function useApi<T>(path: string | null): Loadable<T> {
  const { version } = useContext(RefreshContext);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [manual, setManual] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    getJson<T>(path)
      .then((payload) => {
        if (!cancelled && alive.current) {
          setData(payload);
          setError(null);
        }
      })
      .catch((requestError: RequestError) => {
        if (!cancelled && alive.current) setError(requestError);
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [path, version, manual]);

  return { data, error, loading, reload: () => setManual((n) => n + 1) };
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  return new Date(time).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export const STATE_TONES: Record<string, string> = {
  discover: "cyan",
  approval_pending: "amber",
  approved: "emerald",
  active: "cyan",
  measurement: "cyan",
  reflection: "cyan",
  decision: "violet",
  outcome_approved: "emerald",
  closed: "emerald",
  approval_denied: "red",
  approval_revoked: "red",
  approval_invalid: "red",
  superseded: "red",
};

export function stateTone(state: string | null | undefined): string {
  return (state && STATE_TONES[state]) || "cyan";
}
