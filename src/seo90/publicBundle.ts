import {chmod, lstat, mkdir, readFile, readdir, realpath, unlink, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {bytesDigest, prepareSeo90, renderArticle, renderDailyIndex} from './buildSeo90';
import type {Article, Asset, Bundle, Release} from './types';

export interface PublicPage {path: string; bytes: Buffer; contentId?: string}
export interface PublicSeo90 {
  pages: PublicPage[];
  sitemapEntries: string[];
  relatedByService: Record<string, {title: string; path: string}[]>;
  dailyIndexPath?: string;
  diagnostics: {contentId: string; reasons: string[]}[];
  removals: string[];
  manifest?: Buffer;
  reconciled: boolean;
}
export const SEO90_OWNED_MANIFEST_PATH = '/seo90-release-manifest.json';
const MANIFEST_FILE = 'seo90-release-manifest.json';
const MANIFEST_SCHEMA = 'sxj.seo90.owned-release.v1';
const DAILY_PATH = '/daily/index.html';
const HEX = /^[a-f0-9]{64}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/;
const ARTICLE_PATH = /^\/posts\/(\d{4})-(\d{2})-(\d{2})-([a-z0-9-]+)\.html$/;
const ASSET_PATH = /^\/seo90-assets\/([a-f0-9]{64})\.png$/;
const RELEASE_KEYS = ['contentId','canonicalPath','articleSha256','registrySha256','datePublished','dateModified','articleFileSha256','assetSha256s'];

interface OwnedRelease {
  contentId: string;
  canonicalPath: string;
  articleSha256: string;
  registrySha256: string;
  datePublished: string;
  dateModified: string;
  articleFileSha256: string;
  assetSha256s: string[];
}
interface OwnedManifest {
  schemaVersion: typeof MANIFEST_SCHEMA;
  dailyFileSha256: string | null;
  releases: OwnedRelease[];
}
interface EligibleItem {article: Article; assets: Asset[]}
interface LiveItem {item: EligibleItem; mode: 'new' | 'noop' | 'update'; previous?: OwnedRelease}

const empty = (): PublicSeo90 => ({pages:[], sitemapEntries:[], relatedByService:{}, diagnostics:[], removals:[], reconciled:false});
const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function realCalendarDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function isArticlePath(publicPath: string): boolean {
  const match = ARTICLE_PATH.exec(publicPath);
  return !!match && realCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
}
function allowedPublicPath(publicPath: string): boolean {
  return publicPath === DAILY_PATH || publicPath === SEO90_OWNED_MANIFEST_PATH || ASSET_PATH.test(publicPath) || isArticlePath(publicPath);
}
function lexical(docsReal: string, publicPath: string): string {
  if (!allowedPublicPath(publicPath) || publicPath.includes('\\') || publicPath.includes('..')) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  const target = join(docsReal, ...publicPath.slice(1).split('/'));
  const rel = relative(docsReal, target);
  if (rel.startsWith('..') || isAbsolute(rel) || rel === '') throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  return target;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function hex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}
function sortedHexList(value: unknown, count: number): string[] | null {
  if (!Array.isArray(value) || value.length !== count || !value.every(hex)) return null;
  const sorted = value.slice().sort();
  if (sorted.some((item, index) => item !== value[index]) || new Set(sorted).size !== sorted.length) return null;
  return value.slice();
}

/** A sha stays on disk when any release that remains live still publishes it. */
export function assetRetainedByLiveRelease(sha256: string, liveAssetSha256s: ReadonlySet<string>): boolean {
  return liveAssetSha256s.has(sha256);
}

function serializeManifest(manifest: OwnedManifest): Buffer {
  return Buffer.from(JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    dailyFileSha256: manifest.dailyFileSha256,
    releases: manifest.releases.map((release) => ({
      contentId: release.contentId,
      canonicalPath: release.canonicalPath,
      articleSha256: release.articleSha256,
      registrySha256: release.registrySha256,
      datePublished: release.datePublished,
      dateModified: release.dateModified,
      articleFileSha256: release.articleFileSha256,
      assetSha256s: release.assetSha256s
    }))
  }));
}
function validateManifest(parsed: unknown): OwnedManifest {
  if (!record(parsed) || !exactKeys(parsed, ['schemaVersion','dailyFileSha256','releases'])) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  if (parsed.schemaVersion !== MANIFEST_SCHEMA || !Array.isArray(parsed.releases)) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  const releases: OwnedRelease[] = [];
  for (const entry of parsed.releases) {
    if (!record(entry) || !exactKeys(entry, RELEASE_KEYS)) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
    const contentId = entry.contentId;
    const canonicalPath = entry.canonicalPath;
    const assetSha256s = sortedHexList(entry.assetSha256s, 4);
    if (typeof contentId !== 'string' || !/^[a-z0-9-]+$/.test(contentId) || typeof canonicalPath !== 'string' || !isArticlePath(canonicalPath)) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
    if (!hex(entry.articleSha256) || !hex(entry.registrySha256) || !hex(entry.articleFileSha256) || !assetSha256s) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
    if (typeof entry.datePublished !== 'string' || !TIME.test(entry.datePublished) || typeof entry.dateModified !== 'string' || !TIME.test(entry.dateModified)) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
    if (!Number.isFinite(Date.parse(entry.datePublished)) || !Number.isFinite(Date.parse(entry.dateModified))) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
    releases.push({
      contentId,
      canonicalPath,
      articleSha256: entry.articleSha256,
      registrySha256: entry.registrySha256,
      datePublished: entry.datePublished,
      dateModified: entry.dateModified,
      articleFileSha256: entry.articleFileSha256,
      assetSha256s
    });
  }
  const paths = new Set(releases.map((release) => release.canonicalPath.toLowerCase()));
  const ids = new Set(releases.map((release) => release.contentId));
  if (paths.size !== releases.length || ids.size !== releases.length) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  const ordered = releases.slice().sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
  if (ordered.some((release, index) => release !== releases[index])) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  if (releases.length === 0) {
    if (parsed.dailyFileSha256 !== null) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  } else if (!hex(parsed.dailyFileSha256)) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  return {schemaVersion: MANIFEST_SCHEMA, dailyFileSha256: releases.length ? parsed.dailyFileSha256 as string : null, releases};
}

