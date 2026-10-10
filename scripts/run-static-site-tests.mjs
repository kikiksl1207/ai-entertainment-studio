import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const browserTests = new Set([
  'character-public-pages.test.mjs',
  'story-stage-first-release.test.mjs',
]);
const tests = readdirSync(new URL('../tests/', import.meta.url))
  .filter((name) => (name.endsWith('.test.mjs') || name.endsWith('.test.cjs')) && !name.includes('.browser.') && !browserTests.has(name))
  .sort()
  .map((name) => `tests/${name}`);

if (!tests.length) throw new Error('No static site tests found');
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
