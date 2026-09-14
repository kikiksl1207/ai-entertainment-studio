import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../pages/creator-studio.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/creator-studio.css', import.meta.url), 'utf8');
const dictionary = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const workId = '11111111-1111-4111-8111-111111111111';

class Element {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.classList = { toggle() {}, contains() { return false; } };
  }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  fire(type) { return this.listeners[type]?.({ target: this }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  focus() {}
  setSelectionRange(start) { this.selectionStart = start; }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const result = child.find(predicate);
      if (result) return result;
    }
    return null;
  }
}

function page(fetch) {
  const ids = ['studioShell', 'writerManuscriptWork', 'writerManuscriptLocale',
    'writerManuscriptExpected', 'writerManuscriptBody', 'writerManuscriptParts',
    'writerManuscriptState', 'writerManuscriptBoundary', 'writerManuscriptConfirm',
    'writerManuscriptSubmit', 'writerManuscriptFile', 'writerManuscriptAddPart',
    'writerManuscriptReview', 'writerManuscriptClear'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  elements.writerManuscriptWork.value = workId;
  elements.writerManuscriptLocale.value = 'ko';
  const document = {
    getElementById: id => elements[id] || null,
    createElement: () => new Element(),
    querySelectorAll: selector => selector.startsWith('#writer-manuscript ')
      ? Object.values(elements).filter(el => !['studioShell', 'writerManuscriptParts', 'writerManuscriptState', 'writerManuscriptBoundary'].includes(el.id))
        .concat(elements.writerManuscriptParts.children.flatMap(section => section.children.flatMap(child => child.children)))
      : [],
    querySelector: () => null,
    addEventListener() {}
  };
  const localStorage = { getItem: key => key === 'lumina_auth'
    ? JSON.stringify({ accessToken: 'test-token', user: { id: 'test-user' } }) : null };
  const context = { document, window: { LUMINA_API_BASE: 'https://example.invalid',
    luminaI18n: { t: key => key }, addEventListener() {} }, localStorage,
    sessionStorage: { getItem: () => null }, location: { hash: '' }, fetch,
    TextEncoder, Blob, FormData, URLSearchParams, AbortController, Option: Element,
    setTimeout, clearTimeout, console };
  const verifyCall = script.lastIndexOf('  verify();');
  assert.ok(verifyCall > 0, 'test loads the real writer handlers');
  const injected = script.slice(0, verifyCall) +
    '  globalThis.writerTest = { writerBodyEdited, addWriterPart, reviewWriterParts, submitWriterManuscript, syncWriterSubmit };' +
    script.slice(verifyCall + '  verify();'.length);
  vm.runInNewContext(injected, context, { filename: 'creator-studio.js' });
  return { elements, writer: context.writerTest };
}

function prepareTwoParts(screen, body = '첫째😀\r\n둘째\r\n') {
  const { elements, writer } = screen;
  elements.writerManuscriptBody.value = body;
  writer.writerBodyEdited();
  elements.writerManuscriptBody.selectionStart = '첫째😀\r\n'.length;
  writer.addWriterPart();
  const titles = elements.writerManuscriptParts.children.map(section =>
    section.find(el => el.maxLength === 240));
  titles[0].value = '첫 파트'; titles[0].fire('input');
  titles[1].value = '둘째 파트'; titles[1].fire('input');
  elements.writerManuscriptExpected.value = '2';
  writer.reviewWriterParts();
  return body;
}

test('review and explicit confirmation gate one exact multipart POST', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const screen = page(async (url, options) => { calls.push({ url, options }); await gate;
    return { ok: true, json: async () => ({ manuscript: { workId, locale: 'ko', version: 3 },
      received: { sourceKind: 'utf8_paste', byteLength: new TextEncoder().encode(body).byteLength, parts: 2 },
      analysisStarted: false, idempotentReplay: false }) }; });
  const body = prepareTwoParts(screen);
  const { elements, writer } = screen;
  assert.equal(elements.writerManuscriptSubmit.disabled, true);
  assert.equal(calls.length, 0);
  await writer.submitWriterManuscript();
  assert.equal(calls.length, 0);
  elements.writerManuscriptConfirm.checked = true;
  elements.writerManuscriptConfirm.fire('change');
  assert.equal(elements.writerManuscriptSubmit.disabled, false);
  const pending = writer.submitWriterManuscript();
  await writer.submitWriterManuscript();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://example.invalid/api/v1/me/creator-studio/stories/${workId}/manuscripts/paste`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(Object.keys(calls[0].options.headers).length, 1, 'browser sets multipart boundary');
  assert.equal(await calls[0].options.body.get('manuscript').text(), body);
  assert.deepEqual(JSON.parse(calls[0].options.body.get('manifest')), {
    locale: 'ko', confirmed: true, parts: [
      { partKey: 'part-1', title: '첫 파트', start: 0, end: '첫째😀\r\n'.length },
      { partKey: 'part-2', title: '둘째 파트', start: '첫째😀\r\n'.length, end: body.length }
    ]
  });
  release();
  await pending;
  assert.match(elements.writerManuscriptState.textContent, /writerManuscript\.received/);
  assert.equal(elements.writerManuscriptSubmit.disabled, true);
});

