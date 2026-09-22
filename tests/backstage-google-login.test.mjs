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
  assert.match(source, /use_fedcm_for_button:\s*false/);
  assert.match(source, /button_auto_select:\s*false/);
  assert.doesNotMatch(source, /use_fedcm_for_prompt/);
  assert.match(html, /id="backstageGoogleButtonMount"/);
  assert.match(html, /id="backstageGoogleButtonFallback"/);
  assert.match(html, /backstage\.js\?v=20260922-google-auth-5/);
  assert.match(css, /\.google-action\[hidden\]\s*\{\s*display:\s*none/);
});

test('Backstage keeps public and admin routes on their deployed prefixes', () => {
  assert.match(source, /function publicApiPath\(path\)\s*\{\s*return `\/api\/v1\$\{path\}`;/);
  assert.match(source, /function adminApiPath\(path\)\s*\{\s*return `\/admin\/api\/v1\$\{path\}`;/);
  assert.doesNotMatch(source, /BACKSTAGE_BASE_HAS_API_PREFIX/);
  assert.doesNotMatch(source, /`\/api\/v1\/admin\/api\/v1/);
});

test('Backstage Google login separates authentication and operator permission failures', () => {
  assert.match(source, /error\?\.status === 403/);
  assert.match(source, /운영자 권한이 없어요/);
  assert.match(source, /error\?\.status === 401/);
  assert.match(source, /Google 로그인 정보 확인에 실패했어요/);
  assert.match(source, /error\?\.status === 429/);
  assert.match(source, /error\?\.status >= 500/);
});
