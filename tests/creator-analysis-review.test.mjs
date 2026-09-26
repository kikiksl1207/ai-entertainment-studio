import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness, makeJob, makeEvidence, response, failure, deferred, element, click, evidenceItems,
  ids, citation, quoteText, script } from './creator-analysis-review.test-support.mjs';

test('restored receipt stays idle; fresh submit and double activation send one retained-key POST', async () => {
  const gate = deferred();
  const screen = createHarness({ handler: (call, route, screen) => {
    if (call.options.method === 'POST') {
      assert.equal([...screen.storage.values()].some(value => value.includes(call.options.headers['Idempotency-Key'])), true);
      return gate.promise;
    }
    return route(call.path, call.options);
  } });
  assert.equal(screen.calls.length, 0);
  assert.equal(element(screen, 'Start').hidden, false);
  screen.receive({ fromSubmit: true });
  screen.receive({ fromSubmit: true });
  await click(screen, 'Start');
  assert.equal(screen.posts().length, 1);
  gate.resolve(response(makeJob())); await screen.flush();
  assert.equal(screen.calls.filter(call => call.path.includes(`/analyses/${ids.job}`)).length, 1);
  assert.equal(screen.posts()[0].path, `/api/v1/me/creator-studio/manuscripts/${ids.manuscript}/analyses`);
  assert.equal(screen.posts()[0].options.body, undefined);
  assert.match(element(screen, 'State').textContent, /writerAnalysis.completed/);
  assert.equal(evidenceItems(screen).length, 1);
});

test('submit replay after reload reuses the unknown key, while known jobs resume by GET', async () => {
  const storage = new Map();
  const first = createHarness({ storage, handler: () => { throw new Error('lost acknowledgement'); } });
  first.receive({ fromSubmit: true }); await first.flush();
  const key = first.posts()[0].options.headers['Idempotency-Key'];
  const replay = createHarness({ storage, receipt: false });
  assert.equal(replay.posts().length, 0);
  replay.receive({ fromSubmit: true }); await replay.flush();
  assert.equal(replay.posts().length, 1);
  assert.equal(replay.posts()[0].options.headers['Idempotency-Key'], key);
  const known = createHarness({ storage, receipt: false });
  known.receive({ fromSubmit: true }); await known.flush();
  assert.equal(known.posts().length, 0);
  assert.ok(known.calls.some(call => call.path.includes(`/analyses/${ids.job}`)));
});

test('stale submit receipts cannot enqueue for another owner, work or source locale', async () => {
  for (const change of [
    screen => screen.setIdentity({ ownerId: 'other-owner', epoch: 2 }),
    screen => screen.setContext({ workId: ids.job }),
    screen => screen.setContext({ sourceLocale: 'ja' })
  ]) {
    const screen = createHarness({ receipt: false });
    const stale = { id: ids.manuscript, workId: ids.work, sourceLocale: 'ko',
      identity: { ownerId: 'fixture-owner', epoch: 1 } };
    change(screen);
    screen.receive({ fromSubmit: true }, stale); await screen.flush();
    assert.equal(screen.posts().length, 0);
    assert.equal(screen.elements.writerAnalysis.hidden, true);
  }
});

test('unknown enqueue replays the original key after local reload without reupload or discovery guess', async () => {
  const storage = new Map();
  const first = createHarness({ storage, handler: () => { throw new Error('lost acknowledgement'); } });
  await click(first, 'Start');
  assert.match(element(first, 'State').textContent, /writerAnalysis.unknown/);
  const key = first.posts()[0].options.headers['Idempotency-Key'];
  const reload = createHarness({ storage, receipt: false });
  assert.equal(reload.calls.length, 0, 'unknown enqueue is not automatically resubmitted');
  await click(reload, 'Check');
  assert.equal(reload.posts().length, 1);
  assert.equal(reload.posts()[0].options.headers['Idempotency-Key'], key);
  assert.ok(reload.calls.every(call => !call.path.includes('/paste')));
});

test('known local job resumes through GET only, including a failed first read', async () => {
  const storage = new Map();
  const first = createHarness({ storage }); await click(first, 'Start');
  let reads = 0;
  const reload = createHarness({ storage, receipt: false, handler: (call, route) => ++reads === 1 ? failure('HTTP_INTERNAL_ERROR', 500) : route(call.path, call.options) });
  await reload.flush();
  assert.match(element(reload, 'State').textContent, /writerAnalysis.loadFailed/);
  assert.equal(element(reload, 'Check').hidden, false);
  await click(reload, 'Check');
  assert.equal(reload.posts().length, 0);
  assert.match(element(reload, 'State').textContent, /writerAnalysis.completed/);
});

