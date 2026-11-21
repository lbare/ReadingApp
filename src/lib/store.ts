// Data access for the web app. Two backends with the same interface:
//   - Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set)
//   - local mode: this browser's localStorage, for trying the app before
//     Supabase is set up. Captures from the Shortcut need Supabase.

import type { MergePlan } from "../../supabase/functions/_shared/merge.ts";
import { normalizeTitle } from "../../supabase/functions/_shared/openlibrary.ts";
import type { Book, BookFields, Capture, CaptureItem, Settings, Shelf } from "../../supabase/functions/_shared/types.ts";
import { supabase } from "./supabase.ts";

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface Store {
  listBooks(): Promise<Book[]>;
  insertBook(fields: BookFields): Promise<Book>;
  updateBook(id: string, patch: Partial<BookFields>): Promise<void>;
  deleteBook(id: string): Promise<void>;
  applyMerge(plan: MergePlan): Promise<void>;
  getCapture(id: string): Promise<Capture | null>;
  listCaptures(limit: number): Promise<Capture[]>;
  /** Captures with books still to sort, newest first. */
  listPendingCaptures(): Promise<Capture[]>;
  saveCaptureItems(id: string, items: CaptureItem[]): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  syncGoodreads(): Promise<SyncResult>;
}

// ---------------------------------------------------------------------------
// Supabase

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function supabaseStore(): Store {
  const db = supabase!;
  return {
    async listBooks() {
      // PostgREST caps responses (1000 rows by default), so page through.
      const all: Book[] = [];
      for (let from = 0; ; from += 1000) {
        const rows = check(await db.from("books").select("*").order("created_at").range(from, from + 999)) as Book[];
        all.push(...rows);
        if (rows.length < 1000) return all;
      }
    },
    async insertBook(fields) {
      return check(await db.from("books").insert(fields).select("*").single()) as Book;
    },
    async updateBook(id, patch) {
      check(await db.from("books").update(patch).eq("id", id));
    },
    async deleteBook(id) {
      check(await db.from("books").delete().eq("id", id));
    },
    async applyMerge(plan) {
      for (let i = 0; i < plan.inserts.length; i += 500) {
        check(await db.from("books").insert(plan.inserts.slice(i, i + 500)));
      }
      for (let i = 0; i < plan.updates.length; i += 20) {
        const chunk = plan.updates.slice(i, i + 20);
        const results = await Promise.all(chunk.map((u) => db.from("books").update(u.patch).eq("id", u.id)));
        results.forEach(check);
      }
    },
    async getCapture(id) {
      return check(await db.from("captures").select("*").eq("id", id).maybeSingle()) as Capture | null;
    },
    async listCaptures(limit) {
      return check(await db.from("captures").select("*").order("created_at", { ascending: false }).limit(limit)) as Capture[];
    },
    async listPendingCaptures() {
      return check(await db.from("captures").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(200)) as Capture[];
    },
    async saveCaptureItems(id, items) {
      const status = items.every((i) => i.decision) ? "done" : "pending";
      check(await db.from("captures").update({ items, status }).eq("id", id));
    },
    async getSettings() {
      return check(await db.from("settings").select("*").eq("id", 1).single()) as Settings;
    },
    async saveSettings(patch) {
      check(await db.from("settings").update(patch).eq("id", 1));
    },
    async syncGoodreads() {
      const { data, error } = await db.functions.invoke<SyncResult & { error?: string }>("goodreads-sync", { method: "POST" });
      if (error) {
        // FunctionsHttpError carries the response; surface the function's own message.
        const ctx = (error as { context?: Response }).context;
        const body = ctx ? await ctx.json().catch(() => null) : null;
        throw new Error(body?.error ?? error.message);
      }
      return data!;
    },
  };
}

// ---------------------------------------------------------------------------
// Local mode

interface LocalData {
  books: Book[];
  captures: Capture[];
  settings: Settings;
}

const LOCAL_KEY = "reading-app:v1";
const DEFAULT_SETTINGS: Settings = {
  yearly_goal: 52,
  goodreads_user_id: null,
  goodreads_rss_key: null,
  goodreads_last_sync: null,
  goodreads_last_result: null,
};

