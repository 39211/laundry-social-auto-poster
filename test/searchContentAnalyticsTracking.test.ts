import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { assertSearchContentAnalyticsScript, buildSearchContentAnalyticsScript } from "../src/searchContentAnalytics.js";

type Call = [string, string, Record<string, any>?];

// Deliberately no browser, network, credentials, or GA4 SDK in this harness.
function observe(href?: string, options: { pageType?: string; noGtag?: boolean; text?: string; script?: string } = {}) {
  const calls: Call[] = [];
  const listeners: Record<string, (event?: any) => void> = {};
  let prevented = false;
  class Element {
    constructor(readonly href: string, readonly textContent = options.text ?? "  LINE\n詢問  ") {}
    closest(selector: string) { return selector === "a[href]" ? this : null; }
    getAttribute(name: string) { return name === "href" ? this.href : null; }
  }
  const window = {
    location: Object.freeze({
      href: "https://sixiangjialaundry.com/services/shoe-bag-care.html?utm_source=google#price",
      pathname: "/services/shoe-bag-care.html"
    }),
    innerHeight: 100,
    scrollY: 0,
    gtag: options.noGtag ? undefined : (...args: Call) => calls.push(args)
  };
  const sandbox = { URL, Element, window, document: {
    body: { dataset: { analyticsPageType: options.pageType ?? "home", analyticsContentId: "shoe-bag-care" }, scrollHeight: 1100 },
    documentElement: { scrollHeight: 1100 },
    addEventListener: (name: string, fn: (event?: any) => void) => { listeners[name] = fn; }
  }};
  runInNewContext(options.script ?? buildSearchContentAnalyticsScript(), sandbox, { timeout: 1000 });
  const click = (value: string) => listeners.click?.({
    target: new Element(value),
    preventDefault: () => { prevented = true; }
  });
  if (href !== undefined) click(href);
  const events = () => calls.filter(c => c[0] === "event").map(c => ({ name: c[1], params: c[2]! }));
  const clicks = () => events().filter(e => e.name.startsWith("click_"));
  return { calls, sandbox, click, clicks, events, listeners, prevented: () => prevented };
}

describe("LINE entry attribution (not lead or acquisition attribution)", () => {
  for (const source of ["home-cta", "footer", "services-shoe-bag-care-cta", "local-qinghai-road-shoe-cleaning-nav", "posts-2026-09-28-slot-01-cta", "google_booking", `a${"b".repeat(99)}`]) {
    it(`copies the existing source slug without changing it: ${source}`, () => {
      const r = observe(`/go/line.html?source=${source}`);
      expect(r.clicks()).toHaveLength(1);
      expect(r.clicks()[0]).toEqual({ name: "click_line_cta", params: {
        page_type: "home", content_id: "shoe-bag-care", source_page: "/services/shoe-bag-care.html",
        transport_type: "beacon", cta_name: "LINE 詢問", link_source: source
      }});
      expect(r.prevented()).toBe(false);
      expect(r.sandbox.window.location.href).toContain("?utm_source=google#price");
    });
  }

  for (const query of ["", "?source=", "?source=%20", "?source=a&source=b", "?source=home&source=home", "?source=person%40example.test", "?source=https%3A%2F%2Fexample.test", "?source=04-2452-7411", "?source=home%0A", "?source=home%20cta", `?source=a${"b".repeat(100)}`]) {
    it(`marks missing, ambiguous, or non-slug source unknown: ${query}`, () => {
      const r = observe(`/go/line.html${query}`);
      expect(r.clicks()).toHaveLength(1);
      expect(r.clicks()[0]?.params.link_source).toBe("unknown");
      expect(r.prevented()).toBe(false);
    });
  }

  for (const href of [
    "../go/line.html?source=home-cta",
    "https://sixiangjialaundry.com/go/line.html?source=home%2Dcta",
    "//sixiangjialaundry.com/go/line.html?source=home-cta&email=person%40example.test&utm_source=facebook&utm_medium=paid#hidden"
  ]) it(`uses only the destination source parameter: ${href}`, () => {
    const r = observe(href);
    expect(r.clicks()[0]?.params.link_source).toBe("home-cta");
    for (const key of ["source", "medium", "campaign", "utm_source", "utm_medium", "email", "page_location", "user_id", "client_id"]) {
      expect(r.clicks()[0]?.params).not.toHaveProperty(key);
    }
    expect(JSON.stringify(r.events())).not.toContain("person@");
  });

  for (const href of [
    "https://outside.example/go/line.html?source=home-cta",
    "//outside.example/go/line.html?source=home-cta",
    "http://sixiangjialaundry.com/go/line.html?source=home-cta",
    "https://sixiangjialaundry.com:444/go/line.html?source=home-cta",
    "https://[", "mailto:hello@example.test"
  ]) it(`does not classify external or invalid URLs: ${href}`, () => {
    expect(observe(href).clicks()).toHaveLength(0);
  });

  it("preserves phone events and never fabricates a conversion", () => {
    const r = observe("tel:+886424527411");
    expect(r.clicks().map(e => e.name)).toEqual(["click_phone"]);
    expect(r.clicks()[0]?.params).not.toHaveProperty("link_source");
    r.click("/go/line.html?source=home-cta");
    expect(r.events().some(e => ["line_click", "generate_lead", "purchase"].includes(e.name))).toBe(false);
    expect(r.prevented()).toBe(false);
  });

  it("does not prevent navigation when analytics is unavailable", () => {
    const r = observe("/go/line.html?source=home-cta", { noGtag: true });
    expect(r.events()).toHaveLength(0);
    expect(r.prevented()).toBe(false);
  });

  it("ignores non-element targets and retains the existing CTA length limit", () => {
    const r = observe(undefined, { text: "x".repeat(100) });
    r.listeners.click?.({ target: {} });
    expect(r.clicks()).toHaveLength(0);
    r.click("/go/line.html?source=home-cta");
    expect(r.clicks()[0]?.params.cta_name).toHaveLength(80);
  });

  it("retains live service/scroll/content-group behavior absent from older main source", () => {
    const r = observe(undefined, { pageType: "service" });
    expect(r.events().find(e => e.name === "view_item")?.params.items).toEqual([
      { item_id: "shoe-bag-care", item_name: "shoe-bag-care", item_category: "laundry_service" }
    ]);
    expect(r.calls).toContainEqual(["set", "content_group", "service"]);
    for (const y of [500, 600, 950, 900]) {
      r.sandbox.window.scrollY = y;
      r.listeners.scroll?.();
    }
    expect(r.events().filter(e => e.name === "scroll_depth").map(e => e.params.percent_scrolled)).toEqual([50, 90]);
  });

  it("retains internal service funnel steps", () => {
    expect(observe("/services/white-shoe-cleaning.html", { pageType: "answer" }).clicks().map(e => e.name)).toEqual(["click_service_from_answer"]);
    expect(observe("https://outside.example/services/white-shoe-cleaning.html", { pageType: "answer" }).clicks()).toHaveLength(0);
  });

  it("the build guard accepts the repaired script but rejects a missing or constant entry code", () => {
    const script = buildSearchContentAnalyticsScript();
    expect(() => assertSearchContentAnalyticsScript(script)).not.toThrow();
    const missing = script.replace("link_source: linkSource", "removed_source: linkSource");
    expect(missing).not.toBe(script);
    expect(() => assertSearchContentAnalyticsScript(missing)).toThrow(/link_source/);
    const constant = script.replace("link_source: linkSource", 'link_source: "home-cta"');
    expect(() => assertSearchContentAnalyticsScript(constant)).toThrow(/link_source/);
  });
});
