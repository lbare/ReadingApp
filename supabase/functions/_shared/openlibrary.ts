import type { BookCandidate } from "./types.ts";

type FetchFn = typeof fetch;

const FIELDS = [
  "key",
  "title",
  "author_name",
  "first_publish_year",
  "isbn",
  "number_of_pages_median",
  "cover_i",
  "ratings_average",
  "ratings_count",
  "readinglog_count",
].join(",");

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  number_of_pages_median?: number;
  cover_i?: number;
  ratings_average?: number;
  ratings_count?: number;
  readinglog_count?: number;
}

export function docToCandidate(doc: OpenLibraryDoc): BookCandidate | null {
  if (!doc.title) return null;
  const isbns = doc.isbn ?? [];
  return {
    title: doc.title,
    author: doc.author_name?.[0] ?? null,
    ol_work_key: doc.key ?? null,
    // Prefer English-language editions (978-0 / 978-1) so the Goodreads link opens one.
    isbn13: isbns.find((i) => /^978[01]\d{9}$/.test(i)) ?? isbns.find((i) => /^97[89]\d{10}$/.test(i)) ?? null,
    isbn10: isbns.find((i) => /^[01]\d{8}[\dX]$/.test(i)) ?? isbns.find((i) => i.length === 10) ?? null,
    cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    pages: doc.number_of_pages_median ?? null,
    avg_rating: doc.ratings_average != null ? Math.round(doc.ratings_average * 100) / 100 : null,
    ratings_count: doc.ratings_count ?? null,
    readers: doc.readinglog_count ?? null,
    published_year: doc.first_publish_year ?? null,
  };
}

/** How many Open Library readers shelved it: a better popularity signal than star ratings. */
const popularity = (c: BookCandidate) => c.readers ?? c.ratings_count ?? 0;

/** Same book, different Open Library work (duplicate entries, other editions). */
const sameBook = (a: BookCandidate, b: BookCandidate) =>
  normalizeTitle(a.title) === normalizeTitle(b.title) && normAuthor(a.author) === normAuthor(b.author);

const normAuthor = (a: string | null) => (a ?? "").toLowerCase().replace(/[^\p{L}]/gu, "");

/** Keep the most popular entry of each book, in the order given. */
export function dedupe(list: BookCandidate[]): BookCandidate[] {
  const out: BookCandidate[] = [];
  for (const c of list) {
    const i = out.findIndex((o) => sameBook(o, c));
    if (i === -1) out.push(c);
    else if (popularity(c) > popularity(out[i])) out[i] = c;
  }
  return out;
}

/** Exact title matches first (so "Dune Messiah" beats "Dune"), then most readers. */
export function rank(list: BookCandidate[], title: string): BookCandidate[] {
  const wanted = normalizeTitle(title);
  const exact = (c: BookCandidate) => (normalizeTitle(c.title) === wanted ? 1 : 0);
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => exact(b.c) - exact(a.c) || popularity(b.c) - popularity(a.c) || a.i - b.i)
    .map(({ c }) => c);
}

async function query(params: URLSearchParams, fetchFn: FetchFn): Promise<BookCandidate[]> {
  const res = await fetchFn(`https://openlibrary.org/search.json?${params}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Open Library search failed (${res.status})`);
  const body = (await res.json()) as { docs?: OpenLibraryDoc[] };
  return (body.docs ?? []).map(docToCandidate).filter((c): c is BookCandidate => c !== null);
}

/**
 * Search Open Library. With an author, search title+author fields; otherwise a
 * free-text query (handles "Fourth Wing Rebecca Yarros" typed into one box).
 */
export async function searchOpenLibrary(
  q: { title: string; author?: string | null },
  opts: { limit?: number; fetchFn?: FetchFn } = {},
): Promise<BookCandidate[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const params = new URLSearchParams({ fields: FIELDS, limit: String(opts.limit ?? 5) });
  if (q.author) {
    params.set("title", q.title);
    params.set("author", q.author);
  } else {
    params.set("q", q.title);
  }
  const results = await query(params, fetchFn);

  // An author-qualified search can miss when the author is misspelled; fall back to free text.
  if (results.length === 0 && q.author) return searchOpenLibrary({ title: `${q.title} ${q.author}` }, opts);
  return rank(dedupe(results), q.title);
}

/**
 * Matches for a book pulled out of a capture: the best title+author match
 * first, then other likely books with that title (most readers first), so a
 * wrong author guess still leaves the right book one tap away.
 */
export async function findCandidates(
  q: { title: string; author: string | null },
  opts: { limit?: number; fetchFn?: FetchFn } = {},
): Promise<BookCandidate[]> {
  const limit = opts.limit ?? 5;
  const [byAuthor, byTitle] = await Promise.all([
    q.author ? searchOpenLibrary(q, { ...opts, limit }).catch(() => []) : Promise.resolve([]),
    (async () => {
      const params = new URLSearchParams({ fields: FIELDS, limit: "10", title: q.title });
      return rank(dedupe(await query(params, opts.fetchFn ?? fetch)), q.title);
    })().catch(() => [] as BookCandidate[]),
  ]);
  const best = byAuthor[0] ?? byTitle[0];
  if (!best) return [];
  const rest = rank(dedupe([...byAuthor.slice(1), ...byTitle]).filter((c) => !sameBook(c, best)), q.title);
  return [best, ...rest].slice(0, limit);
}

/** Lowercase, drop subtitles/series info and punctuation: "Dune (Dune #1)" → "dune". */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/:.*$/, " ")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
