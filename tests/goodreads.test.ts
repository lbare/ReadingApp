import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  goodreadsUrl,
  parseGoodreadsListHtml,
  parseCsv,
  parseGoodreadsCsv,
  parseGoodreadsRss,
  parseGoodreadsUserId,
  rssDate,
} from "../supabase/functions/_shared/goodreads.ts";

const csv = readFileSync(new URL("./fixtures/goodreads_library_export.csv", import.meta.url), "utf8");
const rss = readFileSync(new URL("./fixtures/goodreads_rss.xml", import.meta.url), "utf8");

describe("parseCsv", () => {
  it("handles quotes, commas, newlines and CRLF", () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,"two\nlines",3\r\n')).toEqual([
      ["a", "b,c", 'd "e"'],
      ["1", "two\nlines", "3"],
    ]);
  });
});

describe("parseGoodreadsCsv", () => {
  const { books, skipped } = parseGoodreadsCsv(csv);

  it("reads every row", () => {
    expect(skipped).toBe(0);
    expect(books.map((b) => b.title)).toEqual([
      "Example Book, With Comma",
      "Second Example",
      "Third Example (Series #2)",
      "Fourth Example",
    ]);
  });

  it("maps fields and shelves", () => {
    const [a, b, c, d] = books;
    expect(a).toMatchObject({
      goodreads_id: "111",
      author: "Ann Author",
      isbn10: "0439023483",
      isbn13: "9780439023481",
      my_rating: 4,
      pages: 374,
      published_year: 2008,
      date_read: "2024-03-14",
      date_added: "2023-12-01",
      shelf: "read",
      read_count: 1,
      source: "goodreads_csv",
    });
    expect(b).toMatchObject({ shelf: "to_read", my_rating: null, isbn13: null, pages: null, date_read: null });
    expect(c).toMatchObject({ read_count: 2, my_rating: 5 });
    expect(d.shelf).toBe("currently_reading");
  });

  it("rejects files that aren't Goodreads exports", () => {
    expect(() => parseGoodreadsCsv("name,email\nx,y")).toThrow(/Goodreads export/);
  });
});

describe("parseGoodreadsRss", () => {
  const books = parseGoodreadsRss(rss, "read");
  it("parses items", () => {
    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({
      title: "Example Book, With Comma",
      goodreads_id: "111",
      pages: 374,
      isbn10: "0439023483",
      my_rating: 5,
      date_read: "2024-03-14",
      date_added: "2023-12-01",
      cover_url: "https://images.example/111-large.jpg",
      source: "goodreads_rss",
    });
    expect(books[1]).toMatchObject({ title: "Brand & New", cover_url: null, pages: null, my_rating: null });
  });
  it("keeps the date in its own offset", () => {
    expect(rssDate("Thu, 14 Mar 2024 23:30:00 -0700")).toBe("2024-03-14");
  });
});

describe("links and ids", () => {
  it("prefers goodreads id, then isbn, then search", () => {
    expect(goodreadsUrl({ goodreads_id: "111", title: "x" })).toBe("https://www.goodreads.com/book/show/111");
    expect(goodreadsUrl({ isbn13: "9780439023481", title: "x" })).toBe("https://www.goodreads.com/book/isbn/9780439023481");
    expect(goodreadsUrl({ title: "Some Title", author: "A B" })).toBe("https://www.goodreads.com/search?q=Some%20Title%20A%20B");
  });
  it("extracts a user id from a profile URL", () => {
    expect(parseGoodreadsUserId("https://www.goodreads.com/user/show/12345678-some-name")).toBe("12345678");
    expect(parseGoodreadsUserId("12345678")).toBe("12345678");
    expect(parseGoodreadsUserId("nope")).toBeNull();
  });
});

describe("ratings", () => {
  const header =
    "Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies";
  const row = (rating: string) => `1,Some Title,Stephen  King,"King, Stephen",,"=""""","=""""",${rating},Pub,Paperback,300,2020,2020,2026/11/08,2026/10/13,,,read,,,,1,0`;

  it("keeps half stars and treats 0 as unrated", () => {
    const { books } = parseGoodreadsCsv([header, row("3.5"), row("4.0"), row("0"), row("2.5")].join("\n"));
    expect(books.map((b) => b.my_rating)).toEqual([3.5, 4, null, 2.5]);
  });

  it("works without the Average Rating column and tidies spacing", () => {
    const { books } = parseGoodreadsCsv([header, row("3.5")].join("\n"));
    expect(books[0]).toMatchObject({ author: "Stephen King", avg_rating: null, pages: 300, date_read: "2026-11-08" });
  });
});

describe("parseGoodreadsListHtml (saved My Books page)", () => {
  const row = (id: string, title: string, author: string, avg: string, count: string, pages: string, isbn13 = "") => `
<div id="review_${id}" class="bookalike review">
  <div class="field checkbox" style="display: none"><label>checkbox</label><div class="value"><input type="checkbox"></div></div>
  <div class="field title"><label>title</label><div class="value"> <a title="${title}" href="/book/show/${id}-slug"> ${title} </a></div></div>
  <div class="field author"><label>author</label><div class="value"> <a href="/author/show/1.X">${author}</a> <span title="Goodreads Author!">*</span> </div></div>
  <div class="field isbn13" style="display: none"><label>isbn13</label><div class="value"> ${isbn13} </div></div>
  <div class="field num_pages"><label>num pages</label><div class="value"> <nobr> ${pages} <span class="greyText">pp</span> </nobr> </div></div>
  <div class="field avg_rating"><label>avg rating</label><div class="value"> ${avg} </div></div>
  <div class="field num_ratings" style="display: none"><label>num ratings</label><div class="value"> ${count} </div></div>
</div>`;
  const html = `<html><div id="review_list_error_message"></div>${row("59344312", "Verity", "Hoover, Colleen", "4.27", "4,364,928", "336")}${row("11", "Ender&#39;s Game", "Card, Orson Scott", "4.31", "1,500,000", "324", "9780812550702")}</html>`;

  it("reads id, title, author, rating, count and pages from each row", () => {
    expect(parseGoodreadsListHtml(html)).toEqual([
      { goodreads_id: "59344312", title: "Verity", author: "Colleen Hoover", avg_rating: 4.27, ratings_count: 4364928, pages: 336, isbn13: null, isbn10: null },
      { goodreads_id: "11", title: "Ender's Game", author: "Orson Scott Card", avg_rating: 4.31, ratings_count: 1500000, pages: 324, isbn13: "9780812550702", isbn10: null },
    ]);
  });

  it("finds nothing in an unrelated page", () => {
    expect(parseGoodreadsListHtml("<html><body>hi</body></html>")).toEqual([]);
  });
});
