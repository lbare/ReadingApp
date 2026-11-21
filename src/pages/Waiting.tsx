import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Book, BookCandidate, Capture, CaptureDecision } from "../../supabase/functions/_shared/types.ts";
import { CaptureCard, decideItem, sourceLabel, undoItem } from "../components/CaptureCard.tsx";
import { formatDate } from "../lib/dates.ts";
import { store } from "../lib/store.ts";

interface Slot {
  captureId: string;
  index: number;
}

const key = (s: Slot) => `${s.captureId}:${s.index}`;

/** Every book still waiting to be sorted, from all captures, on one screen. */
export function Waiting() {
  const [captures, setCaptures] = useState<Map<string, Capture> | null>(null);
  // The books shown: those undecided when the page opened. Ones sorted here
  // stay (collapsed, with Undo) until you leave.
  const [slots, setSlots] = useState<Slot[]>([]);
  const [library, setLibrary] = useState<Book[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [pending, books] = await Promise.all([store.listPendingCaptures(), store.listBooks()]);
        setCaptures(new Map(pending.map((c) => [c.id, c])));
        setSlots(pending.flatMap((c) => c.items.flatMap((it, index) => (it.decision ? [] : [{ captureId: c.id, index }]))));
        setLibrary(books);
      } catch (e) {
        setError((e as Error).message);
        setCaptures(new Map());
      }
    })();
  }, []);

  async function run(slot: Slot, fn: (c: Capture) => Promise<Capture>) {
    const capture = captures?.get(slot.captureId);
    if (!capture) return;
    setBusy(key(slot));
    setError(null);
    try {
      const updated = await fn(capture);
      setCaptures((m) => new Map(m).set(updated.id, updated));
      setLibrary(await store.listBooks());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const decide = (s: Slot, d: CaptureDecision, c: BookCandidate | undefined) => run(s, (cap) => decideItem(cap, s.index, d, c));
  const undo = (s: Slot) => run(s, (cap) => undoItem(cap, s.index));

  async function skipAll() {
    if (!captures) return;
    const left = slots.filter((s) => !captures.get(s.captureId)?.items[s.index]?.decision);
    if (!window.confirm(`Skip all ${left.length} remaining book${left.length === 1 ? "" : "s"}?`)) return;
    setBusy("all");
    setError(null);
    try {
      const next = new Map(captures);
      for (const id of new Set(left.map((s) => s.captureId))) {
        const c = next.get(id)!;
        const items = c.items.map((it) => (it.decision ? it : { ...it, decision: "skipped" as const, book_id: null }));
        await store.saveCaptureItems(id, items);
        next.set(id, { ...c, items, status: "done" });
      }
      setCaptures(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!captures) return <p className="muted" style={{ marginTop: 24 }}>Loading…</p>;

  const remaining = slots.filter((s) => !captures.get(s.captureId)?.items[s.index]?.decision).length;

  return (
    <>
      <div className="page-head">
        <h1>Waiting for you</h1>
        <p className="small">
          {slots.length === 0
            ? "Nothing to sort. Share a screenshot to Add Book and it shows up here."
            : remaining === 0
              ? "All sorted."
              : `${remaining} book${remaining === 1 ? "" : "s"} to sort`}
        </p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="stack">
        {slots.map((s) => {
          const capture = captures.get(s.captureId)!;
          const item = capture.items[s.index];
          return (
            <CaptureCard
              key={key(s)}
              item={item}
              library={library}
              busy={busy === key(s) || busy === "all"}
              header={
                <>
                  From a {sourceLabel(capture)} · {formatDate(capture.created_at)}
                  {capture.source_url && (
                    <>
                      {" · "}
                      <a href={capture.source_url} target="_blank" rel="noreferrer">original</a>
                    </>
                  )}
                </>
              }
              onDecide={(d, c) => decide(s, d, c)}
              onUndo={() => undo(s)}
            />
          );
        })}
      </div>

      <p className="row" style={{ marginTop: 20, justifyContent: "space-between" }}>
        <Link to="/">Back to shelves</Link>
        {remaining > 1 && (
          <button className="btn-ghost btn-sm" onClick={skipAll} disabled={busy !== null}>Skip all</button>
        )}
      </p>
    </>
  );
}
