import { type BookFields, type Shelf, emptyBook } from "./types.ts";

// ---------------------------------------------------------------------------
// Links

/** Link that opens the book on Goodreads (the iOS app picks up goodreads.com links). */
export function goodreadsUrl(b: {
  goodreads_id?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  title: string;
  author?: string | null;
}): string {
  if (b.goodreads_id) return `https://www.goodreads.com/book/show/${encodeURIComponent(b.goodreads_id)}`;
  const isbn = b.isbn13 ?? b.isbn10;
  if (isbn) return `https://www.goodreads.com/book/isbn/${encodeURIComponent(isbn)}`;
  const q = [b.title, b.author].filter(Boolean).join(" ");
  return `https://www.goodreads.com/search?q=${encodeURIComponent(q)}`;
}

// ---------------------------------------------------------------------------
// Shelves

export function mapGoodreadsShelf(exclusiveShelf: string): Shelf {
  switch (exclusiveShelf.trim().toLowerCase()) {
    case "read":
      return "read";
    case "currently-reading":
      return "currently_reading";
    default:
      return "to_read"; // "to-read" and any custom exclusive shelf
  }
}

// ---------------------------------------------------------------------------
// CSV export (My Books → Import and export → Export Library)

/** RFC 4180 CSV parser: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Goodreads wraps ISBNs as ="0439023483" so spreadsheets keep leading zeros. */
function cleanIsbn(v: string | undefined): string | null {
  const digits = (v ?? "").replace(/[^0-9Xx]/g, "");
  return digits.length === 10 || digits.length === 13 ? digits.toUpperCase() : null;
}

