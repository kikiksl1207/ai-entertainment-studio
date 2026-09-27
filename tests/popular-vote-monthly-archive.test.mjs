import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/popular-vote.js', import.meta.url), 'utf8');

async function renderMonthlyArchive({ campaignStart, picks, monthlyRequestFails = false }) {
  const roots = {
    yearChampion: { innerHTML: '' },
    monthlyPicksGrid: { innerHTML: '' },
  };
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : ['2026-09-27T00:00:00.000Z']));
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
