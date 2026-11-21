// POST /functions/v1/capture
//
// Called by the "Add Book" Apple Shortcut with a TikTok link, a screenshot or
// plain text. Finds the books mentioned, looks each one up on Open Library,
// stores a capture row and returns the URL of the confirmation page.
//
// Auth: header `x-capture-token: <CAPTURE_TOKEN>` (the Shortcut can't sign in).
//
// Body, either JSON:
//   { "text": "https://vm.tiktok.com/…" }          — link or any shared text
//   { "image": "<base64>", "text": "optional" }    — screenshot
// or multipart/form-data with fields `text` and/or `image` (a file).
//
// Response: { id, confirm_url, found, error? }

import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { corsHeaders, json, safeEqual } from "../_shared/http.ts";
import { dedupe, findCandidates, rank } from "../_shared/openlibrary.ts";
import { fetchTikTokInfo, firstUrl, isTikTokUrl } from "../_shared/tiktok.ts";
import type { CaptureItem } from "../_shared/types.ts";

const MODEL = "claude-opus-5-5";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude's per-image limit (base64-decoded)
const MAX_BOOKS = 10;

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const BOOKS_SCHEMA = {
  type: "object",
  properties: {
    books: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Book title as published, without series info." },
          author: { type: "string", description: "Author's name, or an empty string if not stated or inferable." },
        },
        required: ["title", "author"],
        additionalProperties: false,
      },
    },
  },
  required: ["books"],
  additionalProperties: false,
} as const;

const SYSTEM = `You pull book recommendations out of social media posts so they can be added to a reading list.
Return only books that are actually named or clearly shown (title on a cover, in on-screen text, or in the caption).
Use the book's real published title and fill in the author when you are confident who wrote it.
Ignore hashtags, creator names and generic phrases like "my top 5". If no specific book is identifiable, return an empty list.`;

type ExtractInput =
  | { kind: "text"; text: string }
  | { kind: "typed"; text: string }
  | { kind: "image"; base64: string; mediaType: ImageType; context: string };
type ImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

