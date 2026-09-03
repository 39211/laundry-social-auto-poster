import { runInNewContext } from "node:vm";

/**
 * Search-content funnel analytics shared by every generated indexable page.
 *
 * GA4 measures visits and actions; GSC remains the source of truth for search
 * impressions and indexing. The LINE redirect owns the canonical `line_click`
 * event, so source pages emit `click_line_cta` to avoid double counting.
 */

export const SEARCH_CONTENT_ANALYTICS_PATH = "scripts/search-content-analytics.js";

export const REQUIRED_SEARCH_CONTENT_EVENTS = [
  "view_knowledge_hub",
  "view_search_answer",
  "view_service",
  "click_answer_from_hub",
  "click_service_from_hub",
  "click_service_from_answer",
  "click_phone",
  "click_line_cta",
  "view_article",
  "click_service_from_article"
] as const;

export type SearchContentEventName = (typeof REQUIRED_SEARCH_CONTENT_EVENTS)[number];

export function buildSearchContentAnalyticsScript(): string {
  return `(() => {
  "use strict";

  const body = document.body;
  if (!body) return;

  const pageType = body.dataset.analyticsPageType || "unknown";
  const contentId = body.dataset.analyticsContentId || "unknown";
  const sourcePage = window.location.pathname;

  const send = (eventName, extra = {}) => {
    if (typeof window.gtag !== "function") return;
    window.gtag("event", eventName, {
      page_type: pageType,
      content_id: contentId,
      source_page: sourcePage,
      transport_type: "beacon",
      ...extra
    });
  };

  if (pageType === "knowledge_hub") send("view_knowledge_hub");
  if (pageType === "answer") send("view_search_answer");
  if (pageType === "service") send("view_service");
  if (pageType === "article") send("view_article");

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]");
    if (!anchor) return;

    const rawHref = anchor.getAttribute("href") || "";
    const ctaName = (anchor.textContent || "link").replace(/\\s+/g, " ").trim().slice(0, 80);
    if (rawHref.startsWith("tel:")) {
      send("click_phone", { cta_name: ctaName });
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(rawHref, window.location.href);
    } catch {
      return;
    }

    if (targetUrl.pathname.endsWith("/go/line.html")) {
      send("click_line_cta", { cta_name: ctaName });
      return;
    }

    if (pageType === "knowledge_hub" && /\\/(guides|local)\\/[^/]+\\.html$/.test(targetUrl.pathname)) {
      send("click_answer_from_hub", {
        answer_id: targetUrl.pathname.split("/").pop()?.replace(/\\.html$/, "") || "unknown",
        cta_name: ctaName
      });
      return;
    }

    if (pageType === "knowledge_hub" && /\\/services\\/[^/]+\\.html$/.test(targetUrl.pathname)) {
      send("click_service_from_hub", {
        service_id: targetUrl.pathname.split("/").pop()?.replace(/\\.html$/, "") || "unknown",
        cta_name: ctaName
      });
      return;
    }

    if (pageType === "answer" && /\\/services\\/[^/]+\\.html$/.test(targetUrl.pathname)) {
      send("click_service_from_answer", {
        service_id: targetUrl.pathname.split("/").pop()?.replace(/\\.html$/, "") || "unknown",
        cta_name: ctaName
      });
      return;
    }

    if (pageType === "article" && /\\/services\\/[^/]+\\.html$/.test(targetUrl.pathname)) {
      send("click_service_from_article", {
        service_id: targetUrl.pathname.split("/").pop()?.replace(/\\.html$/, "") || "unknown",
        cta_name: ctaName
      });
    }
  });
})();
`;
}

interface RuntimeScenario {
  pageType: "home" | "knowledge_hub" | "answer" | "service" | "article";
  href?: string;
}

interface ObservedRuntimeEvent {
  name: string;
  params: Record<string, unknown>;
}