async function rejectAlias(docsReal: string, publicPath: string): Promise<void> {
  const parts = publicPath.slice(1).split('/');
  let current = docsReal;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]!);
    let status;
    try { status = await lstat(current); }
    catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
    if (status.isSymbolicLink()) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
    if (!status.isDirectory() && index !== parts.length - 1) return;
    const resolved = await realpath(current);
    const rel = relative(docsReal, resolved);
    const expected = relative(docsReal, current);
    if (!samePath(rel, expected) || rel.startsWith('..') || isAbsolute(rel)) throw Error('SEO90_OUTPUT_ALIAS');
  }
}
async function openDocs(docsRoot: string): Promise<string> {
  await mkdir(docsRoot, {recursive: true});
  const status = await lstat(docsRoot);
  if (status.isSymbolicLink() || !status.isDirectory()) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  const docsReal = await realpath(docsRoot);
  const rel = relative(await realpath(dirname(docsRoot)), docsReal);
  if (!samePath(rel, 'docs') || rel.startsWith('..') || isAbsolute(rel)) throw Error('SEO90_OUTPUT_ALIAS');
  return docsReal;
}
async function readOwnedFile(docsReal: string, publicPath: string): Promise<Buffer> {
  const target = lexical(docsReal, publicPath);
  await rejectAlias(docsReal, publicPath);
  let status;
  try { status = await lstat(target); }
  catch (error: any) {
    if (error.code === 'ENOENT') throw Error('SEO90_OWNED_MANIFEST_MISMATCH');
    throw error;
  }
  if (status.isSymbolicLink() || !status.isFile()) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  const resolved = await realpath(target);
  const rel = relative(docsReal, resolved);
  if (!samePath(rel, relative(docsReal, target)) || rel.startsWith('..') || isAbsolute(rel)) throw Error('SEO90_OUTPUT_ALIAS');
  return readFile(resolved);
}
async function verifyOwnedFiles(docsReal: string, manifest: OwnedManifest): Promise<void> {
  if (manifest.releases.length) {
    const daily = await readOwnedFile(docsReal, DAILY_PATH);
    if (bytesDigest(daily) !== manifest.dailyFileSha256) throw Error('SEO90_OWNED_MANIFEST_MISMATCH');
  }
  const seenAssets = new Set<string>();
  for (const release of manifest.releases) {
    const article = await readOwnedFile(docsReal, release.canonicalPath);
    if (bytesDigest(article) !== release.articleFileSha256) throw Error('SEO90_OWNED_MANIFEST_MISMATCH');
    for (const sha of release.assetSha256s) {
      if (seenAssets.has(sha)) continue;
      seenAssets.add(sha);
      const asset = await readOwnedFile(docsReal, `/seo90-assets/${sha}.png`);
      if (bytesDigest(asset) !== sha) throw Error('SEO90_OWNED_MANIFEST_MISMATCH');
    }
  }
}
async function docsRealIfPresent(root: string): Promise<string | null> {
  const docs = join(root, 'docs');
  let status;
  try { status = await lstat(docs); }
  catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
  if (status.isSymbolicLink() || !status.isDirectory()) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  const docsReal = await realpath(docs);
  const rel = relative(await realpath(root), docsReal);
  if (!samePath(rel, 'docs') || rel.startsWith('..') || isAbsolute(rel)) throw Error('SEO90_OUTPUT_ALIAS');
  return docsReal;
}
async function readOwnedManifest(root: string): Promise<OwnedManifest | null> {
  const docsReal = await docsRealIfPresent(root);
  if (!docsReal) return null;
  const manifestPath = join(docsReal, MANIFEST_FILE);
  let status;
  try { status = await lstat(manifestPath); }
  catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
  if (status.isSymbolicLink() || !status.isFile()) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  const resolved = await realpath(manifestPath);
  if (!samePath(relative(docsReal, resolved), MANIFEST_FILE)) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  const raw = await readFile(resolved);
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString('utf8')); }
  catch { throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED'); }
  const manifest = validateManifest(parsed);
  if (!raw.equals(serializeManifest(manifest))) throw Error('SEO90_OWNED_MANIFEST_UNTRUSTED');
  await verifyOwnedFiles(docsReal, manifest);
  return manifest;
}

