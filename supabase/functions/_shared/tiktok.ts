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

/**
 * Caption + author via TikTok's public oEmbed endpoint. Short links
 * (vm.tiktok.com / tiktok.com/t/…) are expanded first.
 */
export async function fetchTikTokInfo(url: string, fetchFn: FetchFn = fetch): Promise<TikTokInfo> {
  let finalUrl = url;
  const host = new URL(url).hostname;
  if (host.startsWith("vm.") || host.startsWith("vt.") || new URL(url).pathname.startsWith("/t/")) {
    const r = await fetchFn(url, { redirect: "follow" });
    finalUrl = r.url || url;
    await r.body?.cancel();
  }
  const res = await fetchFn(`https://www.tiktok.com/oembed?url=${encodeURIComponent(finalUrl)}`);
  if (!res.ok) throw new Error(`TikTok oEmbed failed (${res.status})`);
  const body = (await res.json()) as { title?: string; author_name?: string };
  return { caption: body.title ?? "", author: body.author_name ?? null, url: finalUrl };
}