test('actual nested reserved-version envelope never invents the missing analysisJobId or reuploads', async () => {
  const screen = createHarness({ handler: () => failure('ANALYSIS_VERSION_ALREADY_RESERVED') });
  await click(screen, 'Start');
  assert.match(element(screen, 'State').textContent, /writerAnalysis.reserved/);
  assert.equal(element(screen, 'Start').hidden, true);
  assert.equal(element(screen, 'Check').hidden, true);
  assert.equal(screen.calls.length, 1);
  assert.doesNotMatch(element(screen, 'State').textContent, /Private diagnostic|ANALYSIS_VERSION|33333333/);
  assert.ok([...screen.storage.values()].some(value => JSON.parse(value).analysisId === null));
});

test('disabled semantic analysis retains its key, while unavailable storage prevents any POST', async () => {
  const screen = createHarness({ handler: () => failure('SEMANTIC_ANALYSIS_UNAVAILABLE', 503) });
  await click(screen, 'Start');
  assert.match(element(screen, 'State').textContent, /writerAnalysis.unavailable/);
  await click(screen, 'Start');
  assert.equal(screen.posts()[0].options.headers['Idempotency-Key'], screen.posts()[1].options.headers['Idempotency-Key']);
  const blockedStorage = new Map(); blockedStorage.set = () => { throw new Error('storage unavailable'); };
  const blocked = createHarness({ storage: blockedStorage });
  await click(blocked, 'Start');
  assert.equal(blocked.calls.length, 0);
  assert.match(element(blocked, 'State').textContent, /writerAnalysis.storageUnavailable/);
});

test('all cursor pages remain reachable beyond 100, with back navigation and no decision writes', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => makeEvidence(index));
  const screen = createHarness({ job: makeJob({ evidenceCount: rows.length }), rows });
  await click(screen, 'Start');
  assert.equal(evidenceItems(screen).length, 100);
  assert.equal(element(screen, 'Previous').disabled, true);
  await click(screen, 'Next');
  assert.equal(evidenceItems(screen).length, 100);
  assert.ok(screen.calls.at(-1).path.endsWith('?cursor=' + rows[99].id));
  await click(screen, 'Next');
  assert.equal(evidenceItems(screen).length, 5);
  assert.equal(element(screen, 'Next').disabled, true);
  assert.match(evidenceItems(screen).at(-1).textContent, /Local fixture 205/);
  await click(screen, 'Previous');
  assert.equal(evidenceItems(screen).length, 100);
  assert.match(evidenceItems(screen)[0].textContent, /Local fixture 101/);
  assert.equal(screen.posts().length, 1);
  assert.ok(screen.calls.every(call => !/approval|review\/|decisions|continuity/.test(call.path)));
});

test('running tail append keeps open citations and exposes overflow without losing source order', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => makeEvidence(index));
  const running = makeJob({ status: 'running', phase: 'extracting', semanticCompleted: false, evidenceCount: 80 });
  const screen = createHarness({ job: running, rows: rows.slice(0, 80) });
  await click(screen, 'Start');
  const firstItem = evidenceItems(screen)[0];
  await firstItem.children[3].fire(); await screen.flush();
  assert.equal(firstItem.children[4].textContent.includes(quoteText), true);
  screen.setRows(rows); screen.setJob({ ...running, evidenceCount: 205 });
  await screen.runPoll();
  assert.equal(evidenceItems(screen).length, 100);
  assert.equal(evidenceItems(screen)[0], firstItem, 'polling preserves open source and focus');
  assert.ok(screen.calls.at(-1).path.endsWith('?cursor=' + rows[79].id));
  await click(screen, 'Next');
  assert.match(evidenceItems(screen)[0].textContent, /Local fixture 101/);
  await click(screen, 'Next');
  assert.match(evidenceItems(screen).at(-1).textContent, /Local fixture 205/);
});

