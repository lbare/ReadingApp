// Shared between the web app (Vite) and the edge functions (Deno).
// Keep this folder free of runtime-specific APIs and third-party imports.

export type Shelf = "next_up" | "to_read" | "currently_reading" | "read";

export type BookSource =
  | "manual"
  | "tiktok"
  | "screenshot"
  | "text"
  | "goodreads_csv"
  | "goodreads_rss";

export interface BookFields {
  title: string;
  author: string | null;
  isbn13: string | null;
  isbn10: string | null;
  goodreads_id: string | null;
  ol_work_key: string | null;
  cover_url: string | null;
  pages: number | null;
  avg_rating: number | null;
  ratings_count: number | null;
  published_year: number | null;
  shelf: Shelf;
  position: number | null;
  my_rating: number | null;
  date_added: string | null; // YYYY-MM-DD
  date_started: string | null;
  date_read: string | null;
  read_count: number;
  source: BookSource;
  source_url: string | null;
}

export interface Book extends BookFields {
  id: string;
  created_at: string;
  updated_at: string;
}

/** A possible match for a title/author pulled out of a capture. */
export interface BookCandidate {
  title: string;
  author: string | null;
  ol_work_key: string | null;
  isbn13: string | null;
  isbn10: string | null;
  cover_url: string | null;
  pages: number | null;
  avg_rating: number | null;
  ratings_count: number | null;
  /** Open Library readers who shelved it (popularity). Missing on captures made before it was added. */
  readers?: number | null;
  published_year: number | null;
}

export type CaptureDecision = "next_up" | "to_read" | "skipped";

export interface CaptureItem {
  query: { title: string; author: string | null };
  candidates: BookCandidate[];
  decision: CaptureDecision | null;
  book_id: string | null;
}

export interface Capture {
  id: string;
  created_at: string;
  source_type: "tiktok" | "screenshot" | "text";
  source_url: string | null;
  raw_text: string | null;
  items: CaptureItem[];
  status: "pending" | "done";
  error: string | null;
}

export interface Settings {
  yearly_goal: number;
  goodreads_user_id: string | null;
  goodreads_rss_key: string | null;
  goodreads_last_sync: string | null;
  goodreads_last_result: string | null;
}

export const SHELF_LABEL: Record<Shelf, string> = {
  next_up: "Next Up",
  to_read: "To-Read",
  currently_reading: "Reading",
  read: "Read",
};

export function emptyBook(partial: Partial<BookFields> & { title: string; shelf: Shelf }): BookFields {
  return {
    author: null,
    isbn13: null,
    isbn10: null,
    goodreads_id: null,
    ol_work_key: null,
    cover_url: null,
    pages: null,
    avg_rating: null,
    ratings_count: null,
    published_year: null,
    position: null,
    my_rating: null,
    date_added: null,
    date_started: null,
    date_read: null,
    read_count: 0,
    source: "manual",
    source_url: null,
    ...partial,
  };
}

export function candidateToBook(
  c: BookCandidate,
  shelf: Shelf,
  source: BookSource,
  sourceUrl: string | null,
  today: string,
): BookFields {
  return emptyBook({
    title: c.title,
    author: c.author,
    isbn13: c.isbn13,
    isbn10: c.isbn10,
    ol_work_key: c.ol_work_key,
    cover_url: c.cover_url,
    pages: c.pages,
    avg_rating: c.avg_rating,
    ratings_count: c.ratings_count,
    published_year: c.published_year,
    shelf,
    date_added: today,
    source,
    source_url: sourceUrl,
  });
}
