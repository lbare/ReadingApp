import { useState } from "react";
import { searchOpenLibrary } from "../../supabase/functions/_shared/openlibrary.ts";
import type { BookCandidate } from "../../supabase/functions/_shared/types.ts";
import { Cover, bookMeta } from "./BookBits.tsx";

/** Search Open Library by name and hand back the chosen candidate. */
export function BookSearch(props: {
  initial?: string;
  placeholder?: string;
  onPick: (c: BookCandidate) => void;
}) {
  const [q, setQ] = useState(props.initial ?? "");
  const [results, setResults] = useState<BookCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await searchOpenLibrary({ title: q.trim() }, { limit: 8 }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form onSubmit={run} className="row" role="search" style={{ flexWrap: "nowrap" }}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={props.placeholder ?? "Title and author"}
          aria-label="Search for a book"
          enterKeyHint="search"
        />
        <button type="submit" className="btn-soft" disabled={busy}>
          {busy ? "…" : "Search"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {results && results.length === 0 && <p className="muted">No matches on Open Library.</p>}
      {results && results.length > 0 && (
        <div className="search-results">
          {results.map((c, i) => (
            <button
              key={`${c.ol_work_key}-${i}`}
              className="alt"
              type="button"
              onClick={() => {
                props.onPick(c);
                setResults(null);
                setQ("");
              }}
            >
              <Cover url={c.cover_url} title={c.title} />
              <span>
                <span className="book-title">{c.title}</span>
                <span className="book-meta" style={{ display: "block" }}>{bookMeta(c)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
