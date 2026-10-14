import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../server/src/main.ts', import.meta.url), 'utf8');
test('contract private reads are installed once before routing, parsing, and authentication', () => {
  assert.equal((main.match(/import \{ contentRightsContractPrivacyMiddleware \} from '\.\/story-settlement\/content-rights-contract\.privacy';/g) || []).length, 1);
  assert.equal((main.match(/app\.use\(contentRightsContractPrivacyMiddleware\);/g) || []).length, 1);
  assert.match(main, /app\.use\(chatBoostsPrivacyMiddleware\);\s*app\.use\(contentRightsContractPrivacyMiddleware\);/);
  for (const boundary of ['helmet({', 'configureHttpRouting(app)', 'app.useGlobalPipes(', 'app.enableCors(']) {
    assert(main.indexOf('app.use(contentRightsContractPrivacyMiddleware);') < main.indexOf(boundary));
  }
});