async function extractBooks(input: ExtractInput): Promise<{ title: string; author: string | null }[]> {
  const content: Anthropic.Beta.BetaContentBlockParam[] =
    input.kind === "text"
      ? [{ type: "text", text: `Post text:\n"""\n${input.text}\n"""\n\nWhich books does it mention?` }]
      : input.kind === "typed"
        ? [
            {
              type: "text",
              text:
                `Someone typed this to look up a book: "${input.text}". It is a book title, possibly with the author. ` +
                `Treat it as a title even if it is an ordinary word or phrase, and return the one book they most likely mean.`,
            },
          ]
        : [
          { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.base64 } },
          { type: "text", text: `${input.context} Which books does it show or mention?` },
        ];

  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { effort: "low", format: { type: "json_schema", schema: BOOKS_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (response.stop_reason === "refusal") throw new Error("The model declined to read this capture.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = JSON.parse(text) as { books: { title: string; author: string }[] };
  const seen = new Set<string>();
  return parsed.books
    .map((b) => ({ title: b.title.trim(), author: b.author.trim() || null }))
    .filter((b) => b.title && !seen.has(b.title.toLowerCase()) && seen.add(b.title.toLowerCase()))
    .slice(0, MAX_BOOKS);
}

/** A short single line with no link: a title typed into the Shortcut rather than a shared post. */
function isTyped(text: string): boolean {
  return text.length > 0 && text.length <= 80 && !text.includes("\n") && !/https?:\/\//.test(text);
}

function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^,]+,/, "").replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function readBody(req: Request): Promise<{ text: string; image: Uint8Array | null }> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("image");
    return {
      text: String(form.get("text") ?? ""),
      image: file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null,
    };
  }
  if (type.includes("application/json")) {
    const body = (await req.json()) as { text?: string; url?: string; image?: string };
    return {
      text: [body.url, body.text].filter(Boolean).join(" "),
      image: body.image ? base64ToBytes(body.image) : null,
    };
  }
  return { text: await req.text(), image: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const expected = Deno.env.get("CAPTURE_TOKEN");
  const given = req.headers.get("x-capture-token") ?? "";
  if (!expected || !safeEqual(given, expected)) return json({ error: "Bad or missing x-capture-token" }, 401);

  let body: { text: string; image: Uint8Array | null };
  try {
    body = await readBody(req);
  } catch (e) {
    return json({ error: `Couldn't read the request: ${(e as Error).message}` }, 400);
  }
  const text = body.text.trim();
  if (!text && !body.image) return json({ error: "Send a link, some text or an image." }, 400);

  let sourceType: "tiktok" | "screenshot" | "text" = "text";
  let sourceUrl: string | null = firstUrl(text);
  let rawText: string | null = text || null;
  let error: string | null = null;
  let items: CaptureItem[] = [];

  try {
    // A TikTok link: read the caption. Sharing from TikTok also hands the
    // Shortcut the video's preview image, so this can arrive with an image too.
    let tiktok: { caption: string; author: string | null } | null = null;
    if (sourceUrl && isTikTokUrl(sourceUrl)) {
      sourceType = "tiktok";
      try {
        const info = await fetchTikTokInfo(sourceUrl);
        sourceUrl = info.url;
        rawText = info.caption;
        tiktok = { caption: info.caption, author: info.author };
      } catch (e) {
        if (!body.image) throw e; // with an image we can still try the preview frame
        console.error(e);
      }
    }

    let input: ExtractInput;
    if (body.image) {
      if (body.image.byteLength > MAX_IMAGE_BYTES) {
        throw new Error("Screenshot is over 5 MB. Add a Resize Image / Convert Image (JPEG) step to the Shortcut.");
      }
      const mediaType = sniffImageType(body.image);
      if (!mediaType) throw new Error("Unsupported image type (use JPEG, PNG, GIF or WebP).");
      if (sourceType !== "tiktok") sourceType = "screenshot";
      const context = tiktok
        ? `This is the preview frame of a TikTok video. Its caption: "${tiktok.caption}" (creator: ${tiktok.author ?? "unknown"}).`
        : `This is a screenshot from a social media post${text ? ` (shared with this text: "${text}")` : ""}.`;
      input = { kind: "image", base64: bytesToBase64(body.image), mediaType, context };
    } else if (tiktok) {
      if (!tiktok.caption.trim()) throw new Error("This TikTok has no caption. Share a screenshot of the frame that shows the book.");
      input = { kind: "text", text: `${tiktok.caption}\n\n(creator: ${tiktok.author ?? "unknown"})` };
    } else if (isTyped(text)) {
      input = { kind: "typed", text };
    } else {
      input = { kind: "text", text };
    }

    let found = await extractBooks(input);
    // A typed title Claude didn't recognise: search Open Library with it as-is.
    if (found.length === 0 && input.kind === "typed") found = [{ title: text, author: null }];
    items = await Promise.all(
      found.map(async (q): Promise<CaptureItem> => ({
        query: q,
        candidates: await findCandidates(q, { limit: 5 }).catch(() => []),
        decision: null,
        book_id: null,
      })),
    );
    // Typed title: Claude may pick a different book than the words typed
    // ("cows" → "The Cows"), so also search exactly what was typed and rank
    // titles that match it first, then the most-read.
    if (input.kind === "typed" && items.length > 0) {
      const raw = await findCandidates({ title: text, author: null }, { limit: 5 }).catch(() => []);
      items[0].candidates = rank(dedupe([...items[0].candidates, ...raw]), text).slice(0, 5);
    }
    if (items.length === 0) error = "No books found. Search for it by name below.";
  } catch (e) {
    console.error(e);
    if (e instanceof Anthropic.APIError) {
      // e.g. "Your credit balance is too low…" — shown on the confirmation page.
      const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message;
      error = `Claude API error (${e.status ?? "network"})${detail ? `: ${detail}` : ""}`;
    } else {
      error = (e as Error).message;
    }
  }

  const { data, error: dbError } = await supabase
    .from("captures")
    .insert({ source_type: sourceType, source_url: sourceUrl, raw_text: rawText, items, error })
    .select("id")
    .single();
  if (dbError) return json({ error: `Database error: ${dbError.message}` }, 500);

  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  return json({ id: data.id, confirm_url: `${appUrl}/confirm/${data.id}`, found: items.length, error });
});
