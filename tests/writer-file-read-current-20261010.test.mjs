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
    TextEncoder, TextDecoder, Blob, FormData, URLSearchParams, AbortController, DOMException, Option: Element,
    setTimeout, clearTimeout, console, crypto: { randomUUID: uuidFactory } };
  const verifyCall = script.lastIndexOf('  verify();');
  assert.ok(verifyCall > 0, 'test loads the real writer handlers');
  const injected = script.slice(0, verifyCall) +
    '  globalThis.writerTest = { writerInput, writerBodyEdited, autoWriterParts, addWriterPart, reviewWriterParts, submitWriterManuscript, syncWriterSubmit, createWriterDraft, loadWriterWorks, saveWriterMetadata };' +
    script.slice(verifyCall + '  verify();'.length);
  vm.runInNewContext(injected, context, { filename: 'creator-studio.js' });
  return { elements, writer: context.writerTest, window: context.window, storage };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fileReadPage() {
  const screen = page(async () => { throw new Error('Unexpected synthetic API request'); });
  const input = screen.elements.writerManuscriptFile;
  const begin = (read, name = 'synthetic.txt') => {
    input.files = [{ name, size: 20, arrayBuffer: () => read.promise }];
    return input.fire('change');
  };
  const snapshot = () => ({
    body: screen.elements.writerManuscriptBody.value,
    notice: screen.elements.writerManuscriptState.textContent,
    tone: screen.elements.writerManuscriptState.classList,
    confirmed: screen.elements.writerManuscriptConfirm.checked,
    submitDisabled: screen.elements.writerManuscriptSubmit.disabled,
    parts: screen.elements.writerManuscriptParts.children.length,
  });
  return { ...screen, begin, snapshot };
}

function sourceBytes(value) {
  return new TextEncoder().encode(value).buffer;
}

test('WRITER-FILE-CURRENT-RED: old read rejection cannot replace a newer successful file notice', async () => {
  const screen = fileReadPage();
  const old = deferred(), current = deferred();
  const oldTask = screen.begin(old);
  const currentTask = screen.begin(current, 'current.md');
  current.resolve(sourceBytes('# Part 01. Current\nCurrent synthetic body'));
  await currentTask;
  const before = screen.snapshot();
  assert.equal(before.body, '# Part 01. Current\nCurrent synthetic body');
  assert.doesNotMatch(before.notice, /invalidUtf8/);
  old.reject(new Error('Synthetic superseded file failure'));
  await oldTask;
  assert.deepEqual(screen.snapshot(), before);
});

test('WRITER-FILE-CURRENT: old read rejection cannot replace a manual edit notice', async () => {
  const screen = fileReadPage(), read = deferred();
  const task = screen.begin(read);
  screen.elements.writerManuscriptBody.value = '# Part 01. Edited\nManual synthetic body';
  screen.elements.writerManuscriptBody.fire('input');
  const before = screen.snapshot();
  read.reject(new Error('Synthetic superseded file failure'));
  await task;
  assert.deepEqual(screen.snapshot(), before);
});

test('WRITER-FILE-CURRENT: old read rejection cannot replace a cleared manuscript notice', async () => {
  const screen = fileReadPage(), read = deferred();
  const task = screen.begin(read);
  screen.elements.writerManuscriptClear.fire('click');
  const before = screen.snapshot();
  assert.equal(before.body, '');
  read.reject(new Error('Synthetic superseded file failure'));
  await task;
  assert.deepEqual(screen.snapshot(), before);
});

test('WRITER-FILE-CURRENT: old read success cannot replace a newer file', async () => {
  const screen = fileReadPage(), old = deferred(), current = deferred();
  const oldTask = screen.begin(old), currentTask = screen.begin(current);
  current.resolve(sourceBytes('# Part 01. Current\nCurrent synthetic body'));
  await currentTask;
  const before = screen.snapshot();
  old.resolve(sourceBytes('# Part 01. Old\nOld synthetic body'));
  await oldTask;
  assert.deepEqual(screen.snapshot(), before);
});

test('WRITER-FILE-CURRENT: current read failure keeps the body and explains the failure', async () => {
  const screen = fileReadPage(), read = deferred();
  screen.elements.writerManuscriptBody.value = 'Unchanged synthetic body';
  const task = screen.begin(read);
  read.reject(new Error('Synthetic current file failure'));
  await task;
  assert.equal(screen.elements.writerManuscriptBody.value, 'Unchanged synthetic body');
  assert.match(screen.elements.writerManuscriptState.textContent, /invalidUtf8/);
  assert.equal(screen.elements.writerManuscriptConfirm.checked, false);
  assert.equal(screen.elements.writerManuscriptSubmit.disabled, true);
});

test('WRITER-FILE-CURRENT: current invalid UTF-8 keeps the body and rejects review', async () => {
  const screen = fileReadPage(), read = deferred();
  screen.elements.writerManuscriptBody.value = 'Unchanged synthetic body';
  const task = screen.begin(read);
  read.resolve(Uint8Array.from([0xc3, 0x28]).buffer);
  await task;
  assert.equal(screen.elements.writerManuscriptBody.value, 'Unchanged synthetic body');
  assert.match(screen.elements.writerManuscriptState.textContent, /invalidUtf8/);
  assert.equal(screen.elements.writerManuscriptSubmit.disabled, true);
});

test('WRITER-FILE-CURRENT: valid UTF-8 remains exact and still requires review', async () => {
  const screen = fileReadPage(), read = deferred();
  const content = '# Part 01. Current\nCurrent synthetic body';
  const task = screen.begin(read);
  read.resolve(sourceBytes(content));
  await task;
  assert.equal(screen.elements.writerManuscriptBody.value, content);
  assert.doesNotMatch(screen.elements.writerManuscriptState.textContent, /invalidUtf8/);
  assert.equal(screen.elements.writerManuscriptConfirm.checked, false);
  assert.equal(screen.elements.writerManuscriptSubmit.disabled, true);
});
