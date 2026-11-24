import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { type Book, type BookCandidate, type Capture, type ReadRow, type Shelf, SHELF_LABEL, candidateToBook } from "../../supabase/functions/_shared/types.ts";
import { bookKey } from "../../supabase/functions/_shared/openlibrary.ts";
import { BookSearch } from "../components/BookSearch.tsx";
import { Cover, GoodreadsLink, Stars, bookMeta } from "../components/BookBits.tsx";
import { ReadDates } from "../components/ReadDates.tsx";
import { localToday } from "../lib/dates.ts";
import { addRead, shelveBook, store } from "../lib/store.ts";

const TABS: Shelf[] = ["next_up", "to_read", "currently_reading", "read"];
const PAGE = 50;

type SortKey = "order" | "date" | "title" | "pages" | "rating";
interface SortBy {
  key: SortKey;
  desc: boolean;
}
const SORT_KEYS: Record<Shelf, SortKey[]> = {
  next_up: ["order", "date", "title", "pages", "rating"],
  to_read: ["date", "title", "pages", "rating"],
  currently_reading: ["date", "title", "pages", "rating"],
  read: ["date", "title", "pages", "rating"],
};
// Newest, longest and highest-rated first; titles A–Z.
const DEFAULT_DESC: Record<SortKey, boolean> = { order: false, date: true, title: false, pages: true, rating: true };
const DEFAULT_SORT: Record<Shelf, SortBy> = {
  next_up: { key: "order", desc: false },
  to_read: { key: "date", desc: true },
  currently_reading: { key: "date", desc: true },
  read: { key: "date", desc: true },
};

/** 4364928 → "4.4M", 12500 → "13k". */
function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function sortLabel(key: SortKey, shelf: Shelf): string {
  if (key === "date") return shelf === "read" ? "Date read" : shelf === "currently_reading" ? "Date started" : "Date added";
  return { order: "Your order", title: "Title", pages: "Pages", rating: "Avg rating" }[key];
}

function sortValue(b: Book, key: SortKey, shelf: Shelf): string | number | null {
  switch (key) {
    case "order":
      return b.position;
    case "date":
      return shelf === "read" ? b.date_read : shelf === "currently_reading" ? (b.date_started ?? b.date_added) : b.date_added;
    case "title":
      return b.title.replace(/^(the|a|an)\s+/i, "").toLowerCase();
    case "pages":
      return b.pages;
    case "rating":
      return b.avg_rating;
  }
}

/** Sort a shelf; books missing the value (no pages, no rating…) always go last. */
function sortBooks(list: Book[], by: SortBy, shelf: Shelf): Book[] {
  return [...list].sort((a, b) => {
    const x = sortValue(a, by.key, shelf);
    const y = sortValue(b, by.key, shelf);
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return by.desc ? -c : c;
  });
}

function loadSorts(): Record<Shelf, SortBy> {
  try {
    const saved = JSON.parse(localStorage.getItem("shelf-sort") ?? "{}") as Partial<Record<Shelf, SortBy>>;
    return { ...DEFAULT_SORT, ...saved };
  } catch {
    return { ...DEFAULT_SORT };
  }
}

