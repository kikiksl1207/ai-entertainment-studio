import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../pages/popular-vote.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../lumina-pick/index.html', import.meta.url), 'utf8');
const dictionarySource = appSource.slice(
  appSource.indexOf('const I18N_DICT = {'),
  appSource.indexOf('\nlet _currentLocale = I18N_FALLBACK;'),
);
const dictionary = runInNewContext(`${dictionarySource}\nI18N_DICT`, {});
const locales = ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant'];

test('Lumina Pick UI keys have all five translations', () => {
  const keys = new Set([
    ...[...html.matchAll(/data-i18n(?:-aria)?="(pick\.[^"]+)"/g)].map(match => match[1]),
    ...[...pageSource.matchAll(/pickText\("(pick\.[^"]+)"/g)].map(match => match[1]),
    ...[...appSource.matchAll(/t\("(pick\.[^"]+)"\)/g)].map(match => match[1]),
  ]);
  assert.ok(keys.size > 30);
  for (const key of keys) {
    for (const locale of locales) {
      assert.equal(typeof dictionary[key]?.[locale], 'string', `${key} missing ${locale}`);
    }
  }
});

test('locale changes redraw archive and ranking UI without translating artist or campaign content', async () => {
  let locale = 'ko-KR';
  let localeChange;
  let moreClick;
  const moreLabel = { textContent: '' };
  const hiddenBlock = {
    hidden: true,
    hasAttribute() { return this.hidden; },
    setAttribute() { this.hidden = true; },
    removeAttribute() { this.hidden = false; },
  };
  const rankingsRoot = {
    innerHTML: '',
    querySelector(selector) {
      if (selector === '.vote-rankings-more') return {
        addEventListener(_name, callback) { moreClick = callback; },
        querySelector() { return moreLabel; },
      };
      if (selector === '.vote-ranking-hidden') return hiddenBlock;
      return null;
    },
  };
  const select = { dataset: {}, innerHTML: '', value: '', addEventListener() {} };
  const roots = {
    mainPickLeader: { innerHTML: '' },
    mainPickRankings: rankingsRoot,
    debutRaceGrid: { innerHTML: '' },
    yearChampion: { innerHTML: '' },
    monthlyPicksGrid: { innerHTML: '' },
    voteArchiveYear: select,
    heroLeaderName: { textContent: '' },
    heroCampaignLabel: { textContent: '' },
  };
  const artists = Array.from({ length: 7 }, (_, index) => ({
    slug: `artist-${index}`,
    id: index + 1,
    status: 'public',
    publicName: `아티스트${index}`,
    summary: '작성자가 쓴 소개',
    images: { thumb: '/artist.png', cover: '/artist.png' },
  }));
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-27T00:00:00.000Z'])); }
  }
  const window = {
    location: { search: '' },
    luminaI18n: {
      t: key => dictionary[key]?.[locale] ?? key,
      getRegionalLocale: () => locale,
    },
    addEventListener(name, callback) {
      if (name === 'lumina:localechange') localeChange = callback;
    },
  };
  runInNewContext(pageSource, {
    window,
    document: { getElementById: id => roots[id] ?? null, addEventListener() {} },
    Date: FixedDate,
    Intl,
    URLSearchParams,
    _artists: artists,
    _currentCampaign: { name: '팬 캠페인' },
    apiFetch: async path => {
      if (path.endsWith('/main-pick')) return {
        campaign: { startsAt: '2026-04-27T00:00:00.000Z' },
        leader: { artist: { slug: artists[0].slug } },
        rankings: artists.map((artist, index) => ({ artist: { slug: artist.slug }, totalFreeLikes: 70 - index })),
      };
      if (path.includes('/monthly-picks')) return [{ month: 5, artist: { slug: artists[0].slug }, totalFreeLikes: 30 }];
      return { champion: null };
    },
    loadBoostState: async () => {},
    loadFreeLikeQuota: async () => {},
    updateHeroQuotaDisplay: () => {},
    getCharacterBySlug: slug => artists.find(artist => artist.slug === slug),
    getCharacterMessages: () => ({ tributeMessage: '작가가 쓴 수상 소감', voteAppeal: '작가가 쓴 응원 문구' }),
    getLikesCount: () => 10,
    formatLikeCount: String,
    likeButtonHTML: () => '<button>♥</button>',
    console,
  });
  await window.initPopularVotePage();
  assert.match(rankingsRoot.innerHTML, /2명 더보기/);
  moreClick();

  const expectations = [
    ['en-US', 'Show less', 'Monthly Pick', 'No selection recorded', '2026'],
    ['ja-JP', '閉じる', '今月のピック', '選出記録なし', '2026年'],
    ['zh-CN', '收起', '本月之选', '暂无评选记录', '2026年'],
    ['zh-Hant', '收起', '本月之選', '暫無評選記錄', '2026年'],
    ['ko-KR', '접기', '이달의 픽', '선정 기록 없음', '2026년'],
  ];
  for (const [nextLocale, more, monthly, empty, yearOption] of expectations) {
    locale = nextLocale;
    localeChange();
    assert.match(rankingsRoot.innerHTML, new RegExp(more));
    assert.match(roots.mainPickLeader.innerHTML, new RegExp(monthly));
    assert.match(roots.monthlyPicksGrid.innerHTML, new RegExp(empty));
    assert.match(select.innerHTML, new RegExp(yearOption));
    assert.equal(select.value, '2026');
    assert.equal(roots.heroCampaignLabel.textContent, '팬 캠페인');
    assert.match(roots.mainPickLeader.innerHTML, /작가가 쓴 수상 소감/);
    assert.match(roots.debutRaceGrid.innerHTML, /작가가 쓴 응원 문구/);
    assert.match(roots.debutRaceGrid.innerHTML, /작성자가 쓴 소개/);
  }

  artists[0].publicName = '<svg onload=alert(1)>';
  artists[0].images.cover = 'bad" onerror="alert(1)';
  artists[1].summary = '<img src=x onerror=alert(1)>';
  localeChange();
  assert.match(roots.mainPickLeader.innerHTML, /&lt;svg onload=alert\(1\)&gt;/);
  assert.match(roots.mainPickLeader.innerHTML, /src="bad&quot; onerror=&quot;alert\(1\)"/);
  assert.doesNotMatch(roots.mainPickLeader.innerHTML, /<svg onload=/);
  assert.match(rankingsRoot.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(rankingsRoot.innerHTML, /<img src=x onerror=/);
});

test('primary support button and quota label follow the active locale', () => {
  const authSource = appSource.slice(appSource.indexOf('const API_BASE ='), appSource.indexOf('const I18N_LOCALES ='));
  const sessionSource = appSource.slice(appSource.indexOf('let _currentCampaign = null;'), appSource.indexOf('function rankingMetricNumber('));
  const escapeSource = appSource.slice(
    appSource.indexOf('function feedEscapeHtml('),
    appSource.indexOf('function normalizeFeedAuthorType('),
  );
  const buttonSource = appSource.slice(
    appSource.indexOf('function likeButtonHTML('),
    appSource.indexOf('\nasync function handleLike('),
  );
  const quotaSource = appSource.slice(
    appSource.indexOf('let _freeLikeQuota = null;'),
    appSource.indexOf('/* ── 렌더링: 비공개', appSource.indexOf('function updateHeroQuotaDisplay()')),
  );
  let locale = 'en-US';
  const label = { textContent: '' };
  const authValue = JSON.stringify({ accessToken: 'synthetic-i18n-token', user: { id: 'synthetic-i18n-owner' } });
  const context = {
    document: { getElementById: id => id === 'voteTabs' ? {} : label, querySelectorAll: () => [] },
    localStorage: { getItem: () => authValue },
    window: { addEventListener() {} },
    _currentLocale: locale,
    getCharacterBySlug: () => ({ id: 'synthetic-i18n-artist' }),
    getLikesCount: () => 1200,
    formatLikeCount: String,
    t: key => dictionary[key]?.[locale] ?? key,
    Intl,
  };
  runInNewContext(`${authSource}\n${sessionSource}\n${escapeSource}\n${buttonSource}\n${quotaSource}\n
    _currentCampaign = { id: 'synthetic-i18n-campaign' };
    _freeLikeQuota = { dailyLimit: 5, remaining: 3 }; _freeLikeQuotaState = 'ready';
    this.render = { likeButtonHTML, updateHeroQuotaDisplay };`, context);
  assert.match(context.render.likeButtonHTML('artist-0'), /Support in Lumina Pick/);
  assert.match(context.render.likeButtonHTML('artist-0'), /1.2K/);
  context.render.updateHeroQuotaDisplay();
  assert.equal(label.textContent, '3/5 left today');

  locale = 'zh-Hant';
  context._currentLocale = locale;
  assert.match(context.render.likeButtonHTML('artist-0'), /在 Lumina Pick 應援/);
  context.render.updateHeroQuotaDisplay();
  assert.equal(label.textContent, '今日剩餘 3/5');
  const unsafe = context.render.likeButtonHTML('x" onmouseover="alert(1)');
  assert.match(unsafe, /data-like-slug="x&quot; onmouseover=&quot;alert\(1\)"/);
  assert.doesNotMatch(unsafe, /data-like-slug="x" onmouseover=/);
});