function observeRuntimeEvents(script: string, scenario: RuntimeScenario): ObservedRuntimeEvent[] {
  const events: ObservedRuntimeEvent[] = [];
  let clickListener: ((event: { target: RuntimeElement }) => void) | undefined;

  class RuntimeElement {
    constructor(
      private readonly href: string,
      readonly textContent = "測試連結"
    ) {}

    closest(selector: string): RuntimeElement | null {
      return selector === "a[href]" ? this : null;
    }

    getAttribute(name: string): string | null {
      return name === "href" ? this.href : null;
    }
  }

  const pathname =
    scenario.pageType === "knowledge_hub"
      ? "/knowledge/"
      : scenario.pageType === "article"
        ? "/posts/2026-07-02-slot-01.html"
        : "/guides/test-answer.html";
  const sandbox = {
    URL,
    Element: RuntimeElement,
    window: {
      location: { href: `https://example.com${pathname}`, pathname },
      gtag: (command: string, eventName: string, params: Record<string, unknown> = {}) => {
        if (command === "event") events.push({ name: eventName, params });
      }
    },
    document: {
      body: {
        dataset: {
          analyticsPageType: scenario.pageType,
          analyticsContentId: "runtime-check"
        }
      },
      addEventListener: (eventName: string, listener: (event: { target: RuntimeElement }) => void) => {
        if (eventName === "click") clickListener = listener;
      }
    }
  };

  runInNewContext(script, sandbox, { timeout: 1_000 });
  if (!clickListener) throw new Error("search-content analytics is missing active delegated click tracking");
  if (scenario.href) clickListener({ target: new RuntimeElement(scenario.href) });
  return events;
}

/** Fail closed if a future edit silently disables a funnel stage or double-counts leads. */
export function assertSearchContentAnalyticsScript(script: string): void {
  for (const eventName of REQUIRED_SEARCH_CONTENT_EVENTS) {
    if (!script.includes(`send("${eventName}"`)) {
      throw new Error(`search-content analytics is missing required event: ${eventName}`);
    }
  }
  if (!script.includes('document.addEventListener("click"')) {
    throw new Error("search-content analytics is missing delegated click tracking");
  }
  if (script.includes('send("line_click"')) {
    throw new Error("search-content analytics must not duplicate the LINE redirect line_click event");
  }
  if (script.includes('send("generate_lead"')) {
    throw new Error("generate_lead requires a confirmed conversion and must not fire from navigation clicks");
  }

  const observed = [
    { pageType: "knowledge_hub" as const },
    { pageType: "answer" as const },
    { pageType: "service" as const },
    { pageType: "knowledge_hub" as const, href: "/guides/test-answer.html" },
    { pageType: "knowledge_hub" as const, href: "/services/shoe-bag-care.html" },
    { pageType: "answer" as const, href: "/services/shoe-bag-care.html" },
    { pageType: "article" as const },
    { pageType: "article" as const, href: "/services/shoe-bag-care.html" },
    { pageType: "home" as const, href: "/go/line.html?source=runtime-check" },
    { pageType: "home" as const, href: "tel:+886424527411" }
  ].flatMap((scenario) => observeRuntimeEvents(script, scenario));
  const observedNames = new Set(observed.map((event) => event.name));
  for (const eventName of REQUIRED_SEARCH_CONTENT_EVENTS) {
    if (!observedNames.has(eventName)) {
      throw new Error(`search-content analytics required event is not reachable at runtime: ${eventName}`);
    }
  }
  const eventSpecificParameters: Partial<Record<SearchContentEventName, string[]>> = {
    click_answer_from_hub: ["answer_id", "cta_name"],
    click_service_from_hub: ["service_id", "cta_name"],
    click_service_from_answer: ["service_id", "cta_name"],
    click_service_from_article: ["service_id", "cta_name"],
    click_phone: ["cta_name"],
    click_line_cta: ["cta_name"]
  };
  for (const event of observed) {
    const requiredParameters = [
      "page_type",
      "content_id",
      "source_page",
      "transport_type",
      ...(eventSpecificParameters[event.name as SearchContentEventName] ?? [])
    ];
    for (const parameter of requiredParameters) {
      if (!(parameter in event.params) || event.params[parameter] === "") {
        throw new Error(`search-content analytics event ${event.name} is missing runtime parameter: ${parameter}`);
      }
    }
  }
  for (const forbidden of ["line_click", "generate_lead"]) {
    if (observedNames.has(forbidden)) {
      throw new Error(`search-content analytics emitted forbidden event at runtime: ${forbidden}`);
    }
  }
}
