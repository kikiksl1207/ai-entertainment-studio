import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../pages/creator-studio.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/creator-studio.css', import.meta.url), 'utf8');
const dictionary = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const workId = '11111111-1111-4111-8111-111111111111';
const manuscriptId = '33333333-3333-4333-8333-333333333333';
const contentHash = 'a'.repeat(64);

class Element {
  constructor(id = '', optionValue = '') {
    this.id = id;
    this.value = optionValue;
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
  add(child) { this.children.push(child); }
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

function page(fetch, uuidFactory = () => '55555555-5555-4555-8555-555555555555') {
  const ids = ['studioShell', 'writerManuscriptWork', 'writerManuscriptLocale',
    'writerDraftTitle', 'writerDraftCreate', 'writerDraftState',
    'writerDraftMetadata', 'writerMetadataAuthor', 'writerMetadataSummary',
    'writerMetadataCover', 'writerMetadataSave', 'writerMetadataState',
    'writerManuscriptExpected', 'writerManuscriptBody', 'writerManuscriptParts',
    'writerManuscriptState', 'writerManuscriptBoundary', 'writerManuscriptPreface',
    'writerManuscriptPrefaceChoice', 'writerManuscriptSeparatePreface', 'writerManuscriptConfirm',
    'writerManuscriptSubmit', 'writerManuscriptFile', 'writerManuscriptAddPart',
    'writerManuscriptAutoParts', 'writerManuscriptReview', 'writerManuscriptClear'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  elements.writerManuscriptWork.value = workId;
  elements.writerManuscriptLocale.value = 'ko';
  const document = {
    getElementById: id => elements[id] || null,
    createElement: () => new Element(),
    querySelectorAll: selector => selector.startsWith('#writer-manuscript ')
      ? Object.values(elements).filter(el => !['studioShell', 'writerManuscriptParts', 'writerManuscriptState', 'writerManuscriptBoundary', 'writerManuscriptPreface'].includes(el.id))
        .concat(elements.writerManuscriptParts.children.flatMap(section => section.children.flatMap(child => child.children)))
      : [],
    querySelector: () => null,
    addEventListener() {}
  };
  const storage = new Map([['lumina_auth', JSON.stringify({ accessToken: 'test-token', user: { id: 'test-user' } })]]);
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const context = { document, window: { LUMINA_API_BASE: 'https://example.invalid',
    luminaI18n: { t: key => key }, addEventListener() {} }, localStorage,
    sessionStorage: { getItem: () => null }, location: { hash: '' }, fetch,
    TextEncoder, Blob, FormData, URLSearchParams, AbortController, DOMException, Option: Element,
    setTimeout, clearTimeout, console, crypto: { randomUUID: uuidFactory } };
  const verifyCall = script.lastIndexOf('  verify();');
  assert.ok(verifyCall > 0, 'test loads the real writer handlers');
  const injected = script.slice(0, verifyCall) +
    '  globalThis.writerTest = { writerInput, writerBodyEdited, autoWriterParts, addWriterPart, reviewWriterParts, submitWriterManuscript, syncWriterSubmit, createWriterDraft, loadWriterWorks, saveWriterMetadata };' +
    script.slice(verifyCall + '  verify();'.length);
  vm.runInNewContext(injected, context, { filename: 'creator-studio.js' });
  return { elements, writer: context.writerTest, window: context.window, storage };
}

test('new writer can create and select a private work before submitting a manuscript', async () => {
  const newWorkId = '66666666-6666-4666-8666-666666666666';
  const calls = [];
  const screen = page(async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') return { ok: true, json: async () => ({
      workId: newWorkId, slug: 'draft-55555555-5555-4555-8555-555555555555', status: 'draft' }) };
    return { ok: true, json: async () => ({ items: [{ workId: newWorkId,
      title: { value: '새 원고' }, permissions: { createManuscript: true } }], nextCursor: null }) };
  });
  screen.elements.writerDraftTitle.value = '  새 원고  ';
  await screen.writer.createWriterDraft();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://example.invalid/api/v1/me/creator-studio/stories');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    requestId: '55555555-5555-4555-8555-555555555555', title: '새 원고', locale: 'ko' });
  assert.equal(screen.elements.writerManuscriptWork.value, newWorkId);
  assert.equal(screen.elements.writerManuscriptWork.disabled, false);
  assert.match(screen.elements.writerDraftState.textContent, /writerManuscript\.draftCreated/);
});