function renderEligible(bundle: Bundle, eligible: EligibleItem[], frozen: Map<string, Buffer>): PublicSeo90 {
  const output = empty();
  const addedAssets = new Set<string>();
  for (const {article: a, assets} of eligible) {
    for (const asset of assets) {
      const path = `/seo90-assets/${asset.sha256}.png`;
      if (addedAssets.has(path)) continue;
      const bytes = frozen.get(asset.assetId);
      if (!bytes) throw Error('SEO90_ASSET_BYTES_MISSING');
      output.pages.push({path, bytes: Buffer.from(bytes)});
      addedAssets.add(path);
    }
    const release = bundle.releases.find((item) => item.contentId === a.contentId);
    output.pages.push({path: a.canonicalPath, contentId: a.contentId, bytes: Buffer.from(renderArticle(a, assets, bundle.registry, false, release))});
    output.sitemapEntries.push(`<url><loc>${xml(bundle.registry.baseUrl + a.canonicalPath)}</loc><lastmod>${xml(release!.dateModified)}</lastmod></url>`);
    const servicePath = bundle.registry.services[a.serviceId]!.path;
    (output.relatedByService[servicePath] ??= []).push({title: a.title, path: a.canonicalPath});
  }
  if (eligible.length) {
    output.dailyIndexPath = '/daily/';
    output.pages.push({path: DAILY_PATH, bytes: Buffer.from(renderDailyIndex(eligible, bundle.registry, false))});
    output.sitemapEntries.unshift(`<url><loc>${xml(bundle.registry.baseUrl + '/daily/')}</loc></url>`);
  }
  return output;
}
function foreignSlug(article: Article, paths: Set<string>): boolean {
  const own = article.canonicalPath.toLowerCase();
  const slug = article.slug.toLowerCase();
  for (const path of paths) {
    if (!path.startsWith('/posts/') || path === own) continue;
    const name = path.split('/').pop() ?? '';
    if (name.replace(/\.html$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '') === slug) return true;
  }
  return false;
}
function sameIdentity(recordRelease: OwnedRelease, release: Release, assets: Asset[]): boolean {
  const next = assets.map((asset) => asset.sha256).slice().sort();
  const previous = recordRelease.assetSha256s;
  return release.state === 'published'
    && release.contentId === recordRelease.contentId
    && release.canonicalPath === recordRelease.canonicalPath
    && release.articleSha256 === recordRelease.articleSha256
    && release.registrySha256 === recordRelease.registrySha256
    && release.datePublished === recordRelease.datePublished
    && release.dateModified === recordRelease.dateModified
    && next.length === previous.length
    && next.every((sha, index) => sha === previous[index]);
}
function cleanWithdrawal(article: Article, bundle: Bundle, owned: OwnedRelease | undefined): boolean {
  if (!owned || article.state !== 'withdrawn' || article.contentId !== owned.contentId || article.canonicalPath !== owned.canonicalPath) return false;
  const releases = bundle.releases.filter((release) => release.contentId === article.contentId || release.canonicalPath === article.canonicalPath);
  if (releases.length !== 1) return false;
  const release = releases[0]!;
  return release.state === 'withdrawn'
    && release.contentId === owned.contentId
    && release.canonicalPath === owned.canonicalPath
    && release.articleSha256 === owned.articleSha256
    && release.registrySha256 === owned.registrySha256
    && release.datePublished === owned.datePublished
    && release.dateModified === owned.dateModified;
}
function planOwnedRelease(bundle: Bundle, prepared: {eligible: EligibleItem[]; held: {contentId: string; reasons: string[]}[]; frozen: Map<string, Buffer>}, manifest: OwnedManifest | null, options: {existingPaths: ReadonlySet<string>; existingIds: ReadonlySet<string>}): PublicSeo90 {
  const owned = manifest?.releases ?? [];
  const ownedById = new Map(owned.map((release) => [release.contentId, release]));
  const present = new Set(bundle.articles.map((article) => article.contentId));
  const missing = owned.filter((release) => !present.has(release.contentId));
  const withdrawals: OwnedRelease[] = [];
  const stale: string[] = [];
  for (const article of bundle.articles) {
    const recordRelease = ownedById.get(article.contentId);
    if (prepared.eligible.some((item) => item.article.contentId === article.contentId)) continue;
    if (cleanWithdrawal(article, bundle, recordRelease)) withdrawals.push(recordRelease!);
    else if (recordRelease) stale.push(article.contentId);
  }
  if (missing.length) throw Error('SEO90_RELEASE_RECONCILIATION_REQUIRED');
  if (stale.length) throw Error('SEO90_UNAPPROVED_REVISION');
  const paths = new Set([...options.existingPaths].map((path) => path.toLowerCase()));
  const live: LiveItem[] = [];
  for (const item of prepared.eligible) {
    const article = item.article;
    const release = bundle.releases.find((entry) => entry.contentId === article.contentId);
    if (!release) throw Error('SEO90_RELEASE_RECONCILIATION_REQUIRED');
    const recordRelease = ownedById.get(article.contentId);
    const pathOwner = owned.find((entry) => entry.canonicalPath.toLowerCase() === article.canonicalPath.toLowerCase());
    if ((recordRelease && recordRelease.canonicalPath.toLowerCase() !== article.canonicalPath.toLowerCase()) || (pathOwner && pathOwner.contentId !== article.contentId) || foreignSlug(article, paths)) {
      throw Error('SEO90_EXISTING_ARTICLE_COLLISION');
    }
    if (!recordRelease) {
      if (paths.has(article.canonicalPath.toLowerCase()) || options.existingIds.has(article.contentId)) throw Error('SEO90_EXISTING_ARTICLE_COLLISION');
      live.push({item, mode: 'new'});
      continue;
    }
    if (sameIdentity(recordRelease, release, item.assets)) live.push({item, mode: 'noop', previous: recordRelease});
    else {
      if (release.datePublished !== recordRelease.datePublished || Date.parse(release.dateModified) < Date.parse(recordRelease.dateModified)) throw Error('SEO90_PUBLISHED_DATE_IMMUTABLE');
      live.push({item, mode: 'update', previous: recordRelease});
    }
  }
  const ownsDaily = owned.length > 0;
  if (live.some((item) => item.mode === 'new') && !ownsDaily && (paths.has('/daily/') || paths.has(DAILY_PATH))) throw Error('SEO90_EXISTING_INDEX_COLLISION');
  if (!live.length && !withdrawals.length) {
    const output = empty();
    output.diagnostics = prepared.held;
    return output;
  }
  const rendered = renderEligible(bundle, live.map((item) => item.item), prepared.frozen);
  rendered.diagnostics = prepared.held;
  for (const item of live) {
    if (item.mode !== 'noop' || !item.previous) continue;
    const page = rendered.pages.find((entry) => entry.path === item.item.article.canonicalPath);
    if (!page || bytesDigest(page.bytes) !== item.previous.articleFileSha256) throw Error('SEO90_OWNED_OUTPUT_DRIFT');
  }
  const pureNoop = !!manifest && owned.length > 0 && !withdrawals.length && live.length === owned.length && live.every((item) => item.mode === 'noop');
  const daily = rendered.pages.find((page) => page.path === DAILY_PATH);
  if (pureNoop && (!daily || bytesDigest(daily.bytes) !== manifest!.dailyFileSha256)) throw Error('SEO90_OWNED_OUTPUT_DRIFT');
  if (manifest) {
    const ownedShas = new Set(owned.flatMap((release) => release.assetSha256s));
    rendered.pages = rendered.pages.filter((page) => {
      const sha = /^\/seo90-assets\/([a-f0-9]{64})\.png$/.exec(page.path)?.[1];
      return !sha || !ownedShas.has(sha);
    });
  }
  const liveShas = new Set(live.flatMap((item) => item.item.assets.map((asset) => asset.sha256)));
  const removals = new Set<string>();
  for (const withdrawal of withdrawals) removals.add(withdrawal.canonicalPath);
  const replaced = [...withdrawals, ...live.flatMap((item) => item.mode === 'update' && item.previous ? [item.previous] : [])];
  for (const previous of replaced) {
    for (const sha of previous.assetSha256s) {
      if (!assetRetainedByLiveRelease(sha, liveShas)) removals.add(`/seo90-assets/${sha}.png`);
    }
  }
  if (!live.length && withdrawals.length) removals.add(DAILY_PATH);
  const releases = live.map((item) => {
    const article = item.item.article;
    const release = bundle.releases.find((entry) => entry.contentId === article.contentId)!;
    const page = rendered.pages.find((entry) => entry.path === article.canonicalPath)!;
    return {
      contentId: article.contentId,
      canonicalPath: article.canonicalPath,
      articleSha256: release.articleSha256,
      registrySha256: release.registrySha256,
      datePublished: release.datePublished,
      dateModified: release.dateModified,
      articleFileSha256: bytesDigest(page.bytes),
      assetSha256s: item.item.assets.map((asset) => asset.sha256).slice().sort()
    };
  }).sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
  rendered.manifest = serializeManifest({schemaVersion: MANIFEST_SCHEMA, dailyFileSha256: daily ? bytesDigest(daily.bytes) : null, releases});
  rendered.removals = [...removals].filter((path) => !rendered.pages.some((page) => page.path === path));
  rendered.reconciled = !live.length && withdrawals.length > 0;
  return rendered;
}

