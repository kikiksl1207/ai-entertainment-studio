import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/popular-vote.js', import.meta.url), 'utf8');
const testOptions = { concurrency: false, timeout: 5000 };
const campaign = { startsAt: '2026-04-27T00:00:00.000Z', name: 'Monthly campaign' };
const voteRootIds = ['mainPickLeader', 'mainPickRankings', 'heroLeaderName', 'yearChampion', 'monthlyPicksGrid'];
const formerNames = /FORMER_(?:MAIN_LEADER|RUNNER|ARCHIVE_WINNER|YEAR_CHAMPION)/;
const translations = {
  'pick.status.loading': 'Loading votes',
  'pick.status.awaitingVote': 'Awaiting first vote',
  'pick.status.unavailable': 'Vote totals unavailable',
  'pick.monthly.noVotes': 'No votes this month',
  'pick.monthly.loadError': 'Monthly totals unavailable',
  'pick.archive.loadError': 'Archive unavailable',
  'pick.archive.noRecord': 'No selection recorded',
  'pick.archive.settling': 'Archive settling',
  'pick.archive.firstPending': '{year} first monthly winner pending',
  'pick.year.champion': '{year} annual champion',
};
const artists = Object.fromEntries([
  ['former-main', 'FORMER_MAIN_LEADER'],
  ['former-runner', 'FORMER_RUNNER'],
  ['former-archive', 'FORMER_ARCHIVE_WINNER'],
  ['former-champion', 'FORMER_YEAR_CHAMPION'],
  ['current-main', 'CURRENT_MAIN_LEADER'],
  ['current-archive', 'CURRENT_ARCHIVE_WINNER'],
  ['current-champion', 'CURRENT_YEAR_CHAMPION'],
].map(([slug, publicName]) => [slug, {
  slug, publicName, summary: publicName, images: { thumb: `/${slug}.png`, cover: `/${slug}.png` },
}]));

function row(slug) {
  return { artist: { slug }, totalWeightedScore: '91' };
}

function mainPick(slug = null, runner = null) {
  const leader = slug ? row(slug) : null;
  return { campaign, leader, rankings: leader ? [leader, ...(runner ? [row(runner)] : [])] : [] };
}

