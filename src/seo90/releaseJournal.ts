import {createHash} from 'node:crypto';
import {open, readFile, rename, mkdir, unlink} from 'node:fs/promises';
import {closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

export type ReleaseState = 'PLANNED'|'PREPARED'|'PUSHING'|'GIT_CONFIRMED'|'VERIFYING'|'COMPLETE'|'UNKNOWN'|'HOLD';

export interface ReleaseIntent {
  schemaVersion: 'sxj.seo90.release-intent.v1';
  intentId: string;
  storeId: string;
  baseUrl: string;
  expectedBefore: string;
  candidateCommit?: string;
  contentIds: string[];
  inputSha256: string;
  plannedAt: string;
  windowEndsAt: string;
  state: ReleaseState;
  createdAt: string;
  updatedAt: string;
  selectedPaths: string[];
  error?: string;
  readback?: {checkedAt: string; urls: string[]; failures: string[]};
}

export interface ReleaseJournal {
  schemaVersion: 'sxj.seo90.release-journal.v1';
  intents: ReleaseIntent[];
}

const empty = (): ReleaseJournal => ({schemaVersion: 'sxj.seo90.release-journal.v1', intents: []});

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function readReleaseJournal(path: string): Promise<ReleaseJournal> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as ReleaseJournal;
    if (parsed?.schemaVersion !== 'sxj.seo90.release-journal.v1' || !Array.isArray(parsed.intents)) throw Error('SEO90_JOURNAL_UNTRUSTED');
    return parsed;
  } catch (error: any) {
    if (error.code === 'ENOENT') return empty();
    throw error;
  }
}

export async function writeReleaseJournal(path: string, journal: ReleaseJournal): Promise<void> {
  if (journal.schemaVersion !== 'sxj.seo90.release-journal.v1') throw Error('SEO90_JOURNAL_UNTRUSTED');
  await mkdir(dirname(path), {recursive: true});
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeAtomic(temp, `${JSON.stringify(journal, null, 2)}\n`);
  await rename(temp, path);
}

// The publisher exposes a synchronous commit hook immediately after the source
// commit and before any remote push. Persisting there closes the crash window
// where a push can succeed but the async journal update has not run yet.
export function writeReleaseJournalSync(path: string, journal: ReleaseJournal): void {
  if (journal.schemaVersion !== 'sxj.seo90.release-journal.v1') throw Error('SEO90_JOURNAL_UNTRUSTED');
  mkdirSync(dirname(path), {recursive: true});
  const temp = `${path}.${process.pid}.${Date.now()}.sync.tmp`;
  const fd = openSync(temp, 'wx');
  try {
    writeFileSync(fd, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
}

async function writeAtomic(path: string, value: string): Promise<void> {
  const handle = await open(path, 'wx');
  try { await handle.writeFile(value, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
}

export async function withReleaseLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), {recursive: true});
  let handle;
  try { handle = await open(path, 'wx'); }
  catch (error: any) { if (error.code === 'EEXIST') throw Error('SEO90_RELEASE_LOCKED'); throw error; }
  try { return await fn(); }
  finally { await handle.close(); await unlink(path).catch(() => undefined); }
}

export function pendingIntent(journal: ReleaseJournal): ReleaseIntent | undefined {
  return journal.intents.find((intent) => !['COMPLETE','HOLD'].includes(intent.state));
}

export function upsertIntent(journal: ReleaseJournal, intent: ReleaseIntent): ReleaseJournal {
  const intents = journal.intents.filter((item) => item.intentId !== intent.intentId);
  intents.push(intent);
  return {...journal, intents};
}