/** Reads and validates assets, returns immutable bytes; never writes docs or private reports. */
export async function preparePublicSeo90(bundle: Bundle, options: {
  assetRoot: string; now: string; baseUrl: string;
  existingPaths: ReadonlySet<string>; existingIds: ReadonlySet<string>;
}): Promise<PublicSeo90> {
  if (!bundle?.registry || bundle.registry.baseUrl.replace(/\/$/, '') !== options.baseUrl.replace(/\/$/, '')) throw Error('SEO90_ORIGIN_MISMATCH');
  const {eligible, held, frozen} = await prepareSeo90(bundle, {mode: 'public', assetRoot: options.assetRoot, now: options.now});
  const output = empty();
  output.diagnostics = held;
  if (!eligible.length) return output;
  const paths = new Set([...options.existingPaths].map((path) => path.toLowerCase()));
  const slugs = new Set([...paths].filter((path) => path.startsWith('/posts/')).map((path) => path.split('/').pop()!.replace(/\.html$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')));
  for (const {article: a} of eligible) {
    if (paths.has(a.canonicalPath.toLowerCase()) || slugs.has(a.slug.toLowerCase()) || options.existingIds.has(a.contentId)) throw Error('SEO90_EXISTING_ARTICLE_COLLISION');
  }
  if (paths.has('/daily/') || paths.has(DAILY_PATH)) throw Error('SEO90_EXISTING_INDEX_COLLISION');
  const rendered = renderEligible(bundle, eligible, frozen);
  rendered.diagnostics = held;
  return rendered;
}

async function contained(root: string, path: string): Promise<string> {
  const resolved = await realpath(path), rel = relative(await realpath(root), resolved);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw Error('SEO90_SOURCE_ESCAPE');
  return resolved;
}

/** Only this checked-in allowlist can feed the formal generator. No Vault/social-log discovery. */
export async function loadPublicSeo90(root: string, options: {now: string; baseUrl: string; existingPaths: ReadonlySet<string>; existingIds: ReadonlySet<string>}): Promise<PublicSeo90> {
  const source = join(root, 'content', 'seo90', 'public-ready.json');
  let document: any;
  try { document = JSON.parse(await readFile(await contained(root, source), 'utf8')); }
  catch (error: any) { if (error.code === 'ENOENT') return empty(); throw error; }
  if (!document || document.schemaVersion !== 'sxj.seo90.public-source.v1') throw Error('SEO90_INVALID_PUBLIC_SOURCE');
  if (document.bundle === null) return empty();
  const publishedBase = document.bundle?.registry?.baseUrl;
  if (typeof publishedBase !== 'string' || publishedBase.replace(/\/$/, '') !== options.baseUrl.replace(/\/$/, '')) throw Error('SEO90_ORIGIN_MISMATCH');
  const assetRoot = await contained(root, join(root, 'content', 'seo90', 'public-assets'));
  const prepared = await prepareSeo90(document.bundle, {mode: 'public', assetRoot, now: options.now});
  const manifest = await readOwnedManifest(root);
  return planOwnedRelease(document.bundle, prepared, manifest, options);
}

/** Existing published post paths are reserved, including files not present in today's index. */
export async function existingSeo90Paths(docsRoot: string): Promise<Set<string>> {
  const result = new Set<string>();
  async function collect(directory: string, prefix: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, {withFileTypes: true}); }
    catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const path = prefix + '/' + entry.name;
      if (entry.isSymbolicLink()) throw Error('SEO90_EXISTING_PATH_SYMLINK');
      if (entry.isDirectory()) await collect(join(directory, entry.name), path);
      else result.add(path);
    }
  }
  await collect(join(docsRoot, 'posts'), '/posts');
  await collect(join(docsRoot, 'daily'), '/daily');
  return result;
}