test('failed forward and back reads preserve page position and navigation history', async () => {
  let failNext = false;
  const rows = Array.from({ length: 101 }, (_, index) => makeEvidence(index));
  const screen = createHarness({ job: makeJob({ evidenceCount: 101 }), rows, handler: (call, route) => {
    if (failNext) { failNext = false; return failure('HTTP_INTERNAL_ERROR', 500); }
    return route(call.path, call.options);
  } });
  await click(screen, 'Start');
  failNext = true; await click(screen, 'Next');
  assert.equal(element(screen, 'Previous').disabled, true);
  assert.equal(evidenceItems(screen).length, 100);
  await click(screen, 'Next');
  assert.equal(evidenceItems(screen).length, 1);
  failNext = true; await click(screen, 'Previous');
  assert.equal(element(screen, 'Previous').disabled, false);
  assert.equal(evidenceItems(screen).length, 1);
  await click(screen, 'Previous');
  assert.equal(element(screen, 'Previous').disabled, true);
});

test('malformed, repeated and unbound evidence pages never replace valid results', async () => {
  for (const corrupt of [
    data => { data.endCursor = null; }, data => { data.evidence.push(data.evidence[0]); },
    data => { data.job.manuscriptVersionId = ids.work; }, data => { data.job.sourceContentHash = 'c'.repeat(64); },
    data => { data.job.sourceLocale = 'ja'; }, data => { data.hasMore = true; data.nextCursor = null; }
  ]) {
    let broken = false;
    const screen = createHarness({ handler: async (call, route) => {
      const result = route(call.path, call.options);
      if (!broken) return result;
      const data = await result.json(); corrupt(data); return response(data);
    } });
    await click(screen, 'Start'); const item = evidenceItems(screen)[0];
    broken = true; await click(screen, 'Check');
    assert.match(element(screen, 'State').textContent, /writerAnalysis.loadFailed/);
    assert.equal(evidenceItems(screen)[0], item);
    assert.equal(screen.posts().length, 1);
  }
});

test('completed coverage, incomplete, structural and unknown failed usage remain distinct', async () => {
  for (const [job, phase] of [
    [makeJob(), 'completed'],
    [makeJob({ progress: { coverageComplete: false } }), 'incomplete'],
    [makeJob({ kind: 'structural_legacy', semanticCompleted: false }), 'structural'],
    [makeJob({ status: 'failed', semanticCompleted: false, budget: { usageUnobserved: true } }), 'failedUnknown'],
    [makeJob({ status: 'failed', semanticCompleted: false }), 'failed']
  ]) {
    const screen = createHarness({ job }); await click(screen, 'Start');
    assert.ok(element(screen, 'State').textContent.endsWith('writerAnalysis.' + phase));
    assert.equal(element(screen, 'Start').hidden, true);
    assert.equal(element(screen, 'Boundary').hidden, false);
    await click(screen, 'Check'); assert.equal(screen.posts().length, 1);
    assert.equal(screen.timers.size, 0, 'terminal results do not poll or restart');
  }
});

test('source quotations are explicit plain text, concurrently reachable and not browser-persisted', async () => {
  const screen = createHarness({ job: makeJob({ evidenceCount: 2 }), rows: [makeEvidence(), makeEvidence(1)] });
  await click(screen, 'Start');
  assert.equal(screen.calls.filter(call => call.path.endsWith('/source')).length, 0);
  const items = evidenceItems(screen);
  await Promise.all(items.map(item => item.children[3].fire())); await screen.flush();
  for (const item of items) {
    const source = item.children[4];
    assert.equal(source.children[0].children[1].tagName, 'BLOCKQUOTE');
    assert.equal(source.children[0].children[1].textContent, quoteText);
  }
  for (const [key, value] of screen.storage) {
    assert.doesNotMatch(key + value, /<script>|observation|quoteHash|contentHash|fixture-part|test quotation/);
    const fields = Object.keys(JSON.parse(value)).sort();
    assert.ok(JSON.stringify(fields) === '["analysisId","requestKey"]' || JSON.stringify(fields) === '["manuscriptId"]');
  }
});

test('mismatched citation never renders a quote and explicit retry can recover', async () => {
  let broken = true;
  const screen = createHarness({ handler: (call, route) => call.path.endsWith('/source') && broken
    ? response({ evidenceId: makeEvidence().id, manuscriptVersionId: ids.manuscript, sourceLocale: 'ko', citations: [{ ...citation, end: citation.end + 1, quote: quoteText }] })
    : route(call.path, call.options) });
  await click(screen, 'Start');
  const item = evidenceItems(screen)[0], button = item.children[3], source = item.children[4];
  await button.fire(); await screen.flush();
  assert.match(source.textContent, /writerAnalysis.quoteFailed/);
  assert.equal(source.textContent.includes(quoteText), false);
  broken = false; await button.fire(); await screen.flush();
  assert.equal(source.textContent.includes(quoteText), true);
});

