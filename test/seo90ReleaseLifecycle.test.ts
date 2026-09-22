import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {generatePublicSite} from '../src/generatePublicSite';
import {bytesDigest, digest} from '../src/seo90/buildSeo90';
import {commitSeo90Release, SEO90_OWNED_MANIFEST_PATH, type PublicSeo90} from '../src/seo90/publicBundle';
import type {Article, Asset, Bundle} from '../src/seo90/types';
import {makeSeo90Fixture} from './seo90Fixture';

const baseUrl = 'https://sixiangjialaundry.com';
const now = '2026-09-26T09:00:00+08:00';
const sentinel = 'Unrelated owner content must remain intact.\n';
let root: string, b: Bundle;
const generate = () => generatePublicSite({root, siteBaseUrl: baseUrl, now});
const docs = (...parts: string[]) => join(root, 'docs', ...parts);

async function source(bundle: Bundle | null) {
  const folder = join(root, 'content', 'seo90');
  await mkdir(join(folder, 'public-assets'), {recursive: true});
  if (bundle) {
    for (const path of new Set(bundle.assets.map((asset) => asset.path))) await copyFile(join(root, path), join(folder, 'public-assets', path));
  }
  await writeFile(join(folder, 'public-ready.json'), JSON.stringify({schemaVersion: 'sxj.seo90.public-source.v1', bundle}));
}
async function text(path: string) { return readFile(docs(path), 'utf8'); }
async function treeDigest(directory: string): Promise<string> {
  const files: string[] = [];
  async function walk(current: string, prefix: string) {
    const entries = (await readdir(current, {withFileTypes: true})).slice().sort((a, c) => a.name.localeCompare(c.name));
    for (const entry of entries) {
      const rel = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`unexpected symlink ${rel}`);
      if (entry.isDirectory()) await walk(join(current, entry.name), rel + '/');
      else files.push(rel + '=' + bytesDigest(await readFile(join(current, entry.name))));
    }
  }
  await walk(directory, '');
  return files.join('\n');
}
function articleDates(html: string): {datePublished?: string; dateModified?: string} {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) return {};
  const parsed = JSON.parse(match[1]!) as {datePublished?: string; dateModified?: string};
  return parsed;
}
function serviceCore(html: string): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? '';
  return main.replace(/<section\b[^>]*>\s*<h2>送洗前實用筆記<\/h2>[\s\S]*?<\/section>/g, '').trim();
}
function approve(article: Article, assets: Asset[], publishedAt: string, modifiedAt = publishedAt) {
  const existing = b.approvals.findIndex((approval) => approval.contentId === article.contentId);
  const approval = {contentId: article.contentId, channel: 'website' as const, decision: 'approved' as const, articleSha256: digest(article), registrySha256: digest(b.registry), assetSha256s: assets.map((asset) => asset.sha256), assetManifestSha256: digest(assets), approvedBy: 'fixture-owner', approvedAt: '2026-09-26T07:00:00+08:00'};
  if (existing >= 0) b.approvals[existing] = approval; else b.approvals.push(approval);
  const release = {contentId: article.contentId, canonicalPath: article.canonicalPath, articleSha256: digest(article), registrySha256: digest(b.registry), datePublished: publishedAt, dateModified: modifiedAt, state: 'published' as const};
  const index = b.releases.findIndex((item) => item.contentId === article.contentId);
  if (index >= 0) b.releases[index] = release; else b.releases.push(release);
}
async function addArticle(shareFirstAsset: boolean) {
  const other = structuredClone(b.articles[0]!);
  other.contentId = 'second-note';
  other.title = '需保留的第二篇筆記';
  other.slug = 'second-note';
  other.canonicalPath = '/posts/2026-09-26-second-note.html';
  other.dayNumber = 2;
  other.plannedPublishAt = '2026-09-26T08:00:00+08:00';
  other.assetRefs = [];
  const assets: Asset[] = [];
  for (let i = 0; i < 4; i++) {
    if (shareFirstAsset && i === 0) await copyFile(join(root, b.assets[0]!.path), join(root, `b${i}.png`));
    else {
      const png = new PNG({width: 1000, height: 1250});
      png.data.fill(40 + i);
      await writeFile(join(root, `b${i}.png`), PNG.sync.write(png));
    }
    const file = await readFile(join(root, `b${i}.png`));
    const asset: Asset = {...b.assets[0]!, assetId: `b${i}`, contentId: other.contentId, path: `b${i}.png`, sha256: bytesDigest(file), alt: `第二篇圖 ${i}`, caption: '合成測試，非真素材'};
    assets.push(asset);
    other.assetRefs.push(asset.assetId);
  }
  b.articles.push(other);
  b.assets.push(...assets);
  approve(other, assets, other.plannedPublishAt);
  return other;
}

