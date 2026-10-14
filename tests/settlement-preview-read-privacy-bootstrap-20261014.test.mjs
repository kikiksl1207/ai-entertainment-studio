import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../server/src/main.ts', import.meta.url), 'utf8');
test('settlement private reads are installed once before routing, parsing, and authentication', () => {
  assert.equal((main.match(/import \{ settlementPreviewPrivacyMiddleware \} from '\.\/story-settlement\/settlement-preview\.privacy';/g) || []).length, 1);
  assert.equal((main.match(/app\.use\(settlementPreviewPrivacyMiddleware\);/g) || []).length, 1);
  assert.match(main, /app\.use\(contentRightsContractPrivacyMiddleware\);\s*app\.use\(settlementPreviewPrivacyMiddleware\);/);
  for (const boundary of ['helmet({', 'configureHttpRouting(app)', 'app.useGlobalPipes(', 'app.enableCors(']) {
    assert(main.indexOf('app.use(settlementPreviewPrivacyMiddleware);') < main.indexOf(boundary));
  }
});
