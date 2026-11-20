import { useEffect, useRef, useState } from "react";

// Small hand-rolled SVG charts. Single series, so no legend box; the section
// heading names the measure. Colors come from CSS tokens (styles.css).

interface Tip {
  x: number;
  y: number;
  title: string;
  detail?: string;
}

function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: React.MouseEvent | React.FocusEvent, title: string, detail?: string) => {
    const box = ref.current?.getBoundingClientRect();
    const target = (e.target as Element).getBoundingClientRect();
    if (!box) return;
    setTip({ x: target.left + target.width / 2 - box.left, y: target.top - box.top, title, detail });
  };
  const node = tip && (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.title} {tip.detail && <span>{tip.detail}</span>}
    </div>
  );
  return { ref, show, hide: () => setTip(null), node };
}

/** Rect with 4px rounded top corners, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

export interface Bar {
  key: string;
  label: string;
  value: number;
  tip: string;
  detail?: string;
}

/**
 * Vertical bars. Value labels only on the tallest bar and the `emphasize` bar
 * (e.g. this year); hover/focus any bar for its numbers.
 */
export function BarChart({ bars, emphasize, height = 160, ariaLabel }: { bars: Bar[]; emphasize?: string; height?: number; ariaLabel: string }) {
  const tt = useTooltip();
  // Draw at the container's real width so 11px labels stay 11px on a phone.
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = tt.ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tt.ref]);
  const top = 18;
  const bottom = 22;
  const left = 28;
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(1, ...bars.map((b) => b.value)));
  const slot = (W - left) / Math.max(bars.length, 1);
  const barW = Math.min(44, slot * 0.62);
  const tallest = bars.reduce((m, b) => (b.value > m.value ? b : m), bars[0]);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(bars.length / Math.floor((W - left) / 30)));

  return (
    <div className="chart" ref={tt.ref}>
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => {
          const y = top + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line className="grid" x1={left} x2={W} y1={y} y2={y} strokeDasharray={t === 0 ? undefined : "2 4"} />
              <text x={left - 6} y={y + 4} textAnchor="end">{Number.isInteger(t) ? t : t.toFixed(1)}</text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          const h = (b.value / max) * plotH;
          const x = left + slot * i + (slot - barW) / 2;
          const y = top + plotH - h;
          const showValue = b.value > 0 && (b === tallest || b.key === emphasize);
          return (
            <g key={b.key}>
              <rect
                className="hit"
                x={left + slot * i}
                y={top}
                width={slot}
                height={plotH + bottom}
                tabIndex={0}
                aria-label={`${b.tip}${b.detail ? `, ${b.detail}` : ""}`}
                onMouseEnter={(e) => tt.show(e, b.tip, b.detail)}
                onMouseLeave={tt.hide}
                onFocus={(e) => tt.show(e, b.tip, b.detail)}
                onBlur={tt.hide}
              />
              <path className="bar" d={barPath(x, y, barW, h)} pointerEvents="none" />
              {showValue && (
                <text className="value-label" x={x + barW / 2} y={y - 5} textAnchor="middle">{b.value}</text>
              )}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontWeight={b.key === emphasize ? 700 : 400}>{b.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {tt.node}
    </div>
  );
}

function dayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LEVEL = (n: number) => (n <= 0 ? 0 : n >= 3 ? 3 : n);

/** GitHub-style calendar of one year: columns are weeks (Sun–Sat), cells are days. */
export function Heatmap({ year, counts, titles, today }: { year: number; counts: Map<string, number>; titles: Map<string, string[]>; today: string }) {
  const tt = useTooltip();
  // On narrow screens the year doesn't fit; start scrolled so today is in view.
  useEffect(() => {
    const el = tt.ref.current;
    if (!el) return;
    if (!today.startsWith(`${year}-`)) {
      el.scrollLeft = 0;
      return;
    }
    const col = Math.floor((dayIndex(today) + new Date(Date.UTC(year, 0, 1)).getUTCDay()) / 7);
    el.scrollLeft = Math.max(0, 22 + col * 13 - el.clientWidth + 40);
  }, [year, today, tt.ref]);
  const cell = 11;
  const gap = 2;
  const step = cell + gap;
  const left = 22;
  const top = 16;
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const offset = jan1.getUTCDay();
  const days = (Date.UTC(year + 1, 0, 1) - jan1.getTime()) / 86_400_000;
  const weeks = Math.ceil((days + offset) / 7);
  const width = left + weeks * step;
  const height = top + 7 * step;

  const cells: React.ReactNode[] = [];
  const monthLabels: React.ReactNode[] = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(jan1.getTime() + d * 86_400_000);
    const iso = date.toISOString().slice(0, 10);
    const idx = d + offset;
    const col = Math.floor(idx / 7);
    const row = idx % 7;
    const n = counts.get(iso) ?? 0;
    if (date.getUTCDate() === 1) {
      monthLabels.push(<text key={iso} x={left + col * step} y={10}>{MONTHS[date.getUTCMonth()]}</text>);
    }
    const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
    const names = titles.get(iso) ?? [];
    cells.push(
      <rect
        key={iso}
        x={left + col * step}
        y={top + row * step}
        width={cell}
        height={cell}
        rx={2}
        fill={`var(--heat-${LEVEL(n)})`}
        tabIndex={n ? 0 : -1}
        aria-label={`${label}: ${n} book${n === 1 ? "" : "s"} finished${names.length ? ` (${names.join(", ")})` : ""}`}
        onMouseEnter={(e) => tt.show(e, n ? `${n} finished · ${label}` : label, names.join(", ") || undefined)}
        onMouseLeave={tt.hide}
        onFocus={(e) => tt.show(e, `${n} finished · ${label}`, names.join(", ") || undefined)}
        onBlur={tt.hide}
      />,
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chart heatmap-wrap" ref={tt.ref}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Books finished per day in ${year}`}>
          {monthLabels}
          {["Mon", "Wed", "Fri"].map((d, i) => (
            <text key={d} x={0} y={top + (1 + i * 2) * step + cell - 2}>{d[0]}</text>
          ))}
          {cells}
        </svg>
        {tt.node}
      </div>
      <div className="legend" aria-hidden="true">
        Fewer <i style={{ background: "var(--heat-0)" }} /> <i style={{ background: "var(--heat-1)" }} />
        <i style={{ background: "var(--heat-2)" }} /> <i style={{ background: "var(--heat-3)" }} /> 3+ books
      </div>
    </div>
  );
}
