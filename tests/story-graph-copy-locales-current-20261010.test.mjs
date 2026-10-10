import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { setImmediate as tick } from 'node:timers/promises';

const pageUrl = new URL('../pages/story-stage.js', import.meta.url);
const appUrl = new URL('../app.js', import.meta.url);
const pageBytes = readFileSync(pageUrl), appBytes = readFileSync(appUrl);
const page = pageBytes.toString('utf8');
const shared = appBytes.toString('utf8').replace(/\r\n/g, '\n');
const apiStart = shared.indexOf('async function apiFetch(');
const apiEnd = shared.indexOf('\n/*', apiStart);
assert.ok(apiStart >= 0 && apiEnd > apiStart, 'The actual shared apiFetch function must exist');
const sharedApi = shared.slice(apiStart, apiEnd);
assert.ok(sharedApi.trimEnd().endsWith('}'), 'The complete shared function must be retained');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const inputPins = [[pageUrl, pageBytes], [appUrl, appBytes]].map(([url, bytes]) => ({
  file: fileURLToPath(url), raw: sha(bytes), lf: sha(bytes.toString('utf8').replace(/\r\n/g, '\n')),
}));

const expected = {
  ko: {
    graphTitle: '분기 미리보기',
    graphDescription: '현재 장면과 바로 이어지는 경로',
    graphFocus: '현재 장면',
    graphChoices: '선택지',
    graphNext: '다음 장면',
    graphEnding: '엔딩',
    graphWarning: '이 분기는 공개 전에 검토가 필요합니다.',
    graphEmpty: '이 장면에서 바로 이어지는 분기가 없습니다.',
    graphFailed: '분기 미리보기를 불러오지 못했습니다.',
  },
  en: {
    graphTitle: 'Branch preview',
    graphDescription: 'Current scene and direct next routes',
    graphFocus: 'Current scene',
    graphChoices: 'Choices',
    graphNext: 'Next scene',
    graphEnding: 'Ending',
    graphWarning: 'This branch needs review before publication.',
    graphEmpty: 'No direct branches are available for this scene.',
    graphFailed: 'The branch preview could not be loaded.',
  },
  ja: {
    graphTitle: '分岐のプレビュー',
    graphDescription: '現在のシーンと直接つながるルート',
    graphFocus: '現在のシーン',
    graphChoices: '選択肢',
    graphNext: '次のシーン',
    graphEnding: 'エンディング',
    graphWarning: 'この分岐は公開前に確認が必要です。',
    graphEmpty: 'このシーンから直接進める分岐はありません。',
    graphFailed: '分岐のプレビューを読み込めませんでした。',
  },
  'zh-Hans': {
    graphTitle: '分支预览',
    graphDescription: '当前场景及可直接进入的路线',
    graphFocus: '当前场景',
    graphChoices: '选项',
    graphNext: '下一个场景',
    graphEnding: '结局',
    graphWarning: '此分支需要在发布前检查。',
    graphEmpty: '此场景没有可直接进入的分支。',
    graphFailed: '无法加载分支预览。',
  },
  'zh-Hant': {
    graphTitle: '分支預覽',
    graphDescription: '目前場景及可直接進入的路線',
    graphFocus: '目前場景',
    graphChoices: '選項',
    graphNext: '下一個場景',
    graphEnding: '結局',
    graphWarning: '此分支需要在發布前檢查。',
    graphEmpty: '此場景沒有可直接進入的分支。',
    graphFailed: '無法載入分支預覽。',
  },
};

const id = n => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const workId = id(1), focusId = id(2), nextId = id(3);
const origin = 'https://api.lumina-stage.com';
const auth = { user: { id: id(10) }, accessToken: 'synthetic-graph-copy-owner' };
const content = {
  part: 'Synthetic part <tag> & detail', focus: 'Synthetic current <tag> & detail',
  next: 'Synthetic next <tag> & detail', route: 'Synthetic route <tag> & detail',
  ending: 'Synthetic ending route',
};
const html = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function graph(locale, empty) {
  const localized = value => ({ value, locale, fallback: false });
  return {
    part: { id: id(4), title: localized(content.part) },
    focus: { id: focusId, title: localized(content.focus), endingType: null },
    choices: empty ? [] : [
      { id: id(5), label: localized(content.route), targetSceneId: nextId, targetEndingKey: null,
        nextScene: { id: nextId, title: localized(content.next), endingType: null } },
      { id: id(6), label: localized(content.ending), targetSceneId: null,
        targetEndingKey: 'synthetic-ending', nextScene: null },
    ],
    validation: { warnings: empty ? [] : [{ code: 'SYNTHETIC_WARNING_DETAIL' }] },
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    removeEventListener(name, callback) {
      listeners.set(name, (listeners.get(name) || []).filter(value => value !== callback));
    },
  };
}

