import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../story-upload/index.html', import.meta.url), 'utf8');
const upload = readFileSync(new URL('../pages/story-upload.js', import.meta.url), 'utf8');
const locales = ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant'];

function translations(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = app.match(new RegExp(`"${escaped}"\\s*:\\s*(\\{[^}]+\\})`));
  assert.ok(match, `${key} is defined`);
  return JSON.parse(match[1]);
}

test('story-upload title and footer have five localized values', () => {
  for (const key of ['story.upload.documentTitle', 'footer.tagline']) {
    const copy = translations(key);
    assert.deepEqual(Object.keys(copy).sort(), locales.slice().sort());
    assert.equal(new Set(Object.values(copy)).size, locales.length);
    assert.ok(Object.values(copy).every(Boolean));
  }
});

test('story-upload binds title and footer to locale updates', () => {
  assert.match(html, /<title data-i18n="story\.upload\.documentTitle">최종 원고 업로드 \| Lumina Stage<\/title>/);
  assert.match(html, /<p data-i18n="footer\.tagline">아티스트와 팬이 같은 무대에서 만나는 공간입니다\.<\/p>/);
  assert.match(app, /async function setLocale\(locale\)[\s\S]*?applyI18n\(\)/);
  assert.match(app, /async function initI18n\(\)[\s\S]*?applyI18n\(\)/);
  assert.doesNotMatch(html, /Artists and fans meet on the same stage\./);
});

test('upload confirmation distinguishes review intake from publication and prepared AI branches', () => {
  const confirmations = [...upload.matchAll(/submittedBody: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(confirmations.length, 5);
  for (const confirmation of confirmations) {
    assert.match(confirmation, /AI/);
    assert.match(confirmation, /[.!。]$/);
  }
  assert.match(confirmations[1], /Submission does not publish the story or prepare AI branches/);
  assert.match(upload, /function renderSuccess\(\)[\s\S]*?<p>\$\{escapeHtml\(tr\("submittedBody"\)\)\}<\/p>/);
});
