import type { BookFields } from "./types.ts";

type StatBook = Pick<BookFields, "shelf" | "date_read" | "pages" | "my_rating" | "title" | "author">;

export interface YearTotal {
  year: number;
  books: number;
  pages: number;
}

export interface GoalPace {
  goal: number;
  read: number;
  /** Books you'd have read by today if reading evenly toward the goal. */
  expected: number;
  /** Positive = ahead of pace, negative = behind. */
  delta: number;
  /** Year-end total at the current rate. */
  projected: number;
  /** Books per week needed from today to still hit the goal. */
  neededPerWeek: number;
  dayOfYear: number;
  daysInYear: number;
}

export interface Stats {
  allTime: { books: number; pages: number; undated: number };
  years: YearTotal[]; // ascending, every year from first to `year` (gaps filled with 0)
  year: number;
  yearBooks: number;
  yearPages: number;
  avgPagesPerBook: number | null;
  avgRating: number | null;
  months: { month: number; books: number; pages: number }[]; // 12 entries for `year`
  /** date (YYYY-MM-DD) → books finished that day, for `year`. */
  heatmap: Map<string, number>;
  pace: GoalPace | null; // only for the current year
  longest: StatBook | null;
}

function isLeap(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function dayOfYear(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const start = Date.UTC(y, 0, 1);
  return Math.floor((Date.UTC(y, m - 1, d) - start) / 86_400_000) + 1;
}

/**
 * @param today  local date as YYYY-MM-DD (passed in so tests are deterministic)
 * @param year   the year to break down (defaults to today's year)
 */
export function computeStats(books: StatBook[], goal: number, today: string, year?: number): Stats {
  const thisYear = Number(today.slice(0, 4));
  const y = year ?? thisYear;
  const read = books.filter((b) => b.shelf === "read");
  const dated = read.filter((b): b is StatBook & { date_read: string } => !!b.date_read);

  const byYear = new Map<number, YearTotal>();
  for (const b of dated) {
    const yr = Number(b.date_read.slice(0, 4));
    const t = byYear.get(yr) ?? { year: yr, books: 0, pages: 0 };
    t.books++;
    t.pages += b.pages ?? 0;
    byYear.set(yr, t);
  }
  const firstYear = Math.min(y, ...byYear.keys());
  const lastYear = Math.max(y, thisYear);
  const years: YearTotal[] = [];
  for (let yr = firstYear; yr <= lastYear; yr++) years.push(byYear.get(yr) ?? { year: yr, books: 0, pages: 0 });

  const inYear = dated.filter((b) => b.date_read.startsWith(`${y}-`));
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, books: 0, pages: 0 }));
  const heatmap = new Map<string, number>();
  for (const b of inYear) {
    const m = months[Number(b.date_read.slice(5, 7)) - 1];
    m.books++;
    m.pages += b.pages ?? 0;
    heatmap.set(b.date_read, (heatmap.get(b.date_read) ?? 0) + 1);
  }

  const yearPages = inYear.reduce((s, b) => s + (b.pages ?? 0), 0);
  const withPages = inYear.filter((b) => b.pages);
  const rated = inYear.filter((b) => b.my_rating);

  let pace: GoalPace | null = null;
  if (y === thisYear && goal > 0) {
    const doy = dayOfYear(today);
    const diy = isLeap(y) ? 366 : 365;
    const expected = (goal * doy) / diy;
    const remainingWeeks = Math.max((diy - doy) / 7, 1 / 7);
    pace = {
      goal,
      read: inYear.length,
      expected,
      delta: inYear.length - expected,
      projected: Math.round((inYear.length / doy) * diy),
      neededPerWeek: Math.max(goal - inYear.length, 0) / remainingWeeks,
      dayOfYear: doy,
      daysInYear: diy,
    };
  }

  const longest = withPages.reduce<StatBook | null>((best, b) => (!best || (b.pages ?? 0) > (best.pages ?? 0) ? b : best), null);

  return {
    allTime: {
      books: read.length,
      pages: read.reduce((s, b) => s + (b.pages ?? 0), 0),
      undated: read.length - dated.length,
    },
    years,
    year: y,
    yearBooks: inYear.length,
    yearPages,
    avgPagesPerBook: withPages.length ? Math.round(withPages.reduce((s, b) => s + (b.pages ?? 0), 0) / withPages.length) : null,
    avgRating: rated.length ? Math.round((rated.reduce((s, b) => s + (b.my_rating ?? 0), 0) / rated.length) * 10) / 10 : null,
    months,
    heatmap,
    pace,
    longest,
  };
}
