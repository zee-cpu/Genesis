import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { OpportunityRow, RefreshContext, formatTime, useApi, useRefreshFeed } from "./api";
import Audit from "./views/Audit";
import Identity from "./views/Identity";
import Opportunities from "./views/Opportunities";
import OpportunityDetail from "./views/OpportunityDetail";
import Overview from "./views/Overview";
import SyncCenter from "./views/SyncCenter";

type Theme = "dark" | "light";
type Density = "comfortable" | "compact";

function usePreference<T extends string>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => (localStorage.getItem(key) as T) ?? initial);
  useEffect(() => {
    localStorage.setItem(key, value);
  }, [key, value]);
  return [value, setValue];
}

const NAV = [
  { to: "/", label: "Overview", icon: "M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z" },
  { to: "/opportunities", label: "Opportunities", icon: "M4 6h16M4 12h16M4 18h10" },
  { to: "/audit", label: "Audit trail", icon: "M12 8v4l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
  { to: "/identity", label: "Identity", icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 0 2 2 4-4" },
  { to: "/sync", label: "Sync center", icon: "M3 12a9 9 0 1 0 2.6-6.4M3 3v6h6" },
];

function PaletteEntryList({ query, onPick }: { query: string; onPick: (to: string) => void }) {
  const { data } = useApi<{ opportunities: OpportunityRow[] }>("/api/opportunities");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const entries = useMemo(() => {
    const base = NAV.map((item) => ({ to: item.to, label: item.label, hint: "view" }));
    const businesses = (data?.opportunities ?? []).map((row) => ({
      to: `/opportunities/${row.business_id}`,
      label: row.business_id,
      hint: row.state,
    }));
    const all = [...base, ...businesses];
    if (!query) return all;
    return all.filter((entry) => entry.label.toLowerCase().includes(query.toLowerCase()));
  }, [data, query]);

  useEffect(() => setSelectedIndex(0), [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, entries.length - 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === "Enter" && entries[selectedIndex]) {
        onPick(entries[selectedIndex].to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entries, selectedIndex, onPick]);

  return (
    <ul role="listbox" aria-label="Navigation results">
      {entries.map((entry, index) => (
        <li key={entry.to} role="option" aria-selected={index === selectedIndex}>
          <button type="button" data-selected={index === selectedIndex} onClick={() => onPick(entry.to)}>
            <span>{entry.label}</span>
            <span className="hint">{entry.hint}</span>
          </button>
        </li>
      ))}
      {entries.length === 0 ? <li style={{ padding: 12, color: "var(--muted)", fontSize: 13 }}>No matches.</li> : null}
    </ul>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const pick = useCallback((to: string) => {
    navigate(to);
    onClose();
  }, [navigate, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="palette-scrim" onClick={onClose} aria-hidden="true" />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          autoFocus
          type="text"
          placeholder="Jump to a view or business…"
          aria-label="Search views and businesses"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <PaletteEntryList query={query} onPick={pick} />
      </div>
    </>
  );
}

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/opportunities": "Opportunity explorer",
  "/audit": "Audit trail",
  "/identity": "Approval & identity audit",
  "/sync": "Sync center",
};

export default function App() {
  const refresh = useRefreshFeed();
  const [theme, setTheme] = usePreference<Theme>("gc-theme", "dark");
  const [density, setDensity] = usePreference<Density>("gc-density", "comfortable");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = density;
  }, [theme, density]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = location.pathname.startsWith("/opportunities/")
    ? "Opportunity"
    : TITLES[location.pathname] ?? "Operator Console";

  return (
    <RefreshContext.Provider value={refresh}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">G</span>
            genesis
          </div>
          <nav aria-label="Console sections">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
              >
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={item.icon} />
                </svg>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="foot">
            <span className="readonly-badge" title="This console cannot create, change, approve, sign, or sync records. Use the Genesis CLI.">
              Read-only console
            </span>
            <span className="live-dot" data-stale={!refresh.connected} aria-live="polite">
              {refresh.connected
                ? (refresh.lastRefresh ? `refreshed ${formatTime(refresh.lastRefresh)}` : "live")
                : "reconnecting…"}
            </span>
          </div>
        </aside>

        <div className="main" id="main-content">
          <div className="main-inner">
            <div className="topbar">
              <h1>{title}</h1>
              <div className="controls">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Open command palette (Control or Command plus K)"
                >
                  ⌘K
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                >
                  {theme === "dark" ? "Light" : "Dark"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDensity(density === "comfortable" ? "compact" : "comfortable")}
                  aria-label={`Switch to ${density === "comfortable" ? "compact" : "comfortable"} density`}
                >
                  {density === "comfortable" ? "Compact" : "Comfortable"}
                </button>
              </div>
            </div>

            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/opportunities" element={<Opportunities />} />
              <Route path="/opportunities/:businessId" element={<OpportunityDetail />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/identity" element={<Identity />} />
              <Route path="/sync" element={<SyncCenter />} />
            </Routes>
          </div>
        </div>
      </div>
      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null}
    </RefreshContext.Provider>
  );
}
