import { useState } from "react";
import { bookKey } from "../../supabase/functions/_shared/openlibrary.ts";
import type { Book, BookCandidate, Capture, CaptureDecision } from "../../supabase/functions/_shared/types.ts";
import { formatDate } from "../lib/dates.ts";
import { store } from "../lib/store.ts";
import { CaptureCard, decideItem, sourceLabel, undoItem } from "./CaptureCard.tsx";

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
 * Cards for a list of found books with duplicates folded together, a Skip all,
 * and decisions saved back to their captures.
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
      <div className="stack">
        {groups.map((g) => {
          const capture = captures.get(g[0].captureId)!;
          return (
            <CaptureCard
              key={slotKey(g[0])}
              item={itemOf(g[0])}
              library={library}
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
