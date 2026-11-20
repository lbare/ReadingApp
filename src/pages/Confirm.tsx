import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  type Book,
  type BookCandidate,
  type Capture,
  type CaptureDecision,
  type CaptureItem,
  SHELF_LABEL,
  candidateToBook,
} from "../../supabase/functions/_shared/types.ts";
import { BookSearch } from "../components/BookSearch.tsx";
import { Cover, GoodreadsLink, bookMeta } from "../components/BookBits.tsx";
import { localToday } from "../lib/dates.ts";
import { findInLibrary, shelveBook, store } from "../lib/store.ts";

/**
 * The page the Shortcut opens after a capture: one card per book found, each
 * with Next Up / To-Read / Skip and a link to Goodreads.
 */
export function Confirm() {
  const { id } = useParams();
  const [capture, setCapture] = useState<Capture | null | undefined>(undefined);
  const [library, setLibrary] = useState<Book[]>([]);
  const [selected, setSelected] = useState<number[]>([]); // chosen candidate per item
  const [openAlts, setOpenAlts] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [c, books] = await Promise.all([store.getCapture(id!), store.listBooks()]);
        setCapture(c);
        setLibrary(books);
        setSelected(c ? c.items.map(() => 0) : []);
      } catch (e) {
        setError((e as Error).message);
        setCapture(null);
      }
    })();
  }, [id]);

  async function saveItems(items: CaptureItem[]) {
    await store.saveCaptureItems(capture!.id, items);
    setCapture({ ...capture!, items });
    setLibrary(await store.listBooks());
  }

  async function decide(index: number, decision: CaptureDecision, candidate: BookCandidate | undefined) {
    if (!capture) return;
    setBusy(index);
    setError(null);
    try {
      let bookId: string | null = null;
      if (decision !== "skipped" && candidate) {
        const source = capture.source_type === "tiktok" ? "tiktok" : capture.source_type === "screenshot" ? "screenshot" : "text";
        const r = await shelveBook(candidateToBook(candidate, decision, source, capture.source_url, localToday()), decision);
        bookId = r.book.id;
      }
      const items = capture.items.map((it, i) =>
        i === index ? { ...it, decision, book_id: bookId, candidates: candidate ? [candidate, ...it.candidates.filter((c) => c !== candidate)] : it.candidates } : it,
      );
      setSelected((s) => s.map((v, i) => (i === index ? 0 : v)));
      await saveItems(items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function undo(index: number) {
    if (!capture) return;
    setError(null);
    const items = capture.items.map((it, i) => (i === index ? { ...it, decision: null, book_id: null } : it));
    await saveItems(items).catch((e) => setError((e as Error).message));
  }

  async function addManual(c: BookCandidate, decision: "next_up" | "to_read") {
    if (!capture) return;
    const item: CaptureItem = { query: { title: c.title, author: c.author }, candidates: [c], decision: null, book_id: null };
    const items = [...capture.items, item];
    setCapture({ ...capture, items });
    setSelected((s) => [...s, 0]);
    await saveItems(items);
    // decide() reads `capture` from state, so run it against the new list directly.
    setBusy(items.length - 1);
    try {
      const r = await shelveBook(candidateToBook(c, decision, "manual", capture.source_url, localToday()), decision);
      await saveItems(items.map((it, i) => (i === items.length - 1 ? { ...it, decision, book_id: r.book.id } : it)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (capture === undefined) return <p className="muted" style={{ marginTop: 24 }}>Loading…</p>;
  if (capture === null) {
    return (
      <div className="page-head">
        <h1>Not found</h1>
        <p>{error ?? "This capture doesn't exist, or it was made on another device in local mode."}</p>
        <Link to="/">Back to shelves</Link>
      </div>
    );
  }

  const remaining = capture.items.filter((i) => !i.decision).length;
  const source = capture.source_type === "tiktok" ? "TikTok" : capture.source_type === "screenshot" ? "screenshot" : "shared text";

  return (
    <>
      <div className="page-head">
        <h1>
          {capture.items.length === 0
            ? "No books found"
            : remaining === 0
              ? "All sorted"
              : `${capture.items.length} book${capture.items.length === 1 ? "" : "s"} found`}
        </h1>
        <p className="small">
          From a {source}
          {capture.source_url && (
            <>
              {" · "}
              <a href={capture.source_url} target="_blank" rel="noreferrer">open original</a>
            </>
          )}
        </p>
        {capture.raw_text && capture.source_type === "tiktok" && <p className="muted">“{capture.raw_text}”</p>}
        {capture.error && <p className="banner">{capture.error}</p>}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="stack">
        {capture.items.map((item, i) => {
          const cand = item.candidates[selected[i] ?? 0];
          const shown = cand ?? { title: item.query.title, author: item.query.author, cover_url: null, published_year: null, pages: null };
          const inLib = cand ? findInLibrary(library, cand) : undefined;

          if (item.decision) {
            const book = library.find((b) => b.id === item.book_id);
            return (
              <div key={i} className="card done-line">
                <span className="small">
                  <strong>{shown.title}</strong>{" "}
                  {item.decision === "skipped" ? (
                    <span className="muted">skipped</span>
                  ) : (
                    <span className="pill pill-good">✓ {SHELF_LABEL[book?.shelf ?? item.decision]}</span>
                  )}
                </span>
                <button className="btn-ghost btn-sm" onClick={() => undo(i)}>Undo</button>
              </div>
            );
          }

          return (
            <div key={i} className="card">
              <div className="book book-lg">
                <Cover url={shown.cover_url} title={shown.title} />
                <div>
                  <div className="book-title">{shown.title}</div>
                  <div className="book-meta">{bookMeta(shown)}</div>
                  {cand?.avg_rating && (
                    <div className="book-meta">
                      ★ {cand.avg_rating.toFixed(2)}
                      {cand.ratings_count ? ` · ${cand.ratings_count.toLocaleString()} ratings on Open Library` : ""}
                    </div>
                  )}
                  {!cand && <p className="muted small" style={{ marginTop: 6 }}>No match on Open Library.</p>}
                  {inLib && <p className="small" style={{ marginTop: 6 }}><span className="pill">Already on {SHELF_LABEL[inLib.shelf]}</span></p>}
                  <div className="book-actions">
                    <GoodreadsLink book={inLib ?? shown} label="Open in Goodreads" />
                    {item.candidates.length > 1 && (
                      <button className="btn-ghost btn-sm" aria-expanded={openAlts === i} onClick={() => setOpenAlts(openAlts === i ? null : i)}>
                        {openAlts === i ? "Hide matches" : "Not this one?"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {openAlts === i && (
                <div className="alts">
                  {item.candidates.map((c, k) => (
                    <button
                      key={k}
                      className="alt"
                      aria-pressed={k === (selected[i] ?? 0)}
                      onClick={() => {
                        setSelected((s) => s.map((v, j) => (j === i ? k : v)));
                        setOpenAlts(null);
                      }}
                    >
                      <Cover url={c.cover_url} title={c.title} />
                      <span>
                        <span className="book-title">{c.title}</span>
                        <span className="book-meta" style={{ display: "block" }}>{bookMeta(c)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="choice-row">
                <button className="btn-primary" disabled={!cand || busy === i} onClick={() => decide(i, "next_up", cand)}>Next Up</button>
                <button className="btn-soft" disabled={!cand || busy === i} onClick={() => decide(i, "to_read", cand)}>To-Read</button>
                <button disabled={busy === i} onClick={() => decide(i, "skipped", undefined)}>Skip</button>
              </div>
            </div>
          );
        })}
      </div>

      <ManualAdd onAdd={addManual} defaultOpen={capture.items.length === 0} />

      {remaining === 0 && capture.items.length > 0 && (
        <p style={{ marginTop: 20 }}>
          <Link to="/">Go to shelves →</Link>
        </p>
      )}
    </>
  );
}

function ManualAdd(props: { onAdd: (c: BookCandidate, d: "next_up" | "to_read") => void; defaultOpen: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen);
  const [picked, setPicked] = useState<BookCandidate | null>(null);
  if (!open) {
    return (
      <p style={{ marginTop: 16 }}>
        <button className="btn-ghost" onClick={() => setOpen(true)}>+ Missing a book? Search for it</button>
      </p>
    );
  }
  return (
    <div className="card stack" style={{ marginTop: 16 }}>
      <h2>Search for a book</h2>
      {picked ? (
        <div className="book">
          <Cover url={picked.cover_url} title={picked.title} />
          <div>
            <div className="book-title">{picked.title}</div>
            <div className="book-meta">{bookMeta(picked)}</div>
            <div className="book-actions">
              <button className="btn-primary btn-sm" onClick={() => { props.onAdd(picked, "next_up"); setPicked(null); }}>Next Up</button>
              <button className="btn-soft btn-sm" onClick={() => { props.onAdd(picked, "to_read"); setPicked(null); }}>To-Read</button>
              <button className="btn-ghost btn-sm" onClick={() => setPicked(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : (
        <BookSearch onPick={setPicked} />
      )}
    </div>
  );
}
