type FetchFn = typeof fetch;

export function isTikTokUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return /(^|\.)tiktok\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Pull the first URL out of shared text ("Check this out! https://vm.tiktok.com/abc/"). */
export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0].replace(/[).,]+$/, "") : null;
}

export interface TikTokInfo {
  caption: string;
  author: string | null;
  url: string;
}

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/**
 * Caption + author for a TikTok video. Short links (vm.tiktok.com /
 * tiktok.com/t/…) are expanded first. TikTok's oEmbed endpoint used to return
 * the caption as `title`; it now often returns only the player, so fall back
 * to the caption embedded in the video page itself.
 */
export async function fetchTikTokInfo(url: string, fetchFn: FetchFn = fetch): Promise<TikTokInfo> {
  let finalUrl = url;
  const host = new URL(url).hostname;
  if (host.startsWith("vm.") || host.startsWith("vt.") || new URL(url).pathname.startsWith("/t/")) {
    const r = await fetchFn(url, { redirect: "follow", headers: { "User-Agent": MOBILE_UA } });
    finalUrl = r.url || url;
    await r.body?.cancel();
  }

  let caption = "";
  let author: string | null = null;
  try {
    const res = await fetchFn(`https://www.tiktok.com/oembed?url=${encodeURIComponent(finalUrl)}`);
    if (res.ok) {
      const body = (await res.json()) as { title?: string; author_name?: string };
      caption = body.title ?? "";
      author = body.author_name ?? null;
    } else {
      await res.body?.cancel();
    }
  } catch {
    /* fall through to the page */
  }

  if (!caption.trim()) {
    const res = await fetchFn(finalUrl, { headers: { "User-Agent": MOBILE_UA, "Accept-Language": "en-US,en;q=0.9" } });
    if (!res.ok) throw new Error(`Couldn't load the TikTok (${res.status}).`);
    const page = parseTikTokPage(await res.text());
    caption = page.caption;
    author = author ?? page.author;
  }
  return { caption, author, url: finalUrl };
}

/** Pull the caption ("desc") and creator handle out of a TikTok video page's embedded JSON. */
export function parseTikTokPage(html: string): { caption: string; author: string | null } {
  const script = html.match(/<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (script) {
    try {
      const data = JSON.parse(script[1]);
      const item = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
      if (item?.desc != null) return { caption: String(item.desc), author: item.author?.uniqueId ?? null };
    } catch {
      /* fall back to a plain search */
    }
  }
  const desc = html.match(/"desc":("(?:[^"\\]|\\.)*")/);
  const handle = html.match(/"uniqueId":("(?:[^"\\]|\\.)*")/);
  const decode = (s: string | undefined) => {
    try {
      return s ? (JSON.parse(s) as string) : null;
    } catch {
      return null;
    }
  };
  return { caption: decode(desc?.[1]) ?? "", author: decode(handle?.[1]) };
}
