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
 * read count, goodreads id) overwrite.
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

    // Fill blanks
    for (const k of ["author", "isbn13", "isbn10", "cover_url", "pages", "avg_rating", "published_year"] as const) {
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
