import type { ReadEvent } from "./reads.ts";

// Everything counts reads (finished read-throughs), so a reread in a later
// year counts in that year, the way Goodreads' reading challenge does.

export interface BookRef {
  title: string;
  author: string | null;
  pages: number | null;
}

export interface YearSummary {
  year: number;
  books: number; // reads finished that year
  pages: number;
  avgPages: number | null;
  avgRating: number | null;
  rereads: number;
  authors: number; // distinct authors
  longest: BookRef | null;
  shortest: BookRef | null;
  busiestMonth: { month: number; books: number } | null; // 1-12
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

export interface SameDate {
  year: number;
  books: number;
  pages: number;
}

export interface Stats {
  allTime: { books: number; reads: number; pages: number; undated: number };
  /** Ascending, every year from the first read to the later of `year` and today (gaps filled). */
  years: YearSummary[];
  year: number;
  summary: YearSummary; // for `year`
  months: { month: number; books: number; pages: number }[]; // 12 entries for `year`
  /** year → books finished per month (12 entries). */
  monthGrid: Map<number, number[]>;
  /** date → titles finished that day, for `year`. */
  days: Map<string, string[]>;
  pace: GoalPace | null; // current year only
  /** Every year's total up to today's month and day. */
  sameDate: SameDate[];
  todayLabel: string; // "MM-DD"
}

export function isLeap(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysIn(y: number) {
  return isLeap(y) ? 366 : 365;
}

/** 1-based day of the year. */
export function dayOfYear(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

const yearOf = (e: ReadEvent) => Number(e.date.slice(0, 4));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarizeYear(year: number, events: ReadEvent[]): YearSummary {
  const inYear = events.filter((e) => yearOf(e) === year);
  const withPages = inYear.filter((e) => e.pages);
  const rated = inYear.filter((e) => e.rating);
  const byMonth = Array(12).fill(0) as number[];
  inYear.forEach((e) => byMonth[Number(e.date.slice(5, 7)) - 1]++);
  const top = Math.max(0, ...byMonth);
  const ref = (e: ReadEvent): BookRef => ({ title: e.title, author: e.author, pages: e.pages });
  const sortedByPages = [...withPages].sort((a, b) => (a.pages ?? 0) - (b.pages ?? 0));
  const avgPages = avg(withPages.map((e) => e.pages!));
  const avgRating = avg(rated.map((e) => e.rating!));
  return {
    year,
    books: inYear.length,
    pages: inYear.reduce((s, e) => s + (e.pages ?? 0), 0),
    avgPages: avgPages == null ? null : Math.round(avgPages),
    avgRating: avgRating == null ? null : Math.round(avgRating * 10) / 10,
    rereads: inYear.filter((e) => e.reread).length,
    authors: new Set(inYear.map((e) => (e.author ?? "").toLowerCase()).filter(Boolean)).size,
    longest: sortedByPages.length ? ref(sortedByPages[sortedByPages.length - 1]) : null,
    shortest: sortedByPages.length ? ref(sortedByPages[0]) : null,
    busiestMonth: top > 0 ? { month: byMonth.indexOf(top) + 1, books: top } : null,
  };
}

/**
 * @param events  dated reads, any order
 * @param undated finished books with no known finish date
 * @param today   local date as YYYY-MM-DD (passed in so tests are deterministic)
 * @param year    the year to break down (defaults to today's year)
 */
export function computeStats(events: ReadEvent[], undated: number, goal: number, today: string, year?: number): Stats {
  const thisYear = Number(today.slice(0, 4));
  const y = year ?? thisYear;
  const eventYears = events.map(yearOf);
  const firstYear = Math.min(y, thisYear, ...eventYears);
  const lastYear = Math.max(y, thisYear);

  const years: YearSummary[] = [];
  const monthGrid = new Map<number, number[]>();
  for (let yr = firstYear; yr <= lastYear; yr++) {
    years.push(summarizeYear(yr, events));
    monthGrid.set(yr, Array(12).fill(0));
  }
  for (const e of events) monthGrid.get(yearOf(e))![Number(e.date.slice(5, 7)) - 1]++;

  const inYear = events.filter((e) => yearOf(e) === y);
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, books: 0, pages: 0 }));
  const days = new Map<string, string[]>();
  for (const e of inYear) {
    const m = months[Number(e.date.slice(5, 7)) - 1];
    m.books++;
    m.pages += e.pages ?? 0;
    days.set(e.date, [...(days.get(e.date) ?? []), e.title]);
  }

