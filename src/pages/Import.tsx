import { useEffect, useState } from "react";
import { parseGoodreadsCsv, parseGoodreadsUserId } from "../../supabase/functions/_shared/goodreads.ts";
import { type MergePlan, planMerge } from "../../supabase/functions/_shared/merge.ts";
import type { Settings } from "../../supabase/functions/_shared/types.ts";
import { formatDate } from "../lib/dates.ts";
import { isLocalMode } from "../lib/supabase.ts";
import { store, syncReads } from "../lib/store.ts";

export function Import() {
  return (
    <>
      <div className="page-head">
        <h1>Import</h1>
        <p>Bring over your Goodreads history once, then keep shelves in sync.</p>
      </div>
      <div className="stack">
        <CsvImport />
        <RssSync />
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

function RssSync() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [userInput, setUserInput] = useState("");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    store.getSettings().then((s) => {
      setSettings(s);
      setUserInput(s.goodreads_user_id ?? "");
      setKey(s.goodreads_rss_key ?? "");
    }).catch((e) => setError((e as Error).message));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    const id = userInput.trim() ? parseGoodreadsUserId(userInput) : null;
    // A pasted RSS link carries the key too: …/review/list_rss/123?key=abc&shelf=read
    const keyFromLink = userInput.match(/[?&]key=([^&\s]+)/)?.[1] ?? null;
    if (userInput.trim() && !id) {
      setError("Couldn't find a user id. Paste your profile link, e.g. goodreads.com/user/show/12345678-name");
      return;
    }
    try {
      const patch = { goodreads_user_id: id, goodreads_rss_key: keyFromLink ?? (key.trim() || null) };
      await store.saveSettings(patch);
      setSettings((s) => (s ? { ...s, ...patch } : s));
      setUserInput(id ?? "");
      if (keyFromLink) setKey(keyFromLink);
      setStatus("Saved.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sync() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const r = await store.syncGoodreads();
      setStatus(`Synced: ${r.fetched} in the feeds, ${r.inserted} added, ${r.updated} updated.`);
      setSettings(await store.getSettings());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Goodreads shelf sync (RSS)</h2>
      <p className="small muted">
        Picks up what you shelve or finish on Goodreads after the import: read, currently reading and to-read. Runs when you press
        Sync, and daily if you set up the cron job in the README.
      </p>
      <form className="stack" onSubmit={save}>
        <label>
          Goodreads RSS link (or profile link)
          <input type="text" inputMode="url" value={userInput} onChange={(e) => setUserInput(e.target.value)} placeholder="https://www.goodreads.com/review/list_rss/12345678?key=…" />
          <span className="muted" style={{ fontWeight: 400 }}>
            On goodreads.com: My Books → RSS at the bottom of the page. Copy that link and paste it here.
          </span>
        </label>
        <label>
          RSS key <span className="muted" style={{ fontWeight: 400 }}>(filled in from the RSS link)</span>
          <input type="text" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        </label>
        <div className="row">
          <button type="submit">Save</button>
          <button type="button" className="btn-primary" onClick={sync} disabled={busy || isLocalMode || !settings?.goodreads_user_id}>
            {busy ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </form>
      {isLocalMode && <p className="muted small">Sync runs on Supabase, so it's off in local mode.</p>}
      {settings?.goodreads_last_sync && (
        <p className="muted small">
          Last sync {formatDate(settings.goodreads_last_sync)}: {settings.goodreads_last_result}
        </p>
      )}
      {status && <p className="small" role="status">{status}</p>}
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
