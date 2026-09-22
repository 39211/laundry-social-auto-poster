import {getOption, isMain} from '../src/cli';
import {readReleaseJournal} from '../src/seo90/releaseJournal';
import {runRelease, runRehearsal, runMirrorRehearsal} from '../src/seo90/releaseRunner';
import {join, resolve, isAbsolute} from 'node:path';

function projectDefaultPin(root: string): string {
  return resolve(root, '..', 'notebook-seo-integration', 'RELEASE-PIN.json');
}
function projectDefaultJournal(root: string): string {
  return resolve(root, '..', 'notebook-seo-integration', 'seo90-release-journal.json');
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] || 'run';
  const root = resolve(getOption(args, 'root') || process.cwd());
  const pinPath = resolve(getOption(args, 'policy') || getOption(args, 'pin') || projectDefaultPin(root));
  const journalPath = resolve(getOption(args, 'journal') || projectDefaultJournal(root));
  if (command === 'rehearse') {
    const at = getOption(args, 'at') || getOption(args, 'test-now');
    if (!at || !Number.isFinite(Date.parse(at))) throw Error('rehearse requires --at=<ISO timestamp>');
    const report = resolve(getOption(args, 'report') || join(dirnameFor(root), 'notebook-seo-integration', `seo90-rehearsal-${Date.now()}.json`));
    const result = await runRehearsal({root, pinPath, journalPath: `${journalPath}.rehearsal`, at: new Date(at), reportPath: report});
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'mirror-rehearse') {
    const at = getOption(args, 'at') || getOption(args, 'test-now');
    if (!at || !Number.isFinite(Date.parse(at))) throw Error('mirror-rehearse requires --test-now=<ISO timestamp>');
    const rootPagesRepo = getOption(args, 'root-pages-repo') || getOption(args, 'mirror');
    if (!rootPagesRepo || !isAbsolute(resolve(rootPagesRepo))) throw Error('mirror-rehearse requires an absolute local --root-pages-repo');
    const report = resolve(getOption(args, 'report') || join(dirnameFor(root), 'notebook-seo-integration', `seo90-mirror-rehearsal-${Date.now()}.json`));
    const result = await runMirrorRehearsal({root, pinPath, journalPath, at: new Date(at), rootPagesRepo, reportPath: report});
    console.log(JSON.stringify(result, null, 2));
    if (result.state === 'UNKNOWN' || result.state === 'HOLD') process.exitCode = 2;
    return;
  }
  if (command === 'status') {
    const journal = await readReleaseJournal(journalPath);
    const intentId = getOption(args, 'intent');
    const intents = intentId ? journal.intents.filter((intent) => intent.intentId === intentId) : journal.intents;
    if (intentId && intents.length === 0) throw Error('SEO90_RELEASE_INTENT_NOT_FOUND');
    console.log(JSON.stringify({schemaVersion: journal.schemaVersion, pending: intents.filter((intent) => !['COMPLETE', 'HOLD'].includes(intent.state)).map((intent) => intent.intentId), intents}, null, 2));
    return;
  }
  if (command !== 'run' && command !== 'resume' && command !== 'reconcile') throw Error(`Unknown command: ${command}`);
  const intentId = getOption(args, 'intent');
  if (command === 'resume' && !intentId) throw Error('resume requires --intent=<intent-id>');
  const result = await runRelease({root, pinPath, journalPath, intentId: intentId || undefined});
  console.log(JSON.stringify(result, null, 2));
  if (result.state === 'UNKNOWN' || result.state === 'HOLD') process.exitCode = 2;
}

function dirnameFor(root: string): string {
  return resolve(root, '..');
}

if (isMain(import.meta.url)) main().catch((error) => { console.error(error); process.exitCode = 1; });
