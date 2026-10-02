import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../pages/character-detail.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../character-detail/index.html', import.meta.url), 'utf8');
const dictionarySource = appSource.slice(
  appSource.indexOf('const I18N_DICT = {'),
  appSource.indexOf('\nlet _currentLocale = I18N_FALLBACK;'),
);
const dictionary = runInNewContext(`${dictionarySource}\nI18N_DICT`, {});
const locales = ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant'];

test('public detail action keys have five translations and chat options keep their access state', () => {
  const keys = new Set([...`${html}\n${pageSource}`.matchAll(/(?<![\w/.-])detail\.[A-Za-z]+(?:\.[A-Za-z]+)*/g)].map(match => match[0]));
  assert.ok(keys.size >= 25);
  for (const key of keys) {
    for (const locale of locales) {
      assert.ok(dictionary[key]?.[locale], `${key} missing ${locale}`);
    }
  }
  assert.match(html, /id="chatStartLink" href="\/character-chat"/);
  assert.match(html, /is-premium-chat is-locked" aria-disabled="true"/);
  assert.match(pageSource, /cta-btn cta-btn-premium" disabled aria-disabled="true"/);
  assert.match(pageSource, /cta-btn cta-btn-support" disabled/);
});

function detailFixture({ withAuthModal = true } = {}) {
  let locale = 'ko-KR';
  let localeChange;
  let click;
  let token = true;
  let followResult = { stats: { followerCount: 1235 }, viewer: { isFollowing: true, canUnfollow: true } };
  const calls = [];
  const alerts = [];
  const authModals = [];
  const applied = [];
  const classList = () => ({ add() {}, remove() {}, toggle() {} });
  const root = () => ({ innerHTML: '', hidden: false, dataset: {}, classList: classList(), style: {}, setAttribute() {} });
  const roots = Object.fromEntries([
    'detailHero', 'detailIntro', 'detailMeta', 'detailGallery', 'detailShorts', 'detailProfile',
    'detailCta', 'detailTagNavigation', 'detailChatSection', 'detailBodySection',
    'detailCtaSection', 'detailTagSection', 'detailChatSelect', 'chatStartLink',
  ].map(id => [id, root()]));
  roots.detailHero.querySelector = () => null;
  roots.detailGallery.closest = () => ({ classList: classList() });
  roots.detailGallery.addEventListener = () => {};
  const label = { textContent: '' };
  const count = { textContent: '', dataset: { count: '1234' } };
  const heading = { textContent: '', dataset: { artistName: '작성자 이름' } };
  const attrs = {};
  const btn = {
    hidden: true,
    dataset: {},
    classList: classList(),
    querySelector: selector => selector === '[data-detail-follow-label]' ? label : count,
    setAttribute: (name, value) => { attrs[name] = value; },
  };
  const document = {
    title: '',
    getElementById: id => roots[id] || null,
    querySelector: selector => ({
      '[data-detail-follow]': btn,
      '[data-detail-follower-count]': count,
      '[data-detail-support-heading]': heading,
    })[selector] || null,
    addEventListener: (name, callback) => { if (name === 'click') click = callback; },
  };
  const artist = {
    slug: 'writer-artist', id: 'artist-id', publicName: '작성자 이름', type: '가수', tier: 'main',
    status: 'public', summary: '작성자가 쓴 소개', intro: '작성자가 쓴 이야기', concept: '',
    tags: ['작성자 태그'], profile: { 역할: '보컬' }, images: {},
    gallery: [{ caption: 'Artist caption', src: '/photo.png' }], shorts: [],
    _stats: { followerCount: 1234 },
  };
  const window = {
    location: { search: '?slug=writer-artist', pathname: '/character-detail' },
    addEventListener: (name, callback) => { if (name === 'lumina:localechange') localeChange = callback; },
    luminaI18n: {
      t: key => dictionary[key]?.[locale] || key,
      getRegionalLocale: () => locale,
      apply: node => applied.push(node),
    },
  };
  runInNewContext(pageSource, {
    window, document, URLSearchParams, Intl,
    statusMeta: { public: { className: 'is-public', label: '작가 상태' } },
    getCharacterBySlug: slug => slug === artist.slug ? artist : null,
    _artists: [artist], publicArtistsFromApi: () => [artist],
    shouldKeepLocalGallery: () => true,
    initGallerySlider: () => {}, initLightbox: () => {}, mediaStyle: () => '',
    feedEscapeHtml: value => value,
    isLoggedIn: () => true,
    getAccessToken: () => token ? 'token' : null,
    ...(withAuthModal ? { openAuthModal: (...args) => authModals.push(args) } : {}),
    alert: value => alerts.push(value),
    apiFetch: async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith('/follow')) {
        if (followResult instanceof Error) throw followResult;
        return followResult;
      }
      return { id: artist.id, slug: artist.slug, status: 'active',
        stats: { followerCount: 1234 }, viewer: { isAuthenticated: true, canFollow: true, isFollowing: false } };
    },
    console: { info() {}, warn() {} },
  });
  return {
    window, roots, artist, btn, attrs, label, count, heading, calls, alerts, authModals, applied,
    render: () => window.renderCharacterDetail(),
    bind: () => window.bindArtistDetailFollow(),
    changeLocale: value => { locale = value; localeChange(); },
    click: () => click({ target: { closest: () => btn }, preventDefault() {}, stopPropagation() {} }),
    setToken: value => { token = value; },
    setFollowResult: value => { followResult = value; },
  };
}

test('localechange refreshes dynamic follow and support text without refetching artist content', async () => {
  const view = detailFixture();
  view.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.btn.hidden, false);
  assert.equal(view.roots.chatStartLink.href, '/character-chat?slug=writer-artist');
  assert.match(view.roots.detailIntro.innerHTML, /작성자가 쓴 소개/);
  assert.match(view.roots.detailGallery.innerHTML, /data-i18n="detail.gallery.official"/);
  assert.match(view.roots.detailCta.innerHTML, /data-i18n="detail.support.action"/);
  const initialCalls = view.calls.length;
  for (const [locale, follow, followers, heading] of [
    ['en-US', 'Follow', '1,234 followers', "Support 작성자 이름's next stage"],
    ['ja-JP', 'フォロー', 'フォロワー 1,234', '작성자 이름の次のステージを応援しよう'],
    ['zh-CN', '关注', '1,234 位关注者', '支持작성자 이름的下一座舞台'],
    ['zh-Hant', '追蹤', '1,234 位追蹤者', '支持작성자 이름的下一座舞台'],
    ['ko-KR', '팔로우', '팔로워 1,234', '작성자 이름의 다음 무대를 응원하세요'],
  ]) {
    view.changeLocale(locale);
    assert.equal(view.label.textContent, follow);
    assert.equal(view.attrs['aria-label'], follow);
    assert.equal(view.count.textContent, followers);
    assert.equal(view.heading.textContent, heading);
    assert.match(view.roots.detailIntro.innerHTML, /작성자가 쓴 소개/);
    assert.equal(view.calls.length, initialCalls);
  }
  assert.ok(view.applied.includes(view.roots.detailGallery));
  assert.ok(view.applied.includes(view.roots.detailChatSection));
});