beforeEach(async () => {
  ({root, b} = await makeSeo90Fixture());
  await mkdir(join(root, 'data'), {recursive: true});
  await copyFile(join(process.cwd(), 'data', 'business-profile.json'), join(root, 'data', 'business-profile.json'));
  await mkdir(docs(), {recursive: true});
  await writeFile(docs('unrelated-owner-sentinel.txt'), sentinel);
});
afterEach(async () => { if (root) await rm(root, {recursive: true, force: true}); });

describe('SEO90 owned release lifecycle', () => {
  it('repeat of the same owned release keeps the public tree bytes', async () => {
    await source(b);
    await generate();
    const before = await treeDigest(docs());
    await generate();
    expect(await treeDigest(docs())).toBe(before);
    expect(await text(b.articles[0]!.canonicalPath.slice(1))).toContain(b.articles[0]!.title);
  }, 180_000);

  it('approved update keeps datePublished and refreshes the same url', async () => {
    await source(b);
    await generate();
    const original = b.releases[0]!.datePublished;
    const article = b.articles[0]!;
    article.title = '新版已核准內容標記';
    const assets = article.assetRefs.map((id) => b.assets.find((asset) => asset.assetId === id)!);
    b.approvals[0]!.articleSha256 = digest(article);
    b.approvals[0]!.approvedAt = '2026-09-26T08:00:00+08:00';
    b.approvals[0]!.assetManifestSha256 = digest(assets);
    b.releases[0]!.articleSha256 = digest(article);
    b.releases[0]!.dateModified = '2026-09-26T08:30:00+08:00';
    await source(b);
    await generate();
    const html = await text(article.canonicalPath.slice(1));
    const dates = articleDates(html);
    expect(html).toContain('新版已核准內容標記');
    expect(Date.parse(dates.datePublished!)).toBe(Date.parse(original));
    expect(Date.parse(dates.dateModified!)).toBe(Date.parse('2026-09-26T08:30:00+08:00'));
    expect(await text('daily/index.html')).toContain('新版已核准內容標記');
    expect(await text('services/shoe-bag-care.html')).toContain('新版已核准內容標記');
    expect(await text('sitemap.xml')).toContain('<lastmod>2026-09-26T08:30:00+08:00</lastmod>');
    expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
  }, 180_000);

  it('unapproved revision is rejected and does not replace the public tree', async () => {
    await source(b);
    await generate();
    const before = await treeDigest(docs());
    b.articles[0]!.title = '未重新核准的新內容';
    await source(b);
    await expect(generate()).rejects.toThrow('SEO90_UNAPPROVED_REVISION');
    expect(await treeDigest(docs())).toBe(before);
    expect(await text(b.articles[0]!.canonicalPath.slice(1))).not.toContain('未重新核准的新內容');
  }, 180_000);

  it('moving datePublished of an owned release is rejected without writing', async () => {
    await source(b);
    await generate();
    const before = await treeDigest(docs());
    b.releases[0]!.datePublished = '2026-09-26T08:00:00+08:00';
    b.releases[0]!.dateModified = '2026-09-26T08:30:00+08:00';
    await source(b);
    await expect(generate()).rejects.toThrow('SEO90_PUBLISHED_DATE_IMMUTABLE');
    expect(await treeDigest(docs())).toBe(before);
  }, 180_000);

  it('withdraws one owned article and keeps the other article and its assets', async () => {
    const other = await addArticle(false);
    await source(b);
    await generate();
    const kept = await readFile(docs(other.canonicalPath.slice(1)));
    const keptAssets = await Promise.all(other.assetRefs.map(async (id) => {
      const asset = b.assets.find((item) => item.assetId === id)!;
      return [asset.sha256, await readFile(docs('seo90-assets', asset.sha256 + '.png'))] as const;
    }));
    const core = serviceCore(await text('services/shoe-bag-care.html'));
    b.articles[0]!.state = 'withdrawn';
    b.releases[0]!.state = 'withdrawn';
    await source(b);
    await generate();
    await expect(text(b.articles[0]!.canonicalPath.slice(1))).rejects.toMatchObject({code: 'ENOENT'});
    expect(await readFile(docs(other.canonicalPath.slice(1)))).toEqual(kept);
    for (const [sha, bytes] of keptAssets) expect(await readFile(docs('seo90-assets', sha + '.png'))).toEqual(bytes);
    for (const id of b.articles[0]!.assetRefs) {
      const sha = b.assets.find((asset) => asset.assetId === id)!.sha256;
      await expect(readFile(docs('seo90-assets', sha + '.png'))).rejects.toMatchObject({code: 'ENOENT'});
    }
    const service = await text('services/shoe-bag-care.html');
    expect(service).not.toContain(b.articles[0]!.canonicalPath);
    expect(service).toContain(other.canonicalPath);
    expect(serviceCore(service)).toBe(core);
    expect(await text('daily/index.html')).toContain(other.canonicalPath);
    expect(await text('daily/index.html')).not.toContain(b.articles[0]!.canonicalPath);
    expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
  }, 180_000);

  it('a shared asset file survives withdrawal of only one article', async () => {
    const other = await addArticle(true);
    await source(b);
    await generate();
    const shared = b.assets[0]!.sha256;
    expect(other.assetRefs.map((id) => b.assets.find((asset) => asset.assetId === id)!.sha256)).toContain(shared);
    const sharedBytes = await readFile(docs('seo90-assets', shared + '.png'));
    const kept = await readFile(docs(other.canonicalPath.slice(1)));
    b.articles[0]!.state = 'withdrawn';
    b.releases[0]!.state = 'withdrawn';
    await source(b);
    await generate();
    expect(await readFile(docs('seo90-assets', shared + '.png'))).toEqual(sharedBytes);
    expect(await readFile(docs(other.canonicalPath.slice(1)))).toEqual(kept);
    await expect(text(b.articles[0]!.canonicalPath.slice(1))).rejects.toMatchObject({code: 'ENOENT'});
  }, 180_000);

  it('withdrawing the last owned article removes daily output and navigation', async () => {
    await source(b);
    await generate();
    const core = serviceCore(await text('services/shoe-bag-care.html'));
    const urlsBefore = [...(await text('sitemap.xml')).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!).sort();
    b.articles[0]!.state = 'withdrawn';
    b.releases[0]!.state = 'withdrawn';
    await source(b);
    await generate();
    await expect(text(b.articles[0]!.canonicalPath.slice(1))).rejects.toMatchObject({code: 'ENOENT'});
    await expect(text('daily/index.html')).rejects.toMatchObject({code: 'ENOENT'});
    for (const asset of b.assets) await expect(readFile(docs('seo90-assets', asset.sha256 + '.png'))).rejects.toMatchObject({code: 'ENOENT'});
    const urls = [...(await text('sitemap.xml')).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!).sort();
    expect(urls).toEqual(urlsBefore.filter((url) => url !== baseUrl + b.articles[0]!.canonicalPath && url !== baseUrl + '/daily/'));
    const service = await text('services/shoe-bag-care.html');
    expect(serviceCore(service)).toBe(core);
    expect(service).not.toContain(b.articles[0]!.canonicalPath);
    const htmlPaths: string[] = [];
    async function walk(current: string, prefix: string) {
      for (const entry of await readdir(docs(current), {withFileTypes: true})) {
        const rel = prefix ? prefix + '/' + entry.name : entry.name;
        if (entry.isDirectory()) await walk(rel, rel);
        else if (entry.name.endsWith('.html')) htmlPaths.push(rel);
      }
    }
    await walk('', '');
    for (const path of htmlPaths) expect(await text(path)).not.toContain('href="/daily/"');
    expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
  }, 180_000);

  it('same slug on another date still collides when the other file is not owned', async () => {
    await mkdir(docs('posts'), {recursive: true});
    await writeFile(docs('posts', '2026-09-24-rain-shoes.html'), 'foreign-slug');
    await source(b);
    await expect(generate()).rejects.toThrow('SEO90_EXISTING_ARTICLE_COLLISION');
    expect(await text('posts/2026-09-24-rain-shoes.html')).toBe('foreign-slug');
    await expect(text(b.articles[0]!.canonicalPath.slice(1))).rejects.toMatchObject({code: 'ENOENT'});
  }, 180_000);

  it('a tampered owned manifest does not replace public bytes', async () => {
    await source(b);
    await generate();
    const article = await text(b.articles[0]!.canonicalPath.slice(1));
    const raw = await text('seo90-release-manifest.json');
    const tampered = raw.replace(/"articleFileSha256":"([a-f0-9])/, (_match, digit: string) => `"articleFileSha256":"${digit === 'a' ? 'b' : 'a'}`);
    expect(tampered).not.toBe(raw);
    await writeFile(docs('seo90-release-manifest.json'), tampered);
    await expect(generate()).rejects.toThrow('SEO90_OWNED_MANIFEST_MISMATCH');
    expect(await text(b.articles[0]!.canonicalPath.slice(1))).toBe(article);
    expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
  }, 180_000);

  it('manifest paths that escape or are unknown are not followed', async () => {
    await writeFile(join(root, 'outside-keep.txt'), 'keep');
    await writeFile(docs('seo90-release-manifest.json'), JSON.stringify({
      schemaVersion: 'sxj.seo90.owned-release.v1',
      dailyFileSha256: null,
      releases: [{contentId: 'rain-shoes', canonicalPath: '/posts/../../outside-keep.txt', articleSha256: 'a'.repeat(64), registrySha256: 'b'.repeat(64), datePublished: now, dateModified: now, articleFileSha256: 'c'.repeat(64), assetSha256s: ['d', 'e', 'f', 'a'].map((item) => item.repeat(64))}]
    }));
    await source(b);
    await expect(generate()).rejects.toThrow('SEO90_OWNED_MANIFEST_UNTRUSTED');
    expect(await readFile(join(root, 'outside-keep.txt'), 'utf8')).toBe('keep');
    await writeFile(docs('seo90-release-manifest.json'), JSON.stringify({
      schemaVersion: 'sxj.seo90.owned-release.v1',
      dailyFileSha256: null,
      releases: [],
      extraPath: '/outside-keep.txt'
    }));
    await expect(generate()).rejects.toThrow('SEO90_OWNED_MANIFEST_UNTRUSTED');
    expect(await readFile(join(root, 'outside-keep.txt'), 'utf8')).toBe('keep');
    await expect(text(b.articles[0]!.canonicalPath.slice(1))).rejects.toMatchObject({code: 'ENOENT'});
  }, 180_000);

  it('a manifest junction is not treated as owned output', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside, {recursive: true});
    await writeFile(join(outside, 'keep.txt'), 'keep');
    await symlink(outside, docs('seo90-release-manifest.json'), process.platform === 'win32' ? 'junction' : 'dir');
    await source(b);
    await expect(generate()).rejects.toThrow(/SEO90_OWNED_MANIFEST_UNTRUSTED|SEO90_OUTPUT_ALIAS/);
    expect(await readdir(outside)).toEqual(['keep.txt']);
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  }, 180_000);

  it('a failed commit restores the previous article bytes', async () => {
    await source(b);
    await generate();
    const articlePath = b.articles[0]!.canonicalPath;
    const previous = await readFile(docs(articlePath.slice(1)));
    const plan: PublicSeo90 = {
      pages: [{path: articlePath, bytes: Buffer.from('should-roll-back'), contentId: b.articles[0]!.contentId}],
      sitemapEntries: [],
      relatedByService: {},
      diagnostics: [],
      removals: [],
      manifest: Buffer.from('{"not":"committed"}'),
      reconciled: false
    };
    await expect(commitSeo90Release(docs(), plan, 1)).rejects.toThrow('SEO90_COMMIT_INTERRUPTED');
    expect(await readFile(docs(articlePath.slice(1)))).toEqual(previous);
    expect(await text('seo90-release-manifest.json')).toContain('sxj.seo90.owned-release.v1');
    expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
  }, 180_000);

  it('rolls back when a later public page write fails', async () => {
    await source(b);
    await generate();
    const before = await treeDigest(docs());
    const indexPath = docs('index.html');
    await chmod(indexPath, 0o444);
    try {
      b.articles[0]!.title = '晚期失敗不該留下的新版';
      b.approvals[0]!.articleSha256 = digest(b.articles[0]!);
      b.approvals[0]!.approvedAt = '2026-09-26T08:00:00+08:00';
      b.releases[0]!.articleSha256 = digest(b.articles[0]!);
      b.releases[0]!.dateModified = '2026-09-26T08:30:00+08:00';
      await source(b);
      await expect(generate()).rejects.toThrow();
      expect(await treeDigest(docs())).toBe(before);
      expect(await text(b.articles[0]!.canonicalPath.slice(1))).not.toContain('晚期失敗不該留下的新版');
      expect(await text('social-posts.json')).not.toContain('晚期失敗不該留下的新版');
      expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
      expect((await lstat(indexPath)).mode & 0o222).toBe(0);
    } finally {
      await chmod(indexPath, 0o666);
    }
  }, 180_000);

  it('rolls back a withdrawal when a later public page write fails', async () => {
    await source(b);
    await generate();
    const before = await treeDigest(docs());
    const articlePath = docs(b.articles[0]!.canonicalPath.slice(1));
    const indexPath = docs('index.html');
    await chmod(indexPath, 0o444);
    try {
      b.articles[0]!.state = 'withdrawn';
      b.releases[0]!.state = 'withdrawn';
      await source(b);
      await expect(generate()).rejects.toThrow();
      expect(await treeDigest(docs())).toBe(before);
      expect(await readFile(articlePath, 'utf8')).toContain(b.articles[0]!.title);
      expect(await text('daily/index.html')).toContain(b.articles[0]!.canonicalPath);
      expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
    } finally {
      await chmod(indexPath, 0o666);
    }
  }, 180_000);

  it('rejects a services junction before changing public or external bytes', async () => {
    await source(b);
    await generate();
    const article = await readFile(docs(b.articles[0]!.canonicalPath.slice(1)));
    const social = await readFile(docs('social-posts.json'));
    const outside = join(root, 'external-services');
    await rename(docs('services'), outside);
    await writeFile(join(outside, 'marker.txt'), 'keep-services');
    const externalHtml = await readFile(join(outside, 'shoe-bag-care.html'));
    await symlink(outside, docs('services'), process.platform === 'win32' ? 'junction' : 'dir');
    b.articles[0]!.title = '不該寫進 junction 外的服務頁';
    b.approvals[0]!.articleSha256 = digest(b.articles[0]!);
    b.approvals[0]!.approvedAt = '2026-09-26T08:00:00+08:00';
    b.releases[0]!.articleSha256 = digest(b.articles[0]!);
    b.releases[0]!.dateModified = '2026-09-26T08:30:00+08:00';
    await source(b);
    await expect(generate()).rejects.toThrow('SEO90_OUTPUT_ALIAS');
    expect(await readFile(join(outside, 'marker.txt'), 'utf8')).toBe('keep-services');
    expect(await readFile(join(outside, 'shoe-bag-care.html'))).toEqual(externalHtml);
    expect(await readFile(docs(b.articles[0]!.canonicalPath.slice(1)))).toEqual(article);
    expect(await readFile(docs('social-posts.json'))).toEqual(social);
    expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
  }, 180_000);

  it('rejects a non-services output ancestor junction and keeps the external marker', async () => {
    await source(b);
    await generate();
    const article = await readFile(docs(b.articles[0]!.canonicalPath.slice(1)));
    const social = await readFile(docs('social-posts.json'));
    const outside = join(root, 'external-guides');
    await rename(docs('guides'), outside);
    await writeFile(join(outside, 'marker.txt'), 'keep-guides');
    const externalHtml = await readFile(join(outside, 'photo-before-laundry.html'));
    await symlink(outside, docs('guides'), process.platform === 'win32' ? 'junction' : 'dir');
    b.articles[0]!.title = '不該寫進 guides junction';
    b.approvals[0]!.articleSha256 = digest(b.articles[0]!);
    b.approvals[0]!.approvedAt = '2026-09-26T08:00:00+08:00';
    b.releases[0]!.articleSha256 = digest(b.articles[0]!);
    b.releases[0]!.dateModified = '2026-09-26T08:30:00+08:00';
    await source(b);
    await expect(generate()).rejects.toThrow('SEO90_OUTPUT_ALIAS');
    expect(await readFile(join(outside, 'marker.txt'), 'utf8')).toBe('keep-guides');
    expect(await readFile(join(outside, 'photo-before-laundry.html'))).toEqual(externalHtml);
    expect(await readFile(docs(b.articles[0]!.canonicalPath.slice(1)))).toEqual(article);
    expect(await readFile(docs('social-posts.json'))).toEqual(social);
    expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
  }, 180_000);

  it('a failed restore is not success and blocks the next release', async () => {
    await source(b);
    await generate();
    b.articles[0]!.title = '復原失敗留下的半套';
    b.approvals[0]!.articleSha256 = digest(b.articles[0]!);
    b.approvals[0]!.approvedAt = '2026-09-26T08:00:00+08:00';
    b.releases[0]!.articleSha256 = digest(b.articles[0]!);
    b.releases[0]!.dateModified = '2026-09-26T08:30:00+08:00';
    await source(b);
    await expect(generatePublicSite({root, siteBaseUrl: baseUrl, now, releaseFault: {failRestore: true}})).rejects.toThrow('SEO90_RESTORE_FAILED');
    expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
    b.articles[0]!.title = '阻擋後仍不該發布的第三版';
    b.approvals[0]!.articleSha256 = digest(b.articles[0]!);
    b.releases[0]!.articleSha256 = digest(b.articles[0]!);
    b.releases[0]!.dateModified = '2026-09-26T08:40:00+08:00';
    await source(b);
    await expect(generate()).rejects.toThrow('SEO90_RELEASE_BLOCKED');
    expect(await text(b.articles[0]!.canonicalPath.slice(1))).not.toContain('阻擋後仍不該發布的第三版');
    expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
  }, 180_000);

  it('waits for an in-flight write before restoring a late failure', async () => {
    await source(b);
    await generate();
    const before = await treeDigest(docs());
    const indexPath = docs('index.html');
    await chmod(indexPath, 0o444);
    try {
      b.articles[0]!.title = '在途寫入不該蓋過復原';
      b.approvals[0]!.articleSha256 = digest(b.articles[0]!);
      b.approvals[0]!.approvedAt = '2026-09-26T08:00:00+08:00';
      b.releases[0]!.articleSha256 = digest(b.articles[0]!);
      b.releases[0]!.dateModified = '2026-09-26T08:30:00+08:00';
      await source(b);
      const pending = generatePublicSite({
        root,
        siteBaseUrl: baseUrl,
        now,
        releaseFault: {stall: {suffix: 'social-posts.json', ms: 400}}
      });
      await expect(pending).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(await treeDigest(docs())).toBe(before);
      expect(await text('social-posts.json')).not.toContain('在途寫入不該蓋過復原');
      expect(await text('unrelated-owner-sentinel.txt')).toBe(sentinel);
    } finally {
      await chmod(indexPath, 0o666);
    }
  }, 180_000);
});
