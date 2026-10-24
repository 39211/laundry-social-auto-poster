/** Dependency-free runtime contract tests; no network or GA4 collection. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSearchContentAnalyticsScript, assertSearchContentAnalyticsScript } from '../src/searchContentAnalytics.ts';
const script = buildSearchContentAnalyticsScript();

function observe(pageType = 'answer', href, options = {}) {
  const calls = [], listeners = {};
  class Element {
    constructor(value, text = '  詢問\n服務  ') { this.href = value; this.textContent = text; }
    closest(selector) { return selector === 'a[href]' ? this : null; }
    getAttribute(name) { return name === 'href' ? this.href : null; }
  }
  const location = new URL('https://sixiangjialaundry.com/guides/test.html?utm_source=private#fragment');
  const window = { location, innerHeight: 100, scrollY: 0 };
  if (!options.noGtag) window.gtag = (...args) => calls.push(args);
  const sandbox = { URL, Element, window, document: {
    body: { dataset: { analyticsPageType: pageType, analyticsContentId: 'shoe-bag-care' }, scrollHeight: 1100 },
    documentElement: { scrollHeight: 1100 },
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); }
  }};
  runInNewContext(script, sandbox, { timeout: 1000 });
  const click = (value) => (listeners.click || []).forEach(fn => fn({ target: new Element(value) }));
  if (href !== undefined) click(href);
  const events = () => calls.filter(c => c[0] === 'event').map(c => ({ name: c[1], params: c[2] }));
  return { sandbox, calls, listeners, events, click };
}
const clicks = (result) => result.events().filter(e => e.name.startsWith('click_'));

test('existing built-in fail-closed guard accepts its own script', () => {
  assert.doesNotThrow(() => assertSearchContentAnalyticsScript(script));
});
test('view_item has a one-item GA4 items array, without fabricated price/value', () => {
  const event = observe('service').events().find(e => e.name === 'view_item');
  assert.ok(Array.isArray(event.params.items), 'view_item.items is required by GA4');
  assert.equal(event.params.items.length, 1);
  assert.equal(event.params.items[0].item_id, 'shoe-bag-care');
  assert.equal(event.params.items[0].item_name, 'shoe-bag-care');
  assert.equal(event.params.items[0].item_category, 'laundry_service');
  for (const key of ['price', 'value', 'currency']) {
    assert.equal(key in event.params, false);
    assert.equal(key in event.params.items[0], false);
  }
});
for (const [page, href, expected] of [
  ['knowledge_hub', '/guides/odor.html', 'click_answer_from_hub'],
  ['knowledge_hub', '/local/xitun.html', 'click_answer_from_hub'],
  ['knowledge_hub', '/services/shoe-bag-care.html', 'click_service_from_hub'],
  ['answer', '/services/shoe-bag-care.html', 'click_service_from_answer'],
  ['article', '/services/shoe-bag-care.html', 'click_service_from_article'],
  ['answer', '../services/shoe-bag-care.html', 'click_service_from_answer'],
  ['answer', 'https://sixiangjialaundry.com/services/shoe-bag-care.html?q=1#details', 'click_service_from_answer'],
  ['home', '/go/line.html?source=home', 'click_line_cta'],
  ['home', 'tel:+886424527411', 'click_phone']
]) test(`preserves ${page} -> ${href}`, () => {
  assert.deepEqual(clicks(observe(page, href)).map(e => e.name), [expected]);
});
for (const [page, href] of [
  ['knowledge_hub', 'https://external.example/guides/odor.html'],
  ['knowledge_hub', 'https://external.example/local/xitun.html'],
  ['knowledge_hub', 'https://external.example/services/shoe-bag-care.html'],
  ['answer', 'https://external.example/services/shoe-bag-care.html'],
  ['article', 'https://external.example/services/shoe-bag-care.html'],
  ['home', 'https://external.example/go/line.html'],
  ['answer', '//external.example/services/shoe-bag-care.html'],
  ['answer', 'http://sixiangjialaundry.com/services/shoe-bag-care.html'],
  ['answer', 'https://sixiangjialaundry.com:444/services/shoe-bag-care.html'],
  ['answer', 'ftp://sixiangjialaundry.com/services/shoe-bag-care.html'],
  ['answer', 'https://sixiangjialaundry.com.external.example/services/shoe-bag-care.html']
]) test(`rejects non-same-origin funnel classification: ${page} -> ${href}`, () => {
  assert.equal(clicks(observe(page, href)).length, 0);
});
test('missing gtag is safe and does not synthesize events', () => {
  assert.equal(observe('answer', '/services/shoe-bag-care.html', { noGtag: true }).events().length, 0);
});
test('invalid URL and mailto are not service clicks', () => {
  assert.equal(clicks(observe('answer', 'https://[')).length, 0);
  assert.equal(clicks(observe('answer', 'mailto:test@example.com')).length, 0);
});
test('non-Element click target is ignored', () => {
  const r = observe();
  r.listeners.click[0]({ target: {} });
  assert.equal(clicks(r).length, 0);
});
test('source_page excludes query and fragment; CTA whitespace is normalized', () => {
  const event = clicks(observe('answer', '/services/shoe-bag-care.html'))[0];
  assert.equal(event.params.source_page, '/guides/test.html');
  assert.equal(event.params.cta_name, '詢問 服務');
});
test('scroll depth fires once each at 50 and 90', () => {
  const r = observe();
  for (const y of [100, 500, 600, 950, 950, 400, 900]) {
    r.sandbox.window.scrollY = y;
    r.listeners.scroll[0]();
  }
  assert.deepEqual(r.events().filter(e => e.name === 'scroll_depth').map(e => e.params.percent_scrolled), [50, 90]);
});
test('short page does not create artificial scroll depth', () => {
  const r = observe();
  r.sandbox.document.body.scrollHeight = r.sandbox.document.documentElement.scrollHeight = 50;
  r.listeners.scroll[0]();
  assert.equal(r.events().filter(e => e.name === 'scroll_depth').length, 0);
});
test('navigation never becomes confirmed line_click, generate_lead, purchase or revenue', () => {
  const r = observe('answer', '/services/shoe-bag-care.html');
  r.click('/go/line.html?source=test');
  r.click('tel:+886424527411');
  for (const forbidden of ['line_click', 'generate_lead', 'purchase', 'revenue']) {
    assert.equal(r.events().some(e => e.name === forbidden), false);
  }
});
test('built-in guard rejects missing required event', () => {
  assert.throws(() => assertSearchContentAnalyticsScript(script.replaceAll('click_phone', 'deleted_phone')));
});
test('strengthened guard rejects removal of the same-origin guard', () => {
  const mutated = script.replace('if (targetUrl.origin !== new URL(window.location.href).origin) return;', '');
  assert.notEqual(mutated, script, 'mutation must change the candidate');
  assert.throws(() => assertSearchContentAnalyticsScript(mutated), /external links/);
});
test('strengthened guard rejects deletion of the ecommerce items array', () => {
  const mutated = script.replace('items: [{', 'deleted_items: [{');
  assert.notEqual(mutated, script, 'mutation must change the candidate');
  assert.throws(() => assertSearchContentAnalyticsScript(mutated), /items array/);
});
