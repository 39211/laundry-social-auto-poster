/**
 * Full transport rehearsal for W12.  It creates a temporary source clone and
 * local bare Pages mirror, then invokes the public CLI.  No GitHub URL,
 * production journal, pin or bundle is ever used as a write target.
 */
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteRepo = resolve(scriptDir, '..');
const coordination = resolve(siteRepo, '..');
const originalPinPath = join(coordination, 'notebook-seo-integration', 'RELEASE-PIN.json');
const originalBundlePath = join(coordination, 'notebook-seo-integration', 'WEBSITE-APPROVED-BUNDLE.json');
const outputPath = resolve(process.argv[2] || join(coordination, 'w12-daily-release', 'mirror-rehearsal-20260922.json'));
const at = '2026-09-25T09:00:00+08:00';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}
function gitBare(bare: string, args: string[]): string {
  return execFileSync('git', ['--git-dir', bare, ...args], {cwd: coordination, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function runCli(args: string[]): any {
  const cli = join(siteRepo, 'scripts', 'seo90-release.ts');
  const tsxCli = join(siteRepo, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const output = execFileSync(process.execPath, [tsxCli, cli, ...args], {
    cwd: siteRepo,
    encoding: 'utf8',
    env: {...process.env, PUBLIC_SITE_BASE_URL: 'https://sixiangjialaundry.com'},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const jsonStart = output.indexOf('{');
  if (jsonStart < 0) throw Error(`MIRROR_CLI_NO_JSON:${output.slice(0, 500)}`);
  return JSON.parse(output.slice(jsonStart));
}

async function main(): Promise<void> {
  const originalPin = JSON.parse(await readFile(originalPinPath, 'utf8')) as any;
  const originalBundle = await readFile(originalBundlePath);
  const originalAssets = resolve(originalPin.assetRoot);
  const root = await mkdtemp(join(tmpdir(), 'sxj-w12-mirror-'));
  let keepOnFailure = true;
  try {
    const sourceClone = join(root, 'site-clone');
    const sourceRemote = join(root, 'source-remote.git');
    const pagesSeed = join(root, 'pages-seed');
    const pagesRemote = join(root, 'pages-remote.git');
    const inputs = join(root, 'inputs');
    const bundleCopy = join(inputs, 'bundle.json');
    const assetsCopy = join(inputs, 'assets');
    const policyCopy = join(inputs, 'policy.json');
    const journal = join(root, 'journal', 'release.json');
    const report = join(root, 'evidence', 'mirror-release.json');
    await mkdir(inputs, {recursive: true});

    // All remotes are local paths.  A shared bare clone avoids repacking the
    // large source history while keeping the temporary source ref private.
    const sourceHead = git(siteRepo, ['rev-parse', 'HEAD']);
    git(coordination, ['clone', '--shared', '--bare', siteRepo, sourceRemote]);
    gitBare(sourceRemote, ['update-ref', 'refs/heads/main', sourceHead]);
    gitBare(sourceRemote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    // Shared objects keep this long-lived repository clone fast while the
    // temporary worktree/index remain private and are destroyed afterwards.
    git(coordination, ['clone', '--shared', '--no-checkout', siteRepo, sourceClone]);
    git(sourceClone, ['remote', 'set-url', 'origin', sourceRemote]);
    git(sourceClone, ['fetch', 'origin', 'main']);
    git(sourceClone, ['checkout', '-B', 'main', 'origin/main']);
    // A local clone may inherit the source worktree's sparse/worktree flags;
    // force a clean, complete detached test checkout before the runner sees it.
    git(sourceClone, ['reset', '--hard', 'origin/main']);
    git(sourceClone, ['clean', '-fdx']);
    git(sourceClone, ['config', 'user.email', 'w12-mirror@example.test']);
    git(sourceClone, ['config', 'user.name', 'W12 mirror rehearsal']);
    const sourceBefore = git(sourceClone, ['rev-parse', 'HEAD']);
    if (sourceBefore !== sourceHead) throw Error(`UNEXPECTED_SOURCE_HEAD:${sourceBefore}`);

    git(coordination, ['init', '--bare', pagesRemote]);
    git(coordination, ['init', pagesSeed]);
    git(pagesSeed, ['config', 'user.email', 'mirror@example.test']);
    git(pagesSeed, ['config', 'user.name', 'W12 mirror rehearsal']);
    await mkdir(join(pagesSeed, '.well-known'), {recursive: true});
    await mkdir(join(pagesSeed, 'assets', '2020-01-01'), {recursive: true});
    await writeFile(join(pagesSeed, 'index.html'), '<!doctype html><title>baseline</title>\n');
    await writeFile(join(pagesSeed, 'keep-root.txt'), 'keep\n');
    await writeFile(join(pagesSeed, '.well-known', 'keep.json'), '{"keep":true}\n');
    await writeFile(join(pagesSeed, 'assets', '2020-01-01', 'historical.bin'), 'keep-history\n');
    git(pagesSeed, ['add', '-A']);
    git(pagesSeed, ['commit', '-qm', 'seed mirror']);
    git(pagesSeed, ['remote', 'add', 'origin', pagesRemote]);
    git(pagesSeed, ['push', 'origin', 'HEAD:main']);
    gitBare(pagesRemote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    const pagesBefore = gitBare(pagesRemote, ['rev-parse', 'refs/heads/main']);

    await writeFile(bundleCopy, originalBundle);
    await cp(originalAssets, assetsCopy, {recursive: true});
    const bundleHash = sha256(originalBundle);
    if (bundleHash !== String(originalPin.sourceBundleSha256).toLowerCase()) throw Error(`BUNDLE_HASH_MISMATCH:${bundleHash}`);
    const policy = {
      ...originalPin,
      sourceBundlePath: bundleCopy,
      assetRoot: assetsCopy,
      destination: {...originalPin.destination, repoRoot: sourceClone, ref: 'refs/heads/main', rootPagesRepo: pagesRemote}
    };
    await writeFile(policyCopy, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
    const policyBytes = await readFile(policyCopy);
    const originalPinBytes = await readFile(originalPinPath);

    const first = runCli(['mirror-rehearse', '--policy', policyCopy, '--root', sourceClone, '--journal', journal, '--root-pages-repo', pagesRemote, '--test-now', at, '--report', report]);
    const journalAfterFirst = await readFile(journal, 'utf8');
    const parsedJournal = JSON.parse(journalAfterFirst);
    const intent = parsedJournal.intents?.[0];
    if (!intent || intent.state !== 'COMPLETE') throw Error('MIRROR_INTENT_NOT_COMPLETE');
    const sourceAfter = git(sourceClone, ['rev-parse', 'HEAD']);
    const sourceParent = git(sourceClone, ['rev-parse', `${sourceAfter}^`]);
    const sourceRemoteHead = gitBare(sourceRemote, ['rev-parse', 'refs/heads/main']);
    const pagesAfter = gitBare(pagesRemote, ['rev-parse', 'refs/heads/main']);
    const pagesParent = gitBare(pagesRemote, ['rev-parse', `${pagesAfter}^`]);
    if (sourceParent !== sourceBefore || sourceRemoteHead !== sourceAfter || pagesParent !== pagesBefore || pagesAfter === pagesBefore) throw Error('MIRROR_COMMIT_GRAPH_MISMATCH');
    if (first.evidence?.expectedDueContentIds?.length !== 1 || first.evidence.expectedDueContentIds.join('|') !== first.evidence.emittedContentIds.join('|')) throw Error('MIRROR_DUE_SET_MISMATCH');
    if (first.readback?.failures?.length) throw Error(`MIRROR_LOOPBACK_FAILED:${first.readback.failures.join(',')}`);

    const tree = gitBare(pagesRemote, ['ls-tree', '-r', 'main', '--name-only']).split(/\r?\n/).filter(Boolean);
    const bundle = JSON.parse(originalBundle.toString('utf8')) as any;
    const firstArticle = bundle.articles.find((article: any) => article.plannedPublishAt === at);
    if (!firstArticle) throw Error('FIRST_DUE_ARTICLE_MISSING');
    const futureArticles = bundle.articles.filter((article: any) => article.contentId !== firstArticle.contentId);
    const futurePaths = futureArticles.map((article: any) => article.canonicalPath.replace(/^\//, ''));
    if (!tree.includes(firstArticle.canonicalPath.replace(/^\//, '')) || futurePaths.some((path: string) => tree.includes(path))) throw Error('MIRROR_FUTURE_CONTENT_LEAK');
    const articleBytes = await readFile(join(sourceClone, 'docs', firstArticle.canonicalPath.replace(/^\//, '')));
    const sitemap = await readFile(join(sourceClone, 'docs', 'sitemap.xml'), 'utf8');
    if (!articleBytes.toString('utf8').includes('application/ld+json') || !sitemap.includes(firstArticle.canonicalPath) || futurePaths.some((path: string) => sitemap.includes(path))) throw Error('MIRROR_SEO_READBACK_MISMATCH');
    const rootKeep = gitBare(pagesRemote, ['show', 'main:keep-root.txt']);
    if (rootKeep !== 'keep') throw Error('MIRROR_ROOT_HISTORY_LOST');

    // Exact same projection must be a no-op: no second intent, commit or push.
    const sourceBeforeSecond = sourceAfter;
    const pagesBeforeSecond = pagesAfter;
    const journalBeforeSecond = await readFile(journal, 'utf8');
    const second = runCli(['mirror-rehearse', '--policy', policyCopy, '--root', sourceClone, '--journal', journal, '--root-pages-repo', pagesRemote, '--test-now', at, '--report', join(root, 'evidence', 'mirror-release-second.json')]);
    const journalAfterSecond = await readFile(journal, 'utf8');
    if (!String(second.message).includes('NOOP') || git(sourceClone, ['rev-parse', 'HEAD']) !== sourceBeforeSecond || gitBare(pagesRemote, ['rev-parse', 'refs/heads/main']) !== pagesBeforeSecond || journalAfterSecond !== journalBeforeSecond) throw Error('MIRROR_SECOND_RUN_NOT_NOOP');

    const statusBefore = await readFile(journal, 'utf8');
    const tsxCli = join(siteRepo, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const cli = join(siteRepo, 'scripts', 'seo90-release.ts');
    const statusOutput = execFileSync(process.execPath, [tsxCli, cli, 'status', '--root', sourceClone, '--journal', journal, '--intent', intent.intentId], {cwd: siteRepo, encoding: 'utf8'});
    const statusAfter = await readFile(journal, 'utf8');
    const resumeOutput = execFileSync(process.execPath, [tsxCli, cli, 'resume', '--intent', intent.intentId, '--policy', policyCopy, '--root', sourceClone, '--journal', journal], {cwd: siteRepo, encoding: 'utf8'});
    const resumeAfter = await readFile(journal, 'utf8');
    if (statusAfter.toString() !== statusBefore.toString() || resumeAfter.toString() !== statusBefore.toString()) throw Error('MIRROR_STATUS_RESUME_WROTE');

    const result = {
      schemaVersion: 'sxj.seo90.mirror-rehearsal-report.v1',
      at,
      sourceHead: {before: sourceBefore, after: sourceAfter, parent: sourceParent, remote: sourceRemoteHead},
      pagesMirror: {before: pagesBefore, after: pagesAfter, parent: pagesParent, treeFiles: tree.length},
      dueEvidence: first.evidence,
      first: {state: first.state, intentId: first.intentId, message: first.message, readbackFailures: first.readback?.failures || []},
      second: {state: second.state, message: second.message, noOp: true},
      status: {exit: 0, bytesUnchanged: statusAfter.toString() === statusBefore.toString(), output: statusOutput},
      resume: {exit: 0, bytesUnchanged: resumeAfter.toString() === statusBefore.toString(), output: resumeOutput},
      seoReadback: {jsonLd: true, sitemapDuePresent: true, futurePathsAbsent: true, loopbackFailures: first.readback?.failures || []},
      fixedInputHashes: {bundleSha256: bundleHash, originalPinSha256: sha256(originalPinBytes), isolatedPolicySha256: sha256(policyBytes)},
      formalProductionTouched: false,
      pass: true
    };
    await mkdir(dirname(outputPath), {recursive: true});
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    keepOnFailure = false;
    await rm(root, {recursive: true, force: true});
    console.log(JSON.stringify({pass: true, output: outputPath, sourceBefore, sourceAfter, pagesBefore, pagesAfter, due: first.evidence?.expectedDueContentIds}));
  } catch (error: any) {
    console.error(JSON.stringify({pass: false, error: error?.message || String(error), tempRoot: root, output: outputPath}));
    throw error;
  } finally {
    if (!keepOnFailure) await rm(root, {recursive: true, force: true});
  }
}

main().catch(() => { process.exitCode = 1; });
