import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type Book, type BookCandidate, type Capture, type CaptureItem } from "../../supabase/functions/_shared/types.ts";
import { BookSearch } from "../components/BookSearch.tsx";
import { Cover, bookMeta } from "../components/BookBits.tsx";
import { decideItem, sourceLabel } from "../components/CaptureCard.tsx";
import { CaptureList, type Slot, groupSlots, remainingCount } from "../components/CaptureList.tsx";
import { store } from "../lib/store.ts";

/**
 * The page the Shortcut opens after a capture: one card per book found (each
 * book once), with Next Up / To-Read / Skip, Skip all, and a link to Goodreads.
 */
export function Confirm() {
  const { id } = useParams();
  const [captures, setCaptures] = useState<Map<string, Capture> | null | undefined>(undefined);
  const [groups, setGroups] = useState<Slot[][]>([]);
  const [library, setLibrary] = useState<Book[]>([]);
  const [otherWaiting, setOtherWaiting] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const regroup = (map: Map<string, Capture>) => {
    const c = map.get(id!)!;
    setGroups(groupSlots(map, c.items.map((_, index) => ({ captureId: c.id, index }))));
  };

  useEffect(() => {
    (async () => {
      try {
        const [c, books, pending] = await Promise.all([store.getCapture(id!), store.listBooks(), store.listPendingCaptures()]);
        setLibrary(books);
        setOtherWaiting(pending.filter((p) => p.id !== id).reduce((n, p) => n + p.items.filter((i) => !i.decision).length, 0));
        if (!c) return setCaptures(null);
        const map = new Map([[c.id, c]]);
        setCaptures(map);
        regroup(map);
      } catch (e) {
        setError((e as Error).message);
        setCaptures(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function addManual(c: BookCandidate, decision: "next_up" | "to_read") {
    const capture = captures?.get(id!);
    if (!capture) return;
    setError(null);
    try {
      const item: CaptureItem = { query: { title: c.title, author: c.author }, candidates: [c], decision: null, book_id: null };
      const withItem = { ...capture, items: [...capture.items, item] };
      await store.saveCaptureItems(withItem.id, withItem.items);
      const done = await decideItem(withItem, withItem.items.length - 1, decision, c);
      const map = new Map([[done.id, done]]);
      setCaptures(map);
      regroup(map);
      setLibrary(await store.listBooks());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (captures === undefined) return <p className="muted" style={{ marginTop: 24 }}>Loading…</p>;
  const capture = captures?.get(id!);
  if (!captures || !capture) {
    return (
      <div className="page-head">
        <h1>Not found</h1>
        <p>{error ?? "This capture doesn't exist, or it was made on another device in local mode."}</p>
        <Link to="/">Back to shelves</Link>
      </div>
    );
  }

  const remaining = remainingCount(captures, groups);

  return (
    <>
      <div className="page-head">
        <h1>
          {groups.length === 0
            ? "No books found"
            : remaining === 0
              ? "All sorted"
              : `${groups.length} book${groups.length === 1 ? "" : "s"} found`}
        </h1>
        <p className="small">
          From a {sourceLabel(capture)}
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

      <CaptureList captures={captures} setCaptures={setCaptures} groups={groups} library={library} setLibrary={setLibrary} />

      <ManualAdd onAdd={addManual} defaultOpen={groups.length === 0} />

      {(remaining === 0 || otherWaiting > 0) && (
        <p className="row" style={{ marginTop: 20, gap: 16 }}>
          {otherWaiting > 0 && <Link to="/waiting">{otherWaiting} more waiting →</Link>}
          {remaining === 0 && <Link to="/">Go to shelves →</Link>}
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
