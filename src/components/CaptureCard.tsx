import { useState } from "react";
import {
  type Book,
  type BookCandidate,
  type Capture,
  type CaptureDecision,
  type CaptureItem,
  SHELF_LABEL,
  type Shelf,
  candidateToBook,
} from "../../supabase/functions/_shared/types.ts";
import { formatDate, localToday } from "../lib/dates.ts";
import { findInLibrary, nextPosition, shelveBook, store } from "../lib/store.ts";
import { Cover, GoodreadsLink, bookMeta } from "./BookBits.tsx";

/**
 * Record a decision for one item of a capture and save the capture.
 * Next Up / To-Read shelve the book; "existing" just notes it was already in
 * the library; "skipped" changes nothing.
 */
export async function decideItem(capture: Capture, index: number, decision: CaptureDecision, candidate: BookCandidate | undefined): Promise<Capture> {
  let bookId: string | null = null;
  let undoTo: Shelf | "new" | null = null;
  if ((decision === "next_up" || decision === "to_read") && candidate) {
    const source = capture.source_type === "tiktok" ? "tiktok" : capture.source_type === "screenshot" ? "screenshot" : "text";
    const r = await shelveBook(candidateToBook(candidate, decision, source, capture.source_url, localToday()), decision);
    bookId = r.book.id;
    undoTo = r.previous;
  } else if (decision === "existing" && candidate) {
    bookId = findInLibrary(await store.listBooks(), candidate)?.id ?? null;
  }
  const items = capture.items.map((it, i) =>
    i === index
      ? {
          ...it,
          decision,
          book_id: bookId,
          undo_to: undoTo,
          candidates: candidate ? [candidate, ...it.candidates.filter((c) => c !== candidate)] : it.candidates,
        }
      : it,
  );
  await store.saveCaptureItems(capture.id, items);
  return { ...capture, items, status: items.every((i) => i.decision) ? "done" : "pending" };
}

/** Reverse a decision: remove a book it added, or move a book back to the shelf it came from. */
export async function undoItem(capture: Capture, index: number): Promise<Capture> {
  const { book_id: bookId, undo_to: undoTo } = capture.items[index];
  if (bookId && undoTo === "new") {
    await store.deleteBook(bookId);
  } else if (bookId && undoTo && undoTo !== "new") {
    const books = await store.listBooks();
    await store.updateBook(bookId, { shelf: undoTo, position: undoTo === "next_up" ? nextPosition(books) : null });
  }
  const items = capture.items.map((x, i) => (i === index ? { ...x, decision: null, book_id: null, undo_to: null } : x));
  await store.saveCaptureItems(capture.id, items);
  return { ...capture, items, status: "pending" };
}

export function sourceLabel(c: Pick<Capture, "source_type">): string {
  return c.source_type === "tiktok" ? "TikTok" : c.source_type === "screenshot" ? "screenshot" : "typed text";
}

/** Where a library book is: "Already on To-Read", "Read Nov 18, 2026", "Reading now". */
export function libraryStatus(b: Book): string {
  if (b.shelf === "read") return b.date_read ? `Read ${formatDate(b.date_read)}` : "Already read";
  if (b.shelf === "currently_reading") return "Reading now";
  return `Already on ${SHELF_LABEL[b.shelf]}`;
}

/** The first of an item's matches that's already in the library (any match, not just the top one). */
export function libraryMatch(item: CaptureItem, library: Book[]): { index: number; book: Book } | null {
  for (let i = 0; i < item.candidates.length; i++) {
    const book = findInLibrary(library, item.candidates[i]);
    if (book) return { index: i, book };
  }
  return null;
}

/**
 * One book found in a capture.
 * - Already in the library (any of its matches): a one-line card, "Got it" or "Not this one?".
 * - Otherwise: the best match, other matches folded behind "Not this one?", and Next Up / To-Read / Skip.
 * - Decided: a one-line summary with Undo.
 */
