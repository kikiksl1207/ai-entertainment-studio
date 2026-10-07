import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const lf = text => text.replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const source = await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8');
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
// Existing non-conflict labels are a small literal fixture, independent of checkout history.
const labels = {
  ko: { checking: '읽기 확인 기록을 확인하고 있습니다.', saving: '읽기 확인을 저장하고 있습니다.', unknown: '읽기 확인 저장 여부를 확인하지 못했습니다.', unavailable: '읽기 확인을 저장할 수 없습니다.', check: '읽기 확인 기록 확인', refresh: '최신 페이지 확인' },
  en: { checking: 'Checking read confirmation.', saving: 'Saving read confirmation.', unknown: 'The read confirmation could not be verified.', unavailable: 'Read confirmation is unavailable.', check: 'Check read confirmation', refresh: 'Check latest page' },
  ja: { checking: '読了確認の記録を確認しています。', saving: '読了確認を保存しています。', unknown: '読了確認の保存を確認できませんでした。', unavailable: '読了確認を保存できません。', check: '読了確認の記録を確認', refresh: '最新ページを確認' },
  'zh-Hans': { checking: '正在核实阅读确认记录。', saving: '正在保存阅读确认。', unknown: '无法核实阅读确认是否已保存。', unavailable: '无法保存阅读确认。', check: '查看阅读确认记录', refresh: '查看最新页面' },
  'zh-Hant': { checking: '正在核實閱讀確認紀錄。', saving: '正在儲存閱讀確認。', unknown: '無法核實閱讀確認是否已儲存。', unavailable: '無法儲存閱讀確認。', check: '查看閱讀確認紀錄', refresh: '查看最新頁面' },
};
const after = {
  ko: '읽기 확인 기준이 변경되었습니다. 최신 페이지를 다시 열어 주세요.',
  en: 'The read confirmation criteria have changed. Please reopen the latest page.',
  ja: '読了確認の基準が変更されました。最新のページを開き直してください。',
  'zh-Hans': '阅读确认标准已更改。请重新打开最新页面。',
  'zh-Hant': '閱讀確認標準已變更。請重新開啟最新頁面。',
};

function copyBlock(text) {
  const matches = [...text.matchAll(/^  const ENDING_READ_COPY = \{\r?\n[\s\S]*?^  \};/gm)];
  assert.equal(matches.length, 1, 'Extract only the actual ENDING_READ_COPY declaration');
  return matches[0][0];
}

function functionBlock(text, name) {
  const matches = [...text.matchAll(new RegExp(`^  (?:async )?function ${name}\\([^\\n]*\\) \\{\\r?\\n[\\s\\S]*?^  \\}`, 'gm'))];
  assert.equal(matches.length, 1, `Extract the original ${name} function`);
  return matches[0][0];
}

function translator(text, locale) {
  const state = { locale };
  const tr = runInNewContext(`${copyBlock(text)}\n${functionBlock(text, 'endingReadTr')}\nendingReadTr;`,
    { state }, { timeout: 1000 });
  return { tr, state };
}

function extractCopy(text) {
  return plain(runInNewContext(`${copyBlock(text)}\nENDING_READ_COPY;`, {}, { timeout: 1000 }));
}

const currentCopy = extractCopy(source);
const expectedCopy = Object.fromEntries(locales.map(locale => [locale, { ...labels[locale], changed: after[locale] }]));
const functionNames = ['endingReadTr', 'endingReadTarget', 'endingReadDisplayed', 'endingReadReceiptMatches',
  'reviewEndingRead', 'prepareEndingRead', 'cancelEndingRead', 'checkEndingRead', 'confirmEndingRead',
  'renderScene', 'loadScene', 'request'];

console.log('Copy extraction and isolated original-function fixtures only; no browser, HTTP, DB, provider, approval, or deployment evidence.');

test('actual-source COPY and function extraction accept LF and CRLF in one run', () => {
  const normalized = lf(source);
  for (const text of [normalized, normalized.replace(/\n/g, '\r\n')]) {
    assert.deepEqual(extractCopy(text), expectedCopy);
    for (const name of functionNames) assert.equal(lf(functionBlock(text, name)), functionBlock(normalized, name));
    for (const locale of locales) {
      const { tr } = translator(text, locale);
      for (const [key, value] of Object.entries(expectedCopy[locale])) assert.equal(tr(key), value);
    }
    assert.equal(translator(text, 'fr').tr('changed'), after.en);
    assert.equal(translator(text, 'fr').tr('missing'), '');
  }
});

test('COPY contains exactly the five locale maps and existing status/action keys', () => {
  assert.deepEqual(Object.keys(currentCopy), locales);
  for (const locale of locales) {
    assert.deepEqual(Object.keys(currentCopy[locale]), ['checking', 'saving', 'unknown', 'changed', 'unavailable', 'check', 'refresh']);
    assert.ok(Object.values(currentCopy[locale]).every(value => typeof value === 'string' && value.length > 0));
  }
});

for (const locale of locales) test(`${locale}: criteria message, existing status/action labels and keys`, () => {
  assert.equal(currentCopy[locale].changed, after[locale]);
  assert.deepEqual(currentCopy[locale], expectedCopy[locale]);
  const { tr } = translator(source, locale);
  for (const [key, value] of Object.entries(currentCopy[locale])) assert.equal(tr(key), value);
  assert.equal(tr('saved'), '', 'Saved/confirm-read labels still belong to the original reader copy');
  assert.equal(tr('missing'), '');
});