test('changed source invalidates review; server rejection permits a checked retry', async () => {
  const calls = [];
  const screen = page(async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) return { ok: false, status: 400 };
    return { ok: true, json: async () => ({ manuscript: { workId, locale: 'ko', version: 4 },
      received: { sourceKind: 'utf8_paste', byteLength: new TextEncoder().encode(screen.elements.writerManuscriptBody.value).byteLength, parts: 2 },
      analysisStarted: false, idempotentReplay: true }) };
  });
  prepareTwoParts(screen);
  const { elements, writer } = screen;
  elements.writerManuscriptWork.value = '22222222-2222-4222-8222-222222222222';
  elements.writerManuscriptWork.fire('change');
  elements.writerManuscriptConfirm.checked = true;
  await writer.submitWriterManuscript();
  assert.equal(calls.length, 0);
  elements.writerManuscriptWork.value = workId;
  writer.reviewWriterParts();
  elements.writerManuscriptConfirm.checked = true;
  elements.writerManuscriptConfirm.fire('change');
  await writer.submitWriterManuscript();
  assert.match(elements.writerManuscriptState.textContent, /writerManuscript\.rejected/);
  assert.equal(elements.writerManuscriptSubmit.disabled, false);
  await writer.submitWriterManuscript();
  assert.equal(calls.length, 2);
  assert.match(elements.writerManuscriptState.textContent, /writerManuscript\.receivedReplay/);
});

test('stale work, body, locale, and edited part title cannot POST', async () => {
  for (const change of [
    elements => { elements.writerManuscriptWork.value = '22222222-2222-4222-8222-222222222222'; },
    elements => { elements.writerManuscriptBody.value += 'extra'; },
    elements => { elements.writerManuscriptLocale.value = 'ja'; },
    elements => { const title = elements.writerManuscriptParts.children[0].find(el => el.maxLength === 240);
      title.value = 'changed'; title.fire('input'); }
  ]) {
    let posts = 0;
    const screen = page(async () => { posts++; throw new Error('unexpected POST'); });
    prepareTwoParts(screen);
    screen.elements.writerManuscriptConfirm.checked = true;
    change(screen.elements);
    await screen.writer.submitWriterManuscript();
    assert.equal(posts, 0);
    assert.equal(screen.elements.writerManuscriptSubmit.disabled, true);
  }
});

test('editing a split draft keeps parts visible but revokes confirmation', async () => {
  let posts = 0;
  const screen = page(async () => { posts++; throw new Error('unexpected POST'); });
  prepareTwoParts(screen);
  screen.elements.writerManuscriptConfirm.checked = true;
  screen.elements.writerManuscriptBody.value += '추가';
  screen.elements.writerManuscriptBody.fire('input');
  assert.equal(screen.elements.writerManuscriptParts.children.length, 2);
  assert.equal(screen.elements.writerManuscriptConfirm.checked, false);
  assert.equal(screen.elements.writerManuscriptSubmit.disabled, true);
  await screen.writer.submitWriterManuscript();
  assert.equal(posts, 0);
});

test('an incomplete server receipt is never shown as success', async () => {
  const screen = page(async () => ({ ok: true, json: async () => ({ manuscript: { workId, locale: 'ko', version: 1 } }) }));
  prepareTwoParts(screen);
  screen.elements.writerManuscriptConfirm.checked = true;
  await screen.writer.submitWriterManuscript();
  assert.match(screen.elements.writerManuscriptState.textContent, /writerManuscript\.invalidReceipt/);
  assert.doesNotMatch(screen.elements.writerManuscriptState.textContent, /writerManuscript\.received/);
});

test('five-locale copy and narrow mobile layout remain wired', () => {
  for (const key of ['confirm', 'submit', 'received', 'rejected', 'requestFailed']) {
    const row = dictionary.split(/\r?\n/).find(line => line.includes(`"writerManuscript.${key}":`));
    assert.ok(row, key);
    for (const locale of ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant']) {
      assert.match(row, new RegExp(`"${locale}"\\s*:`));
    }
  }
  assert.match(html, /id="writerManuscriptConfirm"[^>]*disabled/);
  assert.match(html, /id="writerManuscriptSubmit"[^>]*disabled/);
  assert.match(css, /\.writer-manuscript-confirm\s*\{[^}]*overflow-wrap:\s*anywhere/);
  const mobile = css.slice(css.lastIndexOf('@media (max-width: 680px)'));
  assert.ok(mobile.includes('.page-creator-studio .composer-tools button,'));
  assert.ok(mobile.includes('flex: 1 1 100%;'));
});
