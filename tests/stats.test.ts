import { describe, expect, it } from "vitest";
import { computeStats } from "../supabase/functions/_shared/stats.ts";
import { emptyBook } from "../supabase/functions/_shared/types.ts";

const read = (date_read: string | null, pages: number | null, my_rating: number | null = null) =>
  emptyBook({ title: `B ${date_read}`, shelf: "read", date_read, pages, my_rating });

describe("computeStats", () => {
  const books = [
    read("2023-05-01", 300),
    read("2025-01-10", 200, 4),
    read("2025-01-10", 100, 5),
    read("2025-03-02", null),
    read(null, 250),
    emptyBook({ title: "tbr", shelf: "to_read", pages: 999 }),
  ];
  const s = computeStats(books, 52, "2025-03-31");

  it("totals all time, counting undated reads", () => {
    expect(s.allTime).toEqual({ books: 5, pages: 850, undated: 1 });
  });

  it("fills year gaps", () => {
    expect(s.years.map((y) => [y.year, y.books])).toEqual([[2023, 1], [2024, 0], [2025, 3]]);
  });

  it("breaks down the year", () => {
    expect(s.yearBooks).toBe(3);
    expect(s.yearPages).toBe(300);
    expect(s.months[0]).toEqual({ month: 1, books: 2, pages: 300 });
    expect(s.heatmap.get("2025-01-10")).toBe(2);
    expect(s.avgRating).toBe(4.5);
    expect(s.avgPagesPerBook).toBe(150);
  });

  it("computes pace toward the goal", () => {
    // Day 90 of 365: expected 52*90/365 ≈ 12.8
    expect(s.pace!.dayOfYear).toBe(90);
    expect(s.pace!.expected).toBeCloseTo(12.82, 1);
    expect(s.pace!.delta).toBeCloseTo(-9.82, 1);
    expect(s.pace!.projected).toBe(12);
  });

  it("has no pace for past years", () => {
    expect(computeStats(books, 52, "2025-03-31", 2023).pace).toBeNull();
  });
});