test('follow prompts, optimistic state, failure rollback and success use active locale', async () => {
  const view = detailFixture();
  view.render();
  await new Promise(resolve => setImmediate(resolve));
  view.bind();
  view.changeLocale('en-US');
  view.setToken(false);
  await view.click();
  assert.equal(view.authModals[0][1].returnTo.label, 'Continue following the artist');
  assert.equal(view.authModals[0][1].returnTo.href, '/character-detail?slug=writer-artist');

  view.setToken(true);
  view.btn.dataset.artistId = '';
  await view.click();
  assert.equal(view.alerts.at(-1), 'Could not load artist details. Refresh and try again.');

  view.btn.dataset.artistId = 'artist-id';
  view.setFollowResult(new Error('raw server error'));
  await view.click();
  assert.equal(view.alerts.at(-1), 'Could not update your follow. Please try again.');
  assert.equal(view.label.textContent, 'Follow');
  assert.equal(view.count.textContent, '1,234 followers');

  view.changeLocale('ja-JP');
  view.setFollowResult({ stats: { followerCount: 1235 }, viewer: { isFollowing: true, canUnfollow: true } });
  await view.click();
  assert.equal(view.calls.at(-1).path, '/api/v1/artists/artist-id/follow');
  assert.equal(view.calls.at(-1).options.method, 'POST');
  assert.equal(view.label.textContent, 'フォロー解除');
  assert.equal(view.count.textContent, 'フォロワー 1,235');
  view.changeLocale('zh-Hant');
  assert.equal(view.label.textContent, '取消追蹤');

  view.setFollowResult({ stats: { followerCount: 1234 }, viewer: { isFollowing: false } });
  await view.click();
  assert.equal(view.calls.at(-1).options.method, 'DELETE');
  assert.equal(view.label.textContent, '追蹤');
  assert.equal(view.count.textContent, '1,234 位追蹤者');
});

test('follow login fallback alert uses the active locale when auth modal is unavailable', async () => {
  const view = detailFixture({ withAuthModal: false });
  view.render();
  view.bind();
  view.changeLocale('zh-CN');
  view.setToken(false);
  await view.click();
  assert.equal(view.alerts.at(-1), '登录后即可关注艺人。');
  assert.equal(view.calls.filter(call => call.path.endsWith('/follow')).length, 0);
});
