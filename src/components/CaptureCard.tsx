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
import { localToday } from "../lib/dates.ts";
import { findInLibrary, nextPosition, shelveBook, store } from "../lib/store.ts";
import { Cover, GoodreadsLink, bookMeta } from "./BookBits.tsx";

/** Record a decision for one item of a capture: shelve the book (unless skipped) and save the capture. */
export async function decideItem(capture: Capture, index: number, decision: CaptureDecision, candidate: BookCandidate | undefined): Promise<Capture> {
  let bookId: string | null = null;
  let undoTo: Shelf | "new" | null = null;
  if (decision !== "skipped" && candidate) {
    const source = capture.source_type === "tiktok" ? "tiktok" : capture.source_type === "screenshot" ? "screenshot" : "text";
    const r = await shelveBook(candidateToBook(candidate, decision, source, capture.source_url, localToday()), decision);
    bookId = r.book.id;
    undoTo = r.previous;
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

/**
 * One book found in a capture: the best match, up to two "Or did you mean"
 * alternatives, and Next Up / To-Read / Skip. Once decided it collapses to a
 * one-line summary with Undo.
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
  const [selected, setSelected] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const cand = item.candidates[selected] ?? item.candidates[0];
  const shown = cand ?? { title: item.query.title, author: item.query.author, cover_url: null, published_year: null, pages: null };
  const inLib = cand ? findInLibrary(library, cand) : undefined;

  if (item.decision) {
    const book = library.find((b) => b.id === item.book_id);
    return (
      <div className="card done-line">
        <span className="small">
          <strong>{shown.title}</strong>{" "}
          {item.decision === "skipped" ? (
            <span className="muted">skipped</span>
          ) : (
            <span className="pill pill-good">✓ {SHELF_LABEL[book?.shelf ?? item.decision]}</span>
          )}
        </span>
        <button className="btn-ghost btn-sm" onClick={props.onUndo}>Undo</button>
      </div>
    );
  }

  // The chosen match moves to the front of the list once decided.
  const decide = (d: CaptureDecision, c: BookCandidate | undefined) => {
    if (c) setSelected(0);
    setShowAll(false);
    props.onDecide(d, c);
  };

  const others = item.candidates.map((c, k) => ({ c, k })).filter(({ c }) => c !== cand);
  const visible = showAll ? others : others.slice(0, 2);

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
          {inLib && <p className="small" style={{ marginTop: 6 }}><span className="pill">Already on {SHELF_LABEL[inLib.shelf]}</span></p>}
          <div className="book-actions">
            <GoodreadsLink book={inLib ?? shown} label="Open in Goodreads" />
          </div>
        </div>
      </div>

      {others.length > 0 && (
        <div className="alts">
          <div className="alts-label">Or did you mean</div>
          {visible.map(({ c, k }) => (
            <button
              key={k}
              className="alt"
              onClick={() => {
                setSelected(k);
                setShowAll(false);
              }}
            >
              <Cover url={c.cover_url} title={c.title} />
              <span>
                <span className="book-title">{c.title}</span>
                <span className="book-meta" style={{ display: "block" }}>
                  {[c.author, c.published_year, readersLabel(c)].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
          {others.length > 2 && (
            <button className="btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
              {showAll ? "Fewer matches" : `${others.length - 2} more`}
            </button>
          )}
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