test('original English fallback and empty missing-key fallback remain unchanged', () => {
  assert.deepEqual(Object.keys(currentCopy), locales, 'No locale or hidden copy field added');
  for (const locale of [undefined, null, '', 'fr', 'zh', 'en-US']) {
    const { tr } = translator(source, locale);
    for (const [key, value] of Object.entries(expectedCopy.en)) {
      assert.equal(tr(key), value);
    }
    assert.equal(tr('not-a-status'), '');
  }
});

test('actual JSON, status, permission boundary and explicit refresh wiring retain their contracts', () => {
  const flow = functionBlock(source, 'checkEndingRead');
  assert.ok(flow.includes('journal.status = error?.status === 409 ? "changed" :'));
  assert.ok(flow.includes('if (error?.status === 401 || error?.status === 403) return blockScene(errorCopy(error));'));
  assert.ok(flow.includes('method: "POST", auth: true, signal: operation.controller.signal, _retried: true, cache: "no-store"'));
  assert.ok(flow.includes('body: { locale: target.locale, fromPosition: target.fromPosition, expectedRevision: preview.expectedRevision,'));
  assert.ok(flow.includes('expectedScopeChecksum: preview.scopeChecksum, expectedSourceTextHash: preview.sourceTextHash,'));
  assert.ok(flow.includes('idempotencyKey: key, displayedAndRead: true }'));
  const render = functionBlock(source, 'renderScene');
  assert.ok(render.includes('<p data-story-ending-read-status role="status">${escapeHtml(["idle", "saved"].includes(endingStatus) ? "" : endingReadTr(endingStatus))}</p>'));
  assert.ok(render.includes('["checking", "saving", "changed", "unavailable"].includes(endingStatus) ? "disabled" : ""'));
  assert.ok(render.includes('endingStatus === "unknown" ? endingReadTr("check") : readerTr("confirmRead")'));
  assert.ok(render.includes('["changed", "unavailable"].includes(endingStatus) ? `<button'));
  assert.ok(render.includes('data-story-ending-read-refresh'));
  assert.ok(render.includes('escapeHtml(endingReadTr("refresh"))'));
  assert.ok(source.includes('if (event.target.closest("[data-story-ending-read]")) return confirmEndingRead();'));
  assert.ok(source.includes('if (event.target.closest("[data-story-ending-read-refresh]")) return loadScene();'));
  assert.ok(source.includes('["progressMutated", "generationStarted", "imageGenerationStarted", "meaningApproved", "qualityApproved", "publicationStarted"]'));
});

test('the isolated original 409 branch selects changed without retry, write or auth escalation', async () => {
  const journal = { key: 'fixture', status: 'idle', receipt: null, posted: false };
  const state = { locale: 'en', endingRead: journal, endingReadOperation: null, epoch: 1,
    operation: 1, busy: false, resetPreview: null, progress: { revision: 7 } };
  const target = { key: 'fixture', readingKey: 'page', onFinalPage: true, revision: 7 };
  const article = {}, status = { textContent: '' };
  const calls = { review: 0, request: 0, render: 0, timers: 0, cleared: 0, blocked: 0, explicit: 0 };
  const check = runInNewContext(`${copyBlock(source)}\n${functionBlock(source, 'endingReadTr')}\n${functionBlock(source, 'checkEndingRead')}\ncheckEndingRead;`, {
    state, AbortController, window: {},
    root: { isConnected: true, querySelector: selector => selector.endsWith('status]') ? status : article },
    endingReadTarget: () => target, prepareEndingRead: () => journal, endingReadDisplayed: () => true,
    aiRequestOpen: () => false, readerIdentity: () => 'isolated-fixture',
    setTimeout: () => ++calls.timers, clearTimeout: () => ++calls.cleared,
    reviewEndingRead: async () => { ++calls.review; throw { status: 409 }; },
    request: () => { ++calls.request; assert.fail('Conflict must not write or retry'); },
    renderScene: () => ++calls.render,
    blockScene: () => { ++calls.blocked; assert.fail('409 must not become a permission grant or auth flow'); },
    errorCopy: () => '', beginOperation: () => { ++calls.explicit; return 1; },
    finishOperation: () => assert.fail('Read-only check has no explicit operation'),
    cancelEndingRead: () => assert.fail('The fixture stays current'),
  }, { timeout: 1000 });
  await check();
  assert.equal(journal.status, 'changed');
  assert.equal(journal.receipt, null);
  assert.equal(journal.posted, false);
  assert.equal(state.endingReadOperation, null);
  assert.deepEqual(calls, { review: 1, request: 0, render: 1, timers: 1, cleared: 1, blocked: 0, explicit: 0 });
  assert.equal(translator(source, state.locale).tr(journal.status), after.en);
});

test('original confirm guard cannot turn changed status into a new confirmation workflow', async () => {
  const state = { endingRead: null }, calls = [];
  const confirm = runInNewContext(`${functionBlock(source, 'confirmEndingRead')}\nconfirmEndingRead;`,
    { state, checkEndingRead: (...args) => calls.push(args) }, { timeout: 1000 });
  for (const status of ['changed', 'unavailable', 'saved']) {
    state.endingRead = { status };
    await confirm();
  }
  assert.deepEqual(calls, []);
  state.endingRead = { status: 'unknown' };
  await confirm();
  assert.deepEqual(calls, [[]], 'Existing unknown path stays read-only');
  state.endingRead = { status: 'idle' };
  await confirm();
  assert.deepEqual(calls, [[], [true]], 'Existing explicit path unchanged');
});
