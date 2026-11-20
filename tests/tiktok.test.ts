import { describe, expect, it } from "vitest";
import { fetchTikTokInfo, firstUrl, isTikTokUrl } from "../supabase/functions/_shared/tiktok.ts";

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