test('late enqueue on account, work or source locale change cannot reveal old private results', async () => {
  for (const change of [
    screen => screen.setIdentity({ ownerId: 'second-owner', epoch: 2 }),
    screen => screen.setContext({ workId: ids.job }), screen => screen.setContext({ sourceLocale: 'ja' })
  ]) {
    const gate = deferred();
    const screen = createHarness({ handler: () => gate.promise });
    const pending = click(screen, 'Start'); change(screen); screen.tickIdentity();
    gate.resolve(response(makeJob())); await pending;
    assert.equal(screen.elements.writerAnalysis.hidden, true);
    assert.equal(evidenceItems(screen).length, 0);
    assert.equal(screen.calls.length, 1);
  }
});

test('UI locale fences old enqueue and quote replies while retaining source language and original key', async () => {
  const gate = deferred(); let deferStart = true;
  const screen = createHarness({ handler: (call, route) => call.options.method === 'POST' && deferStart ? gate.promise : route(call.path, call.options) });
  const pending = click(screen, 'Start');
  screen.setLocale('ja-JP'); gate.resolve(response(makeJob())); await pending;
  assert.match(element(screen, 'State').textContent, /^ja-JP:writerAnalysis.unknown/);
  assert.equal(evidenceItems(screen).length, 0);
  deferStart = false; await click(screen, 'Check');
  assert.equal(screen.posts()[0].options.headers['Idempotency-Key'], screen.posts()[1].options.headers['Idempotency-Key']);
  assert.equal(evidenceItems(screen)[0].textContent.includes('Local fixture'), true);
  const quoteGate = deferred();
  const quoteScreen = createHarness({ handler: (call, route) => call.path.endsWith('/source') ? quoteGate.promise : route(call.path, call.options) });
  await click(quoteScreen, 'Start');
  const oldItem = evidenceItems(quoteScreen)[0];
  const sourcePending = oldItem.children[3].fire();
  quoteScreen.setLocale('zh-Hant');
  quoteGate.resolve(response({ evidenceId: makeEvidence().id, manuscriptVersionId: ids.manuscript, sourceLocale: 'ko', citations: [{ ...citation, quote: quoteText }] }));
  await sourcePending; await quoteScreen.flush();
  assert.equal(oldItem.isConnected, false);
  assert.equal(element(quoteScreen, 'Evidence').textContent.includes(quoteText), false);
});

test('auth denial and page exit clear private evidence; storage for another owner is never restored', async () => {
  for (const status of [401, 403, 404]) {
    let denied = false;
    const screen = createHarness({ handler: (call, route) => denied ? failure('HTTP_DENIED', status) : route(call.path, call.options) });
    await click(screen, 'Start'); denied = true; await click(screen, 'Check');
    assert.equal(screen.elements.writerAnalysis.hidden, true);
    assert.equal(evidenceItems(screen).length, 0);
  }
  const storage = new Map(); const first = createHarness({ storage }); await click(first, 'Start');
  first.emit('pagehide'); assert.equal(evidenceItems(first).length, 0);
  const other = createHarness({ storage, receipt: false });
  other.setIdentity({ ownerId: 'other-owner', epoch: 2 }); other.window.LuminaCreatorAnalysis.contextChanged(); await other.flush();
  assert.equal(other.elements.writerAnalysis.hidden, true);
  assert.equal(other.posts().length, 0);
});

test('source wiring contains five-language copy, narrow readable layout and no extra approval route', () => {
  const dictionary = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const rows = dictionary.split(/\r?\n/).filter(line => /^\s*"writerAnalysis\./.test(line));
  assert.ok(rows.length >= 35);
  for (const row of rows) {
    const values = Object.values(JSON.parse('{' + row.trim().replace(/,$/, '') + '}'))[0];
    for (const locale of ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant']) assert.ok(values[locale]);
    assert.doesNotMatch(row, /작업중|개발중|작가승인완료/);
  }
  const html = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/creator-studio.css', import.meta.url), 'utf8');
  assert.match(html, /id="writerAnalysis"[^>]*hidden/);
  assert.ok(html.indexOf('/pages/creator-analysis-review.js') > html.indexOf('/app.js'));
  assert.match(css, /\.writer-analysis-item p[^}]*font-size: 16px; font-weight: 400/);
  assert.doesNotMatch(script, /innerHTML|localStorage|data\.analysisJobId|\/decisions|\/submit|\/transition|publicationApproved\s*=\s*true/);
});