test('draft publication details upload a real cover before saving author and summary', async () => {
  const assetId = '88888888-8888-4888-8888-888888888888';
  const calls = [];
  let saved = false;
  const screen = page(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/upload-intents')) return { ok: true, json: async () => ({
      asset: { id: assetId }, upload: { mode: 'direct_upload_ready', method: 'PUT',
        url: 'https://upload.example.invalid/cover', requiredHeaders: { 'content-type': 'image/png' } }
    }) };
    if (url === 'https://upload.example.invalid/cover') return { ok: true };
    if (url.endsWith(`/assets/${assetId}/confirm-upload`)) return { ok: true, json: async () => ({
      asset: { id: assetId, uploadStatus: 'uploaded' }
    }) };
    if (url.endsWith(`/stories/${workId}/metadata`)) {
      saved = true;
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ items: [{ workId,
      slug: 'draft-99999999-9999-4999-8999-999999999999',
      title: { value: '새 작품' }, publication: { status: 'draft', published: false },
      authorDisplayName: saved ? '루미나' : null,
      summary: saved ? { value: 'Different locale description' } : { value: '' },
      publicationSummary: saved ? { value: '새 작품 소개' } : { value: '' },
      cover: saved ? { assetId, url: `/api/v1/assets/public/${assetId}/display` } : null,
      permissions: { createManuscript: true } }], nextCursor: null }) };
  });
  await screen.writer.loadWriterWorks(workId);
  assert.equal(screen.elements.writerDraftMetadata.hidden, false);
  screen.elements.writerMetadataAuthor.value = '루미나';
  screen.elements.writerMetadataSummary.value = '새 작품 소개';
  await screen.writer.saveWriterMetadata();
  assert.equal(calls.length, 1, 'missing cover must not create an upload intent');
  screen.elements.writerMetadataCover.files = [{ name: 'cover.png', type: 'image/png', size: 1024 }];
  screen.elements.writerMetadataSummary.value = '숨김\u200b문자';
  await screen.writer.saveWriterMetadata();
  assert.equal(calls.length, 1, 'invalid text must be rejected before uploading the cover');
  screen.elements.writerMetadataSummary.value = '새 작품 소개';
  await screen.writer.saveWriterMetadata();
  assert.deepEqual(calls.slice(1, 5).map(call => call.url), [
    'https://example.invalid/api/v1/me/assets/upload-intents',
    'https://upload.example.invalid/cover',
    `https://example.invalid/api/v1/me/assets/${assetId}/confirm-upload`,
    `https://example.invalid/api/v1/me/creator-studio/stories/${workId}/metadata`,
  ]);
  assert.deepEqual(JSON.parse(calls[4].options.body), {
    authorDisplayName: '루미나', summary: '새 작품 소개', coverAssetId: assetId,
  });
  assert.equal(screen.elements.writerMetadataCover.value, '');
  assert.equal(screen.elements.writerMetadataSummary.value, '새 작품 소개');
  assert.match(screen.elements.writerMetadataState.textContent, /writerManuscript\.metadataSaved/);
});

