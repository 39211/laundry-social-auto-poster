import {bytesDigest, digest} from './buildSeo90';
import {getConfig} from '../config';
import type {Article, Asset, Bundle} from './types';
import {readReleaseJournal, writeReleaseJournal, writeReleaseJournalSync, withReleaseLock, pendingIntent, upsertIntent, type ReleaseIntent, type ReleaseJournal, type ReleaseState} from './releaseJournal';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {createServer} from 'node:http';

export interface ReleasePin {
  schemaVersion: 'sxj.seo90.release-pin.v1';
  storeId: string;
  baseUrl: string;
  timezone: 'Asia/Taipei';
  sourceBundlePath: string;
  sourceBundleSha256: string;
  assetRoot: string;
  destination: {repoRoot: string; ref: string; rootPagesRepo?: string};
  windowEndsAt: string;
  entries: {contentId: string; plannedPublishAt: string; canonicalPath: string; articleSha256: string; assetSha256s: string[]}[];
}

export interface ReleaseRunResult {
  state: ReleaseState | 'WAIT_DUE';
  intentId?: string;
  selected: string[];
  message: string;
  candidateCommit?: string;
  readback?: {checkedAt: string; urls: string[]; failures: string[]};
  evidence?: {
    expectedDueContentIds: string[];
    emittedContentIds: string[];
    expectedArticlePaths: string[];
    emittedArticlePaths: string[];
    expectedAssetRefs: string[];
    emittedAssetRefs: string[];
  };
}

const PIN_SCHEMA = 'sxj.seo90.release-pin.v1';
const SOURCE_SCHEMA = 'sxj.seo90.public-source.v1';
const TAIPEI_OFFSET = 8 * 60 * 60 * 1000;
const isoTaipei = (value: Date): string => new Date(value.getTime() + TAIPEI_OFFSET).toISOString().replace(/\.\d{3}Z$/, '+08:00');
const dateTaipei = (value: Date): string => isoTaipei(value).slice(0, 10);
const git = (root: string, args: string[]): string => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const sha = (value: Buffer | string): string => bytesDigest(Buffer.isBuffer(value) ? value : Buffer.from(value));

function validatePin(pin: unknown): asserts pin is ReleasePin {
  const value = pin as any;
  if (!value || value.schemaVersion !== PIN_SCHEMA || value.timezone !== 'Asia/Taipei' || !value.storeId || !value.baseUrl || !value.sourceBundlePath || !value.assetRoot || !value.destination?.repoRoot || !value.destination?.ref || !Array.isArray(value.entries)) throw Error('SEO90_RELEASE_PIN_UNTRUSTED');
  if (!/^https:\/\/[^/]+\/?$/.test(value.baseUrl) || !/^[a-f0-9]{64}$/i.test(value.sourceBundleSha256) || !/^2026-10-02T00:00:00\+08:00$/.test(value.windowEndsAt)) throw Error('SEO90_RELEASE_PIN_UNTRUSTED');
  if (value.entries.length !== 7 || new Set(value.entries.map((entry: any) => entry.contentId)).size !== value.entries.length) throw Error('SEO90_RELEASE_PIN_UNTRUSTED');
  for (const entry of value.entries) {
    if (!entry.contentId || !/^\/posts\/[a-z0-9-]+\.html$/.test(entry.canonicalPath) || !/^2026-\d\d-\d\dT09:00:00\+08:00$/.test(entry.plannedPublishAt) || !/^[a-f0-9]{64}$/i.test(entry.articleSha256) || !Array.isArray(entry.assetSha256s) || entry.assetSha256s.length !== 4 || !entry.assetSha256s.every((item: unknown) => typeof item === 'string' && /^[a-f0-9]{64}$/i.test(item))) throw Error('SEO90_RELEASE_PIN_UNTRUSTED');
  }
}

export async function loadReleasePin(path: string): Promise<ReleasePin> {
  const pin = JSON.parse(await readFile(path, 'utf8')) as unknown;
  validatePin(pin);
  const bundleBytes = await readFile(pin.sourceBundlePath);
  if (sha(bundleBytes).toLowerCase() !== pin.sourceBundleSha256.toLowerCase()) throw Error('SEO90_RELEASE_SOURCE_PIN_MISMATCH');
  return pin;
}