  let pace: GoalPace | null = null;
  const summary = years.find((s) => s.year === y)!;
  if (y === thisYear && goal > 0) {
    const doy = dayOfYear(today);
    const diy = daysIn(y);
    const expected = (goal * doy) / diy;
    const remainingWeeks = Math.max((diy - doy) / 7, 1 / 7);
    pace = {
      goal,
      read: summary.books,
      expected,
      delta: summary.books - expected,
      projected: Math.round((summary.books / doy) * diy),
      neededPerWeek: Math.max(goal - summary.books, 0) / remainingWeeks,
      dayOfYear: doy,
      daysInYear: diy,
    };
  }

  // Same calendar date in every year (Feb 29 compares as written).
  const md = today.slice(5);
  const sameDate = years.map((s) => {
    const upTo = events.filter((e) => yearOf(e) === s.year && e.date.slice(5) <= md);
    return { year: s.year, books: upTo.length, pages: upTo.reduce((t, e) => t + (e.pages ?? 0), 0) };
  });

  return {
    allTime: {
      books: new Set(events.map((e) => e.bookId)).size + undated,
      reads: events.length + undated,
      pages: events.reduce((s, e) => s + (e.pages ?? 0), 0),
      undated,
    },
    years,
    year: y,
    summary,
    months,
    monthGrid,
    days,
    pace,
    sameDate,
    todayLabel: md,
  };
}

export type Measure = "books" | "pages";

/**
 * Running total through one year, as steps: [day of year, total after that
 * day]. Starts at (0, 0) and ends at today (current year) or Dec 31.
 */
export function cumulative(events: ReadEvent[], year: number, measure: Measure, today: string): [number, number][] {
  const perDay = new Map<number, number>();
  for (const e of events) {
    if (yearOf(e) !== year) continue;
    const d = dayOfYear(e.date);
    perDay.set(d, (perDay.get(d) ?? 0) + (measure === "books" ? 1 : (e.pages ?? 0)));
  }
  const end = Number(today.slice(0, 4)) === year ? dayOfYear(today) : daysIn(year);
  const points: [number, number][] = [[0, 0]];
  let total = 0;
  for (const d of [...perDay.keys()].sort((a, b) => a - b)) {
    total += perDay.get(d)!;
    points.push([d, total]);
  }
  if (points[points.length - 1][0] < end) points.push([end, total]);
  return points;
}

/** Value of a step series at a given day. */
export function valueAt(points: [number, number][], day: number): number {
  let v = 0;
  for (const [d, total] of points) {
    if (d > day) break;
    v = total;
  }
  return v;
}

export interface Breakdowns {
  ratings: { rating: number; reads: number }[]; // 0.5 to 5 in half steps, only ones present
  unrated: number;
  lengths: { label: string; reads: number }[];
  authors: { author: string; reads: number; books: number }[]; // top 8
}

const LENGTHS: { label: string; max: number }[] = [
  { label: "Under 200", max: 199 },
  { label: "200–299", max: 299 },
  { label: "300–399", max: 399 },
  { label: "400–499", max: 499 },
  { label: "500+", max: Infinity },
];

/** Rating, length and author breakdowns for one year, or all time when `year` is null. */
export function breakdowns(events: ReadEvent[], year: number | null): Breakdowns {
  const list = year == null ? events : events.filter((e) => yearOf(e) === year);
  const ratingCounts = new Map<number, number>();
  for (const e of list) if (e.rating) ratingCounts.set(e.rating, (ratingCounts.get(e.rating) ?? 0) + 1);
  const ratings = [...ratingCounts.entries()].sort((a, b) => b[0] - a[0]).map(([rating, reads]) => ({ rating, reads }));

  const lengths = LENGTHS.map((l) => ({ label: l.label, reads: 0 }));
  for (const e of list) {
    if (!e.pages) continue;
    lengths[LENGTHS.findIndex((l) => e.pages! <= l.max)].reads++;
  }

  const byAuthor = new Map<string, { author: string; reads: number; books: Set<string> }>();
  for (const e of list) {
    if (!e.author) continue;
    const k = e.author.toLowerCase();
    const a = byAuthor.get(k) ?? { author: e.author, reads: 0, books: new Set<string>() };
    a.reads++;
    a.books.add(e.bookId);
    byAuthor.set(k, a);
  }
  const authors = [...byAuthor.values()]
    .map((a) => ({ author: a.author, reads: a.reads, books: a.books.size }))
    .sort((a, b) => b.reads - a.reads || a.author.localeCompare(b.author))
    .slice(0, 8);

  return { ratings, unrated: list.filter((e) => !e.rating).length, lengths, authors };
}
