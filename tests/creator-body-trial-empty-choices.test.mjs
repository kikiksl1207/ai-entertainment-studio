import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext, runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-trial.js', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../pages/creator-body-preview.js', import.meta.url), 'utf8');
const support = readFileSync(new URL('./creator-body-trial.test.mjs', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function section(start, end) {
  const first = support.indexOf(start), last = support.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing trial fixture: ${start}`);
  return support.slice(first, last);
}
// Reuse the existing synthetic fixtures without registering their unrelated tests.
const helpers = [section('const clone =', 'const posts ='), section('const walk =', 'const journalSlot =')].join('\n');
const { screen, mounted, walk, approvalState, preview, response, id, deferred } = runInNewContext(
  `${helpers}; ({ screen, mounted, walk, approvalState, preview, response, id, deferred })`,
  { source, previewSource, assert, createContext, runInContext, TextEncoder, TextDecoder, AbortController },
);
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const notice = view => walk(view.host).find(node => node.id === 'writerBodyTrialNoChoices');
const writes = view => view.calls.filter(call => call.options.method !== 'GET');
for (const locale of locales) {
  test(`${locale}: cross-language no-choice note retains the UI language and saved source language`, async () => {
    const sourceLocale = locale === 'ja' ? 'en' : 'ja';
    const saved = preview(id(1), sourceLocale);
    saved.progress.choices = [];
    saved.progress.currentBeatPosition = 0;
    saved.progress.scene.isGenerated = true;
    const before = plain(saved);
    const view = mounted(call => call.kind === 'preview' ? response(saved) : call.reply(),
      { language: locale, sourceLocale });
    await view.load();
    assert.equal(notice(view)?.lang, locale);
    assert.equal(notice(view)?.textContent, view.api.copy[locale].noChoices);
    assert.equal(walk(view.host).find(node => node.className === 'body-trial-source')?.lang, sourceLocale);
    assert.deepEqual(plain(saved), before);
    assert.ok(view.host.textContent.includes(saved.progress.scene.beats[0].content));
    assert.equal(view.calls.length, 2);
    assert.equal(writes(view).length, 0);
  });
}
function empty({ locale = 'ko', mount = false, unread = false, change, handler, settings } = {}) {
  const approved = approvalState(), saved = preview(id(1), locale);
  saved.progress.choices = [];
  saved.progress.currentBeatPosition = unread ? 0 : 1;
  saved.progress.scene.isGenerated = true;
  change?.({ approved, saved });
  const transport = call => {
    const reply = () => call.kind === 'state' ? response(approved) : call.kind === 'preview' ? response(saved) : call.reply();
    return handler ? handler({ ...call, approved, saved, reply }) : reply();
  };
  const view = mount ? mounted(transport, { language: locale, sourceLocale: locale, ...settings }) : screen(transport, settings);
  if (!mount) { view.set.language(locale); view.set.source(locale); }
  return { view, approved, saved };
}

for (const locale of locales) {
  test(`${locale}: read active body with zero choices explains the gap without assuming a failed request`, async () => {
    const { view, saved } = empty({ locale });
    const before = plain(saved);
    assert.equal(await view.load(), true);
    assert.equal(view.snapshot().messageKey, 'noChoices');
    assert.equal(view.snapshot().canChoose, false);
    assert.equal(view.snapshot().canRecover, true);
    assert.equal(await view.choose(id(6)), false);
    assert.equal(await view.retry(), false);
    assert.deepEqual(plain(view.snapshot().data.preview), before);
    assert.equal(view.calls.length, 2);
    assert.equal(writes(view).length, 0);
    assert.equal(view.keys(), 0);
    assert.ok(view.api.copy[locale].noChoices.length > 20);
    assert.notEqual(view.api.copy[locale].noChoices, view.api.copy[locale].generationFailed);
  });

  test(`${locale}: unread stored body keeps explicit reading and an accessible no-choice note`, async () => {
    const { view } = empty({ locale, unread: true, mount: true });
    await view.load();
    assert.equal(view.host.lang, locale);
    assert.ok(view.host.textContent.includes(view.api.copy[locale].readRequired));
    const note = notice(view);
    assert.ok(note);
    assert.equal(note.getAttribute('role'), 'note');
    assert.equal(note.textContent, view.api.copy[locale].noChoices);
    assert.ok(walk(view.host).some(node => node.id === 'writerBodyTrialRead'));
    assert.equal(view.calls.length, 2);
    assert.equal(writes(view).length, 0);
    assert.equal(view.storage.operations.some(row => row[0] !== 'read'), false);
    assert.ok(view.host.textContent.includes('Private trial text.'));
  });
}

for (const [name, change, key] of [
  ['normal choices', ({ saved }) => { saved.progress.choices = preview().progress.choices; }, 'approval_recorded'],
  ['author ending', ({ saved }) => { saved.progress.scene.endingType = 'author_main'; }, 'ending'],
  ['generated ending', ({ saved }) => { saved.progress.status = 'completed'; saved.progress.scene.endingType = 'ai_generated'; }, 'ending'],
  ['generating', ({ saved }) => { saved.progress.status = 'generating'; }, 'generating'],
  ['no scene', ({ saved }) => { saved.progress.scene = null; }, 'noScene'],
  ['no progress', ({ saved }) => { saved.progress = null; }, 'noProgress'],
]) {
  test(`${name}: empty-choice guidance cannot replace a different progress state`, async () => {
    const { view } = empty({ mount: true, change });
    await view.load();
    assert.ok(view.host.textContent.includes(view.api.copy.ko[key]));
    assert.equal(notice(view), undefined);
    assert.equal(view.host.textContent.includes(view.api.copy.ko.noChoices), false);
    assert.equal(writes(view).length, 0);
  });
}

for (const state of ['approval_expired', 'release_changed', 'cost_unknown', 'budget_over_limit']) {
  test(`${state}: approval and cost blocking retain priority and no dispatch`, async () => {
    const { view } = empty({ change: ({ approved }) => {
      approved.state = state;
      if (state === 'cost_unknown') Object.assign(approved.budget, { unknownCostCount: 1, remainingBudgetKrw: null, evidenceReadyForBudgetCheck: false });
      if (state === 'budget_over_limit') Object.assign(approved.budget, { knownActualCostKrw: '12000.000000', reservedMaximumCostKrw: '0.000000', committedCostKrw: '12000.000000', remainingBudgetKrw: '0.000000' });
    } });
    await view.load();
    assert.equal(view.snapshot().messageKey, state);
    assert.equal(view.snapshot().canChoose, false);
    assert.equal(await view.choose(id(6)), false);
    assert.equal(writes(view).length, 0);
  });
}

for (const [status, key] of [[400, 'invalid'], [401, 'unauthenticated'], [403, 'forbidden'], [409, 'conflict'], [503, 'server']]) {
  test(`${status}: rejected preview cannot expose an empty-choice note or old body`, async () => {
    const { view } = empty({ mount: true, handler: call => call.kind === 'preview' ? response({ private: 'DO_NOT_SHOW' }, status) : call.reply() });
    await view.load();
    assert.ok(view.host.textContent.includes(view.api.copy.ko[key]));
    assert.equal(notice(view), undefined);
    assert.doesNotMatch(view.host.textContent, /Private trial text|DO_NOT_SHOW/);
    assert.equal(writes(view).length, 0);
  });
}

test('a late no-choice preview after owner changes cannot repopulate the old body or guidance', async () => {
  const hold = deferred();
  const { view } = empty({ mount: true, handler: call => call.kind === 'preview' ? hold.promise : call.reply() });
  const task = view.load();
  while (view.calls.length < 2) await Promise.resolve();
  view.setOwner({ ownerId: id(9), epoch: 2 });
  view.window.fire('lumina:authchange');
  const stale = preview(); stale.progress.choices = [];
  hold.resolve(response(stale));
  await task;
  assert.equal(notice(view), undefined);
  assert.doesNotMatch(view.host.textContent, /Private trial text/);
  assert.equal(writes(view).length, 0);
});

test('empty choices keep recent-request recovery explicit and GET-only, without inferring failure', async () => {
  const { view } = empty({ mount: true });
  await view.load();
  assert.equal(view.calls.length, 2);
  assert.ok(view.host.textContent.includes(view.api.copy.ko.noChoices));
  await view.recover();
  assert.equal(view.calls.length, 3);
  assert.ok(view.calls[2].url.endsWith('/body-trial/recovery'));
  assert.equal(view.calls[2].options.method, 'GET');
  assert.ok(view.host.textContent.includes(view.api.copy.ko.recoveryEmpty));
  assert.equal(writes(view).length, 0);
  assert.equal(view.events.length, 0);
});