/** Check owned destinations before the sole writer starts. Does not adopt a junction target as the root. */
export async function assertSeo90Destinations(root: string, pages: PublicPage[]): Promise<void> {
  const docsRoot = join(root, 'docs');
  const relativePaths = pages.map((page) => {
    if (!page.path.startsWith('/') || page.path.includes('\\') || page.path.includes('..')) throw Error('SEO90_OUTPUT_ALIAS');
    return page.path.slice(1);
  });
  await assertPublicWriteBoundary(docsRoot, relativePaths);
}

const BLOCK_FILE = '.seo90-release-blocked';
const blockedSites = new Set<string>();

export interface PublicTreeChange {absolute: string; bytes: Buffer | null}
interface Snap {bytes: Buffer | null; mode: number | null}
export interface PublicTreeCommitOptions {
  sequential?: boolean;
  failAfterWrites?: number;
  failRestore?: boolean;
  stall?: {suffix: string; ms: number};
}

async function siteIdentity(docsRoot: string): Promise<string> {
  const parent = dirname(docsRoot);
  try { return (await realpath(parent)).toLowerCase(); }
  catch (error: any) {
    if (error.code === 'ENOENT') return resolve(parent).toLowerCase();
    throw error;
  }
}

/** Fail closed after a restore failure. The marker sits beside docs, not inside the public tree. */
export async function assertReleaseNotBlocked(docsRoot: string): Promise<void> {
  const id = await siteIdentity(docsRoot);
  if (blockedSites.has(id)) throw Error('SEO90_RELEASE_BLOCKED');
  const marker = join(dirname(docsRoot), BLOCK_FILE);
  try { await lstat(marker); }
  catch (error: any) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  blockedSites.add(id);
  throw Error('SEO90_RELEASE_BLOCKED');
}

