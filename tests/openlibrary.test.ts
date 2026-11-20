import { describe, expect, it } from "vitest";
import { normalizeTitle, searchOpenLibrary } from "../supabase/functions/_shared/openlibrary.ts";

const fakeFetch = (docsByCall: object[][]) => {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ docs: docsByCall[calls.length - 1] ?? [] }));
  }) as unknown as typeof fetch;
  return { fn, calls };
};

describe("searchOpenLibrary", () => {
  it("puts exact title matches first, then most-rated", async () => {
    const { fn } = fakeFetch([[
      { key: "/works/A", title: "Dune", ratings_count: 5000, cover_i: 1, isbn: ["9780441172719", "0441172717"] },
      { key: "/works/B", title: "Dune Messiah", ratings_count: 900 },
    ]]);
    const r = await searchOpenLibrary({ title: "Dune Messiah", author: "Frank Herbert" }, { fetchFn: fn });
    expect(r[0].ol_work_key).toBe("/works/B");
    expect(r[1]).toMatchObject({ isbn13: "9780441172719", isbn10: "0441172717", cover_url: "https://covers.openlibrary.org/b/id/1-M.jpg" });
  });

  it("falls back to free text when title+author finds nothing", async () => {
    const { fn, calls } = fakeFetch([[], [{ key: "/works/C", title: "Found" }]]);
    const r = await searchOpenLibrary({ title: "Found", author: "Misspelt" }, { fetchFn: fn });
    expect(r).toHaveLength(1);
    expect(calls[1]).toContain("q=Found+Misspelt");
  });

  it("normalizes titles", () => {
    expect(normalizeTitle("The Hunger Games (The Hunger Games, #1)")).toBe("hunger games");
    expect(normalizeTitle("Project Hail Mary: A Novel")).toBe("project hail mary");
  });
});