async function loadBundle(pin: ReleasePin): Promise<Bundle> {
  const bundle = JSON.parse(await readFile(pin.sourceBundlePath, 'utf8')) as Bundle;
  if (bundle.registry?.storeId !== pin.storeId || bundle.registry?.baseUrl.replace(/\/$/, '') !== pin.baseUrl.replace(/\/$/, '') || bundle.registry.profileApproved !== true) throw Error('SEO90_RELEASE_BUNDLE_UNTRUSTED');
  const articleMap = new Map(bundle.articles.map((article) => [article.contentId, article]));
  const assetMap = new Map(bundle.assets.map((asset) => [asset.assetId, asset]));
  for (const entry of pin.entries) {
    const article = articleMap.get(entry.contentId);
    if (!article || digest(article).toLowerCase() !== entry.articleSha256.toLowerCase() || article.canonicalPath !== entry.canonicalPath || article.plannedPublishAt !== entry.plannedPublishAt || article.state !== 'approved') throw Error('SEO90_RELEASE_SOURCE_PIN_MISMATCH');
    const assets = article.assetRefs.map((id) => assetMap.get(id));
    if (assets.some((asset) => !asset || asset.review !== 'approved') || assets.map((asset) => asset!.sha256).sort().join(',') !== entry.assetSha256s.map((item) => item.toLowerCase()).sort().join(',')) throw Error('SEO90_RELEASE_SOURCE_PIN_MISMATCH');
  }
  return bundle;
}

export async function projectDueBundle(pin: ReleasePin, bundle: Bundle, now: Date): Promise<{status: 'WAIT_DUE'|'READY'; bundle: Bundle; selected: Article[]; inputSha256: string}> {
  const cutoff = Date.parse(pin.windowEndsAt);
  if (!Number.isFinite(cutoff) || now.getTime() >= cutoff) return {status: 'WAIT_DUE', bundle: {...bundle, articles: [], assets: [], approvals: [], releases: []}, selected: [], inputSha256: digest([])};
  const selected = pin.entries
    .map((entry) => bundle.articles.find((article) => article.contentId === entry.contentId)!)
    .filter((article) => article && Date.parse(article.plannedPublishAt) <= now.getTime());
  if (selected.length === 0) return {status: 'WAIT_DUE', bundle: {...bundle, articles: [], assets: [], approvals: [], releases: []}, selected: [], inputSha256: digest([])};
  const selectedIds = new Set(selected.map((article) => article.contentId));
  const selectedAssets = bundle.assets.filter((asset) => selectedIds.has(asset.contentId));
  const registrySha = digest(bundle.registry);
  const projected: Bundle = {
    registry: bundle.registry,
    articles: selected,
    assets: selectedAssets,
    approvals: bundle.approvals.filter((approval) => selectedIds.has(approval.contentId)),
    releases: selected.map((article) => ({contentId: article.contentId, canonicalPath: article.canonicalPath, articleSha256: digest(article), registrySha256: registrySha, datePublished: article.plannedPublishAt, dateModified: article.plannedPublishAt, state: 'published' as const}))
  };
  return {status: 'READY', bundle: projected, selected, inputSha256: digest(projected)};
}

function dueEvidence(pin: ReleasePin, bundle: Bundle, now: Date, selected: Article[], projected: Bundle) {
  const cutoff = Date.parse(pin.windowEndsAt);
  const articleMap = new Map(bundle.articles.map((article) => [article.contentId, article]));
  const expected = now.getTime() < cutoff
    ? pin.entries.filter((entry) => Date.parse(entry.plannedPublishAt) <= now.getTime()).map((entry) => articleMap.get(entry.contentId)!).filter(Boolean)
    : [];
  const expectedArticlePaths = expected.map((article) => article.canonicalPath).sort();
  const expectedAssetRefs = [...new Set(expected.flatMap((article) => article.assetRefs))].sort();
  const emittedArticlePaths = selected.map((article) => article.canonicalPath).sort();
  const emittedAssetRefs = [...new Set(projected.assets.map((asset) => asset.assetId))].sort();
  return {
    expectedDueContentIds: expected.map((article) => article.contentId).sort(),
    emittedContentIds: selected.map((article) => article.contentId).sort(),
    expectedArticlePaths,
    emittedArticlePaths,
    expectedAssetRefs,
    emittedAssetRefs
  };
}

async function walkFiles(root: string, prefix = ''): Promise<string[]> {
  let entries: any[] = [];
  try { entries = await readdir(join(root, prefix), {withFileTypes: true}); }
  catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walkFiles(root, rel));
    else if (entry.isFile()) files.push(rel.replaceAll('\\', '/'));
  }
  return files;
}

