// POST /functions/v1/goodreads-sync
//
// Pulls the Goodreads RSS feeds for the read, currently-reading and to-read
// shelves and merges them into `books` (see _shared/merge.ts for the rules).
//
// Callers: the signed-in web app ("Sync now"), or a daily pg_cron job using the
// service role key (see README).

import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { goodreadsRssUrl, mapGoodreadsShelf, parseGoodreadsRss, RSS_SHELVES } from "../_shared/goodreads.ts";
import { corsHeaders, json, safeEqual } from "../_shared/http.ts";
import { planMerge } from "../_shared/merge.ts";
import { missingReads } from "../_shared/reads.ts";
import type { Book, BookFields, Settings } from "../_shared/types.ts";

const MAX_PAGES_PER_SHELF = 30;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

async function isAllowed(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (safeEqual(token, serviceKey)) return true;
  // Any valid JWT gets past the gateway (the anon key too), so require a real signed-in user.
  const { data, error } = await supabase.auth.getUser(token);
  return !error && !!data.user;
}

async function fetchShelf(userId: string, shelf: string, key: string | null): Promise<BookFields[]> {
  const out: BookFields[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES_PER_SHELF; page++) {
    const res = await fetch(goodreadsRssUrl(userId, shelf, page, key), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ReadingApp/0.1)" },
    });
    if (res.status === 404) {
      throw new Error(
        key
          ? "Goodreads didn't find that feed. Check the RSS link: copy it again from My Books → RSS (bottom of the page)."
          : "Goodreads needs your RSS link. On goodreads.com go to My Books, tap RSS at the bottom of the page, and paste that link here.",
      );
    }
    if (!res.ok) throw new Error(`Goodreads returned ${res.status} for the ${shelf} shelf.`);
    const xml = await res.text();
    if (!xml.includes("<rss")) throw new Error("Goodreads didn't return a feed. Paste your RSS link from My Books → RSS (bottom of the page).");
    const books = parseGoodreadsRss(xml, mapGoodreadsShelf(shelf));
    const fresh = books.filter((b) => b.goodreads_id && !seen.has(b.goodreads_id));
    if (fresh.length === 0) break; // empty page, or Goodreads repeating the last page
    fresh.forEach((b) => seen.add(b.goodreads_id!));
    out.push(...fresh);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await isAllowed(req))) return json({ error: "Sign in first." }, 401);

  const { data: settings, error: sErr } = await supabase.from("settings").select("*").eq("id", 1).single<Settings>();
  if (sErr) return json({ error: sErr.message }, 500);
  if (!settings.goodreads_user_id) return json({ error: "Add your Goodreads user id in Import first." }, 400);

  let result: { fetched: number; inserted: number; updated: number; unchanged: number };
  try {
    const incoming: BookFields[] = [];
    // Read first, so a book on both "read" and "to-read" pages ends up read.
    for (const shelf of RSS_SHELVES) {
      incoming.push(...(await fetchShelf(settings.goodreads_user_id, shelf, settings.goodreads_rss_key)));
    }

    const { data: existing, error: bErr } = await supabase.from("books").select("*");
    if (bErr) throw new Error(bErr.message);
    const plan = planMerge(existing as Book[], incoming);

    if (plan.inserts.length) {
      const { error } = await supabase.from("books").insert(plan.inserts);
      if (error) throw new Error(error.message);
    }
    for (let i = 0; i < plan.updates.length; i += 20) {
      const chunk = plan.updates.slice(i, i + 20);
      const results = await Promise.all(chunk.map((u) => supabase.from("books").update(u.patch).eq("id", u.id)));
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(failed.error.message);
    }
    // Record a read for each newly finished book (or new finish date).
    const [{ data: allBooks, error: abErr }, { data: reads, error: rErr }] = await Promise.all([
      supabase.from("books").select("id, shelf, date_read, source"),
      supabase.from("reads").select("book_id, date_finished"),
    ]);
    if (abErr || rErr) throw new Error((abErr ?? rErr)!.message);
    const newReads = missingReads(allBooks as Book[], reads ?? []);
    if (newReads.length) {
      const { error } = await supabase.from("reads").upsert(newReads, { onConflict: "book_id,date_finished", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    result = { fetched: incoming.length, inserted: plan.inserts.length, updated: plan.updates.length, unchanged: plan.unchanged };
  } catch (e) {
    const message = (e as Error).message;
    await supabase.from("settings").update({ goodreads_last_sync: new Date().toISOString(), goodreads_last_result: `Failed: ${message}` }).eq("id", 1);
    return json({ error: message }, 502);
  }

  const summary = `${result.fetched} in feed · ${result.inserted} added · ${result.updated} updated`;
  await supabase.from("settings").update({ goodreads_last_sync: new Date().toISOString(), goodreads_last_result: summary }).eq("id", 1);
  return json(result);
});
