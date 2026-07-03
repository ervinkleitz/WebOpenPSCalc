import { useState, useEffect, useCallback } from "react";
import { statsApi } from "../api/client";

const SESSION_KEY = "stats_password";

interface DayEntry { date: string; views: number; calcs: number; }
interface JobEntry  { job_id: number; name: string; count: number; }
interface SkillEntry{ skill_id: number; name: string; count: number; }
interface CountryEntry { country: string; count: number; }
interface StatsData {
  total_views: number;
  total_calcs: number;
  unique_ips: number;
  by_day: DayEntry[];
  top_jobs: JobEntry[];
  top_skills: SkillEntry[];
  countries: CountryEntry[];
  from_ts: number;
  to_ts: number;
}

type Preset = "7" | "30" | "0" | "custom";

function BarChart({ days, maxVal }: { days: DayEntry[]; maxVal: number }) {
  const [tooltip, setTooltip] = useState<{ day: DayEntry; x: number; y: number } | null>(null);

  if (!days.length) return <p className="stats-empty">No data for this period.</p>;

  return (
    <div className="stats-chart" onMouseLeave={() => setTooltip(null)}>
      {days.map((d) => (
        <div
          key={d.date}
          className={`stats-chart-col${tooltip?.day.date === d.date ? " stats-chart-col--hover" : ""}`}
          onMouseEnter={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTooltip({ day: d, x: r.left + r.width / 2, y: r.top });
          }}
        >
          <div className="stats-chart-bars">
            <div
              className="stats-bar stats-bar--views"
              style={{ height: maxVal > 0 ? `${(d.views / maxVal) * 100}%` : "0%" }}
            />
            <div
              className="stats-bar stats-bar--calcs"
              style={{ height: maxVal > 0 ? `${(d.calcs / maxVal) * 100}%` : "0%" }}
            />
          </div>
          <div className="stats-chart-label">{d.date.slice(5)}</div>
        </div>
      ))}

      {tooltip && (
        <div
          className="stats-tooltip"
          style={{ left: tooltip.x, top: tooltip.y - 8 }}
        >
          <div className="stats-tooltip-date">{tooltip.day.date}</div>
          <div className="stats-tooltip-row">
            <span className="stats-tooltip-dot stats-tooltip-dot--views" />
            <span>Views</span>
            <span className="stats-tooltip-val">{tooltip.day.views.toLocaleString()}</span>
          </div>
          <div className="stats-tooltip-row">
            <span className="stats-tooltip-dot stats-tooltip-dot--calcs" />
            <span>Calcs</span>
            <span className="stats-tooltip-val">{tooltip.day.calcs.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StatsPage() {
  const [password, setPassword]   = useState(() => sessionStorage.getItem(SESSION_KEY) || "");
  const [input, setInput]         = useState("");
  const [authed, setAuthed]       = useState(() => !!sessionStorage.getItem(SESSION_KEY));
  const [authErr, setAuthErr]     = useState("");

  const [preset, setPreset]       = useState<Preset>("7");
  const [fromDate, setFromDate]   = useState("");
  const [toDate, setToDate]       = useState("");

  const [data, setData]           = useState<StatsData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");

  const load = useCallback(async (pw: string, p: Preset, fd: string, td: string) => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = {};
      if (p === "custom") {
        if (fd) params.from = String(new Date(fd).getTime());
        if (td) params.to   = String(new Date(td + "T23:59:59").getTime());
      } else {
        params.days = p;
      }
      const result = await statsApi.getData(pw, params);
      setData(result);
    } catch (e: any) {
      if (e.message?.includes("401")) {
        setAuthed(false);
        sessionStorage.removeItem(SESSION_KEY);
        setAuthErr("Wrong password.");
      } else {
        setError(e.message || "Failed to load stats.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed && password) load(password, preset, fromDate, toDate);
  }, [authed, password, preset, fromDate, toDate, load]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    sessionStorage.setItem(SESSION_KEY, input);
    setPassword(input);
    setAuthed(true);
    setAuthErr("");
  }

  if (!authed) {
    return (
      <div className="stats-login-wrap">
        <form className="stats-login" onSubmit={handleLogin}>
          <h2 className="stats-login-title">Stats</h2>
          {authErr && <p className="stats-login-err">{authErr}</p>}
          <input
            className="stats-login-input"
            type="password"
            placeholder="Password"
            value={input}
            autoFocus
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="stats-login-btn" type="submit">Enter</button>
        </form>
      </div>
    );
  }

  const maxVal = data ? Math.max(...data.by_day.map((d) => Math.max(d.views, d.calcs)), 1) : 1;

  return (
    <div className="stats-page">
      <div className="stats-header">
        <h1 className="stats-title">Visitor Stats</h1>
        <div className="stats-presets">
          {(["7","30","0","custom"] as Preset[]).map((p) => (
            <button
              key={p}
              className={`stats-preset-btn${preset === p ? " active" : ""}`}
              onClick={() => setPreset(p)}
            >
              {p === "7" ? "Last 7 days" : p === "30" ? "Last 30 days" : p === "0" ? "All time" : "Custom"}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="stats-date-range">
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <span>to</span>
            <input type="date" value={toDate}   onChange={(e) => setToDate(e.target.value)} />
          </div>
        )}
        <button className="stats-logout" onClick={() => { sessionStorage.removeItem(SESSION_KEY); setAuthed(false); setPassword(""); setInput(""); }}>
          Sign out
        </button>
      </div>

      {loading && <p className="stats-loading">Loading…</p>}
      {error   && <p className="stats-error">{error}</p>}

      {data && !loading && (
        <>
          <div className="stats-metrics">
            <div className="stats-metric">
              <div className="stats-metric-val">{(data.total_views ?? 0).toLocaleString()}</div>
              <div className="stats-metric-label">Page views</div>
            </div>
            <div className="stats-metric">
              <div className="stats-metric-val">{(data.unique_ips ?? 0).toLocaleString()}</div>
              <div className="stats-metric-label">Unique visitors</div>
            </div>
            <div className="stats-metric">
              <div className="stats-metric-val">{(data.total_calcs ?? 0).toLocaleString()}</div>
              <div className="stats-metric-label">Calculations</div>
            </div>
          </div>

          <div className="stats-section">
            <div className="stats-section-header">
              <h2 className="stats-section-title">Daily activity</h2>
              <div className="stats-legend">
                <span className="stats-legend-dot stats-legend-dot--views" />Views
                <span className="stats-legend-dot stats-legend-dot--calcs" />Calculations
              </div>
            </div>
            <BarChart days={data.by_day} maxVal={maxVal} />
          </div>

          <div className="stats-two-col">
            <div className="stats-section">
              <h2 className="stats-section-title">Top jobs</h2>
              {data.top_jobs.length === 0
                ? <p className="stats-empty">No data.</p>
                : (
                  <table className="stats-table">
                    <tbody>
                      {data.top_jobs.map((j) => (
                        <tr key={j.job_id}>
                          <td className="stats-table-name">{j.name}</td>
                          <td className="stats-table-count">{j.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>

            <div className="stats-section">
              <h2 className="stats-section-title">Top skills</h2>
              {data.top_skills.length === 0
                ? <p className="stats-empty">No skill data (normal attacks only).</p>
                : (
                  <table className="stats-table">
                    <tbody>
                      {data.top_skills.map((s) => (
                        <tr key={s.skill_id}>
                          <td className="stats-table-name">{s.name}</td>
                          <td className="stats-table-count">{s.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>

            <div className="stats-section">
              <h2 className="stats-section-title">Visitors by country</h2>
              {data.countries.length === 0
                ? <p className="stats-empty">No data.</p>
                : (
                  <table className="stats-table">
                    <tbody>
                      {data.countries.map((c) => (
                        <tr key={c.country}>
                          <td className="stats-table-name">{c.country}</td>
                          <td className="stats-table-count">{c.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
