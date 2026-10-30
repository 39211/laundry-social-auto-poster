import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";

const official = "https://line.me/R/ti/p/%40454foyks";
const html = readFileSync(join(process.cwd(), "seo-overrides/go/line.html"), "utf8");
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1]!;
function execute(search: string, analytics = true, referrer = "") {
  const redirects: string[] = [];
  const events: Array<{ name: string; params: Record<string, unknown> }> = [];
  const timers: Array<() => void> = [];
  const gtag = (_: string, name: string, params: Record<string, unknown>) => events.push({name, params});
  new Script(code).runInNewContext({window: analytics ? {gtag} : {}, location: {search, replace: (url: string) => redirects.push(url)}, document: {referrer}, URL, URLSearchParams, setTimeout: (fn: () => void) => timers.push(fn)});
  return {redirects, events, timers};
}
describe("official LINE booking redirect", () => {
  it("keeps both attribution keys and waits for the analytics callback", () => {
    const r = execute("?source=home-cta");
    expect(html).toContain("G-ZKHW4MTBZJ");
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({name:"line_click",params:{source:"home-cta",link_source:"home-cta",transport_type:"beacon"}});
    expect(r.redirects).toEqual([]);
    (r.events[0]!.params.event_callback as () => void)();
    r.timers.forEach(fn => fn());
    expect(r.redirects).toEqual([official]);
  });
  it("opens the official account if analytics is blocked or times out", () => {
    expect(execute("?source=booking", false).redirects).toEqual([official]);
    const delayed = execute("?source=booking");delayed.timers.forEach(fn => fn());
    expect(delayed.redirects).toEqual([official]);
  });
  it("retains a non-empty referrer fallback and official no-script links", () => {
    const r = execute("", true, "https://www.instagram.com/");
    expect(r.events[0]!.params).toMatchObject({source:"referrer-instagram",link_source:"referrer-instagram"});
    expect(execute("").events[0]!.params.source).toBe("unknown");
    expect(html).toContain(`url=${official}`);
    expect(html).not.toContain("https://line.me/ti/p/4m-rA6hxf6");
  });
});
