import { useState } from "react";
import type { Book, ReadRow } from "../../supabase/functions/_shared/types.ts";
import { formatDate, localToday } from "../lib/dates.ts";
import { addRead, removeRead } from "../lib/store.ts";

/** A finished book's read dates: shown as one line, with an editor to add a reread or remove a date. */
export function ReadDates({ book, reads, onChange }: { book: Book; reads: ReadRow[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(localToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dated = reads.filter((r) => r.date_finished).sort((a, b) => b.date_finished!.localeCompare(a.date_finished!));
  const missing = book.read_count - Math.max(dated.length, 1);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="small" style={{ marginTop: 4 }}>
      <div className="row" style={{ gap: 6 }}>
        <span className="muted">
          {dated.length === 0 ? "No finish date" : dated.map((r) => formatDate(r.date_finished)).join(" · ")}
          {dated.length > 1 && <> ({dated.length}×)</>}
        </span>
        <button className="btn-ghost btn-sm" style={{ minHeight: 24, padding: "0 6px" }} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Done" : "Edit dates"}
        </button>
      </div>
      {!open && missing > 0 && (
        <div className="muted" style={{ marginTop: 2 }}>
          Goodreads says you read it {book.read_count} times; {missing} date{missing === 1 ? " is" : "s are"} missing.
        </div>
      )}
      {open && (
        <div className="read-editor">
          {dated.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <span>Finished {formatDate(r.date_finished)}</span>
              <button
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={() => window.confirm(`Remove the read finished ${formatDate(r.date_finished)}?`) && run(() => removeRead(book, r))}
              >
                Remove
              </button>
            </div>
          ))}
          <form
            className="row"
            style={{ flexWrap: "nowrap" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (date) run(() => addRead(book, date));
            }}
          >
            <input type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} aria-label="Finish date" required />
            <button type="submit" className="btn-soft btn-sm" disabled={busy || dated.some((r) => r.date_finished === date)}>
              Add read
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </div>
  );
}
