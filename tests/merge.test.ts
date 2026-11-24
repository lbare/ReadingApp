import { describe, expect, it } from "vitest";
import { planMerge } from "../supabase/functions/_shared/merge.ts";
import { type Book, type BookFields, emptyBook } from "../supabase/functions/_shared/types.ts";

let n = 0;
const book = (f: Partial<BookFields> & { title: string; shelf: BookFields["shelf"] }): Book => ({
  ...emptyBook(f),
  id: `id${++n}`,
  created_at: "",
  updated_at: "",
});

describe("planMerge", () => {
  it("inserts unknown books once", () => {
    const inc = emptyBook({ title: "New", shelf: "read", goodreads_id: "9" });
    const plan = planMerge([], [inc, { ...inc }]);
    expect(plan.inserts).toHaveLength(1);
  });

  it("does not demote Next Up to To-Read", () => {
    const local = book({ title: "Fourth Wing", author: "Rebecca Yarros", shelf: "next_up", position: 1 });
    const plan = planMerge([local], [emptyBook({ title: "Fourth Wing (The Empyrean, #1)", author: "Rebecca Yarros", shelf: "to_read", goodreads_id: "61431922" })]);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ id: local.id, patch: { goodreads_id: "61431922" } }]);
  });

  it("moves to Read when Goodreads says read, filling blanks", () => {
    const local = book({ title: "Dune", author: "Frank Herbert", shelf: "next_up", position: 2, isbn13: "9780441172719" });
    const plan = planMerge([local], [
      emptyBook({ title: "Dune", author: "Frank Herbert", shelf: "read", isbn13: "9780441172719", date_read: "2025-02-01", my_rating: 5, read_count: 1, pages: 658 }),
    ]);
    expect(plan.updates[0].patch).toMatchObject({ shelf: "read", position: null, date_read: "2025-02-01", my_rating: 5, read_count: 1, pages: 658 });
  });

  it("reports unchanged rows", () => {
    const local = book({ title: "Same", shelf: "read", goodreads_id: "1", date_read: "2024-01-01", read_count: 1 });
    const plan = planMerge([local], [emptyBook({ title: "Same", shelf: "read", goodreads_id: "1", date_read: "2024-01-01", read_count: 1 })]);
    expect(plan).toMatchObject({ inserts: [], updates: [], unchanged: 1 });
  });
});

describe("average rating", () => {
  it("takes Goodreads' current average even when one is already stored", () => {
    const local = book({ title: "Dune", author: "Frank Herbert", shelf: "to_read", goodreads_id: "1", avg_rating: 4.1 });
    const plan = planMerge([local], [emptyBook({ title: "Dune", author: "Frank Herbert", shelf: "to_read", goodreads_id: "1", avg_rating: 4.27 })]);
    expect(plan.updates).toEqual([{ id: local.id, patch: { avg_rating: 4.27 } }]);
  });
  it("leaves it alone when the import has none (exports without that column)", () => {
    const local = book({ title: "Dune", author: "Frank Herbert", shelf: "to_read", goodreads_id: "1", avg_rating: 4.1 });
    expect(planMerge([local], [emptyBook({ title: "Dune", author: "Frank Herbert", shelf: "to_read", goodreads_id: "1" })]).unchanged).toBe(1);
  });
});