async function markBlocked(docsRoot: string): Promise<void> {
  const id = await siteIdentity(docsRoot);
  blockedSites.add(id);
  const marker = join(dirname(docsRoot), BLOCK_FILE);
  try {
    const status = await lstat(marker);
    if (status.isSymbolicLink()) return;
  } catch (error: any) {
    if (error.code !== 'ENOENT') return;
    await writeFile(marker, 'SEO90_RELEASE_BLOCKED\n', {flag: 'wx'}).catch(() => undefined);
  }
}

/** Pin docs itself. A child junction is never adopted as a new allowed root. */
export async function pinAllowedDocsRoot(docsRoot: string): Promise<string> {
  const parent = dirname(docsRoot);
  let parentStatus;
  try { parentStatus = await lstat(parent); }
  catch (error: any) {
    if (error.code === 'ENOENT') throw Error('SEO90_OUTPUT_ALIAS');
    throw error;
  }
  if (parentStatus.isSymbolicLink() || !parentStatus.isDirectory()) throw Error('SEO90_OUTPUT_ALIAS');
  const parentReal = await realpath(parent);
  let status;
  try { status = await lstat(docsRoot); }
  catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(docsRoot);
    status = await lstat(docsRoot);
  }
  if (status.isSymbolicLink() || !status.isDirectory()) throw Error('SEO90_OUTPUT_ALIAS');
  const pinned = await realpath(docsRoot);
  const rel = relative(parentReal, pinned);
  if (!samePath(rel, 'docs') || rel.startsWith('..') || isAbsolute(rel)) throw Error('SEO90_OUTPUT_ALIAS');
  return pinned;
}