function monthlyPick(month, slug) {
  return { month, ...row(slug), campaign };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not finish within 1500ms`)), 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function element() {
  const values = { innerHTML: '', textContent: '' };
  const node = {
    dataset: {}, value: '', writes: [], listeners: new Map(),
    querySelector: () => null,
    addEventListener(name, callback) {
      const callbacks = this.listeners.get(name) ?? [];
      callbacks.push(callback);
      this.listeners.set(name, callbacks);
    },
  };
  for (const property of Object.keys(values)) {
    Object.defineProperty(node, property, {
      get: () => values[property],
      set(value) {
        values[property] = String(value);
        node.writes.push(String(value));
      },
    });
  }
  return node;
}

function runtime({ now: initialNow, respond }) {
  let now = initialNow;
  const requests = [];
  const intervals = [];
  const counts = { 'main-pick': 0, 'monthly-picks': 0, 'year-champion': 0 };
  const roots = Object.fromEntries([
    ...voteRootIds, 'heroCampaignLabel', 'voteArchiveYear', 'debutRaceGrid',
  ].map(id => [id, element()]));
  class MovingDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  }
  const window = {
    location: { search: '' },
    luminaI18n: { t: key => translations[key] ?? key },
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    addEventListener() {},
  };
  const context = {
    window,
    document: { hidden: false, getElementById: id => roots[id] ?? null, addEventListener() {} },
    Date: MovingDate, Intl, URLSearchParams,
    apiFetch: async (path, options = {}) => {
      const url = new URL(path, 'https://example.test');
      const kind = url.pathname.split('/').at(-1);
      const request = {
        path, kind, pass: ++counts[kind], at: now,
        year: url.searchParams.has('year') ? Number(url.searchParams.get('year')) : null,
        method: String(options.method ?? 'GET').toUpperCase(),
      };
      requests.push(request);
      return respond(request);
    },
    loadBoostState: async () => {},
    loadFreeLikeQuota: async () => {},
    updateHeroQuotaDisplay() {},
    _artists: [], _currentCampaign: null,
    getCharacterBySlug: slug => artists[slug] ?? null,
    getCharacterMessages: () => ({ tributeMessage: 'Thank you for your support', voteAppeal: 'Support me' }),
    getLikesCount: () => 999999,
    formatLikeCount: String,
    console: { warn() {} },
  };
  // Execute the untouched IIFE, including its real loader, refresh coordinator, and renderers.
  runInNewContext(source, context, { timeout: 1000, filename: 'pages/popular-vote.js' });
  return {
    window, roots, requests,
    setNow(value) { now = value; },
    async waitForPass(pass) {
      for (let turn = 0; turn < 50; turn++) {
        if (Object.values(counts).every(count => count >= pass)) return;
        await yieldImmediate();
      }
      assert.fail(`Expected all three GETs for pass ${pass}; got ${JSON.stringify(counts)}`);
    },
    tick() {
      assert.equal(intervals.length, 1, 'initialization installs one boundary watcher');
      return intervals[0]();
    },
    changeYear(year) {
      const select = roots.voteArchiveYear;
      const callbacks = select.listeners.get('change') ?? [];
      assert.equal(callbacks.length, 1, 'archive-year selection is bound only once');
      select.value = String(year);
      return callbacks[0]();
    },
    clearWrites() { for (const root of Object.values(roots)) root.writes.length = 0; },
    rendered() { return voteRootIds.flatMap(id => roots[id].writes).join('\n'); },
    visible() { return voteRootIds.map(id => `${roots[id].innerHTML}\n${roots[id].textContent}`).join('\n'); },
  };
}

function assertReads(harness, years) {
  assert.equal(harness.requests.length, years.length * 3, 'exactly one GET triplet per pass');
  for (const kind of ['main-pick', 'monthly-picks', 'year-champion']) {
    const requests = harness.requests.filter(request => request.kind === kind);
    assert.equal(requests.length, years.length, `${kind} is not duplicated`);
    assert.deepEqual(requests.map(request => request.method), years.map(() => 'GET'), 'catch-up never POSTs');
    assert.deepEqual(requests.map(request => request.path), years.map(year => kind === 'main-pick'
      ? '/api/v1/popular-vote/main-pick'
      : `/api/v1/popular-vote/hall-of-fame/${kind}?year=${year}`));
    assert.deepEqual(requests.map(request => request.year), years.map(year => kind === 'main-pick' ? null : year));
  }
}

function assertCleared(harness) {
  assert.doesNotMatch(harness.visible(), formerNames, 'old main, rankings, archive, and champion are cleared');
  assert.equal(harness.roots.heroLeaderName.textContent, 'Loading votes');
  assert.equal(harness.roots.mainPickRankings.innerHTML, '');
  assert.match(harness.roots.yearChampion.innerHTML, /Loading votes/);
  assert.match(harness.roots.monthlyPicksGrid.innerHTML, /Loading votes/);
}

test('a delayed main response crossing KST midnight is discarded before one GET catch-up', testOptions, async () => {
  const first = deferred();
  const second = deferred();
  const h = runtime({
    now: '2026-09-30T14:59:59.999Z',
    respond({ kind, pass }) {
      if (kind === 'main-pick') return pass === 1 ? first.promise : second.promise;
      if (kind === 'monthly-picks') return pass === 1 ? [monthlyPick(5, 'former-archive')] : [];
      return { champion: pass === 1 ? row('former-champion') : null };
    },
  });
  const initialized = h.window.initPopularVotePage();
  await h.waitForPass(1);
  h.setNow('2026-09-30T15:00:00.000Z');
  first.resolve(mainPick('former-main', 'former-runner'));
  await h.waitForPass(2);
  assertCleared(h);
  assert.doesNotMatch(h.rendered(), formerNames, 'stale responses never render, even temporarily');
  second.resolve(mainPick());
  await bounded(initialized, 'month-boundary initialization');

  assert.equal(h.roots.heroLeaderName.textContent, 'Awaiting first vote');
  assert.match(h.roots.mainPickLeader.innerHTML, /No votes this month/);
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /2026\.09<\/span><strong>Archive settling/);
  assert.doesNotMatch(h.roots.monthlyPicksGrid.innerHTML, /2026\.10/);
  assert.doesNotMatch(h.rendered(), formerNames);
  await bounded(h.tick(), 'stable month-boundary watcher');
  assertReads(h, [2026, 2026]);
});

test('a December response keeps its captured 2026 query year and cannot mark January 2027 loaded', testOptions, async () => {
  const first = deferred();
  const second = deferred();
  const h = runtime({
    now: '2026-12-31T14:59:59.999Z',
    respond({ kind, pass, year }) {
      if (kind === 'main-pick') return pass === 1 ? first.promise : second.promise;
      if (kind === 'monthly-picks') return year === 2026 ? [monthlyPick(12, 'former-archive')] : [];
      return { year, champion: year === 2026 ? row('former-champion') : null };
    },
  });
  const initialized = h.window.initPopularVotePage();
  await h.waitForPass(1);
  h.setNow('2026-12-31T15:00:00.000Z');
  first.resolve(mainPick('former-main'));
  await h.waitForPass(2);
  assertCleared(h);
  assert.doesNotMatch(h.rendered(), formerNames);
  second.resolve(mainPick());
  await bounded(initialized, 'year-boundary initialization');

  assert.equal(h.roots.voteArchiveYear.value, '2027');
  assert.match(h.roots.voteArchiveYear.innerHTML, /value="2027"/);
  assert.match(h.roots.yearChampion.innerHTML, /2027 annual champion/);
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /2027 first monthly winner pending/);
  assert.doesNotMatch(h.roots.monthlyPicksGrid.innerHTML, /2026\.12|2027\.01/);
  assert.equal(h.roots.heroLeaderName.textContent, 'Awaiting first vote');
  assert.doesNotMatch(h.rendered(), formerNames);
  await bounded(h.tick(), 'stable January watcher');
  assertReads(h, [2026, 2027]);
});

test('the exact 00:10 KST grace cutoff rejects in-flight settling data and renders only settled data', testOptions, async () => {
  const first = deferred();
  const second = deferred();
  const h = runtime({
    now: '2026-09-30T15:09:59.999Z',
    respond({ kind, pass }) {
      if (kind === 'main-pick') return pass === 1 ? first.promise : second.promise;
      if (kind === 'monthly-picks') return pass === 1 ? [] : { items: [monthlyPick(9, 'current-archive')] };
      return { champion: null };
    },
  });
  const initialized = h.window.initPopularVotePage();
  await h.waitForPass(1);
  h.setNow('2026-09-30T15:10:00.000Z');
  first.resolve(mainPick('former-main'));
  await h.waitForPass(2);
  assertCleared(h);
  assert.doesNotMatch(h.rendered(), /FORMER_MAIN_LEADER|No selection recorded|Archive settling/);
  second.resolve(mainPick('current-main'));
  await bounded(initialized, 'grace-cutoff initialization');

  assert.equal(h.roots.heroLeaderName.textContent, 'CURRENT_MAIN_LEADER');
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /2026\.09/);
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /CURRENT_ARCHIVE_WINNER/);
  assert.doesNotMatch(h.roots.monthlyPicksGrid.innerHTML, /Archive settling/);
  assert.doesNotMatch(h.rendered(), formerNames);
  await bounded(h.tick(), 'already-settled watcher');
  assertReads(h, [2026, 2026]);
});

test('duplicate refreshes share the rollover catch-up and failed GETs never restore former leaders or empty archives', testOptions, async () => {
  const stale = deferred();
  const catchUp = deferred();
  const h = runtime({
    now: '2026-09-30T14:58:00.000Z',
    respond({ kind, pass }) {
      if (kind === 'main-pick') {
        if (pass === 1) return mainPick('former-main', 'former-runner');
        if (pass === 2) return stale.promise;
        if (pass === 3) return catchUp.promise;
        return mainPick();
      }
      if (pass === 3) throw new Error('catch-up API unavailable');
      if (kind === 'monthly-picks') return pass <= 2 ? [monthlyPick(5, 'former-archive')] : [];
      return { champion: pass <= 2 ? row('former-champion') : null };
    },
  });
  await bounded(h.window.initPopularVotePage(), 'seeded September initialization');
  assert.match(h.roots.mainPickLeader.innerHTML, /FORMER_MAIN_LEADER/);
  assert.match(h.roots.mainPickRankings.innerHTML, /FORMER_RUNNER/);
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /FORMER_ARCHIVE_WINNER/);
  assert.match(h.roots.yearChampion.innerHTML, /FORMER_YEAR_CHAMPION/);
  h.clearWrites();
  const refresh = h.window.refreshPopularVotePage();
  assert.strictEqual(h.window.refreshPopularVotePage(), refresh);
  await h.waitForPass(2);
  h.setNow('2026-09-30T15:01:00.000Z');
  const watcher = h.tick();
  assert.strictEqual(h.window.refreshPopularVotePage(), refresh);
  stale.reject(new Error('old-month main request failed after rollover'));
  await h.waitForPass(3);
  assertCleared(h);
  assert.doesNotMatch(h.rendered(), formerNames);
  assert.strictEqual(h.window.refreshPopularVotePage(), refresh, 'catch-up remains in the same refresh');
  catchUp.reject(new Error('new-month main request failed'));
  await bounded(Promise.all([refresh, watcher]), 'shared failing refresh');

  assert.equal(h.roots.heroLeaderName.textContent, 'Vote totals unavailable');
  assert.match(h.roots.mainPickLeader.innerHTML, /Monthly totals unavailable/);
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /Archive unavailable/);
  assert.doesNotMatch(h.roots.monthlyPicksGrid.innerHTML, /No selection recorded/);
  assert.doesNotMatch(h.rendered(), formerNames);
  assertReads(h, [2026, 2026, 2026]);

  h.setNow('2026-09-30T15:10:00.000Z');
  await bounded(h.tick(), 'archive-failure retry at settlement');
  assert.equal(h.roots.heroLeaderName.textContent, 'Awaiting first vote');
  assert.match(h.roots.mainPickLeader.innerHTML, /No votes this month/);
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /No selection recorded/);
  assert.doesNotMatch(h.roots.monthlyPicksGrid.innerHTML, /Archive unavailable|Archive settling/);
  assert.doesNotMatch(h.rendered(), formerNames);
  await bounded(h.tick(), 'successful settlement is not fetched twice');
  assertReads(h, [2026, 2026, 2026, 2026]);
});

test('time changing in both passes stops at two GET triplets, leaves loading, and releases the refresh lock', testOptions, async () => {
  const first = deferred();
  const second = deferred();
  const h = runtime({
    now: '2026-09-30T14:59:59.999Z',
    respond({ kind, pass }) {
      // Later reads stay stable so an erroneous third pass fails by count, not an infinite clock loop.
      if (kind === 'main-pick') return pass === 1 ? first.promise : pass === 2 ? second.promise : mainPick('current-main');
      if (kind === 'monthly-picks') return [monthlyPick(9, pass === 1 ? 'former-archive' : 'current-archive')];
      return { champion: pass === 1 ? row('former-champion') : null };
    },
  });
  const initialized = h.window.initPopularVotePage();
  await h.waitForPass(1);
  h.setNow('2026-10-01T15:00:00.000Z');
  first.resolve(mainPick('former-main'));
  await h.waitForPass(2);
  h.setNow('2026-11-01T15:00:00.000Z');
  second.resolve(mainPick('current-main'));
  await bounded(initialized, 'twice-changing initialization');

  assertReads(h, [2026, 2026]);
  assertCleared(h);
  assert.doesNotMatch(h.rendered(), /FORMER_|CURRENT_MAIN_LEADER|CURRENT_ARCHIVE_WINNER/);
  await bounded(h.window.refreshPopularVotePage(), 'later stable explicit refresh');
  assert.equal(h.roots.heroLeaderName.textContent, 'CURRENT_MAIN_LEADER');
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /CURRENT_ARCHIVE_WINNER/);
  assertReads(h, [2026, 2026, 2026]);
});

test('a selected previous archive year survives a grace-only rollover and its in-flight catch-up', testOptions, async () => {
  const stale = deferred();
  const catchUp = deferred();
  const h = runtime({
    now: '2026-12-31T15:08:00.000Z',
    respond({ kind, pass, year }) {
      if (kind === 'main-pick') {
        if (pass === 3) return stale.promise;
        if (pass === 4) return catchUp.promise;
        return mainPick();
      }
      if (kind === 'monthly-picks') return year === 2026
        ? { picks: [monthlyPick(12, pass === 4 ? 'current-archive' : 'former-archive')] }
        : [];
      return { year, champion: year === 2026 ? row(pass === 4 ? 'current-champion' : 'former-champion') : null };
    },
  });
  await bounded(h.window.initPopularVotePage(), 'January initialization');
  assert.equal(h.roots.voteArchiveYear.value, '2027');
  await bounded(h.changeYear(2026), 'previous-year selection');
  assert.equal(h.roots.voteArchiveYear.value, '2026');
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /2026\.12/);
  assert.match(h.roots.yearChampion.innerHTML, /2026 annual champion/);
  h.clearWrites();
  h.setNow('2026-12-31T15:09:59.999Z');
  const refresh = h.window.refreshPopularVotePage();
  await h.waitForPass(3);
  h.setNow('2026-12-31T15:10:00.000Z');
  const watcher = h.tick();
  stale.resolve(mainPick('former-main'));
  await h.waitForPass(4);
  assertCleared(h);
  assert.equal(h.roots.voteArchiveYear.value, '2026', 'grace-only reset preserves selection');
  assert.doesNotMatch(h.rendered(), formerNames);
  catchUp.resolve(mainPick('current-main'));
  await bounded(Promise.all([refresh, watcher]), 'previous-year settlement catch-up');

  assert.equal(h.roots.voteArchiveYear.value, '2026');
  assert.equal(h.roots.voteArchiveYear.dataset.bound, '1');
  assert.match(h.roots.voteArchiveYear.innerHTML, /value="2027"/);
  assert.match(h.roots.voteArchiveYear.innerHTML, /value="2026"/);
  assert.equal(h.roots.heroLeaderName.textContent, 'CURRENT_MAIN_LEADER');
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /2026\.12/);
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /CURRENT_ARCHIVE_WINNER/);
  assert.match(h.roots.yearChampion.innerHTML, /2026 annual champion/);
  assert.match(h.roots.yearChampion.innerHTML, /CURRENT_YEAR_CHAMPION/);
  assert.doesNotMatch(h.rendered(), formerNames);
  await bounded(h.tick(), 'selected-year stable watcher');
  assertReads(h, [2027, 2026, 2026, 2026]);
});