export function CaptureCard(props: {
  item: CaptureItem;
  library: Book[];
  busy: boolean;
  /** Optional line above the card, e.g. where it came from. */
  header?: React.ReactNode;
  onDecide: (decision: CaptureDecision, candidate: BookCandidate | undefined) => void;
  onUndo: () => void;
}) {
  const { item, library, busy } = props;
  const match = libraryMatch(item, library);
  const [selected, setSelected] = useState(0);
  const [showAlts, setShowAlts] = useState(false);
  const [notIt, setNotIt] = useState(false); // "Not this one?" on an already-have-it card
  const cand = item.candidates[selected] ?? item.candidates[0];
  const shown = cand ?? { title: item.query.title, author: item.query.author, cover_url: null, published_year: null, pages: null };
  const inLib = cand ? findInLibrary(library, cand) : undefined;

  if (item.decision) {
    const book = library.find((b) => b.id === item.book_id);
    const label =
      item.decision === "skipped" ? null : item.decision === "existing" ? (book ? libraryStatus(book) : "Already had it") : `✓ ${SHELF_LABEL[book?.shelf ?? item.decision]}`;
    return (
      <div className="card done-line">
        <span className="small">
          <strong>{item.candidates[0]?.title ?? item.query.title}</strong>{" "}
          {label ? <span className="pill pill-good">{label}</span> : <span className="muted">skipped</span>}
        </span>
        <button className="btn-ghost btn-sm" onClick={props.onUndo}>Undo</button>
      </div>
    );
  }

  // Already have it: keep it small, the likely answer is "yes, that one".
  if (match && !notIt) {
    const c = item.candidates[match.index];
    return (
      <div className="card known">
        {props.header && <div className="card-source">{props.header}</div>}
        <div className="known-row">
          <Cover url={match.book.cover_url ?? c.cover_url} title={match.book.title} />
          <div className="known-text">
            <div className="book-title">{match.book.title}</div>
            <div className="book-meta">
              <span className="pill">{libraryStatus(match.book)}</span>
            </div>
          </div>
        </div>
        <div className="known-actions">
          <button className="btn-soft btn-sm" disabled={busy} onClick={() => props.onDecide("existing", c)}>Got it</button>
          {match.book.shelf === "to_read" && (
            <button className="btn-ghost btn-sm" disabled={busy} onClick={() => props.onDecide("next_up", c)}>Move to Next Up</button>
          )}
          <button
            className="btn-ghost btn-sm"
            onClick={() => {
              // Show the full card, starting from the first match that isn't the one we have.
              const firstOther = item.candidates.findIndex((x) => !findInLibrary(library, x));
              setSelected(firstOther === -1 ? 0 : firstOther);
              setNotIt(true);
            }}
          >
            Not this one?
          </button>
        </div>
      </div>
    );
  }

  // The chosen match moves to the front of the list once decided.
  const decide = (d: CaptureDecision, c: BookCandidate | undefined) => {
    if (c) setSelected(0);
    setShowAlts(false);
    setNotIt(false);
    props.onDecide(d, c);
  };

  const others = item.candidates.map((c, k) => ({ c, k })).filter(({ c }) => c !== cand);

  return (
    <div className="card">
      {props.header && <div className="card-source">{props.header}</div>}
      <div className="book book-lg">
        <Cover url={shown.cover_url} title={shown.title} />
        <div>
          <div className="book-title">{shown.title}</div>
          <div className="book-meta">{bookMeta(shown)}</div>
          {cand && popularityLine(cand) && <div className="book-meta">{popularityLine(cand)}</div>}
          {!cand && <p className="muted small" style={{ marginTop: 6 }}>No match on Open Library.</p>}
          {inLib && <p className="small" style={{ marginTop: 6 }}><span className="pill">{libraryStatus(inLib)}</span></p>}
          <div className="book-actions">
            <GoodreadsLink book={inLib ?? shown} label="Open in Goodreads" />
            {others.length > 0 && (
              <button className="btn-ghost btn-sm" aria-expanded={showAlts} onClick={() => setShowAlts(!showAlts)}>
                Not this one? <span className={showAlts ? "chev chev-open" : "chev"} aria-hidden="true">▾</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {showAlts && others.length > 0 && (
        <div className="alts">
          <div className="alts-label">Other matches</div>
          {others.map(({ c, k }) => {
            const have = findInLibrary(library, c);
            return (
              <button
                key={k}
                className="alt"
                onClick={() => {
                  setSelected(k);
                  setShowAlts(false);
                }}
              >
                <Cover url={c.cover_url} title={c.title} />
                <span>
                  <span className="book-title">{c.title}</span>
                  <span className="book-meta" style={{ display: "block" }}>
                    {[c.author, c.published_year, have ? libraryStatus(have) : readersLabel(c)].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="choice-row">
        <button className="btn-primary" disabled={!cand || busy} onClick={() => decide("next_up", cand)}>Next Up</button>
        <button className="btn-soft" disabled={!cand || busy} onClick={() => decide("to_read", cand)}>To-Read</button>
        <button disabled={busy} onClick={() => decide("skipped", undefined)}>Skip</button>
      </div>
    </div>
  );
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

function readersLabel(c: BookCandidate): string | null {
  return c.readers ? `${compact(c.readers)} readers` : null;
}

/** "★ 4.10 · 1.1k readers on Open Library" */
function popularityLine(c: BookCandidate): string | null {
  const parts = [c.avg_rating ? `★ ${c.avg_rating.toFixed(2)}` : null, c.readers ? `${compact(c.readers)} readers on Open Library` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
