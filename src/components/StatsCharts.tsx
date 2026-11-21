import { useEffect, useRef, useState } from "react";
import { valueAt } from "../../supabase/functions/_shared/stats.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Day-of-year where each month starts (non-leap; close enough for an axis).
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export const fmtCount = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString());

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

function dayLabel(day: number): string {
  const d = new Date(Date.UTC(2001, 0, Math.max(1, day)));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export interface RaceSeries {
  year: number;
  points: [number, number][];
  emphasized: boolean;
}

/**
 * Running total through the year, one line per year on the same Jan–Dec axis.
 * The emphasized year is the accent color; the others are quiet gray, each
 * labeled at its end. Hover or tap anywhere to compare every year on that date.
 */
export function RaceChart({ series, goal, measure, height = 240 }: { series: RaceSeries[]; goal: number | null; measure: "books" | "pages"; height?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(600);
  const [hover, setHover] = useState<number | null>(null);
  const left = 34;
  const right = 64; // room for end labels
  const top = 12;
  const bottom = 24;
  const plotW = W - left - right;
  const plotH = height - top - bottom;
  const finals = series.map((s) => s.points[s.points.length - 1][1]);
  const max = niceMax(Math.max(1, ...finals, goal ?? 0));
  const x = (day: number) => left + (day / 366) * plotW;
  const y = (v: number) => top + plotH - (v / max) * plotH;

  const path = (pts: [number, number][]) =>
    pts.map(([d, v], i) => (i === 0 ? `M${x(d)},${y(v)}` : `H${x(d)}V${y(v)}`)).join("");

  // End labels, nudged apart so they don't overlap.
  const labels = series
    .map((s) => {
      const [d, v] = s.points[s.points.length - 1];
      return { year: s.year, emphasized: s.emphasized, x: x(d), y: y(v), v };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;

  const ticks = [0, max / 2, max];
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const day = Math.round(((e.clientX - box.left) / box.width) * 366);
    setHover(Math.max(1, Math.min(366, day)));
  };

  const tipRows = hover == null ? [] : [...series].sort((a, b) => b.year - a.year).map((s) => ({ year: s.year, v: valueAt(s.points, hover), active: s.emphasized, inRange: hover <= s.points[s.points.length - 1][0] }));

  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`Running total of ${measure} through each year`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} strokeDasharray={t === 0 ? undefined : "2 4"} />
            <text x={left - 6} y={y(t) + 4} textAnchor="end">{fmtCount(t)}</text>
          </g>
        ))}
        {MONTH_START.map((d, i) =>
          i % (plotW < 360 ? 3 : 1) === 0 ? (
            <text key={i} x={x(d + 15)} y={height - 6} textAnchor="middle">{MONTHS[i]}</text>
          ) : null,
        )}
        {goal ? (
          <g>
            <line className="goal-line" x1={x(0)} y1={y(0)} x2={x(366)} y2={y(goal)} />
            <text x={x(366) + 4} y={y(goal) + 4} className="goal-label">goal {fmtCount(goal)}</text>
          </g>
        ) : null}
        {series.filter((s) => !s.emphasized).map((s) => (
          <path key={s.year} d={path(s.points)} className="race-line" />
        ))}
        {series.filter((s) => s.emphasized).map((s) => (
          <path key={s.year} d={path(s.points)} className="race-line race-line-active" />
        ))}
        {labels.map((l) => (
          <text key={l.year} x={l.x + 5} y={l.y + 4} className={l.emphasized ? "race-label race-label-active" : "race-label"}>
            {l.year} · {fmtCount(l.v)}
          </text>
        ))}
        {hover != null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={top} y2={top + plotH} />}
        <rect
          x={left}
          y={top}
          width={plotW}
          height={plotH}
          fill="transparent"
          style={{ touchAction: "pan-y" }}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover != null && (
        <div className="tooltip race-tip" style={{ left: Math.min(Math.max(x(hover), 70), W - 70), top: top }}>
          <div style={{ marginBottom: 2 }}>{dayLabel(hover)}</div>
          {tipRows.filter((r) => r.inRange).map((r) => (
            <div key={r.year} style={{ fontWeight: r.active ? 700 : 400 }}>
              {r.year}: {fmtCount(r.v)} <span>{r.v === 1 ? measure.slice(0, -1) : measure}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rows are years (newest first), columns are months; shading shows how many books were finished. */
export function MonthGrid({ grid, highlight, onSelect }: { grid: Map<number, number[]>; highlight: number; onSelect: (year: number) => void }) {
  const years = [...grid.keys()].sort((a, b) => b - a);
  const max = Math.max(1, ...[...grid.values()].flat());
  const level = (n: number) => (n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 3)));
  return (
    <div className="table-wrap">
      <table className="month-grid">
        <thead>
          <tr>
            <th />
            {MONTHS.map((m) => (
              <th key={m}>{m[0]}<span className="sr-only">{m.slice(1)}</span></th>
            ))}
            <th>Σ</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            const row = grid.get(y)!;
            return (
              <tr key={y} className={y === highlight ? "is-selected" : undefined}>
                <th scope="row">
                  <button className="link-btn" onClick={() => onSelect(y)}>{y}</button>
                </th>
                {row.map((n, i) => (
                  <td key={i} className={`heat heat-l${level(n)}`} title={`${MONTHS[i]} ${y}: ${n} book${n === 1 ? "" : "s"}`}>
                    {n || ""}
                  </td>
                ))}
                <td className="total">{row.reduce((a, b) => a + b, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal bars with labels and counts, for breakdowns. */
export function BarList({ rows, unit = "" }: { rows: { label: React.ReactNode; value: number; note?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="muted small">Nothing yet.</p>;
  return (
    <div className="bar-list">
      {rows.map((r, i) => (
        <div key={i} className="bar-row">
          <div className="bar-label">{r.label}</div>
          <div className="bar-track" aria-hidden="true">
            <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <div className="bar-value">
            {r.value}
            {unit}
            {r.note && <span className="muted"> {r.note}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
