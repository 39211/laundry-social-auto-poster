import {afterEach, describe, expect, it} from 'vitest';
import {createServer, type Server} from 'node:http';
import {mkdtemp, readFile, writeFile, stat, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {bytesDigest, digest} from '../src/seo90/buildSeo90';
import {fetchReadback, projectDueBundle, runRelease, type ReleasePin} from '../src/seo90/releaseRunner';
import type {Bundle} from '../src/seo90/types';
import {main as releaseCli} from '../scripts/seo90-release';

const baseUrl = 'https://sixiangjialaundry.com';
const times = ['2026-09-25T09:00:00+08:00','2026-09-26T09:00:00+08:00','2026-09-27T09:00:00+08:00','2026-09-28T09:00:00+08:00','2026-09-29T09:00:00+08:00','2026-09-30T09:00:00+08:00','2026-10-01T09:00:00+08:00'];
const fakeBundle = (): Bundle => {
  const articles = times.map((plannedPublishAt, index) => ({
    schemaVersion: 'sxj.seo90.article.v1' as const, contentId: `article-${index + 1}`, seriesId: 'series', dayNumber: index + 1, storeId: 'sxj', title: `文章 ${index + 1}`, slug: `article-${index + 1}`, summary: 'summary', directAnswer: 'answer', sections: [{heading: 'h', body: 'body'}], faq: [{question: 'q', answer: 'a'}], clusterId: 'cluster', serviceId: 'service', serviceAssertions: [], plannedPublishAt, canonicalPath: `/posts/${plannedPublishAt.slice(0,10).replaceAll('-','')}-article-${index + 1}.html`, author: 'owner', sourceRefs: [{type: 'public-fact', ref: 'https://example.test'}], assetRefs: [`asset-${index + 1}-1`,`asset-${index + 1}-2`,`asset-${index + 1}-3`,`asset-${index + 1}-4`], ctaId: 'cta', state: 'approved' as const
  }));
  const assets = articles.flatMap((article, articleIndex) => article.assetRefs.map((assetId, assetIndex) => ({assetId, contentId: article.contentId, path: `${article.contentId}/${assetIndex}.png`, sha256: `${String(articleIndex * 4 + assetIndex + 1).padStart(2,'0')}`.repeat(32), width: 10, height: 10, mime: 'image/png' as const, provider: 'fixture', alt: 'alt', caption: 'caption', review: 'approved'})));
  const registry = {storeId: 'sxj', brand: '私享家', baseUrl, profileApproved: true, cta: {id: 'cta', path: '/go/line.html', label: 'LINE'}, services: {service: {confirmed: true, path: '/services/service.html', assertions: []}}, clusters: {cluster: {label: 'cluster', path: '/services/service.html'}}};
  return {registry, articles, assets, approvals: articles.map((article) => ({contentId: article.contentId, channel: 'website' as const, decision: 'approved' as const, articleSha256: digest(article), registrySha256: digest(registry), assetSha256s: article.assetRefs.map((id) => assets.find((asset) => asset.assetId === id)!.sha256), assetManifestSha256: digest(assets.filter((asset) => asset.contentId === article.contentId)), approvedBy: 'fixture', approvedAt: '2026-09-22T00:00:00+08:00'})), releases: []};
};

function pinFor(bundle: Bundle): ReleasePin {
  return {schemaVersion: 'sxj.seo90.release-pin.v1', storeId: 'sxj', baseUrl, timezone: 'Asia/Taipei', sourceBundlePath: '', sourceBundleSha256: '0'.repeat(64), assetRoot: '', destination: {repoRoot: '', ref: 'HEAD'}, windowEndsAt: '2026-10-02T00:00:00+08:00', entries: bundle.articles.map((article) => ({contentId: article.contentId, plannedPublishAt: article.plannedPublishAt, canonicalPath: article.canonicalPath, articleSha256: digest(article), assetSha256s: article.assetRefs.map((id) => bundle.assets.find((asset) => asset.assetId === id)!.sha256)}))};
}

describe('SEO90 release runner contract', () => {
  it('does not select future articles before the first due boundary', async () => {
    const bundle = fakeBundle();
    const result = await projectDueBundle(pinFor(bundle), bundle, new Date('2026-09-22T12:00:00+08:00'));
    expect(result.status).toBe('WAIT_DUE');
    expect(result.selected).toHaveLength(0);
  });

  it('accumulates only articles due at the current clock', async () => {
    const bundle = fakeBundle();
    const result = await projectDueBundle(pinFor(bundle), bundle, new Date('2026-09-27T09:00:00+08:00'));
    expect(result.status).toBe('READY');
    expect(result.selected.map((article) => article.contentId)).toEqual(['article-1','article-2','article-3']);
    expect(result.bundle.articles).toHaveLength(3);
    expect(result.bundle.releases.map((release) => release.datePublished)).toEqual(times.slice(0, 3));
  });

  it('uses a collection oracle that rejects an exchanged due/future article', async () => {
    const bundle = fakeBundle();
    const now = new Date('2026-09-30T09:00:00+08:00');
    const result = await projectDueBundle(pinFor(bundle), bundle, now);
    const expectedIds = bundle.articles.slice(0, 6).map((article) => article.contentId).sort();
    const expectedPaths = bundle.articles.slice(0, 6).map((article) => article.canonicalPath).sort();
    const expectedAssets = [...new Set(bundle.articles.slice(0, 6).flatMap((article) => article.assetRefs))].sort();
    const emittedIds = result.selected.map((article) => article.contentId).sort();
    const emittedPaths = result.selected.map((article) => article.canonicalPath).sort();
    const emittedAssets = [...new Set(result.bundle.assets.map((asset) => asset.assetId))].sort();
    expect(emittedIds).toEqual(expectedIds);
    expect(emittedPaths).toEqual(expectedPaths);
    expect(emittedAssets).toEqual(expectedAssets);
    const exchanged = [...emittedIds];
    exchanged[0] = 'article-7';
    expect(exchanged).not.toEqual(expectedIds);
  });

  it('readback rejects HTTP 200 with the wrong canonical and accepts exact asset bytes', async () => {
    const png = Buffer.from('fixture-bytes');
    const assetSha = bytesDigest(png);
    const server: Server = createServer((request, response) => {
      if (request.url === '/posts/a.html') {
        response.writeHead(200, {'content-type': 'text/html'}); response.end('<link rel="canonical" href="https://wrong.example/posts/a.html">'); return;
      }
      if (request.url === `/seo90-assets/${assetSha}.png`) { response.writeHead(200, {'content-type': 'image/png'}); response.end(png); return; }
      response.writeHead(404); response.end('missing');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;
    try {
      const result = await fetchReadback(`http://127.0.0.1:${port}`, ['/posts/a.html', `/seo90-assets/${assetSha}.png`], 0, 0);
      expect(result.failures).toEqual([`/posts/a.html:CANONICAL_MISMATCH`]);
      expect(result.urls).toHaveLength(2);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('production clock before due performs zero journal writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seo90-runner-root-'));
    const privateDir = await mkdtemp(join(tmpdir(), 'seo90-runner-private-'));
    try {
      execFileSync('git', ['init', '-q'], {cwd: root});
      execFileSync('git', ['config', 'user.email', 'fixture@example.test'], {cwd: root});
      execFileSync('git', ['config', 'user.name', 'fixture'], {cwd: root});
      await writeFile(join(root, 'README.md'), 'fixture\n');
      execFileSync('git', ['add', 'README.md'], {cwd: root}); execFileSync('git', ['commit', '-qm', 'fixture'], {cwd: root});
      const bundle = fakeBundle();
      const bundlePath = join(privateDir, 'bundle.json'); await writeFile(bundlePath, `${JSON.stringify(bundle)}\n`);
      const pin = pinFor(bundle); pin.sourceBundlePath = bundlePath; pin.sourceBundleSha256 = bytesDigest(await readFile(bundlePath)); pin.assetRoot = privateDir; pin.destination.repoRoot = root;
      const pinPath = join(privateDir, 'pin.json'); await writeFile(pinPath, `${JSON.stringify(pin)}\n`);
      const journal = join(privateDir, 'journal.json');
      const result = await runRelease({root, pinPath, journalPath: journal});
      expect(result.state).toBe('WAIT_DUE');
      await expect(stat(journal)).rejects.toMatchObject({code: 'ENOENT'});
    } finally { await rm(root, {recursive: true, force: true}); await rm(privateDir, {recursive: true, force: true}); }
  });

  it('supports --policy as the explicit run alias without writing before due', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seo90-cli-root-'));
    const privateDir = await mkdtemp(join(tmpdir(), 'seo90-cli-private-'));
    try {
      execFileSync('git', ['init', '-q'], {cwd: root});
      execFileSync('git', ['config', 'user.email', 'fixture@example.test'], {cwd: root});
      execFileSync('git', ['config', 'user.name', 'fixture'], {cwd: root});
      await writeFile(join(root, 'README.md'), 'fixture\n');
      execFileSync('git', ['add', 'README.md'], {cwd: root}); execFileSync('git', ['commit', '-qm', 'fixture'], {cwd: root});
      const bundle = fakeBundle();
      const bundlePath = join(privateDir, 'bundle.json'); await writeFile(bundlePath, `${JSON.stringify(bundle)}\n`);
      const pin = pinFor(bundle); pin.sourceBundlePath = bundlePath; pin.sourceBundleSha256 = bytesDigest(await readFile(bundlePath)); pin.assetRoot = privateDir; pin.destination.repoRoot = root;
      const pinPath = join(privateDir, 'pin.json'); await writeFile(pinPath, `${JSON.stringify(pin)}\n`);
      const journal = join(privateDir, 'journal-policy.json');
      let output = ''; const originalLog = console.log; console.log = (...args: unknown[]) => { output += args.join(' '); };
      try { await releaseCli(['run', '--policy', pinPath, '--root', root, '--journal', journal]); }
      finally { console.log = originalLog; }
      expect(output).toContain('WAIT_DUE');
      await expect(stat(journal)).rejects.toMatchObject({code: 'ENOENT'});
    } finally { await rm(root, {recursive: true, force: true}); await rm(privateDir, {recursive: true, force: true}); }
  });

  it('status is read-only and resume of a terminal intent does not rebuild or push', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seo90-cli-status-root-'));
    const privateDir = await mkdtemp(join(tmpdir(), 'seo90-cli-status-private-'));
    try {
      execFileSync('git', ['init', '-q'], {cwd: root});
      execFileSync('git', ['config', 'user.email', 'fixture@example.test'], {cwd: root});
      execFileSync('git', ['config', 'user.name', 'fixture'], {cwd: root});
      await writeFile(join(root, 'README.md'), 'fixture\n');
      execFileSync('git', ['add', 'README.md'], {cwd: root}); execFileSync('git', ['commit', '-qm', 'fixture'], {cwd: root});
      const bundle = fakeBundle();
      const bundlePath = join(privateDir, 'bundle.json'); await writeFile(bundlePath, `${JSON.stringify(bundle)}\n`);
      const pin = pinFor(bundle); pin.sourceBundlePath = bundlePath; pin.sourceBundleSha256 = bytesDigest(await readFile(bundlePath)); pin.assetRoot = privateDir; pin.destination.repoRoot = root;
      const pinPath = join(privateDir, 'pin.json'); await writeFile(pinPath, `${JSON.stringify(pin)}\n`);
      const intent = {schemaVersion: 'sxj.seo90.release-intent.v1' as const, intentId: 'terminal-intent', storeId: 'sxj', baseUrl, expectedBefore: 'before', candidateCommit: 'after', contentIds: ['article-1'], inputSha256: 'input', plannedAt: '2026-09-22T00:00:00.000Z', windowEndsAt: pin.windowEndsAt, state: 'COMPLETE' as const, createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z', selectedPaths: ['/posts/a.html']};
      const journal = join(privateDir, 'journal.json'); await writeFile(journal, `${JSON.stringify({schemaVersion: 'sxj.seo90.release-journal.v1', intents: [intent]}, null, 2)}\n`);
      const before = await readFile(journal, 'utf8');
      let statusOutput = ''; const originalLog = console.log; console.log = (...args: unknown[]) => { statusOutput += args.join(' '); };
      try { await releaseCli(['status', '--journal', journal, '--intent', 'terminal-intent']); }
      finally { console.log = originalLog; }
      expect(statusOutput).toContain('terminal-intent');
      expect(await readFile(journal, 'utf8')).toBe(before);
      let resumeOutput = ''; console.log = (...args: unknown[]) => { resumeOutput += args.join(' '); };
      try { await releaseCli(['resume', '--intent', 'terminal-intent', '--policy', pinPath, '--root', root, '--journal', journal]); }
      finally { console.log = originalLog; }
      expect(resumeOutput).toContain('RESUME_NOOP');
      expect(await readFile(journal, 'utf8')).toBe(before);
    } finally { await rm(root, {recursive: true, force: true}); await rm(privateDir, {recursive: true, force: true}); }
  });

  it('does not create a second intent for an already complete due projection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seo90-noop-root-'));
    const privateDir = await mkdtemp(join(tmpdir(), 'seo90-noop-private-'));
    try {
      execFileSync('git', ['init', '-q'], {cwd: root});
      execFileSync('git', ['config', 'user.email', 'fixture@example.test'], {cwd: root});
      execFileSync('git', ['config', 'user.name', 'fixture'], {cwd: root});
      await writeFile(join(root, 'README.md'), 'fixture\n');
      execFileSync('git', ['add', 'README.md'], {cwd: root}); execFileSync('git', ['commit', '-qm', 'fixture'], {cwd: root});
      const bundle = fakeBundle();
      const bundlePath = join(privateDir, 'bundle.json'); await writeFile(bundlePath, `${JSON.stringify(bundle)}\n`);
      const pin = pinFor(bundle); pin.sourceBundlePath = bundlePath; pin.sourceBundleSha256 = bytesDigest(await readFile(bundlePath)); pin.assetRoot = privateDir; pin.destination.repoRoot = root;
      const pinPath = join(privateDir, 'pin.json'); await writeFile(pinPath, `${JSON.stringify(pin)}\n`);
      const now = new Date('2026-09-25T09:00:00+08:00');
      const projection = await projectDueBundle(pin, bundle, now);
      const intent = {schemaVersion: 'sxj.seo90.release-intent.v1' as const, intentId: 'complete-projection', storeId: pin.storeId, baseUrl: pin.baseUrl, expectedBefore: 'before', candidateCommit: 'after', contentIds: projection.selected.map((article) => article.contentId), inputSha256: projection.inputSha256, plannedAt: now.toISOString(), windowEndsAt: pin.windowEndsAt, state: 'COMPLETE' as const, createdAt: now.toISOString(), updatedAt: now.toISOString(), selectedPaths: projection.selected.map((article) => article.canonicalPath)};
      const journal = join(privateDir, 'journal.json'); await writeFile(journal, `${JSON.stringify({schemaVersion: 'sxj.seo90.release-journal.v1', intents: [intent]}, null, 2)}\n`);
      const before = await readFile(journal, 'utf8');
      const result = await runRelease({root, pinPath, journalPath: journal, now, rehearsal: true});
      expect(result.message).toContain('NOOP');
      expect(result.intentId).toBe('complete-projection');
      expect(await readFile(journal, 'utf8')).toBe(before);
    } finally { await rm(root, {recursive: true, force: true}); await rm(privateDir, {recursive: true, force: true}); }
  });
});
