import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Parent copies this new test into CLEAN/tests; it then reads the adjacent actual page.
const source = readFileSync(new URL('../pages/popular-vote.js', import.meta.url), 'utf8');
const MAIN = '/api/v1/popular-vote/main-pick';
const MONTHLY = '/api/v1/popular-vote/hall-of-fame/monthly-picks';
const ANNUAL = '/api/v1/popular-vote/hall-of-fame/year-champion';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function checkpoint(predicate) {
  for (let turn = 0; turn < 50; turn++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Expected synthetic VM request checkpoint');
}

function champion(year) {
  return { year, champion: { rankNo: 1, artist: { slug: `api-champion-${year}` },
    totalWeightedScore: '77', totalFreeLikes: '12', totalLuminaBoosts: '0' }, rankings: [] };
}

function harness({ now: initialNow = '2027-10-09T00:00:00.000Z',
  annual: initialAnnual = async year => ({ year, champion: null }) } = {}) {
  let now = initialNow, annual = initialAnnual, yearChange, boundCount = 0;
  const calls = [], events = new Map(), lookedUpSlugs = [];
  const select = { dataset: {}, innerHTML: '', value: '',
    addEventListener(name, callback) {
      assert.equal(name, 'change'); yearChange = callback; boundCount++;
    } };
  const roots = { yearChampion: { innerHTML: '' }, monthlyPicksGrid: { innerHTML: '' },
    voteArchiveYear: select };
  class MovingDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const translations = {
    'pick.status.loading': 'Loading annual archive',
    'pick.status.unavailable': 'Annual archive unavailable',
    'pick.year.champion': 'Champion {year}',
    'pick.year.score': 'Score {score}; year {year}',
  };
  const window = { location: { search: '' },
    luminaI18n: { t: key => translations[key] ?? key },
    setInterval() { return 1; },
    addEventListener(name, callback) { events.set(name, callback); } };
  const context = { window,
    document: { getElementById: id => roots[id] ?? null, addEventListener() {} },
    Date: MovingDate, Intl, URLSearchParams,
    apiFetch: async (requestPath, options = {}) => {
      const url = new URL(requestPath, 'https://synthetic.invalid');
      const year = Number(url.searchParams.get('year'));
      calls.push({ endpoint: url.pathname, year, method: options.method ?? 'GET' });
      if (url.pathname === MAIN) {
        return { campaign: { startsAt: '2026-04-01T00:00:00.000Z' }, leader: null, rankings: [] };
      }
      if (url.pathname === MONTHLY) return [];
      assert.equal(url.pathname, ANNUAL, 'Only the original three public reads are permitted');
      return annual(year, calls.filter(call => call.endpoint === ANNUAL).length);
    },
    loadBoostState: async () => {}, loadFreeLikeQuota: async () => {},
    updateHeroQuotaDisplay() {},
    getCharacterBySlug(slug) {
      lookedUpSlugs.push(slug);
      if (!/^api-champion-202[678]$/.test(slug)) return null;
      const year = slug.slice(-4);
      return { slug, publicName: `API Champion ${year} <Synthetic>`,
        images: { thumb: '/synthetic-champion.png', cover: '/synthetic-champion-cover.png' } };
    },
    formatLikeCount: String, console: { warn() {} },
  };
  runInNewContext(source, context);
  return { window, roots, select, calls, lookedUpSlugs,
    init: () => window.initPopularVotePage(),
    refresh: () => window.refreshPopularVotePage(),
    annualYears: () => calls.filter(call => call.endpoint === ANNUAL).map(call => call.year),
    setAnnual(callback) { annual = callback; },
    setNow(value) { now = value; },
    change(year) {
      assert.equal(typeof yearChange, 'function'); select.value = String(year); return yearChange();
    },
    locale() {
      const callback = events.get('lumina:localechange'); assert.equal(typeof callback, 'function'); callback();
    },
    boundCount: () => boundCount,
  };
}

function onlyOriginalGetReads(fixture) {
  assert.ok(fixture.calls.every(call => call.method === 'GET' && [MAIN, MONTHLY, ANNUAL].includes(call.endpoint)));
}

test('PICK annual archive status: stale captured year is invalidated after an awaited refresh', async () => {
  const f = harness();
  await f.init();
  const pendingAnnual = deferred();
  f.setAnnual(() => pendingAnnual.promise);
  const refresh = f.refresh();
  const staleChange = f.change(2026);
  assert.deepEqual(f.annualYears(), [2027, 2027]);
  // Observe a changed selection value without injecting internal application state.
  f.select.value = '2027';
  pendingAnnual.resolve({ year: 2027, champion: null });
  await Promise.all([refresh, staleChange]);
  assert.deepEqual(f.annualYears(), [2027, 2027]);
  assert.equal(f.select.value, '2027');
  assert.equal(f.boundCount(), 1);
  onlyOriginalGetReads(f);
});

test('PICK annual archive status: latest selected year wins two queued change events', async () => {
  const f = harness({ now: '2028-10-09T00:00:00.000Z', annual: async year => champion(year) });
  await f.init();
  const pendingAnnual = deferred();
  f.setAnnual(year => year === 2028 ? pendingAnnual.promise : Promise.resolve(champion(year)));
  const refresh = f.refresh();
  const oldChange = f.change(2026);
  const newestChange = f.change(2027);
  pendingAnnual.resolve(champion(2028));
  await Promise.all([refresh, oldChange, newestChange]);
  assert.deepEqual(f.annualYears(), [2028, 2028, 2027]);
  assert.equal(f.select.value, '2027');
  assert.match(f.roots.yearChampion.innerHTML, /Champion 2027/);
  assert.doesNotMatch(f.roots.yearChampion.innerHTML, /Champion 2028|vote-year-waiting|unavailable/);
  assert.equal(f.boundCount(), 1);
  onlyOriginalGetReads(f);
});

test('PICK annual archive status: failed annual read recovers only after explicit refresh', async () => {
  let failing = true;
  const f = harness({ annual: async year => {
    if (failing) throw new Error('Synthetic annual read failure');
    return champion(year);
  } });
  await f.init();
  assert.match(f.roots.yearChampion.innerHTML, /Annual archive unavailable/);
  assert.equal(f.calls.length, 3);
  await Promise.resolve();
  assert.equal(f.calls.length, 3, 'No automatic read retry is invented');
  failing = false;
  await f.refresh();
  assert.deepEqual(f.annualYears(), [2027, 2027]);
  assert.equal(f.calls.length, 6);
  assert.match(f.roots.yearChampion.innerHTML, /vote-year-champion-card/);
  assert.doesNotMatch(f.roots.yearChampion.innerHTML, /unavailable|vote-year-waiting/);
  onlyOriginalGetReads(f);
});

test('PICK annual archive status: a later annual failure retires the formerly displayed champion', async () => {
  const f = harness({ annual: async year => champion(year) });
  await f.init();
  assert.match(f.roots.yearChampion.innerHTML, /vote-year-champion-card/);
  f.setAnnual(async () => { throw new Error('Synthetic later annual failure'); });
  await f.refresh();
  assert.match(f.roots.yearChampion.innerHTML, /Annual archive unavailable/);
  assert.doesNotMatch(f.roots.yearChampion.innerHTML, /vote-year-champion-card|vote-year-waiting|API Champion/);
  assert.deepEqual(f.annualYears(), [2027, 2027]);
  onlyOriginalGetReads(f);
});

test('PICK annual archive status: normal API-shaped champion uses its actual returned artist and score', async () => {
  const f = harness({ annual: async year => champion(year) });
  await f.init();
  const html = f.roots.yearChampion.innerHTML;
  assert.deepEqual(f.annualYears(), [2027]);
  assert.deepEqual(f.lookedUpSlugs, ['api-champion-2027']);
  assert.match(html, /vote-year-champion-card/);
  assert.ok(html.includes('/character-detail?slug=api-champion-2027'));
  assert.ok(html.includes('API Champion 2027 &lt;Synthetic&gt;'));
  assert.ok(html.includes('Score 77; year 2027'));
  assert.ok(html.includes('/synthetic-champion-cover.png'));
  assert.doesNotMatch(html, /vote-year-waiting|unavailable|<Synthetic>/);
  onlyOriginalGetReads(f);
});

test('PICK annual archive status: two KST boundary crossings leave a reset loading state, not a stale champion', async () => {
  const f = harness({ now: '2026-12-31T14:59:00.000Z', annual: async year => champion(year) });
  await f.init();
  assert.match(f.roots.yearChampion.innerHTML, /Champion 2026/);
  const oldAnnual = deferred(), catchupAnnual = deferred();
  f.setAnnual(year => year === 2026 ? oldAnnual.promise : catchupAnnual.promise);
  const refresh = f.refresh();
  f.setNow('2026-12-31T15:01:00.000Z');
  oldAnnual.resolve(champion(2026));
  await checkpoint(() => f.annualYears().length === 3);
  assert.deepEqual(f.annualYears(), [2026, 2026, 2027]);
  assert.match(f.roots.yearChampion.innerHTML, /Loading annual archive/);
  f.setNow('2027-01-31T15:01:00.000Z');
  catchupAnnual.resolve(champion(2027));
  await refresh;
  f.locale();
  assert.match(f.roots.yearChampion.innerHTML, /Loading annual archive/);
  assert.doesNotMatch(f.roots.yearChampion.innerHTML, /vote-year-champion-card|vote-year-waiting|unavailable/);
  assert.equal(f.annualYears().length, 3, 'One catch-up only; no unbounded annual loop');
  assert.equal(f.select.value, '2027');
  assert.equal(f.boundCount(), 1);
  onlyOriginalGetReads(f);
});