export function Shelves() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  // ?tab=read&q=Verity opens a shelf filtered (used by links from Stats).
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Shelf>(() => (params.get("tab") as Shelf) ?? (sessionStorageGet("shelf") as Shelf) ?? "next_up");
  const [reads, setReads] = useState<ReadRow[]>([]);
  const [filter, setFilter] = useState(() => params.get("q") ?? "");
  const [limit, setLimit] = useState(PAGE);
  const [sorts, setSorts] = useState<Record<Shelf, SortBy>>(loadSorts);
  const sort = sorts[tab];
  const manualOrder = tab === "next_up" && sort.key === "order";

  function setSort(next: SortBy) {
    const all = { ...sorts, [tab]: next };
    setSorts(all);
    setLimit(PAGE);
    try {
      localStorage.setItem("shelf-sort", JSON.stringify(all));
    } catch {
      /* remembered for this visit only */
    }
  }
  const [picked, setPicked] = useState<BookCandidate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [b, c, r] = await Promise.all([store.listBooks(), store.listPendingCaptures(), store.listReads()]);
      setBooks(b);
      setReads(r);
      setCaptures(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Titles of every book still to sort, across all captures.
  const waiting = useMemo(() => {
    const byKey = new Map<string, string>(); // each book once, even if shared twice
    for (const c of captures)
      for (const i of c.items) if (!i.decision) byKey.set(bookKey(i.candidates[0] ?? i.query), i.candidates[0]?.title ?? i.query.title);
    return [...byKey.values()];
  }, [captures]);

  const byShelf = useMemo(() => {
    const m: Record<Shelf, Book[]> = { next_up: [], to_read: [], currently_reading: [], read: [] };
    for (const b of books ?? []) m[b.shelf].push(b);
    m.next_up.sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
    m.to_read.sort((a, b) => (b.date_added ?? "").localeCompare(a.date_added ?? ""));
    m.read.sort((a, b) => (b.date_read ?? "").localeCompare(a.date_read ?? ""));
    return m;
  }, [books]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = sortBooks(byShelf[tab], sort, tab);
    return q ? list.filter((b) => `${b.title} ${b.author ?? ""}`.toLowerCase().includes(q)) : list;
  }, [byShelf, tab, filter, sort]);

  function selectTab(s: Shelf) {
    setTab(s);
    setFilter("");
    setLimit(PAGE);
    sessionStorageSet("shelf", s);
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addPicked(shelf: "next_up" | "to_read") {
    if (!picked) return;
    await act(async () => {
      const r = await shelveBook(candidateToBook(picked, shelf, "manual", null, localToday()), shelf);
      setNotice(r.kept ? `“${r.book.title}” is already on ${SHELF_LABEL[r.kept]}.` : `Added “${r.book.title}” to ${SHELF_LABEL[shelf]}.`);
      setPicked(null);
    });
  }

  async function move(book: Book, dir: -1 | 1) {
    const list = byShelf.next_up;
    const i = list.findIndex((b) => b.id === book.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const order = [...list];
    [order[i], order[j]] = [order[j], order[i]];
    await act(() => Promise.all(order.map((b, k) => (b.position === k + 1 ? null : store.updateBook(b.id, { position: k + 1 })))));
  }

  const toShelf = (book: Book, shelf: Shelf) =>
    act(() =>
      store.updateBook(book.id, {
        shelf,
        position: shelf === "next_up" ? Math.max(0, ...byShelf.next_up.map((b) => b.position ?? 0)) + 1 : null,
      }),
    );

  const finish = (book: Book) => act(() => addRead(book, localToday()));

  const readsByBook = useMemo(() => {
    const m = new Map<string, ReadRow[]>();
    for (const r of reads) m.set(r.book_id, [...(m.get(r.book_id) ?? []), r]);
    return m;
  }, [reads]);

  const start = (book: Book) => act(() => store.updateBook(book.id, { shelf: "currently_reading", position: null, date_started: localToday() }));

  const remove = (book: Book) => {
    if (window.confirm(`Remove “${book.title}” from your library?`)) act(() => store.deleteBook(book.id));
  };

  return (
    <>
      <div className="page-head">
        <h1>Shelves</h1>
      </div>

      {waiting.length > 0 && (
        <Link to="/waiting" className="card waiting-link" style={{ marginBottom: 16 }}>
          <span>
            <h2>Waiting for you</h2>
            <span className="book-meta" style={{ display: "block" }}>
              {waiting.slice(0, 3).join(", ")}
              {waiting.length > 3 ? ` and ${waiting.length - 3} more` : ""}
            </span>
          </span>
          <span className="pill">{waiting.length} →</span>
        </Link>
      )}

      <div className="card stack">
        <h2>Add a book</h2>
        {picked ? (
          <div className="book">
            <Cover url={picked.cover_url} title={picked.title} />
            <div>
              <div className="book-title">{picked.title}</div>
              <div className="book-meta">{bookMeta(picked)}</div>
              <div className="book-actions">
                <button className="btn-primary btn-sm" onClick={() => addPicked("next_up")}>Next Up</button>
                <button className="btn-soft btn-sm" onClick={() => addPicked("to_read")}>To-Read</button>
                <button className="btn-ghost btn-sm" onClick={() => setPicked(null)}>Cancel</button>
              </div>
            </div>
          </div>
        ) : (
          <BookSearch onPick={(c) => { setPicked(c); setNotice(null); }} />
        )}
        {notice && <p className="muted" role="status">{notice}</p>}
      </div>

      <div className="section">
        <div className="tabs" role="tablist">
          {TABS.map((s) => (
            <button key={s} role="tab" aria-selected={tab === s} onClick={() => selectTab(s)}>
              {SHELF_LABEL[s]}
              <span className="count">{byShelf[s].length}</span>
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}
        {byShelf[tab].length > 1 && (
          <div className="shelf-tools">
            {byShelf[tab].length > 12 && (
              <input type="search" placeholder={`Filter ${SHELF_LABEL[tab]}`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter this shelf" />
            )}
            <div className="sort-control">
              <select
                value={sort.key}
                aria-label="Sort by"
                onChange={(e) => {
                  const key = e.target.value as SortKey;
                  setSort({ key, desc: DEFAULT_DESC[key] });
                }}
              >
                {SORT_KEYS[tab].map((k) => (
                  <option key={k} value={k}>{sortLabel(k, tab)}</option>
                ))}
              </select>
              {sort.key !== "order" && (
                <button
                  className="icon-btn"
                  aria-label={sort.desc ? "Descending, tap for ascending" : "Ascending, tap for descending"}
                  title={sort.desc ? "Descending" : "Ascending"}
                  onClick={() => setSort({ ...sort, desc: !sort.desc })}
                >
                  {sort.desc ? "↓" : "↑"}
                </button>
              )}
            </div>
          </div>
        )}

        {books === null ? (
          <p className="muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="muted">{emptyText(tab, filter)}</p>
        ) : (
          <div className="card list">
            {shown.slice(0, limit).map((b, i) => (
              <div key={b.id} className="list-item book">
                <Cover url={b.cover_url} title={b.title} />
                <div>
                  <div className="book-title">{b.title}</div>
                  <div className="book-meta">
                    {bookMeta(b)}
                    {b.avg_rating != null && (
                      <span className={sort.key === "rating" ? "avg-rating is-sorted" : "avg-rating"}>
                        {" "}· ★ {b.avg_rating.toFixed(2)} avg
                        {b.ratings_count ? <span className="muted" title={`${b.ratings_count.toLocaleString()} ratings`}> ({compactCount(b.ratings_count)})</span> : null}
                      </span>
                    )}
                  </div>
                  {tab === "read" && (
                    <>
                      <Stars value={b.my_rating} />
                      <ReadDates book={b} reads={readsByBook.get(b.id) ?? []} onChange={reload} />
                    </>
                  )}
                  <div className="book-actions">
                    {tab === "next_up" && (
                      <>
                        {manualOrder && (
                          <>
                            <button className="icon-btn" aria-label="Move up" disabled={i === 0 || !!filter} onClick={() => move(b, -1)}>↑</button>
                            <button className="icon-btn" aria-label="Move down" disabled={i === shown.length - 1 || !!filter} onClick={() => move(b, 1)}>↓</button>
                          </>
                        )}
                        <button className="btn-sm" onClick={() => start(b)}>Start reading</button>
                        <button className="btn-sm" onClick={() => toShelf(b, "to_read")}>To-Read</button>
                      </>
                    )}
                    {tab === "to_read" && (
                      <button className="btn-soft btn-sm" onClick={() => toShelf(b, "next_up")}>Next Up</button>
                    )}
                    {tab === "currently_reading" && (
                      <button className="btn-soft btn-sm" onClick={() => finish(b)}>Finished</button>
                    )}
                    <GoodreadsLink book={b} />
                    {(tab === "next_up" || tab === "to_read") && (
                      <button className="btn-ghost btn-sm" onClick={() => remove(b)}>Remove</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {shown.length > limit && (
          <button onClick={() => setLimit((l) => l + PAGE)}>Show more ({shown.length - limit} left)</button>
        )}
      </div>
    </>
  );
}

function emptyText(tab: Shelf, filter: string) {
  if (filter) return "Nothing matches that filter.";
  switch (tab) {
    case "next_up":
      return "Nothing queued. Share a screenshot to the Add Book shortcut, or search above.";
    case "to_read":
      return "Your To-Read list is empty. Import from Goodreads to bring it over.";
    case "currently_reading":
      return "Not reading anything right now.";
    case "read":
      return "No finished books yet. Import your Goodreads history to fill this in.";
  }
}

function sessionStorageGet(k: string): string | null {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function sessionStorageSet(k: string, v: string) {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