async function assertNoReparse(pinned: string, absolute: string): Promise<void> {
  const rel = relative(pinned, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw Error('SEO90_OUTPUT_ALIAS');
  const parts = rel.split(sep);
  let current = pinned;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]!);
    let status;
    try { status = await lstat(current); }
    catch (error: any) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (status.isSymbolicLink()) throw Error('SEO90_OUTPUT_ALIAS');
    if (!status.isDirectory() && index !== parts.length - 1) throw Error('SEO90_OUTPUT_ALIAS');
    const resolved = await realpath(current);
    const resolvedRel = relative(pinned, resolved);
    const expectedRel = relative(pinned, current);
    if (!samePath(resolvedRel, expectedRel) || resolvedRel.startsWith('..') || isAbsolute(resolvedRel)) throw Error('SEO90_OUTPUT_ALIAS');
  }
}

function normalizeInside(pinned: string, absolute: string): string {
  const rel = relative(pinned, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw Error('SEO90_OUTPUT_ALIAS');
  return join(pinned, rel);
}

/** Check every relative target before any public write. Missing tails are allowed; reparse points are not. */
export async function assertPublicWriteBoundary(docsRoot: string, relativePaths: string[]): Promise<void> {
  await assertReleaseNotBlocked(docsRoot);
  const pinned = await pinAllowedDocsRoot(docsRoot);
  for (const relPath of relativePaths) {
    if (typeof relPath !== 'string' || relPath === '' || relPath.includes('\\') || relPath.includes('..') || relPath.startsWith('/') || relPath.includes(':') || isAbsolute(relPath)) {
      throw Error('SEO90_OUTPUT_ALIAS');
    }
    await assertNoReparse(pinned, join(pinned, ...relPath.split('/')));
  }
}

async function readSnap(target: string): Promise<Snap> {
  try {
    const status = await lstat(target);
    if (status.isSymbolicLink() || !status.isFile()) throw Error('SEO90_OUTPUT_ALIAS');
    return {bytes: await readFile(target), mode: status.mode};
  } catch (error: any) {
    if (error.code === 'ENOENT') return {bytes: null, mode: null};
    throw error;
  }
}

function sameBytes(left: Buffer | null, right: Buffer | null): boolean {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

async function restoreAll(snapshots: Map<string, Snap>): Promise<void> {
  for (const [target, snap] of [...snapshots.entries()].reverse()) {
    const current = await readSnap(target);
    if (sameBytes(current.bytes, snap.bytes)) {
      if (snap.bytes !== null && snap.mode !== null && current.mode !== null && (snap.mode & 0o222) !== (current.mode & 0o222)) {
        await chmod(target, snap.mode);
      }
      continue;
    }
    if (snap.bytes === null) {
      if (current.mode !== null && (current.mode & 0o222) === 0) await chmod(target, 0o666);
      await unlink(target);
      continue;
    }
    await mkdir(dirname(target), {recursive: true});
    if (current.bytes !== null && current.mode !== null && (current.mode & 0o222) === 0) await chmod(target, 0o666);
    await writeFile(target, snap.bytes);
    if (snap.mode !== null) await chmod(target, snap.mode);
  }
}

async function verifyRestored(snapshots: Map<string, Snap>): Promise<void> {
  for (const [target, snap] of snapshots) {
    const current = await readSnap(target);
    if (!sameBytes(current.bytes, snap.bytes)) throw Error('SEO90_RESTORE_FAILED');
    if (snap.bytes !== null && snap.mode !== null && current.mode !== null && (snap.mode & 0o222) !== (current.mode & 0o222)) {
      throw Error('SEO90_RESTORE_FAILED');
    }
  }
}

/**
 * One in-process public-tree transaction. Snapshots stay in memory.
 * This does not make power loss, cross-process crash, or a malicious race atomic.
 */
export async function commitPublicTree(docsRoot: string, changes: PublicTreeChange[], options: PublicTreeCommitOptions = {}): Promise<void> {
  if (!changes.length) {
    await assertReleaseNotBlocked(docsRoot);
    return;
  }
  await assertReleaseNotBlocked(docsRoot);
  const pinned = await pinAllowedDocsRoot(docsRoot);
  const planned: PublicTreeChange[] = [];
  for (const change of changes) {
    const absolute = normalizeInside(pinned, change.absolute);
    await assertNoReparse(pinned, absolute);
    planned.push({absolute, bytes: change.bytes});
  }
  const snapshots = new Map<string, Snap>();
  for (const item of planned) {
    if (snapshots.has(item.absolute)) continue;
    snapshots.set(item.absolute, await readSnap(item.absolute));
  }
  const started: Promise<unknown>[] = [];
  let completed = 0;
  let mutated = false;
  const stallMs = options.stall ? Math.min(5000, Math.max(0, options.stall.ms)) : 0;
  const runOne = async (item: PublicTreeChange): Promise<void> => {
    if (stallMs > 0 && options.stall && item.absolute.endsWith(options.stall.suffix)) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, stallMs));
    }
    mutated = true;
    if (item.bytes === null) {
      await unlink(item.absolute).catch((error: any) => { if (error.code !== 'ENOENT') throw error; });
      return;
    }
    await mkdir(dirname(item.absolute), {recursive: true});
    await writeFile(item.absolute, item.bytes);
  };
  try {
    if (options.sequential) {
      for (const item of planned) {
        const job = runOne(item);
        started.push(job);
        await job;
        completed += 1;
        if (options.failAfterWrites !== undefined && completed === options.failAfterWrites) throw Error('SEO90_COMMIT_INTERRUPTED');
      }
    } else {
      for (const item of planned) {
        const job = runOne(item);
        started.push(job);
      }
      await Promise.all(started);
    }
    if (options.failRestore) throw Error('SEO90_RESTORE_INJECTED');
  } catch (error) {
    await Promise.allSettled(started);
    if (mutated) {
      try {
        if (options.failRestore) throw Error('SEO90_RESTORE_INJECTED');
        await restoreAll(snapshots);
        await verifyRestored(snapshots);
      } catch {
        await markBlocked(docsRoot);
        throw Error('SEO90_RESTORE_FAILED');
      }
    }
    throw error;
  }
}

