import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../backstage/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../backstage.css', import.meta.url), 'utf8');

test('Backstage Google login uses an ID credential for authentication', () => {
  assert.match(source, /google\.accounts\.id\.initialize\(\{/);
  assert.match(source, /google\.accounts\.id\.renderButton\(googleButtonMount/);
  assert.match(source, /callback:\s*handleGoogleCredentialResponse/);
  assert.match(source, /token:\s*credentialResponse\.credential/);
  assert.doesNotMatch(source, /initTokenClient/);
  assert.doesNotMatch(source, /tokenResponse\.access_token/);
  assert.doesNotMatch(source, /google\.accounts\.id\.prompt/);
  assert.match(html, /id="backstageGoogleButtonMount"/);
  assert.match(html, /id="backstageGoogleButtonFallback"/);
  assert.match(css, /\.google-action\[hidden\]\s*\{\s*display:\s*none/);
});

test('Backstage Google login separates authentication and operator permission failures', () => {
  assert.match(source, /error\?\.status === 403/);
  assert.match(source, /운영자 권한이 없어요/);
  assert.match(source, /error\?\.status === 401/);
  assert.match(source, /Google 로그인 정보 확인에 실패했어요/);
  assert.match(source, /error\?\.status === 429/);
  assert.match(source, /error\?\.status >= 500/);
});
