import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
const origin = 'https://sixiangjialaundry.com';
const data = readFileSync('seo-overrides/scripts/sxj-r10-20261103/posts-data.js', 'utf8');
const core = readFileSync('seo-overrides/scripts/sxj-r10-20261103/r9-core.js', 'utf8');
function adapter() {
  const context: any = { window: {}, location: { origin }, URL };
  vm.runInNewContext(data, context);
  return context.window.SXJPosts;
}
describe('R10 card-only image derivatives', () => {
  it('selects the existing naming convention without changing original media', () => {
    const api = adapter();
    expect(api.thumbnail(origin + '/assets/2026-11-10/slot-01.png')).toBe(origin + '/assets/2026-11-10/slot-01.webp');
    expect(api.thumbnail('/assets/2026-11-10/slot-02.png')).toBe(origin + '/assets/2026-11-10/slot-02.webp');
    expect(core).toContain('img.src=window.SXJPosts.thumbnail(p.image)');
    expect(core).toContain("img.src=p.image||''"); // modal retains original
    expect(core).toContain('video.poster=p.image');
  });
  it('uses editorial titles while preserving original published captions and image URLs', async () => {
    const image = origin + '/assets/2026-11-10/slot-01.png';
    const current = {article_posts: [{article_path: 'posts/new.html', date: '2026-11-10', topic: 'Old title', editorial_title: 'Corrected title', image_url: image, facebook_caption: 'Published FB', instagram_caption: 'Published IG'}]};
    const context: any = {window: {}, location: {origin}, URL, fetch: async (url: string) => ({ok: true, json: async () => url === '/social-posts.json' ? current : [{article: '/posts/new.html', title: 'Old curated title'}]})};
    vm.runInNewContext(data, context);
    const posts = await context.window.SXJPosts.load();
    expect(posts[0].title).toBe('Corrected title');
    expect(posts[0].image).toBe(image);
    expect(posts[0].facebookCaption).toBe('Published FB');
    expect(posts[0].instagramCaption).toBe('Published IG');
  });
  it('does not rewrite curated, remote, video, or signed media', () => {
    const api = adapter();
    for (const url of ['https://i.ytimg.com/vi/id/hqdefault.jpg', 'https://cdn.example/assets/2026-11-10/slot-01.png', '/assets/services/a.png', '/assets/2026-11-10/slot-01.mp4', '/assets/2026-11-10/slot-01.png?v=1', '/assets/2026-11-10/slot-01.png#crop']) expect(api.thumbnail(url)).toBe(url);
  });
  it('falls back once to the original, then to readable text on a second failure', () => {
    const functionSource = core.slice(core.indexOf('function photoFallback('), core.indexOf('\nfunction card('));
    const context: any = { el: (_tag: string, _cls: string, text: string) => text };
    vm.runInNewContext(functionSource, context);
    for (const original of [origin + '/assets/2026-11-10/slot-01.png', '/assets/2026-11-10/slot-01.png']) {
      let handler = () => {}; const messages: string[] = [];
      const img: any = { src: origin + '/assets/2026-11-10/slot-01.webp', getAttribute: () => img.src, addEventListener: (_: string, fn: () => void) => { handler = fn; }, remove: () => { img.removed = true; }, parentElement: { append: (text: string) => messages.push(text) } };
      context.photoFallback(img, original); handler();
      expect(img.src).toBe(original); expect(img.removed).toBeUndefined();
      handler(); expect(img.removed).toBe(true); expect(messages[0]).toContain('仍可閱讀內容');
    }
  });
});
