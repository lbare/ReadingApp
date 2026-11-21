import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Book, Capture } from "../../supabase/functions/_shared/types.ts";
import { CaptureList, type Slot, groupSlots, remainingCount } from "../components/CaptureList.tsx";
import { store } from "../lib/store.ts";

/** Every book still waiting to be sorted, from all captures, on one screen (each book once). */
export function Waiting() {
  const [captures, setCaptures] = useState<Map<string, Capture> | null>(null);
  // Grouped once on open: books sorted here stay (collapsed, with Undo) until you leave.
  const [groups, setGroups] = useState<Slot[][]>([]);
  const [library, setLibrary] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [pending, books] = await Promise.all([store.listPendingCaptures(), store.listBooks()]);
        const map = new Map(pending.map((c) => [c.id, c]));
        const slots = pending.flatMap((c) => c.items.flatMap((it, index) => (it.decision ? [] : [{ captureId: c.id, index }])));
        setCaptures(map);
        setGroups(groupSlots(map, slots));
        setLibrary(books);
      } catch (e) {
        setError((e as Error).message);
        setCaptures(new Map());
      }
    })();
  }, []);

  if (!captures) return <p className="muted" style={{ marginTop: 24 }}>Loading…</p>;
  const remaining = remainingCount(captures, groups);

  return (
    <>
      <div className="page-head">
        <h1>Waiting for you</h1>
        <p className="small">
          {groups.length === 0
            ? "Nothing to sort. Share a screenshot to Add Book and it shows up here."
            : remaining === 0
              ? "All sorted."
              : `${remaining} book${remaining === 1 ? "" : "s"} to sort`}
        </p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <CaptureList captures={captures} setCaptures={setCaptures} groups={groups} library={library} setLibrary={setLibrary} showSource />
      <p style={{ marginTop: 12 }}>
        <Link to="/">Back to shelves</Link>
      </p>
    </>
  );
}
