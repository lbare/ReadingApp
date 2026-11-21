import { useMemo, useState } from "react";
import { bookKey } from "../../supabase/functions/_shared/openlibrary.ts";
import type { Book, BookCandidate, Capture, CaptureDecision, CaptureItem } from "../../supabase/functions/_shared/types.ts";
import { formatDate } from "../lib/dates.ts";
import { store } from "../lib/store.ts";
import { Cover } from "./BookBits.tsx";
import { CaptureCard, decideItem, libraryMatch, libraryStatus, sourceLabel, undoItem } from "./CaptureCard.tsx";

/** One found book: where it lives in which capture. */
export interface Slot {
  captureId: string;
  index: number;
}

/**
 * Group slots that are the same book (by its best match, or what was asked
 * for), keeping first-seen order. The first slot of a group is the one shown;
 * the rest are duplicates that follow its decision.
 */
export function groupSlots(captures: Map<string, Capture>, slots: Slot[]): Slot[][] {
  const groups = new Map<string, Slot[]>();
  for (const s of slots) {
    const item = captures.get(s.captureId)?.items[s.index];
    if (!item) continue;
    const key = bookKey(item.candidates[0] ?? item.query);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.values()];
}

const slotKey = (s: Slot) => `${s.captureId}:${s.index}`;

/**
 * Found books with duplicates folded together, saved back to their captures:
 * - books already in the library: a compact grid, with "Got it, all";
 * - the rest: full cards with Next Up / To-Read / Skip;
 * - Skip all; skipped books disappear (no Undo).
 */
