/** Read-only production preflight for the W12 daily release.
 *
 * It invokes the production `run --policy` command with the real system clock.
 * Before 2026-09-25 this must be WAIT_DUE and leave the source worktree,
 * journal, pin, bundle, remote refs and public files byte-identical.
 */
import {existsSync} from 'node:fs';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname, fileURLToPath, join, resolve} from 'node:path';

const siteRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coordination = resolve(siteRepo, '..');
const pinPath = resolve(process.argv[2] || join(coordination, 'notebook-seo-integration', 'RELEASE-PIN.json'));
const journalPath = resolve(process.argv[3] || join(coordination, 'notebook-seo-integration', 'seo90-release-journal.json'));
const outputPath = resolve(process.argv[4] || join(coordination, 'w12-daily-release', 'production-preflight-20260922.json'));
const trackedFiles = ['docs/CNAME', 'docs/sitemap.xml', 'docs/daily/index.html', 'docs/seo90-release-manifest.json'];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}
function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
async function maybeDigest(path: string): Promise<string | null> {
  try { return digest(await readFile(path)); } catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
}
function parseJsonOutput(text: string): any {
  const start = text.indexOf('{');
  if (start < 0) throw Error(`PREFLIGHT_NO_JSON:${text.slice(0, 500)}`);
  return JSON.parse(text.slice(start));
}
function remoteHead(cwd: string, remote: string, ref: string): string {
  const line = git(cwd, ['ls-remote', remote, ref]).split(/\r?\n/).find(Boolean);
  if (!line) throw Error(`PREFLIGHT_REMOTE_REF_MISSING:${ref}`);
  return line.split(/\s+/)[0];
}

async function main(): Promise<void> {
  const pinBytesBefore = await readFile(pinPath);
  const pin = JSON.parse(pinBytesBefore.toString('utf8').replace(/^\uFEFF/, '')) as any;
  const bundleBytesBefore = await readFile(pin.sourceBundlePath);
  const bundleShaBefore = digest(bundleBytesBefore);
  if (bundleShaBefore.toLowerCase() !== String(pin.sourceBundleSha256).toLowerCase()) throw Error('PREFLIGHT_BUNDLE_PIN_MISMATCH');
  const sourceBefore = git(siteRepo, ['rev-parse', pin.destination.ref]);
  const sourceRemoteBefore = remoteHead(siteRepo, 'origin', pin.destination.ref);
  const pagesBefore = remoteHead(siteRepo, pin.destination.rootPagesRepo, 'refs/heads/main');
  const statusBefore = git(siteRepo, ['status', '--porcelain']);
  const journalBefore = existsSync(journalPath) ? (await readFile(journalPath)).toString('utf8') : null;
  const filesBefore: Record<string, string | null> = {};
  for (const relative of trackedFiles) filesBefore[relative] = await maybeDigest(join(siteRepo, relative));

  const tsxCli = join(siteRepo, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const cli = join(siteRepo, 'scripts', 'seo90-release.ts');
  const runOutput = execFileSync(process.execPath, [tsxCli, cli, 'run', '--policy', pinPath, '--root', siteRepo, '--journal', journalPath], {
    cwd: siteRepo,
    encoding: 'utf8',
    env: {...process.env, PUBLIC_SITE_BASE_URL: pin.baseUrl},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const runResult = parseJsonOutput(runOutput);

  const sourceAfter = git(siteRepo, ['rev-parse', pin.destination.ref]);
  const sourceRemoteAfter = remoteHead(siteRepo, 'origin', pin.destination.ref);
  const pagesAfter = remoteHead(siteRepo, pin.destination.rootPagesRepo, 'refs/heads/main');
  const statusAfter = git(siteRepo, ['status', '--porcelain']);
  const journalAfter = existsSync(journalPath) ? (await readFile(journalPath)).toString('utf8') : null;
  const filesAfter: Record<string, string | null> = {};
  for (const relative of trackedFiles) filesAfter[relative] = await maybeDigest(join(siteRepo, relative));
  const pinBytesAfter = await readFile(pinPath);
  const bundleBytesAfter = await readFile(pin.sourceBundlePath);
  const checks = {
    stateWaitDue: runResult.state === 'WAIT_DUE',
    dueSetEmpty: Array.isArray(runResult.evidence?.expectedDueContentIds) && runResult.evidence.expectedDueContentIds.length === 0,
    sourceClean: !statusBefore && !statusAfter,
    sourceHeadStable: sourceBefore === sourceAfter,
    sourceRemoteStable: sourceRemoteBefore === sourceRemoteAfter,
    pagesRemoteStable: pagesBefore === pagesAfter,
    journalByteStable: journalBefore === journalAfter,
    pinByteStable: pinBytesBefore.equals(pinBytesAfter),
    bundleByteStable: bundleBytesBefore.equals(bundleBytesAfter),
    publicFilesByteStable: trackedFiles.every((relative) => filesBefore[relative] === filesAfter[relative]),
    noPendingIntent: !(runResult.pending || []).length
  };
  const report = {
    schemaVersion: 'sxj.seo90.production-preflight.v1',
    checkedAt: new Date().toISOString(),
    source: {repo: siteRepo, ref: pin.destination.ref, localHead: sourceAfter, remoteHead: sourceRemoteAfter, statusBefore, statusAfter},
    pagesMirror: {remote: pin.destination.rootPagesRepo, before: pagesBefore, after: pagesAfter},
    pin: {path: pinPath, sha256: digest(pinBytesAfter), bundleSha256: bundleShaBefore},
    journal: {path: journalPath, existedBefore: journalBefore !== null, byteStable: checks.journalByteStable},
    runResult,
    publicFiles: {before: filesBefore, after: filesAfter},
    checks,
    formalProductionTouched: false,
    pass: Object.values(checks).every(Boolean)
  };
  await mkdir(dirname(outputPath), {recursive: true});
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({pass: report.pass, output: outputPath, state: runResult.state, due: runResult.evidence?.expectedDueContentIds || [], sourceHead: sourceAfter, pagesHead: pagesAfter}));
  if (!report.pass) process.exitCode = 1;
}

main().catch((error) => { console.error(JSON.stringify({pass: false, error: error?.message || String(error), output: outputPath})); process.exitCode = 1; });
