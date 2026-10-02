import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../pages/lumina-feed.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../lumina-feed/index.html', import.meta.url), 'utf8');
const dictionarySource = appSource.slice(
  appSource.indexOf('const I18N_DICT = {'),
  appSource.indexOf('\nlet _currentLocale = I18N_FALLBACK;'),
);
const dictionary = runInNewContext(`${dictionarySource}\nI18N_DICT`, {});
const locales = ['ko-KR', 'ja-JP', 'en-US', 'zh-CN', 'zh-Hant'];

function section(start, end) {
  return pageSource.slice(pageSource.indexOf(start), pageSource.indexOf(end, pageSource.indexOf(start)));
}

test('feed UI keys and interpolation parameters exist in all five locales', () => {
  const keys = new Set([
    ...[...html.matchAll(/data-i18n(?:-aria)?="(feed\.[^"]+)"/g)].map(match => match[1]),
    ...[...html.matchAll(/data-i18n-attr="[^"]*?:(feed\.[^",]+)[^"]*"/g)].map(match => match[1]),
    ...[...pageSource.matchAll(/feed(?:T|Text)\("(feed\.[^"]+)"/g)].map(match => match[1]),
  ]);
  assert.ok(keys.size > 65, `expected broad core-feed coverage, found ${keys.size} keys`);
  for (const key of keys) {
    const base = dictionary[key]?.['ko-KR'];
    assert.equal(typeof base, 'string', `${key} missing ko-KR`);
    const placeholders = [...base.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const locale of locales) {
      const value = dictionary[key]?.[locale];
      assert.equal(typeof value, 'string', `${key} missing ${locale}`);
      assert.ok(value.length > 0, `${key} empty ${locale}`);
      assert.deepEqual([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort(), placeholders,
        `${key} interpolation mismatch for ${locale}`);
    }
  }
});

test('empty, search, and filter states use the selected locale', () => {
  const root = { innerHTML: '' };
  let locale = 'en-US';
  const context = {
    document: { getElementById: id => id === 'luminaFeedList' ? root : null },
    _luminaFeedItems: [],
    _luminaFeedFilter: 'all',
    _luminaFeedQuery: '',
    _luminaFeedSource: 'error',
    sortFeedListWithThreadContinuations: items => items,
    feedT: key => dictionary[key]?.[locale] ?? key,
  };
  runInNewContext(`${section('function renderLuminaFeed()', 'function bindLuminaFeedTabs()')}\nthis.render = renderLuminaFeed;`, context);
  context.render();
  assert.match(root.innerHTML, /Could not load the feed/);

  locale = 'ja-JP';
  context._luminaFeedSource = 'operations';
  context._luminaFeedQuery = 'missing';
  context.render();
  assert.match(root.innerHTML, /検索結果がありません/);

  locale = 'zh-Hant';
  context._luminaFeedQuery = '';
  context._luminaFeedFilter = 'fan_post';
  context.render();
  assert.match(root.innerHTML, /此分類暫時沒有貼文/);
});

test('upload and submit errors translate without exposing server messages', () => {
  let locale = 'en-US';
  const context = {
    feedT: key => dictionary[key]?.[locale] ?? key,
    navigator: { onLine: true },
    FEED_COMPOSE_MAX_BODY: 2200,
    FEED_COMPOSE_MAX_IMAGE_MB: 20,
    FEED_ALLOWED_IMAGE_LABEL: 'JPEG, PNG, WebP, GIF',
  };
  runInNewContext(`
    function feedText(key, values = {}) {
      return feedT(key).replace(/\\{(\\w+)\\}/g, (_, name) => String(values[name] ?? ''));
    }
    ${section('function feedUploadErrorMessage(', 'function releaseFeedComposeAssetPreview(')}
    this.messages = { feedUploadErrorMessage, feedComposeSubmitErrorMessage };
  `, context);
  assert.equal(context.messages.feedUploadErrorMessage({ status: 401 }), 'Your session expired. Please log in again.');
  assert.match(context.messages.feedUploadErrorMessage({ status: 413, message: 'payload too large' }), /20MB/);
  assert.match(context.messages.feedComposeSubmitErrorMessage({ status: 429 }), /posting too often/);
  assert.doesNotMatch(context.messages.feedComposeSubmitErrorMessage({ status: 500, message: 'private server detail' }), /private server detail/);

  locale = 'zh-CN';
  assert.match(context.messages.feedComposeSubmitErrorMessage({ status: 401 }), /登录已过期/);
  locale = 'ko-KR';
  assert.equal(context.messages.feedComposeSubmitErrorMessage({ status: 403 }), '지금은 이 글을 게시할 수 없어요. 권한 확인 후 다시 시도해주세요.');
});
