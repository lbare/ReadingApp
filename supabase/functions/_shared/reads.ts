import type { Book, ReadRow } from "./types.ts";

type NewRead = Pick<ReadRow, "book_id" | "date_finished" | "source">;

/**
 * Reads implied by the books table that aren't recorded yet: a finished book
 * whose finish date has no read row. Covers imports, Goodreads sync and the
 * Finished button, and is safe to run any number of times.
 */
export function missingReads(books: Pick<Book, "id" | "shelf" | "date_read" | "source">[], reads: Pick<ReadRow, "book_id" | "date_finished">[]): NewRead[] {
  const have = new Set(reads.map((r) => `${r.book_id}|${r.date_finished}`));
  return books
    .filter((b) => b.shelf === "read" && b.date_read && !have.has(`${b.id}|${b.date_read}`))
    .map((b) => ({
      book_id: b.id,
      date_finished: b.date_read,
      source: b.source === "goodreads_csv" || b.source === "goodreads_rss" ? b.source : "app",
    }));
}

/** One finished read, joined with its book. */
export interface ReadEvent {
  date: string; // YYYY-MM-DD
  bookId: string;
  title: string;
  author: string | null;
  pages: number | null;
  rating: number | null;
  /** Not the first time this book was finished. */
  reread: boolean;
}

/**
 * Turn reads into dated events for stats, oldest first. Finished books with no
 * dated read are counted as `undated`. `extraReads` lists books Goodreads says
 * were read more times than there are dates for.
 */
export function buildReadEvents(
  books: Pick<Book, "id" | "title" | "author" | "pages" | "my_rating" | "shelf" | "read_count">[],
  reads: Pick<ReadRow, "book_id" | "date_finished">[],
): { events: ReadEvent[]; undated: number; extraReads: { bookId: string; title: string; missing: number }[] } {
  const byId = new Map(books.map((b) => [b.id, b]));
  const dated = reads
    .filter((r) => r.date_finished && byId.has(r.book_id))
    .sort((a, b) => a.date_finished!.localeCompare(b.date_finished!));
  const seen = new Set<string>();
  const perBook = new Map<string, number>();
  const events = dated.map((r) => {
    const b = byId.get(r.book_id)!;
    const reread = seen.has(b.id);
    seen.add(b.id);
    perBook.set(b.id, (perBook.get(b.id) ?? 0) + 1);
    return { date: r.date_finished!, bookId: b.id, title: b.title, author: b.author, pages: b.pages, rating: b.my_rating, reread };
  });
  const finished = books.filter((b) => b.shelf === "read");
  const undated = finished.filter((b) => !perBook.has(b.id)).length;
  const extraReads = finished
    .map((b) => ({ bookId: b.id, title: b.title, missing: b.read_count - Math.max(perBook.get(b.id) ?? 0, 1) }))
    .filter((x) => x.missing > 0);
  return { events, undated, extraReads };
}
