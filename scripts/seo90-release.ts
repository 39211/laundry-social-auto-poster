import {getOption, isMain} from '../src/cli';
import {runRelease, runRehearsal} from '../src/seo90/releaseRunner';
import {join, resolve} from 'node:path';

function projectDefaultPin(root: string): string {
  return resolve(root, '..', 'notebook-seo-integration', 'RELEASE-PIN.json');
}
function projectDefaultJournal(root: string): string {
  return resolve(root, '..', 'notebook-seo-integration', 'seo90-release-journal.json');
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] || 'run';
  const root = resolve(getOption(args, 'root') || process.cwd());
  const pinPath = resolve(getOption(args, 'pin') || projectDefaultPin(root));
  const journalPath = resolve(getOption(args, 'journal') || projectDefaultJournal(root));
  if (command === 'rehearse') {
    const at = getOption(args, 'at');
    if (!at || !Number.isFinite(Date.parse(at))) throw Error('rehearse requires --at=<ISO timestamp>');
    const report = resolve(getOption(args, 'report') || join(dirnameFor(root), 'notebook-seo-integration', `seo90-rehearsal-${Date.now()}.json`));
    const result = await runRehearsal({root, pinPath, journalPath: `${journalPath}.rehearsal`, at: new Date(at), reportPath: report});
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command !== 'run' && command !== 'reconcile') throw Error(`Unknown command: ${command}`);
  const result = await runRelease({root, pinPath, journalPath});
  console.log(JSON.stringify(result, null, 2));
  if (result.state === 'UNKNOWN' || result.state === 'HOLD') process.exitCode = 2;
}

function dirnameFor(root: string): string {
  return resolve(root, '..');
}

if (isMain(import.meta.url)) main().catch((error) => { console.error(error); process.exitCode = 1; });