function localStore(): Store {
  const load = (): LocalData => {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) return JSON.parse(raw) as LocalData;
    } catch {
      /* storage unavailable or corrupt: start empty */
    }
    return { books: [], captures: [], settings: { ...DEFAULT_SETTINGS } };
  };
  const save = (d: LocalData) => {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(d));
    } catch (e) {
      throw new Error(`Couldn't save in this browser: ${(e as Error).message}`);
    }
  };
  const now = () => new Date().toISOString();
  const mk = (f: BookFields): Book => ({ ...f, id: crypto.randomUUID(), created_at: now(), updated_at: now() });

  return {
    async listBooks() {
      return load().books;
    },
    async insertBook(fields) {
      const d = load();
      const b = mk(fields);
      d.books.push(b);
      save(d);
      return b;
    },
    async updateBook(id, patch) {
      const d = load();
      d.books = d.books.map((b) => (b.id === id ? { ...b, ...patch, updated_at: now() } : b));
      save(d);
    },
    async deleteBook(id) {
      const d = load();
      d.books = d.books.filter((b) => b.id !== id);
      save(d);
    },
    async applyMerge(plan) {
      const d = load();
      const patches = new Map(plan.updates.map((u) => [u.id, u.patch]));
      d.books = d.books.map((b) => (patches.has(b.id) ? { ...b, ...patches.get(b.id), updated_at: now() } : b));
      d.books.push(...plan.inserts.map(mk));
      save(d);
    },
    async getCapture(id) {
      return load().captures.find((c) => c.id === id) ?? null;
    },
    async listCaptures(limit) {
      return load().captures.slice(-limit).reverse();
    },
    async listPendingCaptures() {
      return load().captures.filter((c) => c.status === "pending").reverse();
    },
    async saveCaptureItems(id, items) {
      const d = load();
      d.captures = d.captures.map((c) =>
        c.id === id ? { ...c, items, status: items.every((i) => i.decision) ? "done" : "pending" } : c,
      );
      save(d);
    },
    async getSettings() {
      return { ...DEFAULT_SETTINGS, ...load().settings };
    },
    async saveSettings(patch) {
      const d = load();
      d.settings = { ...DEFAULT_SETTINGS, ...d.settings, ...patch };
      save(d);
    },
    async syncGoodreads() {
      throw new Error("Goodreads RSS sync runs on Supabase. In local mode, use the CSV import.");
    },
  };
}

export const store: Store = supabase ? supabaseStore() : localStore();

// ---------------------------------------------------------------------------
// Helpers shared by pages

/** Find the library entry for a book, by Open Library work, ISBN, Goodreads id, or title + author. */
export function findInLibrary(
  books: Book[],
  b: Pick<BookFields, "title" | "author" | "isbn13" | "ol_work_key"> & { goodreads_id?: string | null },
): Book | undefined {
  const t = normalizeTitle(b.title);
  const a = (b.author ?? "").toLowerCase().replace(/[^\p{L}]/gu, "");
  return books.find(
    (x) =>
      (b.ol_work_key && x.ol_work_key === b.ol_work_key) ||
      (b.isbn13 && x.isbn13 === b.isbn13) ||
      (b.goodreads_id && x.goodreads_id === b.goodreads_id) ||
      (normalizeTitle(x.title) === t && (x.author ?? "").toLowerCase().replace(/[^\p{L}]/gu, "") === a),
  );
}

export function nextPosition(books: Book[]): number {
  return Math.max(0, ...books.filter((b) => b.shelf === "next_up").map((b) => b.position ?? 0)) + 1;
}

/**
 * Put a book on a shelf: insert it, or move the existing entry. Never moves a
 * book that's already read or being read back to a wishlist shelf.
 */
export async function shelveBook(fields: BookFields, shelf: Extract<Shelf, "next_up" | "to_read">): Promise<{ book: Book; moved: boolean; kept?: Shelf; previous: Shelf | "new" | null }> {
  const books = await store.listBooks();
  const existing = findInLibrary(books, fields);
  if (existing) {
    if (existing.shelf === "read" || existing.shelf === "currently_reading") {
      return { book: existing, moved: false, kept: existing.shelf, previous: null };
    }
    if (existing.shelf !== shelf) {
      const patch: Partial<BookFields> = { shelf, position: shelf === "next_up" ? nextPosition(books) : null };
      for (const k of ["ol_work_key", "isbn13", "isbn10", "cover_url", "pages", "avg_rating", "ratings_count", "published_year"] as const) {
        if (existing[k] == null && fields[k] != null) (patch as Record<string, unknown>)[k] = fields[k];
      }
      await store.updateBook(existing.id, patch);
      return { book: { ...existing, ...patch }, moved: true, previous: existing.shelf };
    }
    return { book: existing, moved: false, kept: existing.shelf, previous: null };
  }
  const book = await store.insertBook({ ...fields, shelf, position: shelf === "next_up" ? nextPosition(books) : null });
  return { book, moved: true, previous: "new" };
}