test('metadata-only storage cannot be mistaken for an uploaded cover', async () => {
  const calls = [];
  const screen = page(async (url, options) => {
    calls.push(url);
    if (url.endsWith('/upload-intents')) return { ok: true, json: async () => ({
      asset: { id: '88888888-8888-4888-8888-888888888888' },
      upload: { mode: 'metadata_only', url: 'https://upload.example.invalid/cover' }
    }) };
    return { ok: true, json: async () => ({ items: [{ workId,
      slug: 'draft-99999999-9999-4999-8999-999999999999',
      publication: { status: 'draft', published: false },
      title: { value: '새 작품' }, summary: { value: '' },
      permissions: { createManuscript: true } }], nextCursor: null }) };
  });
  await screen.writer.loadWriterWorks(workId);
  screen.elements.writerMetadataAuthor.value = '루미나';
  screen.elements.writerMetadataSummary.value = '소개';
  screen.elements.writerMetadataCover.files = [{ name: 'cover.png', type: 'image/png', size: 1024 }];
  await screen.writer.saveWriterMetadata();
  assert.equal(calls.length, 2);
  assert.match(screen.elements.writerMetadataState.textContent, /writerManuscript\.coverUploadUnavailable/);
});

test('a failed list refresh retries the same draft request instead of creating a duplicate', async () => {
  const newWorkId = '66666666-6666-4666-8666-666666666666';
  const posts = [];
  let catalogCalls = 0;
  const screen = page(async (_url, options) => {
    if (options.method === 'POST') {
      posts.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ workId: newWorkId, status: 'draft' }) };
    }
    catalogCalls++;
    if (catalogCalls === 1) throw new Error('temporary catalog failure');
    return { ok: true, json: async () => ({ items: [{ workId: newWorkId,
      title: { value: '새 원고' }, permissions: { createManuscript: true } }], nextCursor: null }) };
  });
  screen.elements.writerDraftTitle.value = '새 원고';
  await screen.writer.createWriterDraft();
  assert.match(screen.elements.writerDraftState.textContent, /writerManuscript\.draftRefreshFailed/);
  assert.equal(screen.elements.writerDraftTitle.value, '새 원고');
  await screen.writer.createWriterDraft();
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(screen.elements.writerManuscriptWork.value, newWorkId);
});

test('a different signed-in account never reuses the first writer draft request', async () => {
  const requestIds = ['55555555-5555-4555-8555-555555555555',
    '77777777-7777-4777-8777-777777777777'];
  const posts = [];
  const screen = page(async (_url, options) => {
    if (options.method === 'POST') {
      posts.push(JSON.parse(options.body));
      return { ok: false, status: 500 };
    }
    throw new Error('catalog should not be called');
  }, () => requestIds.shift());
  screen.elements.writerDraftTitle.value = '새 원고';
  await screen.writer.createWriterDraft();
  screen.storage.set('lumina_auth', JSON.stringify({ accessToken: 'other-token',
    user: { id: 'other-user' } }));
  await screen.writer.createWriterDraft();
  assert.equal(posts.length, 2);
  assert.notEqual(posts[0].requestId, posts[1].requestId);
});

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

