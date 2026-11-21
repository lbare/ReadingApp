import { describe, expect, it } from "vitest";
import { dedupe, findCandidates, normalizeTitle, searchOpenLibrary } from "../supabase/functions/_shared/openlibrary.ts";

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

describe("popularity and alternatives", () => {
  const doc = (key: string, title: string, author: string, readers: number) => ({ key, title, author_name: [author], readinglog_count: readers });

  it("merges duplicate entries, keeping the most read", () => {
    const fn = (async () => new Response(JSON.stringify({ docs: [
      doc("/works/A", "Rebecca of Sunnybrook Farm", "Kate Wiggin", 16),
      doc("/works/B", "Rebecca of Sunnybrook Farm", "Kate Wiggin", 19),
    ] }))) as unknown as typeof fetch;
    return searchOpenLibrary({ title: "Rebecca of Sunnybrook Farm" }, { fetchFn: fn }).then((r) => {
      expect(r).toHaveLength(1);
      expect(r[0].ol_work_key).toBe("/works/B");
      expect(dedupe([...r, ...r])).toHaveLength(1);
    });
  });

  it("puts the title+author match first, then other books with that title by readers", async () => {
    const fn = (async (url: string) => {
      const docs = url.includes("author=")
        ? [doc("/works/R", "Rebecca", "Daphne du Maurier", 1127)]
        : [
            doc("/works/K", "The Key to Rebecca", "Ken Follett", 64),
            doc("/works/R2", "Rebecca", "Daphne du Maurier", 900),
            doc("/works/M", "Rebecca", "Someone Else", 40),
            doc("/works/S", "Rebecca of Sunnybrook Farm", "Kate Wiggin", 19),
          ];
      return new Response(JSON.stringify({ docs }));
    }) as unknown as typeof fetch;
    const r = await findCandidates({ title: "Rebecca", author: "Daphne du Maurier" }, { fetchFn: fn });
    expect(r.map((c) => c.ol_work_key)).toEqual(["/works/R", "/works/M", "/works/K", "/works/S"]);
  });

  it("works without an author", async () => {
    const fn = (async () => new Response(JSON.stringify({ docs: [doc("/works/A", "It", "Stephen King", 5000), doc("/works/B", "It Ends with Us", "Colleen Hoover", 9000)] }))) as unknown as typeof fetch;
    const r = await findCandidates({ title: "It", author: null }, { fetchFn: fn });
    expect(r.map((c) => c.title)).toEqual(["It", "It Ends with Us"]);
  });
});