/** Lexical owned paths only. Does not write. */
export async function planOwnedReleaseWrites(docsRoot: string, plan: PublicSeo90): Promise<PublicTreeChange[]> {
  const writes = plan.pages.map((page) => ({path: page.path, bytes: page.bytes}));
  if (plan.manifest) writes.push({path: SEO90_OWNED_MANIFEST_PATH, bytes: plan.manifest});
  const written = new Set(writes.map((page) => page.path));
  const removals = plan.removals.filter((path) => !written.has(path));
  if (!writes.length && !removals.length) return [];
  const docsReal = await openDocs(docsRoot);
  const changes: PublicTreeChange[] = [];
  for (const page of writes) {
    const target = lexical(docsReal, page.path);
    await rejectAlias(docsReal, page.path);
    changes.push({absolute: target, bytes: page.bytes});
  }
  for (const publicPath of removals) {
    const target = lexical(docsReal, publicPath);
    await rejectAlias(docsReal, publicPath);
    changes.push({absolute: target, bytes: null});
  }
  return changes;
}

/** Prepare already finished. Replace owned output only after snapshots exist; failure rewrites those bytes. */
export async function commitSeo90Release(docsRoot: string, plan: PublicSeo90, failAfterWrites?: number): Promise<string[]> {
  const changes = await planOwnedReleaseWrites(docsRoot, plan);
  if (!changes.length) return [];
  await commitPublicTree(docsRoot, changes, {sequential: true, failAfterWrites});
  return changes.filter((change) => change.bytes !== null).map((change) => change.absolute);
}
