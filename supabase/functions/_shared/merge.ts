import { normalizeTitle } from "./openlibrary.ts";
import type { Book, BookFields, Shelf } from "./types.ts";

/**
 * Work out how imported books (Goodreads CSV/RSS) land in the library without
 * duplicating anything or losing local decisions.
 *
 * Matching: Goodreads id → ISBN-13 → ISBN-10 → normalized title + author.
 * Shelf rules:
 *   - "read" and "currently_reading" from Goodreads always win (it's the reading log).
 *   - A Goodreads "to_read" never demotes a book already on Next Up / Reading / Read here.
 * Fields: imported values fill blanks; Goodreads-owned fields (rating, dates,
 * read count, goodreads id, community average rating) overwrite.
 */
export interface MergePlan {
  inserts: BookFields[];
  updates: { id: string; patch: Partial<BookFields> }[];
  unchanged: number;
}

const SHELF_RANK: Record<Shelf, number> = { to_read: 0, next_up: 1, currently_reading: 2, read: 3 };

function key(b: Pick<BookFields, "title" | "author">): string {
  return `${normalizeTitle(b.title)}|${(b.author ?? "").toLowerCase().replace(/[^\p{L}]+/gu, "")}`;
}

export function planMerge(existing: Book[], incoming: BookFields[]): MergePlan {
  const byGr = new Map<string, Book>();
  const byIsbn = new Map<string, Book>();
  const byKey = new Map<string, Book>();
  const index = (b: Book) => {
    if (b.goodreads_id) byGr.set(b.goodreads_id, b);
    if (b.isbn13) byIsbn.set(b.isbn13, b);
    if (b.isbn10) byIsbn.set(b.isbn10, b);
    byKey.set(key(b), b);
  };
  existing.forEach(index);

  const plan: MergePlan = { inserts: [], updates: [], unchanged: 0 };
  let unchanged = 0;
  const pending = new Map<string, Partial<BookFields>>();
  const insertedKeys = new Map<string, BookFields>();

  for (const inc of incoming) {
    const match =
      (inc.goodreads_id && byGr.get(inc.goodreads_id)) ||
      (inc.isbn13 && byIsbn.get(inc.isbn13)) ||
      (inc.isbn10 && byIsbn.get(inc.isbn10)) ||
      byKey.get(key(inc));

    if (!match) {
      // Same book twice in one import (e.g. RSS pages overlap): keep the first.
      const k = inc.goodreads_id ?? key(inc);
      if (!insertedKeys.has(k)) {
        insertedKeys.set(k, inc);
        plan.inserts.push(inc);
      }
      continue;
    }

    const current = { ...match, ...(pending.get(match.id) ?? {}) };
    const patch: Partial<BookFields> = { ...(pending.get(match.id) ?? {}) };
    const set = <K extends keyof BookFields>(k: K, v: BookFields[K]) => {
      if (v !== current[k]) (patch as Record<string, unknown>)[k] = v;
    };

    // Shelf
    const incomingWins =
      inc.shelf === "read" ||
      inc.shelf === "currently_reading" ||
      SHELF_RANK[inc.shelf] > SHELF_RANK[current.shelf];
    if (incomingWins && inc.shelf !== current.shelf) {
      set("shelf", inc.shelf);
      if (inc.shelf !== "next_up") set("position", null);
    }

    // Goodreads-owned fields
    if (inc.goodreads_id) set("goodreads_id", inc.goodreads_id);
    if (inc.my_rating != null) set("my_rating", inc.my_rating);
    if (inc.date_read && (!current.date_read || inc.date_read > current.date_read)) set("date_read", inc.date_read);
    if (inc.read_count > current.read_count) set("read_count", inc.read_count);
    if (inc.date_added && (!current.date_added || inc.date_added < current.date_added)) set("date_added", inc.date_added);

    // Goodreads' community average changes over time: keep it current.
    if (inc.avg_rating != null) set("avg_rating", inc.avg_rating);

    // Fill blanks
    for (const k of ["author", "isbn13", "isbn10", "cover_url", "pages", "published_year"] as const) {
      if (current[k] == null && inc[k] != null) set(k, inc[k] as never);
    }

    const before = Object.keys(pending.get(match.id) ?? {}).length;
    if (Object.keys(patch).length > before) pending.set(match.id, patch);
    else unchanged++;
  }

  for (const [id, patch] of pending) plan.updates.push({ id, patch });
  plan.unchanged = unchanged;
  return plan;
}

/**
 * Ratings from saved Goodreads "My Books" pages: update the community average
 * and ratings count for books already in the library (matched by Goodreads id,
 * then ISBN, then title + author). Fills a missing Goodreads id or page count
 * too. Never adds books.
 */
export function planRatingUpdates(
  existing: Book[],
  rows: { goodreads_id: string | null; title: string; author: string | null; avg_rating: number | null; ratings_count: number | null; pages: number | null; isbn13: string | null; isbn10: string | null }[],
): { updates: { id: string; patch: Partial<BookFields> }[]; matched: number; unmatched: string[] } {
  const byGr = new Map(existing.filter((b) => b.goodreads_id).map((b) => [b.goodreads_id!, b]));
  const byIsbn = new Map<string, Book>();
  for (const b of existing) {
    if (b.isbn13) byIsbn.set(b.isbn13, b);
    if (b.isbn10) byIsbn.set(b.isbn10, b);
  }
  const byKey = new Map(existing.map((b) => [key(b), b]));
  const updates = new Map<string, Partial<BookFields>>();
  const unmatched: string[] = [];
  let matched = 0;
  for (const r of rows) {
    const b =
      (r.goodreads_id && byGr.get(r.goodreads_id)) ||
      (r.isbn13 && byIsbn.get(r.isbn13)) ||
      (r.isbn10 && byIsbn.get(r.isbn10)) ||
      byKey.get(key(r));
    if (!b) {
      unmatched.push(r.title);
      continue;
    }
    matched++;
    const patch: Partial<BookFields> = {};
    if (r.avg_rating != null && r.avg_rating !== b.avg_rating) patch.avg_rating = r.avg_rating;
    if (r.ratings_count != null && r.ratings_count !== b.ratings_count) patch.ratings_count = r.ratings_count;
    if (!b.goodreads_id && r.goodreads_id) patch.goodreads_id = r.goodreads_id;
    if (b.pages == null && r.pages != null) patch.pages = r.pages;
    if (Object.keys(patch).length) updates.set(b.id, { ...(updates.get(b.id) ?? {}), ...patch });
  }
  return { updates: [...updates].map(([id, patch]) => ({ id, patch })), matched, unmatched };
}