test('paste suggests all 28 main and 4 side part headings without changing the source', () => {
  const screen = page(async () => { throw new Error('unexpected POST'); });
  const source = ['# 작품 소개', '앞부분 설명', ...Array.from({ length: 28 }, (_, index) =>
    `# Part ${String(index + 1).padStart(2, '0')}. 본편 ${index + 1}\n장면 ${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) =>
    `# Side ${String(index + 1).padStart(2, '0')}. 외전 ${index + 1}\n다른 장면 ${index + 1}`)].join('\n\n');
  screen.elements.writerManuscriptBody.value = source;
  screen.writer.writerBodyEdited();
  const sections = screen.elements.writerManuscriptParts.children;
  assert.equal(sections.length, 32);
  assert.equal(screen.elements.writerManuscriptPreface.hidden, false);
  assert.equal(sections[0].find(el => el.maxLength === 240).value, '본편 1');
  assert.equal(sections[31].find(el => el.maxLength === 240).value, '외전 4');
  screen.elements.writerManuscriptExpected.value = '32';
  screen.writer.reviewWriterParts();
  assert.match(screen.elements.writerManuscriptState.textContent, /writerManuscript\.boundariesReviewed/);
  assert.equal(screen.elements.writerManuscriptBody.value, source);
  assert.equal(screen.elements.writerManuscriptSubmit.disabled, true);
  assert.match(sections[0].find(el => el.className === 'writer-manuscript-part-preview').textContent,
    /작품 소개/);
});

test('writer explicitly separates a detected preface without changing uploaded bytes', () => {
  const screen = page(async () => { throw new Error('unexpected POST'); });
  const source = '# 작품 소개\r\n메모\r\n\r\n# Part 01. 첫 장\r\n본문\r\n# Part 02. 둘째 장\r\n결말';
  const first = source.indexOf('# Part 01');
  screen.elements.writerManuscriptBody.value = source;
  screen.writer.writerBodyEdited();
  assert.equal(screen.elements.writerManuscriptPrefaceChoice.hidden, false);
  assert.equal(screen.writer.writerInput().manifest.parts[0].start, 0);
  screen.elements.writerManuscriptSeparatePreface.checked = true;
  screen.elements.writerManuscriptSeparatePreface.fire('change');
  const input = screen.writer.writerInput();
  assert.equal(input.error, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(input.manifest.preface)), { start: 0, end: first });
  assert.equal(input.manifest.parts[0].start, first);
  assert.equal(input.body, source);
  assert.match(screen.elements.writerManuscriptParts.children[0]
    .find(el => el.className === 'writer-manuscript-part-preview').textContent, /Part 01/);
  assert.doesNotMatch(screen.elements.writerManuscriptParts.children[0]
    .find(el => el.className === 'writer-manuscript-part-preview').textContent, /작품 소개/);
  screen.elements.writerManuscriptBody.value = source.replace('메모', '수정 메모');
  screen.writer.writerBodyEdited();
  assert.equal(screen.elements.writerManuscriptSeparatePreface.checked, false);
  assert.equal(screen.writer.writerInput().manifest.parts[0].start, 0);
});

test('missing Part 01 heading never offers Part 01 prose as a removable preface', () => {
  const screen = page(async () => { throw new Error('unexpected POST'); });
  screen.elements.writerManuscriptBody.value = '# Part 01 첫 장\n본문\n\n# Part 02. 둘째 장\n본문';
  screen.writer.writerBodyEdited();
  assert.equal(screen.elements.writerManuscriptParts.children.length, 1);
  assert.equal(screen.elements.writerManuscriptPrefaceChoice.hidden, true);
  assert.match(screen.elements.writerManuscriptParts.children[0]
    .find(el => el.className === 'writer-manuscript-part-preview').textContent, /Part 01 첫 장/);
});

test('editing after a manual split clears the stale preface boundary', () => {
  const screen = page(async () => { throw new Error('unexpected POST'); });
  const source = '작품 소개\n\n# Part 01. 첫 장\n본문\n\n# Part 02. 둘째 장\n결말';
  screen.elements.writerManuscriptBody.value = source;
  screen.writer.writerBodyEdited();
  screen.elements.writerManuscriptSeparatePreface.checked = true;
  screen.elements.writerManuscriptSeparatePreface.fire('change');
  screen.elements.writerManuscriptBody.selectionStart = source.indexOf('본문');
  screen.writer.addWriterPart();
  screen.elements.writerManuscriptBody.value = '새 앞내용\n' + source;
  screen.writer.writerBodyEdited();
  assert.equal(screen.elements.writerManuscriptSeparatePreface.checked, false);
  assert.equal(screen.elements.writerManuscriptPrefaceChoice.hidden, true);
  for (const section of screen.elements.writerManuscriptParts.children) {
    const title = section.find(el => el.maxLength === 240);
    if (!title.value) { title.value = '추가 파트'; title.fire('input'); }
  }
  const input = screen.writer.writerInput();
  assert.equal(input.error, undefined);
  assert.equal(input.manifest.preface, undefined);
  assert.equal(input.manifest.parts[0].start, 0);
});

test('unclear headings keep the manual draft, while explicit detection can replace it', () => {
  const screen = page(async () => { throw new Error('unexpected POST'); });
  const { elements, writer } = screen;
  elements.writerManuscriptBody.value = '첫 장면\n\n다음 장면';
  writer.writerBodyEdited();
  assert.equal(elements.writerManuscriptParts.children.length, 1);
  writer.autoWriterParts();
  assert.match(elements.writerManuscriptState.textContent, /writerManuscript\.autoNotFound/);
  elements.writerManuscriptBody.value = '제1화 첫 문\n본문\n\n제2화 둘째 문\n본문';
  writer.autoWriterParts();
  assert.equal(elements.writerManuscriptParts.children.length, 2);
  assert.equal(elements.writerManuscriptParts.children[1].find(el => el.maxLength === 240).value, '둘째 문');
  assert.equal(elements.writerManuscriptPreface.hidden, true);
  elements.writerManuscriptBody.value = '제1화 첫 문\n본문\n\n제3화 셋째 문\n본문';
  writer.writerBodyEdited();
  assert.equal(elements.writerManuscriptParts.children.length, 1);
});

test('a UTF-8 BOM on the first numbered heading does not alter its source or title', () => {
  const screen = page(async () => { throw new Error('unexpected POST'); });
  const source = '\uFEFF제1화 첫 문\r\n본문\r\n\r\n제2화 둘째 문\r\n본문';
  screen.elements.writerManuscriptBody.value = source;
  screen.writer.writerBodyEdited();
  const sections = screen.elements.writerManuscriptParts.children;
  assert.equal(sections.length, 2);
  assert.equal(sections[0].find(el => el.maxLength === 240).value, '첫 문');
  assert.equal(sections[1].find(el => el.maxLength === 240).value, '둘째 문');
  assert.equal(screen.elements.writerManuscriptPreface.hidden, true);
  assert.equal(screen.elements.writerManuscriptBody.value, source);
});

test('the supplied final manuscript suggests 32 ordered parts without changing a character', {
  skip: !process.env.STORY_QA_MANUSCRIPT_PATH,
}, () => {
  const source = readFileSync(process.env.STORY_QA_MANUSCRIPT_PATH, 'utf8');
  const screen = page(async () => { throw new Error('unexpected POST'); });
  screen.elements.writerManuscriptBody.value = source;
  screen.writer.writerBodyEdited();
  const sections = screen.elements.writerManuscriptParts.children;
  assert.equal(sections.length, 32);
  assert.equal(screen.elements.writerManuscriptPreface.hidden, false);
  assert.equal(sections[0].find(el => el.maxLength === 240).value, '지워진 목소리');
  assert.equal(sections[31].find(el => el.maxLength === 240).value, '우리의 두 번째 이름');
  assert.equal(screen.elements.writerManuscriptBody.value, source);
  assert.match(sections[0].find(el => el.className === 'writer-manuscript-part-preview').textContent,
    /내 이름을 먹지 않은 괴물/);
  screen.elements.writerManuscriptSeparatePreface.checked = true;
  screen.elements.writerManuscriptSeparatePreface.fire('change');
  const input = screen.writer.writerInput();
  assert.equal(input.manifest.preface.end, source.indexOf('# Part 01.'));
  assert.equal(input.manifest.parts[0].start, source.indexOf('# Part 01.'));
  assert.equal(input.body, source);
  assert.doesNotMatch(screen.elements.writerManuscriptParts.children[0]
    .find(el => el.className === 'writer-manuscript-part-preview').textContent, /내 이름을 먹지 않은 괴물/);
});

test('the supplied three-digit long-book headings suggest all 265 parts', {
  skip: !process.env.STORY_QA_LONG_MANUSCRIPT_PATH,
}, () => {
  const source = readFileSync(process.env.STORY_QA_LONG_MANUSCRIPT_PATH, 'utf8');
  const screen = page(async () => { throw new Error('unexpected POST'); });
  screen.elements.writerManuscriptBody.value = source;
  screen.writer.writerBodyEdited();
  const sections = screen.elements.writerManuscriptParts.children;
  assert.equal(sections.length, 265);
  assert.equal(sections[0].find(el => el.maxLength === 240).value, '스물일곱 번째 남자');
  assert.equal(sections[264].find(el => el.maxLength === 240).value, '기록은 용서하지 않는다');
  assert.equal(screen.elements.writerManuscriptPreface.hidden, false);
  assert.equal(screen.elements.writerManuscriptBody.value, source);
  assert.equal(screen.elements.writerManuscriptSubmit.disabled, true);
});

test('review and explicit confirmation gate one exact multipart POST', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const screen = page(async (url, options) => { calls.push({ url, options }); await gate;
    return { ok: true, json: async () => ({ manuscript: { id: manuscriptId, contentHash, workId, locale: 'ko', version: 3 },
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
  const receipt = screen.window.LuminaCreatorManuscript.receipt();
  assert.equal(receipt.id, manuscriptId);
  assert.equal(receipt.contentHash, contentHash);
  assert.equal(receipt.identity.ownerId, 'test-user');
  assert.equal('body' in receipt, false);
  assert.equal('bytes' in receipt, false);
});

test('reviewed preface is sent as a separate manifest span while uploading the full source', async () => {
  const source = '작품 소개\n\n# Part 01. 첫 장\n본문\n\n# Part 02. 둘째 장\n결말';
  const first = source.indexOf('# Part 01');
  const calls = [];
  const screen = page(async (_url, options) => {
    calls.push(options.body);
    return { ok: true, json: async () => ({ manuscript: {
      id: manuscriptId, contentHash, workId, locale: 'ko', version: 5 },
      received: { sourceKind: 'utf8_paste', byteLength: new TextEncoder().encode(source).byteLength,
        parts: 2 }, analysisStarted: false, idempotentReplay: false }) };
  });
  const { elements, writer } = screen;
  elements.writerManuscriptBody.value = source;
  writer.writerBodyEdited();
  elements.writerManuscriptSeparatePreface.checked = true;
  elements.writerManuscriptSeparatePreface.fire('change');
  writer.reviewWriterParts();
  elements.writerManuscriptConfirm.checked = true;
  elements.writerManuscriptConfirm.fire('change');
  await writer.submitWriterManuscript();
  assert.equal(calls.length, 1);
  assert.equal(await calls[0].get('manuscript').text(), source);
  const manifest = JSON.parse(calls[0].get('manifest'));
  assert.deepEqual(manifest.preface, { start: 0, end: first });
  assert.equal(manifest.parts[0].start, first);
  assert.equal(manifest.parts[1].end, source.length);
});

test('server-queued analysis resumes by job id without a second paid start request', async () => {
  const analysisJobId = '44444444-4444-4444-8444-444444444444';
  const screen = page(async () => ({ ok: true, json: async () => ({
    manuscript: { id: manuscriptId, contentHash, workId, locale: 'ko', version: 4 },
    received: { sourceKind: 'utf8_paste', byteLength: new TextEncoder().encode(screen.elements.writerManuscriptBody.value).byteLength, parts: 2 },
    analysisStarted: true, analysisJobId, idempotentReplay: false
  }) }));
  const resumes = [];
  screen.window.LuminaCreatorAnalysis = { receive: (_receipt, options) => resumes.push(options) };
  prepareTwoParts(screen);
  screen.elements.writerManuscriptConfirm.checked = true;
  screen.elements.writerManuscriptConfirm.fire('change');

  await screen.writer.submitWriterManuscript();

  assert.equal(resumes.length, 1);
  assert.equal(resumes[0].fromSubmit, false);
  assert.equal(resumes[0].existingAnalysisId, analysisJobId);
});

test('changed source invalidates review; server rejection permits a checked retry', async () => {
  const calls = [];
  const screen = page(async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) return { ok: false, status: 400 };
    return { ok: true, json: async () => ({ manuscript: { id: manuscriptId, contentHash, workId, locale: 'ko', version: 4 },
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

test('account change while paste awaits 401 never refreshes or resends old manuscript', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const screen = page(async (url, options) => { calls.push({ url, options }); await gate; return { ok: false, status: 401 }; });
  prepareTwoParts(screen);
  screen.elements.writerManuscriptConfirm.checked = true;
  const pending = screen.writer.submitWriterManuscript();
  screen.storage.set('lumina_auth', JSON.stringify({ accessToken: 'second-token', refreshToken: 'second-refresh', user: { id: 'second-user' } }));
  release(); await pending;
  assert.equal(calls.length, 1);
  assert.equal(screen.window.LuminaCreatorManuscript.receipt(), null);
  assert.equal(screen.elements.writerManuscriptSubmit.disabled, true);
});

test('late refresh cannot replace a new account or retry its scoped analysis request', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const screen = page(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/refresh')) {
      await gate;
      return { ok: true, json: async () => ({ accessToken: 'late-old-token', user: { id: 'test-user' } }) };
    }
    return { ok: false, status: 401 };
  });
  screen.storage.set('lumina_auth', JSON.stringify({ accessToken: 'test-token', refreshToken: 'old-refresh', user: { id: 'test-user' } }));
  const api = screen.window.LuminaCreatorStudioApi;
  const pending = api.fetch('/api/v1/me/creator-studio/analyses/' + manuscriptId, { identity: api.identity() });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  screen.storage.set('lumina_auth', JSON.stringify({ accessToken: 'second-token', user: { id: 'second-user' } }));
  release(); await rejected;
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(screen.storage.get('lumina_auth')).user.id, 'second-user');
});

test('five-locale copy and narrow mobile layout remain wired', () => {
  for (const key of ['autoParts', 'autoNotFound', 'prefaceIncluded', 'separatePreface',
    'prefaceExcluded', 'confirm', 'submit', 'received', 'rejected', 'requestFailed',
    'draftTitle', 'draftPlaceholder', 'createDraft', 'draftTitleRequired', 'draftCreating',
    'draftCreated', 'draftRefreshFailed', 'draftFailed', 'metadataHeading', 'authorName',
    'summary', 'cover', 'saveMetadata', 'coverReady', 'coverRequired', 'metadataRequired',
    'coverInvalid', 'metadataSaving', 'coverUploadUnavailable', 'metadataSaved', 'metadataFailed']) {
    const row = dictionary.split(/\r?\n/).find(line => line.includes(`"writerManuscript.${key}":`));
    assert.ok(row, key);
    for (const locale of ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant']) {
      assert.match(row, new RegExp(`"${locale}"\\s*:`));
    }
  }
  assert.match(html, /id="writerManuscriptConfirm"[^>]*disabled/);
  assert.match(html, /id="writerDraftTitle"/);
  assert.match(html, /id="writerDraftCreate"/);
  assert.match(html, /id="writerDraftMetadata"[^>]*hidden/);
  assert.match(html, /id="writerMetadataCover"[^>]*accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(html, /id="writerManuscriptAutoParts"/);
  assert.match(html, /id="writerManuscriptPreface"[^>]*hidden/);
  assert.match(html, /id="writerManuscriptSeparatePreface"[^>]*type="checkbox"/);
  assert.match(html, /id="writerManuscriptSubmit"[^>]*disabled/);
  assert.match(css, /\.writer-manuscript-confirm\s*\{[^}]*overflow-wrap:\s*anywhere/);
  const mobile = css.slice(css.lastIndexOf('@media (max-width: 680px)'));
  assert.ok(mobile.includes('.page-creator-studio .composer-tools button,'));
  assert.ok(mobile.includes('flex: 1 1 100%;'));
});
