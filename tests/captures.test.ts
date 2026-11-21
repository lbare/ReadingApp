import { describe, expect, it } from "vitest";
import { groupSlots } from "../src/components/CaptureList.tsx";
import type { BookCandidate, Capture, CaptureItem } from "../supabase/functions/_shared/types.ts";

const cand = (title: string, author: string): BookCandidate => ({
  title, author, ol_work_key: null, isbn13: null, isbn10: null, cover_url: null, pages: null, avg_rating: null, ratings_count: null, published_year: null,
});
const item = (c: BookCandidate | null, q = "x"): CaptureItem => ({ query: { title: c?.title ?? q, author: c?.author ?? null }, candidates: c ? [c] : [], decision: null, book_id: null });
const capture = (id: string, items: CaptureItem[]): Capture => ({ id, created_at: "", source_type: "screenshot", source_url: null, raw_text: null, items, status: "pending", error: null });

describe("groupSlots", () => {
  it("folds the same book across and within captures, keeping first-seen order", () => {
    const a = capture("a", [item(cand("Rebecca", "Daphne du Maurier")), item(cand("Cows", "Matthew Stokoe"))]);
    const b = capture("b", [item(cand("Rebecca (Virago Modern Classics)", "Daphne Du Maurier")), item(cand("The Road", "Cormac McCarthy")), item(cand("Cows", "Matthew Stokoe"))]);
    const map = new Map([["a", a], ["b", b]]);
    const slots = [...a.items.map((_, index) => ({ captureId: "a", index })), ...b.items.map((_, index) => ({ captureId: "b", index }))];
    const groups = groupSlots(map, slots);
    expect(groups.map((g) => g.map((s) => `${s.captureId}${s.index}`))).toEqual([["a0", "b0"], ["a1", "b2"], ["b1"]]);
  });
});