async function createCandidate(root: string, pin: ReleasePin, projected: Bundle, now: Date, expectedBefore: string): Promise<{path: string; changed: string[]}> {
  const candidate = await mkdtemp(join(tmpdir(), 'sxj-seo90-release-'));
  try {
    git(root, ['worktree', 'add', '--detach', candidate, expectedBefore]);
    const sourceDir = join(candidate, 'content', 'seo90');
    const assetDir = join(sourceDir, 'public-assets');
    await mkdir(assetDir, {recursive: true});
    await writeFile(join(sourceDir, 'public-ready.json'), `${JSON.stringify({schemaVersion: SOURCE_SCHEMA, bundle: projected}, null, 2)}\n`, 'utf8');
    for (const asset of projected.assets) {
      const source = resolve(pin.assetRoot, asset.path);
      const bytes = await readFile(source);
      if (bytesDigest(bytes).toLowerCase() !== asset.sha256.toLowerCase()) throw Error('SEO90_RELEASE_ASSET_PIN_MISMATCH');
      const target = join(assetDir, asset.path);
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, bytes);
    }
    process.env.PUBLIC_SITE_BASE_URL = process.env.PUBLIC_SITE_BASE_URL || pin.baseUrl;
    const {generatePublicSite} = await import('../generatePublicSite');
    await generatePublicSite({root: candidate, siteBaseUrl: pin.baseUrl, now: now.toISOString()});
    const candidateFiles = new Set(await walkFiles(join(candidate, 'docs')));
    const rootFiles = new Set(await walkFiles(join(root, 'docs')));
    const all = [...new Set([...candidateFiles, ...rootFiles])].sort();
    const changed: string[] = [];
    for (const rel of all) {
      const left = join(root, 'docs', rel), right = join(candidate, 'docs', rel);
      let lb: Buffer | null = null, rb: Buffer | null = null;
      try { lb = await readFile(left); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      try { rb = await readFile(right); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      if (lb === null ? rb !== null : rb === null || !lb.equals(rb)) changed.push(rel);
    }
    return {path: candidate, changed};
  } catch (error) {
    await removeWorktree(root, candidate);
    throw error;
  }
}

async function removeWorktree(root: string, candidate: string): Promise<void> {
  try { git(root, ['worktree', 'remove', '--force', candidate]); }
  catch { await rm(candidate, {recursive: true, force: true}); }
}

async function applyCandidate(root: string, candidate: string, changed: string[], expectedBefore: string): Promise<void> {
  if (git(root, ['rev-parse', 'HEAD']) !== expectedBefore) throw Error('SEO90_RELEASE_REMOTE_DRIFT');
  if (git(root, ['status', '--porcelain'])) throw Error('SEO90_RELEASE_SOURCE_DIRTY');
  for (const rel of changed) {
    if (!rel || rel.includes('..') || rel.includes('\\')) throw Error('SEO90_RELEASE_OUTPUT_UNTRUSTED');
    const source = join(candidate, 'docs', rel), target = join(root, 'docs', rel);
    try {
      const bytes = await readFile(source);
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, bytes);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      await rm(target, {force: true});
    }
  }
}

function releasePaths(selected: Article[], projected: Bundle): string[] {
  return ['/daily/index.html', ...selected.map((article) => article.canonicalPath), ...selected.flatMap((article) => article.assetRefs.map((id) => `/seo90-assets/${projected.assets.find((asset) => asset.assetId === id)!.sha256}.png`))];
}

export async function fetchReadback(baseUrl: string, paths: string[], retries = 3, delayMs = 2000, canonicalBaseUrl = baseUrl): Promise<{checkedAt: string; urls: string[]; failures: string[]}> {
  const failures: string[] = [];
  const urls: string[] = [];
  for (const path of paths) {
    const url = `${baseUrl.replace(/\/$/, '')}${path === '/daily/index.html' ? '/daily/' : path}`;
    urls.push(url);
    let last = '';
    let ok = false;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {redirect: 'error'});
        const body = Buffer.from(await response.arrayBuffer());
        if (!response.ok) last = `HTTP_${response.status}`;
        else if (path.startsWith('/seo90-assets/') && bytesDigest(body) !== path.split('/').pop()!.replace(/\.png$/, '')) last = 'ASSET_BYTES_MISMATCH';
        else if (path.startsWith('/posts/') && !body.toString('utf8').includes(`rel="canonical" href="${canonicalBaseUrl.replace(/\/$/, '')}${path}"`)) last = 'CANONICAL_MISMATCH';
        else ok = true;
      } catch (error: any) { last = error?.code || error?.message || 'READBACK_ERROR'; }
      if (ok || attempt === retries) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
    if (!ok) failures.push(`${path}:${last}`);
  }
  return {checkedAt: new Date().toISOString(), urls, failures};
}

