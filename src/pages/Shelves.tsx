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

export function Shelves() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  // ?tab=read&q=Verity opens a shelf filtered (used by links from Stats).
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Shelf>(() => (params.get("tab") as Shelf) ?? (sessionStorageGet("shelf") as Shelf) ?? "next_up");
  const [reads, setReads] = useState<ReadRow[]>([]);
  const [filter, setFilter] = useState(() => params.get("q") ?? "");
  const [limit, setLimit] = useState(PAGE);
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
    const list = byShelf[tab];
    return q ? list.filter((b) => `${b.title} ${b.author ?? ""}`.toLowerCase().includes(q)) : list;
  }, [byShelf, tab, filter]);

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
        {byShelf[tab].length > 12 && (
          <input type="search" placeholder={`Filter ${SHELF_LABEL[tab]}`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter this shelf" />
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
                  <div className="book-meta">{bookMeta(b)}</div>
                  {tab === "read" && (
                    <>
                      <Stars value={b.my_rating} />
                      <ReadDates book={b} reads={readsByBook.get(b.id) ?? []} onChange={reload} />
                    </>
                  )}
                  <div className="book-actions">
                    {tab === "next_up" && (
                      <>
                        <button className="icon-btn" aria-label="Move up" disabled={i === 0 || !!filter} onClick={() => move(b, -1)}>↑</button>
                        <button className="icon-btn" aria-label="Move down" disabled={i === shown.length - 1 || !!filter} onClick={() => move(b, 1)}>↓</button>
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
