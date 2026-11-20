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
    published_year: doc.first_publish_year ?? null,
  };
}

/**
 * Search Open Library. With an author, search title+author fields; otherwise a
 * free-text query (handles "Fourth Wing Rebecca Yarros" typed into one box).
 */
export async function searchOpenLibrary(
  query: { title: string; author?: string | null },
  opts: { limit?: number; fetchFn?: FetchFn } = {},
): Promise<BookCandidate[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const params = new URLSearchParams({ fields: FIELDS, limit: String(opts.limit ?? 5) });
  if (query.author) {
    params.set("title", query.title);
    params.set("author", query.author);
  } else {
    params.set("q", query.title);
  }
  const res = await fetchFn(`https://openlibrary.org/search.json?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Open Library search failed (${res.status})`);
  const body = (await res.json()) as { docs?: OpenLibraryDoc[] };
  let results = (body.docs ?? []).map(docToCandidate).filter((c): c is BookCandidate => c !== null);

  // An author-qualified search can miss when the author is misspelled; fall back to free text.
  if (results.length === 0 && query.author) {
    return searchOpenLibrary({ title: `${query.title} ${query.author}` }, opts);
  }
  // Exact title matches first (so "Dune Messiah" beats "Dune"), then the work
  // people actually read (most ratings), keeping Open Library's order for ties.
  const wanted = normalizeTitle(query.title);
  const exact = (c: BookCandidate) => (normalizeTitle(c.title) === wanted ? 1 : 0);
  results = results
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        exact(b.c) - exact(a.c) ||
        (b.c.ratings_count ?? 0) - (a.c.ratings_count ?? 0) ||
        a.i - b.i,
    )
    .map(({ c }) => c);
  return results;
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
