import { describe, expect, it } from "vitest";
import { fetchTikTokInfo, firstUrl, isTikTokUrl, parseTikTokPage } from "../supabase/functions/_shared/tiktok.ts";

describe("tiktok", () => {
  it("finds the url in shared text", () => {
    expect(firstUrl("look at this https://vm.tiktok.com/ZMabc123/ wow")).toBe("https://vm.tiktok.com/ZMabc123/");
    expect(isTikTokUrl("https://www.tiktok.com/@user/video/1")).toBe(true);
    expect(isTikTokUrl("https://example.com")).toBe(false);
  });

  it("expands short links before calling oEmbed", async () => {
    const calls: string[] = [];
    const fn = (async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://vm.")) {
        const r = new Response("");
        Object.defineProperty(r, "url", { value: "https://www.tiktok.com/@reader/video/42" });
        return r;
      }
      return new Response(JSON.stringify({ title: "my top 3 #booktok", author_name: "reader" }));
    }) as unknown as typeof fetch;
    const info = await fetchTikTokInfo("https://vm.tiktok.com/ZMabc123/", fn);
    expect(info).toEqual({ caption: "my top 3 #booktok", author: "reader", url: "https://www.tiktok.com/@reader/video/42" });
    expect(calls[1]).toBe("https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40reader%2Fvideo%2F42");
  });
});

describe("caption fallback", () => {
  const page = (desc: string) =>
    `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: { desc, author: { uniqueId: "reader" } } } } },
    })}</script></html>`;

  it("reads the caption from the page when oEmbed has none", async () => {
    const calls: string[] = [];
    const fn = (async (url: string) => {
      calls.push(url);
      if (url.includes("/oembed")) return new Response(JSON.stringify({ type: "video", html: "<iframe>" }));
      return new Response(page("Read “Rebecca” by Daphne du Maurier #booktok"));
    }) as unknown as typeof fetch;
    const info = await fetchTikTokInfo("https://www.tiktok.com/@reader/video/42", fn);
    expect(info).toEqual({ caption: "Read “Rebecca” by Daphne du Maurier #booktok", author: "reader", url: "https://www.tiktok.com/@reader/video/42" });
    expect(calls).toHaveLength(2);
  });

  it("falls back to a plain search of the page", () => {
    expect(parseTikTokPage('{"x":1,"desc":"Line one\\nwith \\"quotes\\"","uniqueId":"bk"}')).toEqual({ caption: 'Line one\nwith "quotes"', author: "bk" });
    expect(parseTikTokPage("<html></html>")).toEqual({ caption: "", author: null });
  });
});
