import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/popular-vote.js', import.meta.url), 'utf8');
const testOptions = { concurrency: false, timeout: 5000 };
const initialNow = '2027-06-15T03:00:00.000Z';
const campaign = { startsAt: '2026-01-01T00:00:00.000Z', name: 'Synthetic campaign' };
const kinds = ['main-pick', 'monthly-picks', 'year-champion'];
const translations = {
  'pick.status.loading': 'Loading votes',
  'pick.status.unavailable': 'Vote totals unavailable',
  'pick.monthly.noVotes': 'No votes this month',
  'pick.archive.loadError': 'Archive unavailable',
  'pick.archive.noRecord': 'No selection recorded',
  'pick.archive.firstPending': '{year} first monthly winner pending',
  'pick.archive.yearOption': '{year} year',
  'pick.year.champion': '{year} annual champion',
};

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function element(isSelect = false) {
  let html = '';
  let value = '';
  let options = [];
  return {
    dataset: {}, textContent: '', listeners: new Map(), writes: [],
    get innerHTML() { return html; },
    set innerHTML(markup) {
      html = String(markup);
      this.writes.push(html);
      if (isSelect) {
        // Replacing native options loses the old selection before .value is assigned.
        options = [...html.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
        value = options[0] ?? '';
      }
    },
    get value() { return value; },
    set value(next) {
      value = !isSelect || options.includes(String(next)) ? String(next) : '';
    },
    querySelector() { return null; },
    addEventListener(name, callback) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
    },
  };
}

function runtime() {
  let now = initialNow;
  let language = 'A';
  const requests = [];
  const counts = Object.fromEntries(kinds.map(kind => [kind, 0]));
  const gates = new Map();
  const failures = new Set();
  const emptyPasses = new Set();
  const intervals = [];
  const events = new Map();
  const roots = Object.fromEntries([
    'mainPickLeader', 'mainPickRankings', 'heroLeaderName', 'heroCampaignLabel',
    'yearChampion', 'monthlyPicksGrid', 'debutRaceGrid',
  ].map(id => [id, element()]));
  roots.voteArchiveYear = element(true);
  class MovingDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  }
  const window = {
    location: { search: '' },
    luminaI18n: { t: key => translations[key] ? `${language} ${translations[key]}` : key },
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    addEventListener(name, callback) {
      events.set(name, [...(events.get(name) ?? []), callback]);
    },
  };
  const context = {
    window, Date: MovingDate, Intl, URLSearchParams,
    document: { hidden: false, getElementById: id => roots[id] ?? null, addEventListener() {} },
    apiFetch: async (path, options = {}) => {
      const url = new URL(path, 'https://synthetic.invalid');
      const kind = url.pathname.split('/').at(-1);
      assert.ok(kinds.includes(kind), 'only the three expected read endpoints are allowed');
      const pass = ++counts[kind];
      const year = url.searchParams.has('year') ? Number(url.searchParams.get('year')) : null;
      requests.push({ kind, path, year, method: String(options.method ?? 'GET').toUpperCase() });
      if (gates.has(pass)) await gates.get(pass).promise;
      if (failures.has(`${pass}:${kind}`)) throw new Error('SYNTHETIC_READ_FAILURE');
      if (kind === 'main-pick') return { campaign, leader: null, rankings: [] };
      if (kind === 'year-champion') return { year, champion: null };
      return { items: emptyPasses.has(pass) ? [] : [
        { month: 1, artist: { slug: `synthetic-${year}` }, totalWeightedScore: '1', campaign },
      ] };
    },
    loadBoostState: async () => {}, loadFreeLikeQuota: async () => {},
    updateHeroQuotaDisplay() {}, _artists: [], _currentCampaign: null,
    getCharacterBySlug: slug => /^synthetic-202[678]$/.test(slug) ? {
      slug, publicName: `WINNER_${slug.slice(-4)}`, images: { thumb: '/synthetic.png' },
    } : null,
    getCharacterMessages: () => ({ tributeMessage: 'Synthetic thanks' }),
    getLikesCount: () => 0, formatLikeCount: String, console: { warn() {} },
  };
  // Load the complete module; never replace its loader, coordinator, or renderers.
  runInNewContext(source, context, { timeout: 1000, filename: 'pages/popular-vote.js' });
  return {
    window, roots, requests,
    hold(pass) { const gate = deferred(); gates.set(pass, gate); return gate; },
    fail(pass, ...names) { for (const name of names) failures.add(`${pass}:${name}`); },
    empty(pass) { emptyPasses.add(pass); },
    setNow(value) { now = value; },
    handlerCount() { return roots.voteArchiveYear.listeners.get('change')?.length ?? 0; },
    changeYear(year) {
      const select = roots.voteArchiveYear;
      assert.equal(this.handlerCount(), 1, 'one native change handler');
      select.value = String(year);
      assert.equal(select.value, String(year), 'the requested year is actually offered');
      return select.listeners.get('change')[0]();
    },
    locale(next) {
      language = next;
      const callbacks = events.get('lumina:localechange') ?? [];
      assert.equal(callbacks.length, 1, 'one actual module locale listener');
      callbacks[0]();
    },
    tick() {
      assert.equal(intervals.length, 1, 'one actual calendar watcher');
      return intervals[0]();
    },
    async waitForPass(pass) {
      for (let turn = 0; turn < 50; turn++) {
        if (kinds.every(kind => counts[kind] >= pass)) return;
        await yieldImmediate();
      }
      assert.fail(`Expected GET triplet ${pass}`);
    },
  };
}