// Render-only VM fixture: keep the existing event/shared-fetch pattern without the account-race factory.
function mount(locale, variant) {
  const calls = [], timers = new Map(), historyCalls = [];
  let timerId = 0;
  const root = { ...eventTarget(), innerHTML: '', isConnected: true,
    setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] };
  const headings = { storyStageTitle: { textContent: '' }, storyStageDescription: { textContent: '' } };
  const document = { ...eventTarget(), activeElement: null,
    getElementById: name => name === 'storyStageRoot' ? root : headings[name] || null,
    querySelector: () => null,
    body: { classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} } } };
  const location = { origin: 'https://fixture.invalid', pathname: '/story-stage',
    search: `?workId=${workId}`, href: `https://fixture.invalid/story-stage?workId=${workId}` };
  const history = { replaceState(_state, _title, value) {
    historyCalls.push(value);
    const next = new URL(value, location.href);
    location.href = next.href; location.search = next.search; location.pathname = next.pathname;
  } };
  const window = { ...eventTarget(), location, history, getAuth: () => auth, isLoggedIn: () => true,
    luminaI18n: { getLocale: () => locale }, scrollY: 0, scrollTo() {} };
  const payload = graph(locale, variant === 'empty');
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ url: parsed.href, method: options.method || 'GET',
      query: Object.fromEntries(parsed.searchParams), headers: options.headers, body: options.body });
    assert.equal(parsed.origin, origin);
    assert.equal(parsed.pathname, `/api/v1/stories/${workId}/graph`);
    assert.equal(options.method, 'GET', 'No mutation/provider route is available in the fixture');
    const body = variant === 'failed' ? { message: 'SYNTHETIC_INTERNAL_DIAGNOSTIC' } : payload;
    return { status: variant === 'failed' ? 503 : 200, ok: variant !== 'failed',
      json: async () => JSON.parse(JSON.stringify(body)) };
  };
  const context = { window, document, location, history, URL, URLSearchParams, AbortController,
    API_BASE: origin, getAuth: () => auth, fetch,
    refreshAuthOnce() { assert.fail('Real auth refresh is outside this copy fixture'); },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(value) { timers.delete(value); },
    sessionStorage: { getItem: () => null,
      setItem() { assert.fail('No session write is expected for graph copy'); },
      removeItem() { assert.fail('No session write is expected for graph copy'); } },
  };
  // The full page is unmodified; shared auth initialization, real DOM layout and server admission are not run.
  runInNewContext(sharedApi + '\nwindow.apiFetch = apiFetch;\n' + page, context, { timeout: 1000 });
  return { root, historyCalls, oneRead() {
    assert.equal(calls.length, 1, 'No automatic retry, extra read or generation command');
    assert.deepEqual(calls[0].query, { locale });
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].body, undefined);
    assert.equal(calls[0].headers.Authorization, `Bearer ${auth.accessToken}`);
    assert.equal(timers.size, 0, 'The shared fetch timeout must be cleared');
  } };
}

async function settle() { for (let i = 0; i < 6; i++) await tick(); }
function rendered(markup, tag, value) {
  assert.ok(markup.includes(`<${tag}>${html(value)}</${tag}>`), `Missing rendered ${tag}: ${value}`);
}

for (const [locale, copy] of Object.entries(expected)) {
  test(locale === 'ko'
    ? 'GRAPH-COPY-LOCALES-RED: ko renders localized graph routes, ending and warning'
    : `graph copy locales: ${locale} renders graph routes, ending and warning`, async () => {
    const f = mount(locale, 'routes');
    await settle();
    const markup = f.root.innerHTML;
    f.oneRead();
    assert.equal(f.historyCalls.length, 1);
    assert.ok(markup.includes('<section class="story-graph-preview" '), 'The actual graph must mount before copy assertions');
    for (const [tag, value] of [['p', content.part], ['strong', content.focus],
      ['strong', content.route], ['small', content.next], ['strong', content.ending]]) rendered(markup, tag, value);
    assert.ok(markup.includes(`data-story-graph-focus="${nextId}"`));
    assert.doesNotMatch(markup, /SYNTHETIC_WARNING_DETAIL|<tag>/);
    assert.ok(markup.includes(`<section class="story-graph-preview" aria-label="${copy.graphTitle}">`));
    rendered(markup, 'h2', copy.graphTitle);
    rendered(markup, 'span', copy.graphDescription);
    rendered(markup, 'span', copy.graphFocus);
    assert.ok(markup.includes(`<section class="story-graph-routes" aria-label="${copy.graphChoices}">`));
    rendered(markup, 'h3', copy.graphNext);
    rendered(markup, 'small', copy.graphEnding);
    assert.ok(markup.includes(`<p class="story-graph-warning" role="status">${copy.graphWarning}</p>`));
  });

  test(`graph copy locales: ${locale} renders the empty direct-branch notice`, async () => {
    const f = mount(locale, 'empty');
    await settle();
    const markup = f.root.innerHTML;
    f.oneRead();
    assert.equal(f.historyCalls.length, 1);
    assert.ok(markup.includes('<section class="story-graph-preview" '));
    rendered(markup, 'strong', content.focus);
    assert.doesNotMatch(markup, /class="story-graph-choice"|class="story-graph-warning"/);
    rendered(markup, 'h2', copy.graphTitle);
    rendered(markup, 'span', copy.graphDescription);
    rendered(markup, 'span', copy.graphFocus);
    rendered(markup, 'h3', copy.graphNext);
    rendered(markup, 'p', copy.graphEmpty);
    assert.ok(markup.includes(`aria-label="${copy.graphChoices}"`));
  });

  test(`graph copy locales: ${locale} renders a safe failed-load notice without automatic retry`, async () => {
    const f = mount(locale, 'failed');
    await settle();
    const markup = f.root.innerHTML;
    f.oneRead();
    assert.equal(f.historyCalls.length, 0);
    assert.ok(markup.includes('data-story-retry'));
    assert.doesNotMatch(markup, /story-graph-preview|SYNTHETIC_INTERNAL_DIAGNOSTIC|Synthetic current/);
    rendered(markup, 'h2', copy.graphFailed);
  });
}
