import { describe, expect, it } from "vitest";
import { buildReadEvents, missingReads } from "../supabase/functions/_shared/reads.ts";
import { breakdowns, computeStats, cumulative, valueAt } from "../supabase/functions/_shared/stats.ts";
import { type Book, type BookFields, emptyBook } from "../supabase/functions/_shared/types.ts";

let n = 0;
const book = (f: Partial<BookFields> & { title: string }): Book => ({
  ...emptyBook({ shelf: "read", ...f }),
  id: `b${++n}`,
  created_at: "",
  updated_at: "",
});

// A small library: one reread (Verity, 2023 and 2026), one undated read.
const verity = book({ title: "Verity", author: "Colleen Hoover", pages: 336, my_rating: 5, date_read: "2023-10-25", read_count: 2 });
const phm = book({ title: "Project Hail Mary", author: "Andy Weir", pages: 476, my_rating: 5, date_read: "2023-09-06", read_count: 2 });
const a = book({ title: "A", author: "Andy Weir", pages: 200, my_rating: 3.5, date_read: "2025-01-10" });
const b = book({ title: "B", author: "Someone", pages: 100, my_rating: 4, date_read: "2025-01-10" });
const c = book({ title: "C", author: "Someone", pages: null, date_read: "2026-03-02" });
const undatedBook = book({ title: "Old", pages: 250 });
const tbr = book({ title: "TBR", shelf: "to_read", pages: 999 });
const books = [verity, phm, a, b, c, undatedBook, tbr];

const reads = [
  ...missingReads(books, []),
  { book_id: verity.id, date_finished: "2026-02-14" }, // the reread
];

describe("missingReads", () => {
  it("adds one read per finished, dated book and nothing twice", () => {
    expect(missingReads(books, []).map((r) => r.book_id)).toEqual([verity.id, phm.id, a.id, b.id, c.id]);
    expect(missingReads(books, reads)).toEqual([]);
  });
});

describe("buildReadEvents", () => {
  const { events, undated, extraReads } = buildReadEvents(books, reads);
  it("orders reads and marks rereads", () => {
    expect(events.map((e) => `${e.title}@${e.date}${e.reread ? "*" : ""}`)).toEqual([
      "Project Hail Mary@2023-09-06",
      "Verity@2023-10-25",
      "A@2025-01-10",
      "B@2025-01-10",
      "Verity@2026-02-14*",
      "C@2026-03-02",
    ]);
    expect(undated).toBe(1);
  });
  it("flags books read more times than there are dates for", () => {
    expect(extraReads).toEqual([{ bookId: phm.id, title: "Project Hail Mary", missing: 1 }]);
  });
});

describe("computeStats", () => {
  const { events, undated } = buildReadEvents(books, reads);
  const s = computeStats(events, undated, 20, "2026-03-31");

  it("counts reads, including rereads, and distinct books", () => {
    expect(s.allTime).toEqual({ books: 6, reads: 7, pages: 336 + 476 + 200 + 100 + 336, undated: 1 });
  });

  it("summarizes each year, filling gaps", () => {
    expect(s.years.map((y) => [y.year, y.books])).toEqual([[2023, 2], [2024, 0], [2025, 2], [2026, 2]]);
    expect(s.summary).toMatchObject({ year: 2026, books: 2, pages: 336, rereads: 1, avgRating: 5, busiestMonth: { month: 2, books: 1 } });
    const y2025 = s.years.find((y) => y.year === 2025)!;
    expect(y2025).toMatchObject({ avgPages: 150, avgRating: 3.8, authors: 2, longest: { title: "A" }, shortest: { title: "B" } });
  });

  it("builds the month grid and day list", () => {
    expect(s.monthGrid.get(2025)![0]).toBe(2);
    expect(s.days.get("2026-02-14")).toEqual(["Verity"]);
  });

  it("compares every year at the same date", () => {
    // By Mar 31: 2023 none, 2025 both January reads, 2026 both.
    expect(s.sameDate.map((x) => [x.year, x.books])).toEqual([[2023, 0], [2024, 0], [2025, 2], [2026, 2]]);
  });

  it("computes pace toward the goal", () => {
    expect(s.pace).toMatchObject({ goal: 20, read: 2, dayOfYear: 90 });
    expect(s.pace!.expected).toBeCloseTo(4.93, 1);
  });

  it("has no pace for past years", () => {
    expect(computeStats(events, undated, 20, "2026-03-31", 2025).pace).toBeNull();
  });
});

describe("cumulative", () => {
  const { events } = buildReadEvents(books, reads);
  it("steps through the year and stops at today", () => {
    const pts = cumulative(events, 2026, "books", "2026-03-31");
    expect(pts).toEqual([[0, 0], [45, 1], [61, 2], [90, 2]]);
    expect(valueAt(pts, 50)).toBe(1);
  });
  it("runs past years to Dec 31 and can sum pages", () => {
    const pts = cumulative(events, 2025, "pages", "2026-03-31");
    expect(pts).toEqual([[0, 0], [10, 300], [365, 300]]);
  });
});

describe("breakdowns", () => {
  const { events } = buildReadEvents(books, reads);
  it("counts ratings, lengths and authors", () => {
    const all = breakdowns(events, null);
    expect(all.ratings).toEqual([{ rating: 5, reads: 3 }, { rating: 4, reads: 1 }, { rating: 3.5, reads: 1 }]);
    expect(all.unrated).toBe(1);
    expect(all.lengths.map((l) => l.reads)).toEqual([1, 1, 2, 1, 0]);
    expect(all.authors[0]).toEqual({ author: "Andy Weir", reads: 2, books: 2 });
    expect(all.authors.find((x) => x.author === "Colleen Hoover")).toEqual({ author: "Colleen Hoover", reads: 2, books: 1 });
  });
  it("can be limited to one year", () => {
    expect(breakdowns(events, 2025).authors.map((x) => x.author)).toEqual(["Andy Weir", "Someone"]);
  });
});
