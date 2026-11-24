import { useEffect, useState } from "react";
import { parseGoodreadsCsv, parseGoodreadsListHtml } from "../../supabase/functions/_shared/goodreads.ts";
import { type MergePlan, planMerge, planRatingUpdates } from "../../supabase/functions/_shared/merge.ts";
import { store, syncReads } from "../lib/store.ts";

export function Import() {
  return (
    <>
      <div className="page-head">
        <h1>Import</h1>
        <p>Bring over your Goodreads history, and refresh ratings from Goodreads when you like.</p>
      </div>
      <div className="stack">
        <CsvImport />
        <GoodreadsRatings />
        <Goal />
      </div>
    </>
  );
}

function CsvImport() {
  const [plan, setPlan] = useState<(MergePlan & { total: number; skipped: number }) | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPlan(null);
    setStatus(null);
    setError(null);
    if (!file) return;
    try {
      const { books, skipped } = parseGoodreadsCsv(await file.text());
      const existing = await store.listBooks();
      setPlan({ ...planMerge(existing, books), total: books.length, skipped });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      await store.applyMerge(plan);
      await syncReads();
      setStatus(`Imported: ${plan.inserts.length} added, ${plan.updates.length} updated.`);
      setPlan(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Goodreads export (CSV)</h2>
      <p className="small muted">
        On Goodreads: My Books → Import and export → Export Library, then download the file. It has your full history: every
        shelf, ratings and finish dates. Importing again later is safe; nothing gets duplicated.
      </p>
      <label>
        Export file
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
      </label>
      {plan && (
        <div className="stack">
          <p className="small">
            {plan.total} books in the file: <strong>{plan.inserts.length}</strong> new, <strong>{plan.updates.length}</strong> to
            update, {plan.unchanged} already up to date{plan.skipped ? `, ${plan.skipped} rows skipped` : ""}.
          </p>
          <div className="row">
            <button className="btn-primary" onClick={apply} disabled={busy || (plan.inserts.length === 0 && plan.updates.length === 0)}>
              {busy ? "Importing…" : "Import"}
            </button>
            <button className="btn-ghost" onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}
      {status && <p className="small" role="status">{status}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function GoodreadsRatings() {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const rows = (await Promise.all(files.map((f) => f.text()))).flatMap(parseGoodreadsListHtml);
      if (rows.length === 0) {
        throw new Error("No books found in that file. Save the My Books page itself (goodreads.com → My Books) as a web page.");
      }
      const books = await store.listBooks();
      const plan = planRatingUpdates(books, rows);
      await store.applyMerge({ inserts: [], updates: plan.updates, unchanged: 0 });
      const stillMissing = (await store.listBooks()).filter((b) => b.avg_rating == null).length;
      setResult(
        `Read ${rows.length} book${rows.length === 1 ? "" : "s"}: updated ratings for ${plan.updates.length}` +
          (plan.matched > plan.updates.length ? `, ${plan.matched - plan.updates.length} already up to date` : "") +
          (plan.unmatched.length ? `, ${plan.unmatched.length} not in your library` : "") +
          `. ${stillMissing ? `${stillMissing} of your books still have no rating.` : "Every book has a rating."}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Goodreads ratings</h2>
      <p className="small muted">
        Goodreads' export no longer includes average ratings, but your My Books page shows them. On a computer: open
        goodreads.com → My Books, set <strong>per page</strong> (bottom of the list) to 100, then save the page (File → Save
        Page As, "Web Page, HTML only"). Save each page if you have more than 100 books, and upload them all here. Do it again
        whenever you want fresher numbers.
      </p>
      <label>
        Saved My Books page(s)
        <input type="file" accept=".html,.htm,text/html" multiple onChange={onFiles} disabled={busy} />
      </label>
      {busy && <p className="muted small">Reading…</p>}
      {result && <p className="small" role="status">{result}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Goal() {
  const [goal, setGoal] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    store.getSettings().then((s) => setGoal(String(s.yearly_goal))).catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(goal, 10);
    if (!Number.isFinite(n) || n < 1) {
      setError("Enter a number of books.");
      return;
    }
    setError(null);
    try {
      await store.saveSettings({ yearly_goal: n });
      setStatus("Saved.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="card stack">
      <h2>Yearly goal</h2>
      <form className="row" onSubmit={save} style={{ flexWrap: "nowrap" }}>
        <input type="number" min={1} inputMode="numeric" value={goal} onChange={(e) => { setGoal(e.target.value); setStatus(null); }} aria-label="Books per year" style={{ maxWidth: 140 }} />
        <span className="muted">books a year</span>
        <button type="submit" style={{ marginLeft: "auto" }}>Save</button>
      </form>
      {status && <p className="small" role="status">{status}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
