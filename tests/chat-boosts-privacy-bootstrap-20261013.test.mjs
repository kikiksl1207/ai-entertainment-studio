import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../server/src/main.ts', import.meta.url), 'utf8');
test('chat and paid-like privacy is installed once before routing, parsers and guards', () => {
  assert.equal((main.match(/import \{ chatBoostsPrivacyMiddleware \} from '\.\/common\/chat-boosts-privacy';/g) || []).length, 1);
  assert.equal((main.match(/app\.use\(chatBoostsPrivacyMiddleware\);/g) || []).length, 1);
  assert.match(main, /app\.use\(rewardsPrivacyMiddleware\);\s*app\.use\(chatBoostsPrivacyMiddleware\);/);
  assert(main.indexOf('app.use(chatBoostsPrivacyMiddleware);') < main.indexOf('helmet({'));
  assert(main.indexOf('app.use(chatBoostsPrivacyMiddleware);') < main.indexOf('configureHttpRouting(app)'));
  assert(main.indexOf('app.use(chatBoostsPrivacyMiddleware);') < main.indexOf('app.enableCors('));
});
