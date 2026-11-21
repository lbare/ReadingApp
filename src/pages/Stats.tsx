import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { buildReadEvents } from "../../supabase/functions/_shared/reads.ts";
import { type GoalPace, type Measure, breakdowns, computeStats, cumulative } from "../../supabase/functions/_shared/stats.ts";
import type { Book, ReadRow } from "../../supabase/functions/_shared/types.ts";
import { BarChart, Heatmap } from "../components/Charts.tsx";
import { BarList, MonthGrid, RaceChart } from "../components/StatsCharts.tsx";
import { localToday } from "../lib/dates.ts";
import { store } from "../lib/store.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (n: number) => n.toLocaleString();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function Stats() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [reads, setReads] = useState<ReadRow[]>([]);
  const [goal, setGoal] = useState(52);
  const [year, setYear] = useState(() => Number(localToday().slice(0, 4)));
  const [measure, setMeasure] = useState<Measure>("books");
  const [scope, setScope] = useState<"year" | "all">("year");
  const [error, setError] = useState<string | null>(null);
  const today = localToday();
  const thisYear = Number(today.slice(0, 4));

  useEffect(() => {
    Promise.all([store.listBooks(), store.listReads(), store.getSettings()])
      .then(([b, r, s]) => {
        setBooks(b);
        setReads(r);
        setGoal(s.yearly_goal);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const data = useMemo(() => (books ? buildReadEvents(books, reads) : null), [books, reads]);
  const stats = useMemo(() => (data ? computeStats(data.events, data.undated, goal, today, year) : null), [data, goal, today, year]);
  const breakdown = useMemo(() => (data ? breakdowns(data.events, scope === "all" ? null : year) : null), [data, scope, year]);
  const race = useMemo(() => {
    if (!data || !stats) return [];
    // The last four years (and the selected one), oldest first so the selected line draws on top.
    const yrs = stats.years.map((y) => y.year).filter((y) => y >= thisYear - 3 || y === year);
    return yrs.map((y) => ({ year: y, points: cumulative(data.events, y, measure, today), emphasized: y === year }));
  }, [data, stats, measure, today, year, thisYear]);

  if (error) return <p className="error" style={{ marginTop: 24 }}>{error}</p>;
  if (!stats || !data || !breakdown) return <p className="muted" style={{ marginTop: 24 }}>Loading…</p>;

  if (stats.allTime.reads === 0) {
    return (
      <div className="page-head">
        <h1>Stats</h1>
        <p>
          No finished books yet. <Link to="/import">Import your Goodreads history</Link> to see your reading over the years.
        </p>
      </div>
    );
  }

  const isThisYear = year === thisYear;
  const s = stats.summary;
  const yearsDesc = [...stats.years].reverse();
  const sameDate = [...stats.sameDate].reverse();
  const sameDateLabel = new Date(`2001-${stats.todayLabel}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const mine = stats.sameDate.find((d) => d.year === thisYear)!;
  const lastYear = stats.sameDate.find((d) => d.year === thisYear - 1);
  const counts = new Map([...stats.days].map(([d, t]) => [d, t.length]));
  const daysElapsed = isThisYear ? stats.pace?.dayOfYear ?? 365 : 365;

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>Stats</h1>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" style={{ width: "auto" }}>
            {yearsDesc.map((y) => (
              <option key={y.year} value={y.year}>{y.year}</option>
            ))}
          </select>
        </div>
        <p className="small">
          {fmt(stats.allTime.books)} books{stats.allTime.reads > stats.allTime.books && <> ({fmt(stats.allTime.reads)} reads)</>} and{" "}
          {fmt(stats.allTime.pages)} pages all time
          {stats.allTime.undated > 0 && <span className="muted"> · {stats.allTime.undated} without a finish date</span>}
        </p>
      </div>

      {data.extraReads.length > 0 && (
        <p className="banner small" style={{ marginBottom: 12 }}>
          {data.extraReads.map((x) => x.title).join(", ")} {data.extraReads.length === 1 ? "was" : "were"} read more times than there are dates for, so
          some reads don't count yet.{" "}
          <Link to={`/?tab=read${data.extraReads.length === 1 ? `&q=${encodeURIComponent(data.extraReads[0].title)}` : ""}`}>Add the dates →</Link>
        </p>
      )}

      <div className="tiles">
        <div className="card tile">
          <div className="tile-label">Books {isThisYear ? "this year" : `in ${year}`}</div>
          <div className="tile-value">{s.books}</div>
          <div className="tile-sub">
            {isThisYear && lastYear ? deltaText(mine.books - lastYear.books, `this time in ${thisYear - 1}`) : s.rereads ? plural(s.rereads, "reread") : " "}
          </div>
        </div>
        <div className="card tile">
          <div className="tile-label">Pages</div>
          <div className="tile-value">{fmt(s.pages)}</div>
          <div className="tile-sub">{s.pages ? `${fmt(Math.round(s.pages / daysElapsed))} a day` : "—"}</div>
        </div>
        <div className="card tile">
          <div className="tile-label">Average length</div>
          <div className="tile-value">{s.avgPages ?? "—"}</div>
          <div className="tile-sub">pages per book</div>
        </div>
        <div className="card tile">
          <div className="tile-label">Average rating</div>
          <div className="tile-value">{s.avgRating ?? "—"}</div>
          <div className="tile-sub">out of 5</div>
        </div>
      </div>

      {stats.pace && <Pace pace={stats.pace} />}

      <section className="section card">
        <div className="section-head">
          <h2>{measure === "books" ? "Books" : "Pages"} through the year</h2>
          <div className="seg" role="group" aria-label="Measure">
            <button aria-pressed={measure === "books"} onClick={() => setMeasure("books")}>Books</button>
            <button aria-pressed={measure === "pages"} onClick={() => setMeasure("pages")}>Pages</button>
          </div>
        </div>
        <RaceChart series={race} goal={isThisYear && measure === "books" ? goal : null} measure={measure} />
        <p className="muted small">Running total for each year. {year} is highlighted; touch the chart to compare years on any date.</p>
      </section>

      <section className="section card">
        <div className="section-head">
          <h2>By {sameDateLabel}</h2>
          <span className="muted small">each year up to today's date</span>
        </div>
        {lastYear && (
          <p className="small">
            <strong>{deltaText(mine.books - lastYear.books, `last year at this point`)}</strong>
            {(() => {
              const best = stats.sameDate.reduce((a, b) => (b.books > a.books ? b : a));
              return best.year === thisYear ? " Your best start of any year." : ` Best start: ${best.year} with ${best.books}.`;
            })()}
          </p>
        )}
        <table>
          <thead>
            <tr><th>Year</th><th>Books</th><th>Pages</th><th>vs {thisYear}</th></tr>
          </thead>
          <tbody>
            {sameDate.map((d) => (
              <tr key={d.year} className={d.year === thisYear ? "is-current" : undefined}>
                <td>{d.year}</td>
                <td>{d.books}</td>
                <td>{fmt(d.pages)}</td>
                <td className="muted">{d.year === thisYear ? "—" : signed(mine.books - d.books)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section card">
        <div className="section-head">
          <h2>Books finished per day</h2>
          <span className="muted">{year}</span>
        </div>
        <Heatmap year={year} counts={counts} titles={stats.days} today={today} />
      </section>

      <section className="section card">
        <div className="section-head">
          <h2>Books per month</h2>
          <span className="muted small">tap a year to select it</span>
        </div>
        <MonthGrid grid={stats.monthGrid} highlight={year} onSelect={setYear} />
      </section>

      <section className="section card">
        <div className="section-head">
          <h2>Year by year</h2>
        </div>
        <BarChart
          ariaLabel="Books finished per year"
          bars={stats.years.map((y) => ({
            key: String(y.year),
            label: String(y.year),
            value: y.books,
            tip: `${y.year}: ${plural(y.books, "book")}`,
            detail: `${fmt(y.pages)} pages`,
          }))}
          emphasize={String(year)}
        />
        <div className="table-wrap">
          <table className="year-table">
            <thead>
              <tr>
                <th>Year</th><th>Books</th><th>Pages</th><th>Avg pages</th><th>Avg ★</th><th>Rereads</th><th>Authors</th><th>Busiest month</th><th>Longest</th><th>Shortest</th>
              </tr>
            </thead>
            <tbody>
              {yearsDesc.map((y) => (
                <tr key={y.year} className={y.year === year ? "is-current" : undefined}>
                  <th scope="row"><button className="link-btn" onClick={() => setYear(y.year)}>{y.year}</button></th>
                  <td>{y.books}</td>
                  <td>{fmt(y.pages)}</td>
                  <td>{y.avgPages ?? "—"}</td>
                  <td>{y.avgRating ?? "—"}</td>
                  <td>{y.rereads || "—"}</td>
                  <td>{y.authors || "—"}</td>
                  <td>{y.busiestMonth ? `${MONTHS[y.busiestMonth.month - 1]} (${y.busiestMonth.books})` : "—"}</td>
                  <td className="book-cell">{y.longest ? `${shortTitle(y.longest.title)} · ${y.longest.pages}p` : "—"}</td>
                  <td className="book-cell">{y.shortest && y.books > 1 ? `${shortTitle(y.shortest.title)} · ${y.shortest.pages}p` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section card">
        <div className="section-head">
          <h2>Breakdowns</h2>
          <div className="seg" role="group" aria-label="Breakdown range">
            <button aria-pressed={scope === "year"} onClick={() => setScope("year")}>{year}</button>
            <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>All time</button>
          </div>
        </div>
        <div className="breakdowns">
          <div>
            <h3>Your ratings</h3>
            <BarList rows={breakdown.ratings.map((r) => ({ label: stars(r.rating), value: r.reads }))} />
            {breakdown.unrated > 0 && <p className="muted small">{breakdown.unrated} unrated</p>}
          </div>
          <div>
            <h3>Length</h3>
            <BarList rows={breakdown.lengths.map((l) => ({ label: `${l.label} pp`, value: l.reads }))} />
          </div>
          <div>
            <h3>Most-read authors</h3>
            <BarList
              rows={breakdown.authors.map((a) => ({
                label: a.author,
                value: a.reads,
                note: a.reads > a.books ? `(${plural(a.books, "book")})` : undefined,
              }))}
            />
          </div>
        </div>
      </section>
    </>
  );
}

function Pace({ pace }: { pace: GoalPace }) {
  const pct = (n: number) => `${Math.min(100, (n / pace.goal) * 100)}%`;
  const delta = Math.round(pace.delta);
  const status = delta > 0 ? `${plural(delta, "book")} ahead of pace` : delta < 0 ? `${plural(-delta, "book")} behind pace` : "Right on pace";
  return (
    <section className="section card">
      <div className="section-head">
        <h2>Yearly goal</h2>
        <span className="muted">{pace.read} / {pace.goal}</span>
      </div>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={pace.goal} aria-valuenow={pace.read} aria-label={`${pace.read} of ${pace.goal} books; ${status}`}>
        <div className="meter-fill" style={{ width: pct(pace.read) }} />
        <div className="meter-mark" style={{ left: pct(pace.expected) }}>
          {/* Keep the label inside the card near either end. */}
          <span style={pace.expected / pace.goal > 0.75 ? { left: "auto", right: 0, transform: "none" } : pace.expected / pace.goal < 0.25 ? { left: 0, transform: "none" } : undefined}>
            Today’s pace: {Math.round(pace.expected)}
          </span>
        </div>
      </div>
      <p className="small">
        <strong>{pace.read >= pace.goal ? "Goal reached!" : `${status}.`}</strong>{" "}
        <span className="muted">
          On track for {pace.projected} this year
          {pace.read < pace.goal ? ` · ${pace.neededPerWeek.toFixed(1)} a week to reach ${pace.goal}` : ""}
        </span>
      </p>
    </section>
  );
}

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}

function deltaText(n: number, than: string) {
  if (n === 0) return `Same as ${than}`;
  return `${plural(Math.abs(n), "book")} ${n > 0 ? "more" : "fewer"} than ${than}`;
}

function stars(r: number) {
  const full = Math.floor(r);
  return `${"★".repeat(full)}${r % 1 ? "½" : ""}`;
}

function shortTitle(t: string) {
  const clean = t.replace(/\s*\(.*?\)\s*/g, " ").trim();
  return clean.length > 26 ? `${clean.slice(0, 25)}…` : clean;
}
