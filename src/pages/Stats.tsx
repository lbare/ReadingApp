import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type GoalPace, computeStats } from "../../supabase/functions/_shared/stats.ts";
import type { Book } from "../../supabase/functions/_shared/types.ts";
import { BarChart, Heatmap } from "../components/Charts.tsx";
import { localToday } from "../lib/dates.ts";
import { store } from "../lib/store.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (n: number) => n.toLocaleString();

export function Stats() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [goal, setGoal] = useState(52);
  const [year, setYear] = useState(() => Number(localToday().slice(0, 4)));
  const [error, setError] = useState<string | null>(null);
  const today = localToday();

  useEffect(() => {
    Promise.all([store.listBooks(), store.getSettings()])
      .then(([b, s]) => {
        setBooks(b);
        setGoal(s.yearly_goal);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const stats = useMemo(() => (books ? computeStats(books, goal, today, year) : null), [books, goal, today, year]);
  const titlesByDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const b of books ?? []) {
      if (b.shelf === "read" && b.date_read?.startsWith(`${year}-`)) m.set(b.date_read, [...(m.get(b.date_read) ?? []), b.title]);
    }
    return m;
  }, [books, year]);

  if (error) return <p className="error" style={{ marginTop: 24 }}>{error}</p>;
  if (!stats) return <p className="muted" style={{ marginTop: 24 }}>Loading…</p>;

  if (stats.allTime.books === 0) {
    return (
      <div className="page-head">
        <h1>Stats</h1>
        <p>
          No finished books yet. <Link to="/import">Import your Goodreads history</Link> to see your reading over the years.
        </p>
      </div>
    );
  }

  const yearsWithData = stats.years.filter((y) => y.books > 0 || y.year === Number(today.slice(0, 4))).map((y) => y.year).reverse();
  const isThisYear = year === Number(today.slice(0, 4));

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>Stats</h1>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" style={{ width: "auto" }}>
            {yearsWithData.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <p className="small">
          {fmt(stats.allTime.books)} books and {fmt(stats.allTime.pages)} pages all time
          {stats.allTime.undated > 0 && <span className="muted"> ({stats.allTime.undated} read without a finish date)</span>}
        </p>
      </div>

      <div className="tiles">
        <div className="card tile">
          <div className="tile-label">Books {isThisYear ? "this year" : `in ${year}`}</div>
          <div className="tile-value">{stats.yearBooks}</div>
          {isThisYear && <div className="tile-sub">of {goal} goal</div>}
        </div>
        <div className="card tile">
          <div className="tile-label">Pages</div>
          <div className="tile-value">{fmt(stats.yearPages)}</div>
          <div className="tile-sub">{stats.yearBooks ? `${fmt(Math.round(stats.yearPages / Math.max(1, isThisYear ? stats.pace!.dayOfYear : 365)))} a day` : "—"}</div>
        </div>
        <div className="card tile">
          <div className="tile-label">Average length</div>
          <div className="tile-value">{stats.avgPagesPerBook ?? "—"}</div>
          <div className="tile-sub">pages per book</div>
        </div>
        <div className="card tile">
          <div className="tile-label">Average rating</div>
          <div className="tile-value">{stats.avgRating ?? "—"}</div>
          <div className="tile-sub">{stats.longest ? `Longest: ${stats.longest.title.slice(0, 22)}${stats.longest.title.length > 22 ? "…" : ""}` : "your stars"}</div>
        </div>
      </div>

      {stats.pace && <Pace pace={stats.pace} />}

      <section className="section card">
        <div className="section-head">
          <h2>Books finished per day</h2>
          <span className="muted">{year}</span>
        </div>
        <Heatmap year={year} counts={stats.heatmap} titles={titlesByDay} today={today} />
      </section>

      <section className="section card">
        <div className="section-head">
          <h2>Books per month</h2>
          <span className="muted">{year}</span>
        </div>
        <BarChart
          ariaLabel={`Books finished per month in ${year}`}
          bars={stats.months.map((m) => ({
            key: String(m.month),
            label: MONTHS[m.month - 1],
            value: m.books,
            tip: `${MONTHS[m.month - 1]}: ${m.books} book${m.books === 1 ? "" : "s"}`,
            detail: `${fmt(m.pages)} pages`,
          }))}
          emphasize={isThisYear ? String(Number(today.slice(5, 7))) : undefined}
        />
      </section>

      <section className="section card">
        <div className="section-head">
          <h2>Books per year</h2>
        </div>
        <BarChart
          ariaLabel="Books finished per year"
          bars={stats.years.map((y) => ({
            key: String(y.year),
            label: String(y.year),
            value: y.books,
            tip: `${y.year}: ${y.books} book${y.books === 1 ? "" : "s"}`,
            detail: `${fmt(y.pages)} pages`,
          }))}
          emphasize={String(year)}
        />
        <details>
          <summary>Show as table</summary>
          <table>
            <thead>
              <tr><th>Year</th><th>Books</th><th>Pages</th></tr>
            </thead>
            <tbody>
              {[...stats.years].reverse().map((y) => (
                <tr key={y.year}><td>{y.year}</td><td>{y.books}</td><td>{fmt(y.pages)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </>
  );
}

function Pace({ pace }: { pace: GoalPace }) {
  const pct = (n: number) => `${Math.min(100, (n / pace.goal) * 100)}%`;
  const delta = Math.round(pace.delta);
  const status =
    delta > 0 ? `${delta} book${delta === 1 ? "" : "s"} ahead of pace` : delta < 0 ? `${-delta} book${delta === -1 ? "" : "s"} behind pace` : "Right on pace";
  return (
    <section className="section card">
      <div className="section-head">
        <h2>Yearly goal</h2>
        <span className="muted">{pace.read} / {pace.goal}</span>
      </div>
      <div
        className="meter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={pace.goal}
        aria-valuenow={pace.read}
        aria-label={`${pace.read} of ${pace.goal} books; ${status}`}
      >
        <div className="meter-fill" style={{ width: pct(pace.read) }} />
        <div className="meter-mark" style={{ left: pct(pace.expected) }}>
          <span>Today’s pace: {Math.round(pace.expected)}</span>
        </div>
      </div>
      <p className="small">
        <strong>{status}.</strong>{" "}
        <span className="muted">
          On track for {pace.projected} this year
          {pace.read < pace.goal ? ` · ${pace.neededPerWeek.toFixed(1)} a week to reach ${pace.goal}` : " · goal reached"}
        </span>
      </p>
    </section>
  );
}
