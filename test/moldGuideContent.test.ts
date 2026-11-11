import { describe, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { moldGuideChecks } from '../scripts/mold-guide-regression.mjs';

describe('Mold guide content regression safeguards', () => {
  for (const { name, run } of moldGuideChecks(fileURLToPath(new URL('../', import.meta.url)))) {
    it(name, run);
  }
});
