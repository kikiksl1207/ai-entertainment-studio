import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/popular-vote.js', import.meta.url), 'utf8');

async function renderMonthlyArchive({ campaignStart, picks, monthlyRequestFails = false, now = '2026-09-27T00:00:00.000Z' }) {
  const roots = {
    yearChampion: { innerHTML: '' },
    monthlyPicksGrid: { innerHTML: '' },
  };
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
  }
  const window = { location: { search: '' } };
  const context = {
    window,
    document: { getElementById: (id) => roots[id] ?? null },
    Date: FixedDate,
    Intl,
    URLSearchParams,
    apiFetch: async (path) => {
      if (path.endsWith('/main-pick')) {
        return { campaign: campaignStart ? { startsAt: campaignStart } : null, leader: null, rankings: [] };
      }
      if (path.includes('/monthly-picks')) {
        if (monthlyRequestFails) throw new Error('monthly API unavailable');
        return picks;
      }
      return { champion: null };
    },
    loadBoostState: async () => {},
    loadFreeLikeQuota: async () => {},
    updateHeroQuotaDisplay: () => {},
    getCharacterBySlug: (slug) => slug === 'han-seoyul'
      ? { slug, publicName: '한서율', images: { thumb: '/han.png' } }
      : null,
    formatLikeCount: String,
    console,
  };
  runInNewContext(source, context);
  await window.initPopularVotePage();
  return roots.monthlyPicksGrid.innerHTML;
}

test('shows each completed month without inventing a missing winner', async () => {
  const html = await renderMonthlyArchive({
    campaignStart: '2026-04-27T00:00:00.000Z',
    picks: [{ month: 5, artist: { slug: 'han-seoyul' }, totalWeightedScore: '191' }],
  });

  for (const month of ['04', '05', '06', '07', '08']) {
    assert.match(html, new RegExp(`2026\\.${month}`));
  }
  assert.doesNotMatch(html, /2026\.09/);
  assert.equal((html.match(/선정 기록 없음/g) ?? []).length, 4);
  assert.equal((html.match(/한서율/g) ?? []).length, 2);
});

test('does not show the ongoing first month as a closed archive', async () => {
  const html = await renderMonthlyArchive({ campaignStart: '2026-09-01T00:00:00.000Z', picks: [] });
  assert.match(html, /첫 월간 1위/);
  assert.doesNotMatch(html, /2026\.09/);
});

test('shows a load error rather than marking failed requests as empty months', async () => {
  const html = await renderMonthlyArchive({
    campaignStart: '2026-04-27T00:00:00.000Z',
    picks: [],
    monthlyRequestFails: true,
  });
  assert.match(html, /월간 기록을 불러오지 못했어요/);
  assert.doesNotMatch(html, /선정 기록 없음/);
});

test('uses the winner campaign start when the current campaign is unavailable', async () => {
  const html = await renderMonthlyArchive({
    campaignStart: null,
    picks: [{ month: 5, artist: { slug: 'han-seoyul' }, campaign: { startsAt: '2026-04-27T00:00:00.000Z' } }],
  });
  assert.match(html, /2026\.04/);
  assert.match(html, /2026\.05/);
});

test('labels the just-closed month as pending during the archive grace window', async () => {
  const html = await renderMonthlyArchive({
    campaignStart: '2026-04-27T00:00:00.000Z',
    picks: [],
    now: '2026-09-30T15:02:00.000Z',
  });
  assert.match(html, /2026\.09<\/span><strong>집계 확정 중/);
});

test('refreshes at the KST month boundary and can inspect the previous year', async () => {
  let now = '2026-12-31T14:58:00.000Z';
  let intervalCallback;
  let yearChange;
  let monthlyFails = false;
  const requestedYears = [];
  class MovingDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const select = {
    dataset: {},
    innerHTML: '',
    value: '',
    addEventListener(_name, callback) { yearChange = callback; },
  };
  const roots = {
    yearChampion: { innerHTML: '' },
    monthlyPicksGrid: { innerHTML: '' },
    voteArchiveYear: select,
  };
  const window = {
    location: { search: '' },
    setInterval(callback) { intervalCallback = callback; },
  };
  const context = {
    window,
    document: { getElementById: (id) => roots[id] ?? null, addEventListener() {} },
    Date: MovingDate,
    Intl,
    URLSearchParams,
    apiFetch: async (path) => {
      if (path.endsWith('/main-pick')) return { campaign: { startsAt: '2026-04-27T00:00:00.000Z' }, leader: null, rankings: [] };
      const year = Number(new URL('https://example.test' + path).searchParams.get('year'));
      requestedYears.push(year);
      if (path.includes('/monthly-picks')) {
        if (monthlyFails) throw new Error('archive temporarily unavailable');
        return year === 2026 ? [{ month: 12, artist: { slug: 'han-seoyul' }, totalWeightedScore: '12' }] : [];
      }
      return { champion: null };
    },
    loadBoostState: async () => {},
    loadFreeLikeQuota: async () => {},
    updateHeroQuotaDisplay: () => {},
    getCharacterBySlug: (slug) => slug === 'han-seoyul'
      ? { slug, publicName: '한서율', images: { thumb: '/han.png' } }
      : null,
    formatLikeCount: String,
    console,
  };
  runInNewContext(source, context);
  await window.initPopularVotePage();
  assert.doesNotMatch(roots.monthlyPicksGrid.innerHTML, /2026\.12/);

  now = '2026-12-31T15:01:00.000Z';
  await intervalCallback();
  assert.equal(select.value, '2027');
  assert.ok(requestedYears.includes(2027));

  select.value = '2026';
  await yearChange();
  assert.match(roots.monthlyPicksGrid.innerHTML, /2026\.12/);
  assert.equal(select.dataset.bound, '1');

  now = '2026-12-31T15:11:00.000Z';
  const beforeSettlement = requestedYears.length;
  monthlyFails = true;
  await intervalCallback();
  assert.equal(requestedYears.length, beforeSettlement + 2);
  assert.match(roots.monthlyPicksGrid.innerHTML, /불러오지 못했/);
  monthlyFails = false;
  await intervalCallback();
  assert.equal(requestedYears.length, beforeSettlement + 4);
  assert.match(roots.monthlyPicksGrid.innerHTML, /2026\.12/);
  await intervalCallback();
  assert.equal(requestedYears.length, beforeSettlement + 4);
});