async function initialized() {
  const h = runtime();
  await h.window.initPopularVotePage();
  assert.equal(h.roots.voteArchiveYear.value, '2027');
  assert.equal((h.roots.voteArchiveYear.innerHTML.match(/<option /g) ?? []).length, 2);
  return h;
}

function assertReads(h, years) {
  assert.equal(h.requests.length, years.length * 3, 'one GET triplet per refresh');
  for (const kind of kinds) {
    const reads = h.requests.filter(request => request.kind === kind);
    assert.deepEqual(reads.map(request => request.method), years.map(() => 'GET'));
    assert.deepEqual(reads.map(request => request.path), years.map(year => kind === 'main-pick'
      ? '/api/v1/popular-vote/main-pick'
      : `/api/v1/popular-vote/hall-of-fame/${kind}?year=${year}`));
  }
}

test('PICK-INTENT-NEW-1: locale rerender preserves the latest queued archive year', testOptions, async () => {
  const h = await initialized();
  const gate = h.hold(2);
  const previous = h.changeYear(2026);
  await h.waitForPass(2);
  const latest = h.changeYear(2027);
  h.locale('B');
  const selectedAfterLocale = h.roots.voteArchiveYear.value;
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /B Loading votes/);
  gate.resolve();
  await Promise.all([previous, latest]);

  assert.equal(selectedAfterLocale, '2027', 'locale-only rerender must preserve the queued 2027 intent');
  assert.equal(h.roots.voteArchiveYear.value, '2027');
  assert.match(h.roots.voteArchiveYear.innerHTML, />B 2027 year</);
  assert.match(h.roots.yearChampion.innerHTML, /B 2027 annual champion/);
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /2027\.01/);
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /WINNER_2027/);
  assert.doesNotMatch(h.roots.monthlyPicksGrid.innerHTML, /2026\.|WINNER_2026/);
  assertReads(h, [2027, 2026, 2027]);
});

test('PICK-INTENT-NEW-2: superseded queued years never replace the latest selection', testOptions, async () => {
  const h = await initialized();
  const gate = h.hold(2);
  const previous = h.changeYear(2026);
  await h.waitForPass(2);
  const superseded = h.changeYear(2027);
  const latest = h.changeYear(2026);
  h.locale('B');
  h.locale('A');
  assert.equal(h.roots.voteArchiveYear.value, '2026');
  assertReads(h, [2027, 2026]);
  gate.resolve();
  await Promise.all([previous, superseded, latest]);

  assert.equal(h.roots.voteArchiveYear.value, '2026');
  assert.match(h.roots.yearChampion.innerHTML, /A 2026 annual champion/);
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /2026\.01/);
  assert.doesNotMatch(h.roots.monthlyPicksGrid.innerHTML, /2027\.|WINNER_2027/);
  assertReads(h, [2027, 2026, 2026]);
});

test('PICK-INTENT-NEW-3: calendar rollover still resets the archive year', testOptions, async () => {
  const h = await initialized();
  await h.changeYear(2026);
  const gate = h.hold(3);
  const previous = h.window.refreshPopularVotePage();
  await h.waitForPass(3);
  h.setNow('2027-12-31T15:11:00.000Z'); // January 2028 in the module's explicit KST scope.
  const watcher = h.tick();
  h.locale('B');
  assert.equal(h.roots.voteArchiveYear.value, '2028', 'calendar reset outranks the old archive choice');
  gate.resolve();
  await Promise.all([previous, watcher]);

  assert.equal(h.roots.voteArchiveYear.value, '2028');
  assert.match(h.roots.voteArchiveYear.innerHTML, /value="2028"/);
  assert.match(h.roots.yearChampion.innerHTML, /B 2028 annual champion/);
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /2028 first monthly winner pending/);
  assert.doesNotMatch(h.roots.monthlyPicksGrid.innerHTML, /2026\.|2027\.|WINNER_2026/);
  await h.tick();
  assertReads(h, [2027, 2026, 2026, 2028]);
});

test('PICK-INTENT-NEW-4: locale changes bind one native year handler and preserve load failures', testOptions, async () => {
  const h = await initialized();
  const gate = h.hold(2);
  h.fail(2, 'monthly-picks', 'year-champion');
  const failed = h.changeYear(2026);
  await h.waitForPass(2);
  for (const language of ['B', 'A', 'B']) {
    h.locale(language);
    assert.equal(h.handlerCount(), 1);
    assert.equal(h.roots.voteArchiveYear.dataset.bound, '1');
  }
  assertReads(h, [2027, 2026]);
  gate.resolve();
  await failed;

  assert.equal(h.roots.voteArchiveYear.value, '2026');
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /B Archive unavailable/);
  assert.match(h.roots.yearChampion.innerHTML, /B Vote totals unavailable/);
  assert.doesNotMatch(h.roots.monthlyPicksGrid.innerHTML, /No selection recorded|WINNER_/);
  h.locale('A');
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /A Archive unavailable/);
  assert.match(h.roots.yearChampion.innerHTML, /A Vote totals unavailable/);
  assertReads(h, [2027, 2026]);
  h.empty(3);
  await h.window.refreshPopularVotePage();
  h.locale('A');
  assert.equal(h.handlerCount(), 1);
  assert.equal(h.roots.voteArchiveYear.value, '2026');
  assert.match(h.roots.monthlyPicksGrid.innerHTML, /A No selection recorded/);
  assert.doesNotMatch(h.roots.monthlyPicksGrid.innerHTML, /Archive unavailable|WINNER_/);
  assert.match(h.roots.yearChampion.innerHTML, /A 2026 annual champion/);
  assertReads(h, [2027, 2026, 2026]);
});