export function CaptureList(props: {
  captures: Map<string, Capture>;
  setCaptures: (m: Map<string, Capture>) => void;
  groups: Slot[][];
  library: Book[];
  setLibrary: (b: Book[]) => void;
  /** Show where each book came from above its card (for lists spanning captures). */
  showSource?: boolean;
}) {
  const { captures, groups, library } = props;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const itemOf = (s: Slot) => captures.get(s.captureId)!.items[s.index];
  const remaining = groups.filter((g) => !itemOf(g[0]).decision);

  // Which books go in the "already on your shelves" grid. Decided once per
  // list (not as the library changes), so adding a new book doesn't make its
  // card jump into the grid. "Not this one?" moves a book back out.
  const [notKnown, setNotKnown] = useState<Set<string>>(new Set());
  const knownAtStart = useMemo(
    () =>
      new Set(
        groups
          .filter((g) => {
            const it = itemOf(g[0]);
            return it.decision === "existing" || (!it.decision && libraryMatch(it, library));
          })
          .map((g) => slotKey(g[0])),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups],
  );
  const visible = groups.filter((g) => itemOf(g[0]).decision !== "skipped");
  const known = visible.filter((g) => knownAtStart.has(slotKey(g[0])) && !notKnown.has(slotKey(g[0])));
  const rest = visible.filter((g) => !known.includes(g));

  /** Apply `fn` to each slot in turn (several may share a capture), then refresh. */
  async function run(key: string, steps: { slot: Slot; fn: (c: Capture, index: number) => Promise<Capture> }[]) {
    setBusy(key);
    setError(null);
    const next = new Map(captures);
    try {
      for (const { slot, fn } of steps) next.set(slot.captureId, await fn(next.get(slot.captureId)!, slot.index));
      props.setCaptures(next);
      props.setLibrary(await store.listBooks());
    } catch (e) {
      props.setCaptures(next);
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // The shown card gets the decision; its duplicates are marked skipped (and undone with it).
  const decide = (g: Slot[], d: CaptureDecision, c: BookCandidate | undefined) =>
    run(slotKey(g[0]), [
      { slot: g[0], fn: (cap, i) => decideItem(cap, i, d, c) },
      ...g.slice(1).map((slot) => ({ slot, fn: (cap: Capture, i: number) => decideItem(cap, i, "skipped", undefined) })),
    ]);
  const undo = (g: Slot[]) => run(slotKey(g[0]), g.map((slot) => ({ slot, fn: (cap: Capture, i: number) => undoItem(cap, i) })));

  async function gotItAll(gs: Slot[][]) {
    await run(
      "all",
      gs.flatMap((g) => {
        const it = itemOf(g[0]);
        const m = libraryMatch(it, library);
        return [
          { slot: g[0], fn: (cap: Capture, i: number) => decideItem(cap, i, "existing", m ? it.candidates[m.index] : it.candidates[0]) },
          ...g.slice(1).map((slot) => ({ slot, fn: (cap: Capture, i: number) => decideItem(cap, i, "skipped", undefined) })),
        ];
      }),
    );
  }

  async function skipAll() {
    if (!window.confirm(`Skip all ${remaining.length} remaining book${remaining.length === 1 ? "" : "s"}?`)) return;
    await run(
      "all",
      remaining.flat().map((slot) => ({ slot, fn: (cap: Capture, i: number) => decideItem(cap, i, "skipped", undefined) })),
    );
  }

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {remaining.length > 1 && (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
          <button className="btn-ghost btn-sm" onClick={skipAll} disabled={busy !== null}>
            Skip all {remaining.length}
          </button>
        </div>
      )}
      {known.length > 0 && (
        <KnownGrid
          groups={known}
          itemOf={itemOf}
          library={library}
          busy={busy}
          onGotItAll={gotItAll}
          onDecide={decide}
          onUndo={undo}
          onNotIt={(g) => setNotKnown((s) => new Set(s).add(slotKey(g[0])))}
        />
      )}
      <div className="stack">
        {rest.map((g) => {
          const capture = captures.get(g[0].captureId)!;
          return (
            <CaptureCard
              key={slotKey(g[0])}
              item={itemOf(g[0])}
              library={library}
              full
              busy={busy === slotKey(g[0]) || busy === "all"}
              header={
                props.showSource ? (
                  <>
                    From a {sourceLabel(capture)} · {formatDate(capture.created_at)}
                    {g.length > 1 && <> · shared {g.length}×</>}
                    {capture.source_url && (
                      <>
                        {" · "}
                        <a href={capture.source_url} target="_blank" rel="noreferrer">original</a>
                      </>
                    )}
                  </>
                ) : undefined
              }
              onDecide={(d, c) => decide(g, d, c)}
              onUndo={() => undo(g)}
            />
          );
        })}
      </div>
    </>
  );
}

export function remainingCount(captures: Map<string, Capture>, groups: Slot[][]): number {
  return groups.filter((g) => !captures.get(g[0].captureId)?.items[g[0].index]?.decision).length;
}

/**
 * Books already in the library, two per row. Tap one for its actions;
 * "Got it, all" settles every one still open.
 */
function KnownGrid(props: {
  groups: Slot[][];
  itemOf: (s: Slot) => CaptureItem;
  library: Book[];
  busy: string | null;
  onGotItAll: (gs: Slot[][]) => void;
  onDecide: (g: Slot[], d: CaptureDecision, c: BookCandidate | undefined) => void;
  onUndo: (g: Slot[]) => void;
  onNotIt: (g: Slot[]) => void;
}) {
  const { groups, itemOf, library } = props;
  const [picked, setPicked] = useState<string | null>(null);
  const open = groups.filter((g) => !itemOf(g[0]).decision);

  const tile = (g: Slot[]) => {
    const it = itemOf(g[0]);
    const m = libraryMatch(it, library);
    const doneBook = it.decision ? library.find((b) => b.id === it.book_id) : undefined;
    const book = m?.book ?? doneBook;
    return { it, m, book, c: m ? it.candidates[m.index] : it.candidates[0] };
  };

  const sel = groups.find((g) => slotKey(g[0]) === picked);
  const s = sel ? tile(sel) : null;

  return (
    <section className="card known-grid-card">
      <div className="section-head" style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 15 }}>Already on your shelves · {groups.length}</h2>
        {open.length > 1 && (
          <button className="btn-soft btn-sm" disabled={props.busy !== null} onClick={() => props.onGotItAll(open)}>
            Got it, all {open.length}
          </button>
        )}
      </div>
      <div className="known-grid">
        {groups.map((g) => {
          const { it, book, c } = tile(g);
          const k = slotKey(g[0]);
          const decided = !!it.decision;
          return (
            <button
              key={k}
              className={`known-tile${decided ? " is-done" : ""}`}
              aria-pressed={picked === k}
              onClick={() => setPicked(picked === k ? null : k)}
            >
              <Cover url={book?.cover_url ?? c?.cover_url ?? null} title={book?.title ?? c?.title ?? it.query.title} />
              <span className="known-tile-text">
                <span className="known-tile-title">{book?.title ?? c?.title ?? it.query.title}</span>
                <span className="known-tile-status">{decided ? (it.decision === "next_up" ? "✓ Moved to Next Up" : "✓ Got it") : book ? libraryStatus(book).replace(/^Already on /, "On ") : ""}</span>
              </span>
            </button>
          );
        })}
      </div>
      {sel && s && (
        <div className="known-actions-bar">
          <span className="small" style={{ fontWeight: 600 }}>{s.book?.title ?? s.c?.title}</span>
          <div className="row" style={{ gap: 6 }}>
            {s.it.decision ? (
              <button className="btn-ghost btn-sm" disabled={props.busy !== null} onClick={() => { props.onUndo(sel); setPicked(null); }}>Undo</button>
            ) : (
              <>
                <button className="btn-soft btn-sm" disabled={props.busy !== null} onClick={() => { props.onDecide(sel, "existing", s.c); setPicked(null); }}>Got it</button>
                {s.book?.shelf === "to_read" && (
                  <button className="btn-sm" disabled={props.busy !== null} onClick={() => { props.onDecide(sel, "next_up", s.c); setPicked(null); }}>Move to Next Up</button>
                )}
                <button className="btn-ghost btn-sm" onClick={() => { props.onNotIt(sel); setPicked(null); }}>Not this one?</button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