async function readbackCandidate(candidate: string, paths: string[], canonicalBaseUrl: string): Promise<{checkedAt: string; urls: string[]; failures: string[]}> {
  const docsRoot = join(candidate, 'docs');
  const server = createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      const rel = requestPath === '/daily/' ? 'daily/index.html' : requestPath.replace(/^\//, '');
      if (!rel || rel.includes('..') || rel.includes('\\')) throw Error('BAD_PATH');
      const body = await readFile(join(docsRoot, ...rel.split('/')));
      response.statusCode = 200;
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('SEO90_RELEASE_REHEARSAL_SERVER_UNAVAILABLE');
    return await fetchReadback(`http://127.0.0.1:${address.port}`, paths, 0, 0, canonicalBaseUrl);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

function intentFor(pin: ReleasePin, selected: Article[], projected: Bundle, inputSha256: string, expectedBefore: string, plannedAt: string): ReleaseIntent {
  const contentIds = selected.map((article) => article.contentId).sort();
  const intentId = sha(`${pin.storeId}|${pin.baseUrl}|${expectedBefore}|${contentIds.join(',')}|${inputSha256}`).slice(0, 32);
  return {schemaVersion: 'sxj.seo90.release-intent.v1', intentId, storeId: pin.storeId, baseUrl: pin.baseUrl, expectedBefore, contentIds, inputSha256, plannedAt, windowEndsAt: pin.windowEndsAt, state: 'PLANNED', createdAt: plannedAt, updatedAt: plannedAt, selectedPaths: ['/daily/index.html', ...selected.map((article) => article.canonicalPath), ...selected.flatMap((article) => article.assetRefs.map((id) => `/seo90-assets/${projected.assets.find((asset) => asset.assetId === id)!.sha256}.png`))]};
}

async function updateJournal(path: string, journal: ReleaseJournal, intent: ReleaseIntent): Promise<ReleaseJournal> {
  const next = upsertIntent(journal, intent);
  await writeReleaseJournal(path, next);
  return next;
}

export async function runRelease(input: {root: string; pinPath: string; journalPath: string; now?: Date; rehearsal?: boolean; readbackRetries?: number; readbackDelayMs?: number}): Promise<ReleaseRunResult> {
  const root = resolve(input.root);
  const pin = await loadReleasePin(input.pinPath);
  const now = input.rehearsal ? (input.now ?? new Date()) : new Date();
  if (!input.rehearsal && input.now) throw Error('SEO90_PRODUCTION_CLOCK_OVERRIDE');
  return withReleaseLock(`${input.journalPath}.lock`, async () => {
    let journal = await readReleaseJournal(input.journalPath);
    const pending = pendingIntent(journal);
    if (pending) return reconcileRelease(input, pin, journal, pending);
    const bundle = await loadBundle(pin);
    const projection = await projectDueBundle(pin, bundle, now);
    if (projection.status === 'WAIT_DUE') {
      const evidence = dueEvidence(pin, bundle, now, [], projection.bundle);
      return {state: 'WAIT_DUE', selected: [], message: 'WAIT_DUE: no approved article is due; zero public writes, commits and pushes.', evidence};
    }
    const expectedBefore = git(root, ['rev-parse', pin.destination.ref]);
    const intent = intentFor(pin, projection.selected, projection.bundle, projection.inputSha256, expectedBefore, now.toISOString());
    const evidence = dueEvidence(pin, bundle, now, projection.selected, projection.bundle);
    if (evidence.expectedDueContentIds.join('|') !== evidence.emittedContentIds.join('|') || evidence.expectedArticlePaths.join('|') !== evidence.emittedArticlePaths.join('|') || evidence.expectedAssetRefs.join('|') !== evidence.emittedAssetRefs.join('|')) throw Error('SEO90_RELEASE_DUE_SET_MISMATCH');
    journal = await updateJournal(input.journalPath, journal, intent);
    intent.state = 'PREPARED'; intent.updatedAt = new Date().toISOString(); journal = await updateJournal(input.journalPath, journal, intent);
    let candidate: {path: string; changed: string[]} | undefined;
    try {
      candidate = await createCandidate(root, pin, projection.bundle, now, expectedBefore);
      if (input.rehearsal) {
        const readback = await readbackCandidate(candidate.path, releasePaths(projection.selected, projection.bundle), pin.baseUrl);
        intent.readback = readback;
        intent.state = readback.failures.length ? 'UNKNOWN' : 'COMPLETE'; intent.updatedAt = new Date().toISOString(); await updateJournal(input.journalPath, journal, intent);
        if (readback.failures.length) throw Error(`SEO90_RELEASE_REHEARSAL_READBACK_FAILED:${readback.failures.join(',')}`);
        return {state: 'COMPLETE', intentId: intent.intentId, selected: projection.selected.map((article) => article.contentId), message: `REHEARSAL_READY: ${candidate.changed.length} public files changed; loopback readback passed; no source or remote write.`, readback, evidence};
      }
      await applyCandidate(root, candidate.path, candidate.changed, expectedBefore);
      intent.candidateCommit = expectedBefore;
      intent.state = 'PUSHING'; intent.updatedAt = new Date().toISOString(); journal = await updateJournal(input.journalPath, journal, intent);
      const date = projection.selected.at(-1)!.plannedPublishAt.slice(0, 10);
      process.env.PUBLIC_SITE_BASE_URL = process.env.PUBLIC_SITE_BASE_URL || pin.baseUrl;
      const {publishPagesAssets} = await import('../publishPages');
      publishPagesAssets(date, root, pin.destination.rootPagesRepo || getConfig().publicRootPagesRepo || '', now, {
        afterSourceCommit: (commit) => {
          intent.candidateCommit = commit;
          intent.state = 'GIT_CONFIRMED';
          intent.updatedAt = new Date().toISOString();
          writeReleaseJournalSync(input.journalPath, upsertIntent(journal, intent));
        }
      });
      const candidateCommit = git(root, ['rev-parse', 'HEAD']);
      intent.candidateCommit = candidateCommit; intent.state = 'GIT_CONFIRMED'; intent.updatedAt = new Date().toISOString(); journal = await updateJournal(input.journalPath, journal, intent);
      intent.state = 'VERIFYING'; intent.updatedAt = new Date().toISOString(); journal = await updateJournal(input.journalPath, journal, intent);
      const paths = releasePaths(projection.selected, projection.bundle);
      const readback = await fetchReadback(pin.baseUrl, paths, input.readbackRetries ?? 3, input.readbackDelayMs ?? 2000);
      intent.readback = readback; intent.updatedAt = new Date().toISOString(); intent.state = readback.failures.length ? 'UNKNOWN' : 'COMPLETE'; journal = await updateJournal(input.journalPath, journal, intent);
      return {state: intent.state, intentId: intent.intentId, selected: projection.selected.map((article) => article.contentId), message: readback.failures.length ? 'UNKNOWN: source push may have completed; reconcile with GET only.' : 'COMPLETE: source and Pages mirror pushed and public URLs read back.', candidateCommit, readback, evidence};
    } finally {
      if (candidate) await removeWorktree(root, candidate.path);
    }
  });
}

async function reconcileRelease(input: {root: string; journalPath: string; readbackRetries?: number; readbackDelayMs?: number}, pin: ReleasePin, journal: ReleaseJournal, intent: ReleaseIntent): Promise<ReleaseRunResult> {
  if (!intent.candidateCommit) {
    intent.state = 'HOLD'; intent.error = 'No candidate commit was recorded before interruption; manual inspection required.'; intent.updatedAt = new Date().toISOString(); await updateJournal(input.journalPath, journal, intent);
    return {state: 'HOLD', intentId: intent.intentId, selected: intent.contentIds, message: intent.error};
  }
  const branchCommit = git(input.root, ['rev-parse', pin.destination.ref]);
  if (branchCommit !== intent.candidateCommit) return {state: 'UNKNOWN', intentId: intent.intentId, selected: intent.contentIds, message: 'UNKNOWN: candidate commit is not at the pinned branch; no retry was sent.'};
  const readback = await fetchReadback(pin.baseUrl, intent.selectedPaths, input.readbackRetries ?? 3, input.readbackDelayMs ?? 2000);
  intent.readback = readback; intent.updatedAt = new Date().toISOString(); intent.state = readback.failures.length ? 'UNKNOWN' : 'COMPLETE'; await updateJournal(input.journalPath, journal, intent);
  return {state: intent.state, intentId: intent.intentId, selected: intent.contentIds, message: readback.failures.length ? 'UNKNOWN: GET/readback still incomplete; no new commit or push.' : 'COMPLETE: reconciled existing commit with GET only.', candidateCommit: intent.candidateCommit, readback};
}

export async function runRehearsal(input: {root: string; pinPath: string; journalPath: string; at: Date; reportPath: string}): Promise<ReleaseRunResult> {
  const result = await runRelease({...input, now: input.at, rehearsal: true, readbackRetries: 0, readbackDelayMs: 0});
  await mkdir(dirname(input.reportPath), {recursive: true});
  await writeFile(input.reportPath, `${JSON.stringify({schemaVersion: 'sxj.seo90.rehearsal.v1', at: input.at.toISOString(), result}, null, 2)}\n`, 'utf8');
  return result;
}