function toInt(v: string | undefined): number | null {
  const n = parseInt((v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/** "3.5" → 3.5, "4" → 4; 0 or blank (unrated) → null. Rounded to the nearest half star. */
function toRating(v: string | undefined): number | null {
  const n = toFloat(v);
  if (n == null || n <= 0) return null;
  return Math.min(5, Math.round(n * 2) / 2);
}

/** Collapse runs of whitespace ("Stephen  King" → "Stephen King"). */
function clean(v: string | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

function toFloat(v: string | undefined): number | null {
  const n = parseFloat((v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

/** "2021/03/14" → "2021-03-14" (Goodreads CSV); returns null for blanks. */
function csvDate(v: string | undefined): string | null {
  const m = (v ?? "").trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export interface CsvImportResult {
  books: BookFields[];
  skipped: number;
}

export function parseGoodreadsCsv(text: string): CsvImportResult {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("The file is empty.");
  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const required = ["Book Id", "Title", "Author", "Exclusive Shelf"];
  const missing = required.filter((r) => col(r) === -1);
  if (missing.length) {
    throw new Error(`This doesn't look like a Goodreads export (missing ${missing.join(", ")}).`);
  }
  const get = (r: string[], name: string) => {
    const i = col(name);
    return i === -1 ? undefined : r[i];
  };

  const books: BookFields[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const title = clean(get(r, "Title"));
    if (!title) {
      skipped++;
      continue;
    }
    const shelf = mapGoodreadsShelf(get(r, "Exclusive Shelf") ?? "");
    const dateRead = csvDate(get(r, "Date Read"));
    const rating = toRating(get(r, "My Rating"));
    const readCount = toInt(get(r, "Read Count"));
    books.push(
      emptyBook({
        title,
        author: clean(get(r, "Author")) || null,
        isbn13: cleanIsbn(get(r, "ISBN13")),
        isbn10: cleanIsbn(get(r, "ISBN")),
        goodreads_id: (get(r, "Book Id") ?? "").trim() || null,
        pages: toInt(get(r, "Number of Pages")),
        avg_rating: toFloat(get(r, "Average Rating")),
        published_year: toInt(get(r, "Original Publication Year")) ?? toInt(get(r, "Year Published")),
        shelf,
        my_rating: rating,
        date_added: csvDate(get(r, "Date Added")),
        date_read: dateRead,
        read_count: readCount ?? (shelf === "read" ? 1 : 0),
        source: "goodreads_csv",
      }),
    );
  }
  return { books, skipped };
}

// ---------------------------------------------------------------------------
// RSS (https://www.goodreads.com/review/list_rss/<user id>?shelf=<shelf>)

export const RSS_SHELVES = ["read", "currently-reading", "to-read"] as const;

export function goodreadsRssUrl(
  userId: string,
  shelf: string,
  page: number,
  key?: string | null,
): string {
  const params = new URLSearchParams({ shelf, page: String(page) });
  if (key) params.set("key", key);
  return `https://www.goodreads.com/review/list_rss/${encodeURIComponent(userId)}?${params}`;
}

/** Accepts a bare id ("12345678") or a profile URL ("…/user/show/12345678-name"). */
export function parseGoodreadsUserId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/(?:user\/show\/|list_rss\/|review\/list\/)?(\d{3,})/);
  return m ? m[1] : null;
}

function decodeXml(s: string): string {
  return s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1]) : null;
}

/** RFC 822 date ("Sat, 14 Mar 2021 00:00:00 -0700") → "2021-03-14" in the date's own offset. */
export function rssDate(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/(\d{1,2}) (\w{3}) (\d{4})/);
  if (!m) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mi = months.indexOf(m[2].toLowerCase());
  if (mi === -1) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function parseGoodreadsRss(xml: string, shelf: Shelf): BookFields[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.map((item) => {
    const bookBlock = item.match(/<book id="?(\d+)"?>([\s\S]*?)<\/book>/);
    const isbn = cleanIsbn(tag(item, "isbn") ?? undefined);
    const rating = toRating(tag(item, "user_rating") ?? undefined);
    const dateRead = rssDate(tag(item, "user_read_at"));
    const cover = tag(item, "book_large_image_url") || tag(item, "book_image_url");
    return emptyBook({
      title: tag(item, "title") ?? "(untitled)",
      author: tag(item, "author_name"),
      isbn13: isbn && isbn.length === 13 ? isbn : null,
      isbn10: isbn && isbn.length === 10 ? isbn : null,
      goodreads_id: tag(item, "book_id") ?? bookBlock?.[1] ?? null,
      // Goodreads serves a "nophoto" placeholder when there's no cover.
      cover_url: cover && !cover.includes("nophoto") ? cover : null,
      pages: bookBlock ? toInt(tag(bookBlock[2], "num_pages") ?? undefined) : null,
      avg_rating: toFloat(tag(item, "average_rating") ?? undefined),
      published_year: toInt(tag(item, "book_published") ?? undefined),
      shelf,
      my_rating: rating,
      date_added: rssDate(tag(item, "user_date_added")),
      date_read: dateRead,
      read_count: shelf === "read" ? 1 : 0,
      source: "goodreads_rss",
    });
  });
}

// ---------------------------------------------------------------------------
// Saved "My Books" page (goodreads.com/review/list/<id>, saved as HTML).
// Goodreads dropped RSS feeds and the export no longer has average ratings,
// but the My Books table still shows them for every book on the page.

export interface ListPageBook {
  goodreads_id: string | null;
  title: string;
  author: string | null; // "First Last"
  avg_rating: number | null;
  ratings_count: number | null;
  pages: number | null;
  isbn13: string | null;
  isbn10: string | null;
}

function htmlText(s: string): string {
  return decodeXml(s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function listField(row: string, name: string): { html: string; text: string } | null {
  const m = row.match(new RegExp(`class="field ${name}"[^>]*>\\s*<label>[\\s\\S]*?</label>\\s*<div class="value">([\\s\\S]*?)</div>\\s*</(?:div|td)>`));
  return m ? { html: m[1], text: htmlText(m[1]) } : null;
}

/** "Hoover, Colleen" → "Colleen Hoover" (single names stay as they are). */
function unflipName(name: string): string {
  const parts = name.split(",").map((p) => p.trim());
  return parts.length === 2 && parts[1] ? `${parts[1]} ${parts[0]}` : name;
}

export function parseGoodreadsListHtml(html: string): ListPageBook[] {
  const starts: number[] = [];
  // Rows are <div id="review_123" class="bookalike review"> (or <tr> in older layouts).
  const re = /<(?:div|tr)[^>]*\bid="review_\d+"/g;
  for (let m = re.exec(html); m; m = re.exec(html)) starts.push(m.index);
  return starts.map((start, i) => {
    const row = html.slice(start, starts[i + 1] ?? html.length);
    const title = listField(row, "title");
    const author = listField(row, "author");
    const avg = parseFloat(listField(row, "avg_rating")?.text ?? "");
    const count = parseInt((listField(row, "num_ratings")?.text ?? "").replace(/[^\d]/g, ""), 10);
    const pages = parseInt(listField(row, "num_pages")?.text ?? "", 10);
    const authorName = author?.text.replace(/\s*\*$/, "").trim() ?? "";
    return {
      goodreads_id: title?.html.match(/\/book\/show\/(\d+)/)?.[1] ?? null,
      title: title?.text ?? "",
      author: authorName ? unflipName(authorName) : null,
      avg_rating: Number.isFinite(avg) && avg > 0 ? avg : null,
      ratings_count: Number.isFinite(count) ? count : null,
      pages: Number.isFinite(pages) && pages > 0 ? pages : null,
      isbn13: cleanIsbn(listField(row, "isbn13")?.text),
      isbn10: cleanIsbn(listField(row, "isbn")?.text),
    };
  }).filter((b) => b.title);
}
