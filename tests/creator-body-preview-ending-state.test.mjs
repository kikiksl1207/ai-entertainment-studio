import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext, runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-preview.js', import.meta.url), 'utf8');
const support = readFileSync(new URL('./creator-body-preview.test.mjs', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function section(text, start, end) {
  const first = text.indexOf(start), last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing preview fixture: ${start}`);
  return text.slice(first, last);
}

// Reuse the existing synthetic mount fixture without registering its test suite.
const fixtures = [
  section(support, 'const clone =', "test('entry adds one unframed mount"),
  section(support, 'const walk =', "test('mount is idle; only the icon button loads"),
].join('\n');
const { mounted, body, response, walk } = runInNewContext(`${fixtures}; ({ mounted, body, response, walk })`, {
  source, assert, createContext, runInContext, TextEncoder, TextDecoder, AbortController,
});

const labels = {
  ko: { completed: '\uc5d4\ub529 \ub3c4\ub2ec', old: '\uc644\ub3c5',
    active: '\uc77d\ub294 \uc911', pending: '\uc0dd\uc131 \ub300\uae30 \ub610\ub294 \uc0dd\uc131 \uc911' },
  en: { completed: 'Ending reached', old: 'Finished reading', active: 'Reading', pending: 'Pending or generating' },
  ja: { completed: '\u30a8\u30f3\u30c7\u30a3\u30f3\u30b0\u306b\u5230\u9054', old: '\u8aad\u4e86',
    active: '\u8aad\u66f8\u4e2d', pending: '\u751f\u6210\u5f85\u3061\u3001\u307e\u305f\u306f\u751f\u6210\u4e2d' },
  'zh-Hans': { completed: '\u5df2\u5230\u8fbe\u7ed3\u5c40', old: '\u5df2\u8bfb\u5b8c',
    active: '\u9605\u8bfb\u4e2d', pending: '\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d' },
  'zh-Hant': { completed: '\u5df2\u5230\u9054\u7d50\u5c40', old: '\u5df2\u8b80\u5b8c',
    active: '\u95b1\u8b80\u4e2d', pending: '\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d' },
};

async function load(value, locale) {
  const before = plain(value);
  const view = mounted(() => response(value));
  view.locale(locale);
  view.window.fire('lumina:localechange');
  const parsed = view.api.parsePreview(value, { workId: value.workId, locale: value.locale });
  assert.deepEqual(plain(parsed), before);
  assert.equal(view.calls.length, 0);
  await view.click();
  assert.equal(view.calls.length, 1);
  assert.equal(view.calls[0].url, `/api/v1/me/creator-studio/stories/${value.workId}/body-preview?locale=${value.locale}`);
  assert.equal(view.calls[0].options.method, 'GET');
  assert.equal(view.calls[0].options.body, undefined);
  assert.equal(view.refreshPosts(), 0);
  assert.deepEqual(plain(value), before);
  assert.equal(view.host.lang, locale);
  assert.equal(walk(view.host).filter(node => node.tagName === 'BUTTON').length, 1);
  const metadata = walk(view.host).find(node => node.className === 'body-preview-metadata');
  assert.ok(metadata, 'production mount rendered parsed progress metadata');
  return { view, parsed, status: metadata.children[0].children[1].textContent };
}

for (const [locale, expected] of Object.entries(labels)) {
  test(`${locale}: completed at cursor zero means ending reached, not finished reading`, async () => {
    for (const endingType of ['author_main', 'author_sub', 'ai_generated']) {
      const value = body();
      Object.assign(value.progress, { status: 'completed', currentBeatPosition: 0, choices: [] });
      Object.assign(value.progress.scene, { endingType, isGenerated: endingType === 'ai_generated' });
      const { view, parsed, status } = await load(value, locale);
      assert.equal(parsed.progress.status, 'completed');
      assert.equal(parsed.progress.currentBeatPosition, 0);
      assert.equal(view.api.copy[locale].statusCompleted, expected.completed);
      assert.equal(status, expected.completed);
      assert.equal(view.host.textContent.includes(expected.old), false);
      assert.equal(view.host.textContent.includes('Finished reading'), false);
      assert.equal(view.host.textContent.includes('\uc644\ub3c5'), false);
    }
  });

  test(`${locale}: active and pending engine states retain their existing labels`, async () => {
    for (const state of ['active', 'pending', 'ai_pending', 'pending_generation', 'generating']) {
      const value = body();
      Object.assign(value.progress, { status: state, currentBeatPosition: 0 });
      if (state !== 'active') value.progress.scene.endingType = 'author_main';
      const { view, parsed, status } = await load(value, locale);
      assert.equal(parsed.progress.status, state);
      assert.equal(parsed.progress.currentBeatPosition, 0);
      assert.equal(status, state === 'active' ? expected.active : expected.pending);
      assert.equal(view.api.copy[locale].statusActive, expected.active);
      assert.equal(view.api.copy[locale].statusPending, expected.pending);
      assert.equal(status.includes(expected.completed), false);
      if (state !== 'active') {
        assert.equal(walk(view.host).find(node => node.className === 'body-preview-state').textContent,
          view.api.copy[locale].generating);
      }
    }
  });
}
