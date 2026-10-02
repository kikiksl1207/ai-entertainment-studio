import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHarness, makeJob, makeRecoverableJob, makeGenerationResponse, makeEvidence, response, failure, deferred, element, click, evidenceItems,
  ids, sourceHash, citation, quoteText, script } from './creator-analysis-review.test-support.mjs';

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

test('published manuscript analysis can be restored without a browser upload receipt or paid POST', async () => {
  const storage = new Map();
  const screen = createHarness({ storage, receipt: false });
  assert.equal(screen.elements.writerAnalysisRestore.hidden, false);
  await screen.elements.writerAnalysisRestore.fire(); await screen.flush();
  assert.equal(screen.posts().length, 0);
  assert.equal(screen.elements.writerAnalysis.hidden, false);
  assert.equal(element(screen, 'Start').hidden, true);
  assert.equal(screen.elements.writerGenerationEntry.hidden, false);
  assert.ok(screen.calls.some(call => call.path.includes(`/stories/${ids.work}/manuscripts?limit=1`)));
  assert.ok(screen.calls.some(call => call.path.includes(`/manuscripts/${ids.manuscript}/analyses?limit=30`)));
  const reload = createHarness({ storage, receipt: false }); await reload.flush();
  assert.equal(reload.posts().length, 0);
  assert.equal(reload.elements.writerAnalysis.hidden, false);
  assert.equal(reload.elements.writerGenerationEntry.hidden, false);
});

test('restoring an unstarted manuscript offers analysis without silently charging for a POST', async () => {
  const legacy = makeJob({ kind: 'structural_legacy', semanticCompleted: false });
  const screen = createHarness({ job: legacy, receipt: false });
  await screen.elements.writerAnalysisRestore.fire(); await screen.flush();
  assert.equal(screen.posts().length, 0);
  assert.equal(screen.elements.writerAnalysis.hidden, false);
  assert.equal(element(screen, 'Start').hidden, false);
});

test('shows how many unverifiable candidates were excluded from the writer analysis', async () => {
  const screen = createHarness({ job: makeJob({ discardedEvidenceCount: 2 }) });
  screen.setLocale('ko-KR');
  await click(screen, 'Start');
  assert.match(element(screen, 'Counts').textContent, /확인 불가 분석 2건 제외/);
});

test('opens AI findings first and keeps repetitive structure rows in a separate view', async () => {
  const structural = makeEvidence(1, { provenance: 'structural_only', title: undefined, observation: undefined });
  const screen = createHarness({ rows: [structural, makeEvidence()] });
  await click(screen, 'Start');
  assert.equal(evidenceItems(screen).length, 1);
  assert.equal(evidenceItems(screen)[0].textContent.includes('Local fixture 1'), true);
  assert.equal(screen.calls.some(call => call.path.includes(`/analyses/${ids.job}?view=semantic`)), true);
  await screen.elements.writerAnalysisStructural.fire(); await screen.flush();
  assert.equal(evidenceItems(screen).length, 1);
  assert.equal(evidenceItems(screen)[0].textContent.includes('writerAnalysis.structure'), true);
  assert.equal(screen.calls.some(call => call.path.includes(`/analyses/${ids.job}?view=structural`)), true);
  await screen.elements.writerAnalysisSemantic.fire(); await screen.flush();
  assert.equal(evidenceItems(screen)[0].textContent.includes('Local fixture 1'), true);
});

test('shows a clear empty result when analysis completed without cited AI findings', async () => {
  const screen = createHarness({ rows: [makeEvidence(1, { provenance: 'structural_only', title: undefined, observation: undefined })] });
  await click(screen, 'Start');
  assert.equal(evidenceItems(screen).length, 0);
  assert.equal(element(screen, 'Empty').hidden, false);
  assert.equal(element(screen, 'Empty').textContent.includes('semanticEmpty'), true);
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
  assert.equal(new URL(screen.calls.at(-1).path, 'https://fixture.invalid').searchParams.get('cursor'), rows[99].id);
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
  assert.equal(new URL(screen.calls.at(-1).path, 'https://fixture.invalid').searchParams.get('cursor'), rows[79].id);
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
  assert.match(html, /id="writerAnalysisRecover"[^>]*hidden[^>]*aria-describedby="writerAnalysisRecoverState"/);
  assert.match(html, /id="writerAnalysisRecoverState"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
  assert.ok(html.indexOf('/pages/creator-analysis-review.js') > html.indexOf('/app.js'));
  assert.match(css, /\.writer-analysis-item p[^}]*font-size: 16px; font-weight: 400/);
  assert.doesNotMatch(script, /innerHTML|localStorage|data\.analysisJobId|\/decisions|\/submit|\/transition|publicationApproved\s*=\s*true/);
});

async function restoredRecovery(options = {}) {
  const screen = createHarness({ receipt: false, job: makeRecoverableJob(), ...options });
  await screen.elements.writerAnalysisRestore.fire(); await screen.flush();
  return screen;
}

test('profile recovery requires explicit local-only capability and complete observed analysis', async () => {
  const eligible = await restoredRecovery();
  assert.equal(element(eligible, 'Recover').hidden, false);
  assert.equal(element(eligible, 'Start').hidden, true);
  assert.equal(eligible.posts().length, 0);
  assert.equal(eligible.timers.size, 0);
  for (const overrides of [
    { profileRecovery: undefined }, { profileRecovery: { available: false, mode: 'local_settings_only' } },
    { profileRecovery: { available: 'true', mode: 'local_settings_only' } },
    { profileRecovery: { available: true, mode: 'provider_retry' } },
    { profileRecovery: { available: true } }, { budget: { usageUnobserved: true } },
    { errorCode: 'provider_outcome_unknown' }, { kind: 'structural_legacy' },
    { progress: { ...makeJob().progress, completedParagraphs: 0 } },
    { progress: { ...makeJob().progress, plannedParagraphs: 0 } },
    { progress: { ...makeJob().progress, completedChunks: 0 } },
    { progress: { ...makeJob().progress, plannedChunks: 0 } },
    { progress: { ...makeJob().progress, totalParagraphs: 0 } },
    { status: 'queued' }, { status: 'running' }, { status: 'completed' }
  ]) {
    const screen = await restoredRecovery({ job: makeRecoverableJob(overrides) });
    assert.equal(element(screen, 'Recover').hidden, true, JSON.stringify(overrides));
    await element(screen, 'Recover').listeners.click[0]();
    assert.equal(screen.posts().length, 0, 'hidden recovery cannot be invoked programmatically');
  }
});

test('explicit recovery posts the job hash once, then reloads evidence and opens an unapproved settings draft', async () => {
  const gate = deferred(); let recoveryCall;
  const screen = await restoredRecovery({ generationProfile: makeGenerationResponse(), handler: (call, route) => {
    if (call.path.endsWith('/recover-profile')) { recoveryCall = () => route(call.path, call.options); return gate.promise; }
    return route(call.path, call.options);
  } });
  await click(screen, 'Structural');
  const pending = click(screen, 'Recover');
  await element(screen, 'Recover').listeners.click[0]();
  await click(screen, 'Check');
  assert.equal(element(screen, 'Recover').disabled, true);
  assert.equal(element(screen, 'Check').disabled, true);
  assert.equal(screen.posts().length, 1);
  const call = screen.posts()[0];
  assert.equal(call.path, `/api/v1/me/creator-studio/analyses/${ids.job}/recover-profile`);
  assert.deepEqual(JSON.parse(call.options.body), { expectedSourceContentHash: sourceHash });
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.equal(call.options.identity.ownerId, 'fixture-owner');
  assert.equal(call.options.identity.epoch, 1);
  assert.equal(call.options.signal.aborted, false);
  assert.match(element(screen, 'RecoverState').textContent, /not be applied automatically/);
  gate.resolve(recoveryCall()); await pending;
  assert.equal(element(screen, 'Recover').hidden, true);
  assert.equal(element(screen, 'Start').hidden, true);
  assert.match(element(screen, 'State').textContent, /writerAnalysis.completed/);
  assert.match(element(screen, 'RecoverState').textContent, /Review it before applying/);
  assert.equal(screen.calls.at(-2).path, `/api/v1/me/creator-studio/analyses/${ids.job}?view=semantic`);
  assert.equal(screen.calls.at(-1).path, `/api/v1/me/creator-studio/stories/${ids.work}/generation-profile`);
  assert.equal(screen.elements.writerGenerationModal.classList.contains('is-hidden'), false);
  assert.equal(screen.elements.writerGenerationSections.children.length, 8);
  assert.equal(screen.elements.writerGenerationApprove.disabled, false);
  assert.equal(screen.posts().length, 1);
  assert.ok(screen.calls.every(call => !/\/approve$|\/paste$/.test(call.path) && call.options.method !== 'PATCH'));
  for (const value of screen.storage.values()) assert.doesNotMatch(value, /sourceContentHash|expectedSourceContentHash|draftSettings/);
});

test('recovery failures and ambiguous acknowledgements offer check and explicit retry without automatic writes', async () => {
  for (const result of [failure('ANALYSIS_PROFILE_RECOVERY_UNAVAILABLE'), failure('INTERNAL_ERROR', 500), null]) {
    let broken = true;
    const screen = await restoredRecovery({ handler: (call, route) => {
      if (call.path.endsWith('/recover-profile') && broken) {
        if (!result) throw new Error('lost acknowledgement');
        return result;
      }
      return route(call.path, call.options);
    } });
    const item = evidenceItems(screen)[0];
    await click(screen, 'Recover');
    assert.match(element(screen, 'RecoverState').textContent, /Check the status/);
    assert.doesNotMatch(element(screen, 'RecoverState').textContent, /Private diagnostic|ANALYSIS_PROFILE|INTERNAL_ERROR/);
    assert.equal(element(screen, 'Recover').hidden, false);
    assert.equal(element(screen, 'Recover').disabled, false);
    assert.equal(element(screen, 'Check').disabled, false);
    assert.equal(element(screen, 'Start').hidden, true);
    assert.equal(evidenceItems(screen)[0], item);
    await screen.runPoll(); screen.emit('focus'); screen.setLocale('en-US'); await screen.flush();
    assert.equal(screen.posts().length, 1);
    assert.equal(screen.timers.size, 0);
    await click(screen, 'Check');
    assert.equal(screen.posts().length, 1, 'status check uses GET, never recovery or analysis POST');
    broken = false; await click(screen, 'Recover');
    assert.equal(screen.posts().length, 2);
    assert.ok(screen.posts().every(call => call.path.endsWith('/recover-profile')));
  }
});

test('malformed, foreign and nonterminal recovery jobs are ignored without polling or profile reads', async () => {
  for (const corrupt of [
    () => null, value => ({ job: value }), value => ({ ...value, id: ids.work }),
    value => ({ ...value, manuscriptVersionId: ids.work }), value => ({ ...value, sourceLocale: 'ja' }),
    value => ({ ...value, sourceContentHash: 'c'.repeat(64) }), value => ({ ...value, kind: 'structural_legacy' }),
    value => ({ ...value, status: 'running' }), value => ({ ...value, status: 'queued' }),
    value => ({ ...value, semanticCompleted: false }), value => ({ ...value, progress: { coverageComplete: false } }),
    value => ({ ...value, budget: { usageUnobserved: true } }), value => ({ ...value, profileRecovery: undefined }),
    value => ({ ...value, profileRecovery: { available: true, mode: 'local_settings_only' } }),
    value => ({ ...value, profileRecovery: { available: false, mode: 'provider_retry' } })
  ]) {
    const screen = await restoredRecovery({ handler: (call, route) => call.path.endsWith('/recover-profile')
      ? response(corrupt(makeJob())) : route(call.path, call.options) });
    await click(screen, 'Recover');
    assert.match(element(screen, 'RecoverState').textContent, /Recovery could not be confirmed/);
    assert.equal(element(screen, 'Recover').hidden, false);
    assert.equal(screen.elements.writerGenerationEntry.hidden, true);
    assert.equal(screen.calls.some(call => call.path.endsWith('/generation-profile')), false);
    assert.equal(screen.timers.size, 0);
    assert.equal(screen.posts().length, 1);
  }
});

test('recovery remains hash-bound even when a resumed pointer has no manuscript hash', async () => {
  const storage = new Map([
    [`lumina.writer.resume:fixture-owner:${ids.work}:ko`, JSON.stringify({ manuscriptId: ids.manuscript })],
    [`lumina.writer.analysis:fixture-owner:${ids.manuscript}`, JSON.stringify({ analysisId: ids.job, requestKey: null })]
  ]);
  const screen = createHarness({ receipt: false, storage, job: makeRecoverableJob(), handler: (call, route) =>
    call.path.endsWith('/recover-profile') ? response(makeJob({ sourceContentHash: 'b'.repeat(64) })) : route(call.path, call.options) });
  await screen.flush(); await click(screen, 'Recover');
  assert.match(element(screen, 'RecoverState').textContent, /Recovery could not be confirmed/);
  assert.equal(screen.calls.some(call => call.path.endsWith('/generation-profile')), false);
});

test('a failed recovery projection can withdraw capability and a GET can reconcile a lost successful reply', async () => {
  const withdrawn = await restoredRecovery({ handler: (call, route) => call.path.endsWith('/recover-profile')
    ? response(makeRecoverableJob({ profileRecovery: { available: false, mode: 'local_settings_only' } })) : route(call.path, call.options) });
  await click(withdrawn, 'Recover');
  assert.equal(element(withdrawn, 'Recover').hidden, true);
  assert.match(element(withdrawn, 'RecoverState').textContent, /Could not recover/);
  assert.equal(element(withdrawn, 'Check').hidden, false);
  const reconciled = await restoredRecovery({ generationProfile: makeGenerationResponse(), handler: (call, route, screen) => {
    if (call.path.endsWith('/recover-profile')) { screen.setJob(makeJob()); throw new Error('lost acknowledgement'); }
    return route(call.path, call.options);
  } });
  await click(reconciled, 'Recover');
  assert.equal(reconciled.elements.writerGenerationEntry.hidden, true);
  await click(reconciled, 'Check');
  assert.equal(reconciled.elements.writerGenerationModal.classList.contains('is-hidden'), false);
  assert.equal(element(reconciled, 'Recover').hidden, true);
  assert.match(element(reconciled, 'RecoverState').textContent, /Review it before applying/);
  assert.equal(reconciled.posts().length, 1);
});

test('failed evidence reread after recovery offers a GET retry before opening generation review', async () => {
  let failRead = false;
  const screen = await restoredRecovery({ generationProfile: makeGenerationResponse(), handler: (call, route) => {
    if (call.path.endsWith('/recover-profile')) { failRead = true; return route(call.path, call.options); }
    if (call.path.includes(`/analyses/${ids.job}?`) && failRead) { failRead = false; return failure('INTERNAL_ERROR', 500); }
    return route(call.path, call.options);
  } });
  await click(screen, 'Recover');
  assert.match(element(screen, 'State').textContent, /writerAnalysis.loadFailed/);
  assert.equal(element(screen, 'Recover').hidden, true);
  assert.equal(element(screen, 'Check').disabled, false);
  assert.equal(screen.calls.some(call => call.path.endsWith('/generation-profile')), false);
  await click(screen, 'Check');
  assert.equal(screen.elements.writerGenerationModal.classList.contains('is-hidden'), false);
  assert.equal(screen.posts().length, 1);
});

test('late recovery replies cannot repaint or unlock another account, work, source locale or epoch', async () => {
  for (const change of [
    screen => screen.setIdentity({ ownerId: 'other-owner', epoch: 2 }),
    screen => screen.setIdentity({ ownerId: 'fixture-owner', epoch: 2 }),
    screen => screen.setContext({ workId: ids.job }), screen => screen.setContext({ sourceLocale: 'ja' })
  ]) {
    const gate = deferred();
    const screen = await restoredRecovery({ generationProfile: makeGenerationResponse(), handler: (call, route) =>
      call.path.endsWith('/recover-profile') ? gate.promise : route(call.path, call.options) });
    const pending = click(screen, 'Recover'); const call = screen.posts()[0];
    change(screen); screen.tickIdentity();
    assert.equal(call.options.signal.aborted, true);
    gate.resolve(response(makeJob())); await pending;
    assert.equal(screen.elements.writerAnalysis.hidden, true);
    assert.equal(element(screen, 'Recover').hidden, true);
    assert.equal(element(screen, 'RecoverState').textContent, '');
    assert.equal(evidenceItems(screen).length, 0);
    assert.equal(screen.elements.writerGenerationModal.classList.contains('is-hidden'), true);
    assert.equal(screen.calls.some(call => call.path.endsWith('/generation-profile')), false);
  }
});

test('old recovery finalizers cannot clear a new scope recovery lock', async () => {
  const gates = [deferred(), deferred()]; let attempts = 0;
  const screen = await restoredRecovery({ handler: (call, route) => call.path.endsWith('/recover-profile')
    ? gates[attempts++].promise : route(call.path, call.options) });
  const oldPending = click(screen, 'Recover');
  screen.setContext({ workId: ids.job }); screen.window.LuminaCreatorAnalysis.contextChanged();
  screen.setContext({ workId: ids.work }); screen.window.LuminaCreatorAnalysis.contextChanged(); await screen.flush();
  const newPending = click(screen, 'Recover');
  gates[0].resolve(response(makeJob())); await oldPending;
  assert.equal(element(screen, 'Recover').disabled, true);
  assert.match(element(screen, 'RecoverState').textContent, /Recovering the settings draft/);
  await element(screen, 'Recover').listeners.click[0]();
  assert.equal(screen.posts().length, 2);
  gates[1].resolve(failure('ANALYSIS_PROFILE_RECOVERY_UNAVAILABLE')); await newPending;
  assert.equal(element(screen, 'Recover').disabled, false);
});

test('locale changes fence in-flight recovery and retain only explicit retry in the new language', async () => {
  const gate = deferred();
  const screen = await restoredRecovery({ handler: (call, route) => call.path.endsWith('/recover-profile')
    ? gate.promise : route(call.path, call.options) });
  const pending = click(screen, 'Recover'); screen.setLocale('ja-JP');
  gate.resolve(response(makeJob())); await pending;
  assert.equal(element(screen, 'Recover').textContent, '生成設定を復旧');
  assert.match(element(screen, 'RecoverState').textContent, /復旧の完了を確認できません/);
  assert.equal(screen.posts().length, 1);
  assert.equal(screen.calls.some(call => call.path.endsWith('/generation-profile')), false);
  assert.equal(screen.elements.writerGenerationModal.classList.contains('is-hidden'), true);
});

test('recovery authorization denial and page exit clear recovery UI and all private results', async () => {
  for (const status of [401, 403, 404]) {
    const screen = await restoredRecovery({ handler: (call, route) => call.path.endsWith('/recover-profile')
      ? failure('HTTP_DENIED', status) : route(call.path, call.options) });
    await click(screen, 'Recover');
    assert.equal(screen.elements.writerAnalysis.hidden, true);
    assert.equal(element(screen, 'RecoverState').textContent, '');
    assert.equal(evidenceItems(screen).length, 0);
    assert.equal(screen.posts().length, 1);
  }
  const screen = await restoredRecovery(); screen.emit('pagehide');
  assert.equal(element(screen, 'Recover').hidden, true);
  assert.equal(element(screen, 'RecoverState').textContent, '');
});

test('recovery button, boundary, loading, completion and errors are localized through generationCopy', async () => {
  for (const [locale, button, boundary, loading, completed, failed, unknown] of [
    ['ko-KR', '생성 설정 복구', /원고 AI를 다시 요청하거나 자동 승인하지/, /자동으로 적용되지/, /검토 후 직접 적용/, /복구하지 못했습니다/, /완료 여부를 확인하지/],
    ['en-US', 'Recover generation settings', /does not request manuscript AI again or approve/, /not be applied automatically/, /Review it before applying/, /Could not recover/, /Recovery could not be confirmed/],
    ['ja-JP', '生成設定を復旧', /再依頼や自動承認は行いません/, /自動適用は行いません/, /確認してから適用/, /復旧できませんでした/, /完了を確認できません/],
    ['zh-CN', '恢复生成设置', /不会再次请求稿件 AI，也不会自动批准/, /不会自动应用/, /核对后再应用/, /无法恢复/, /无法确认恢复是否完成/],
    ['zh-Hant', '復原生成設定', /不會再次請求稿件 AI，也不會自動核准/, /不會自動套用/, /核對後再套用/, /無法復原/, /無法確認復原是否完成/]
  ]) {
    const gate = deferred(); let mode = 'pending';
    const screen = await restoredRecovery({ handler: (call, route) => {
      if (!call.path.endsWith('/recover-profile')) return route(call.path, call.options);
      if (mode === 'pending') return gate.promise;
      if (mode === 'failed') return failure('ANALYSIS_PROFILE_RECOVERY_UNAVAILABLE');
      throw new Error('lost acknowledgement');
    } });
    screen.setLocale(locale); await screen.flush();
    assert.equal(element(screen, 'Recover').textContent, button);
    assert.match(element(screen, 'RecoverState').textContent, boundary);
    const pending = click(screen, 'Recover'); assert.match(element(screen, 'RecoverState').textContent, loading);
    screen.setJob(makeJob()); gate.resolve(response(makeJob())); await pending;
    assert.match(element(screen, 'RecoverState').textContent, completed);
    screen.setJob(makeRecoverableJob()); await click(screen, 'Check');
    mode = 'failed'; await click(screen, 'Recover'); assert.match(element(screen, 'RecoverState').textContent, failed);
    mode = 'unknown'; await click(screen, 'Recover'); assert.match(element(screen, 'RecoverState').textContent, unknown);
  }
});

test('saving an edited summary clears old AI observations and categories but preserves evidence and fixed flags', async () => {
  const initial = makeGenerationResponse();
  const screen = await restoredRecovery({ generationProfile: initial });
  await click(screen, 'Recover');
  const sections = screen.elements.writerGenerationSections;
  const edited = sections.querySelector('[data-key="writing_style"]');
  edited.querySelector('textarea').value = 'My corrected writing style.';
  await edited.querySelector('textarea').fire('input');
  const accepted = sections.querySelector('[data-key="canon"]');
  await accepted.querySelector('.writer-generation-decisions button').fire();
  const unchangedEdit = sections.querySelector('[data-key="timeline"]');
  await unchangedEdit.querySelectorAll('.writer-generation-decisions button')[1].fire();
  const branch = sections.querySelector('[data-key="branch_behavior"]');
  branch.querySelector('textarea').value = 'My corrected branching rule.';
  await branch.querySelector('textarea').fire('input');
  await screen.elements.writerGenerationSave.fire(); await screen.flush();
  const patches = screen.calls.filter(call => call.options.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].path, `/api/v1/me/creator-studio/stories/${ids.work}/generation-profile`);
  const saved = JSON.parse(patches[0].options.body).settings.sections;
  const changed = saved.find(section => section.key === 'writing_style');
  assert.equal(changed.decision, 'edited');
  assert.equal(changed.value.summary, 'My corrected writing style.');
  assert.deepEqual(changed.value.observations, []);
  assert.deepEqual(changed.value.categories, []);
  assert.equal(changed.value.imitationBoundary, 'approved_work_only');
  assert.deepEqual(changed.evidence, initial.profile.draftSettings.sections[0].evidence);
  const confirmed = saved.find(section => section.key === 'canon');
  assert.equal(confirmed.decision, 'accepted');
  assert.deepEqual(confirmed.value.observations, ['Previous AI interpretation.']);
  assert.deepEqual(confirmed.evidence, initial.profile.draftSettings.sections[2].evidence);
  assert.deepEqual(saved.find(section => section.key === 'timeline').value.observations, ['Previous AI interpretation.']);
  const editedBranch = saved.find(section => section.key === 'branch_behavior');
  assert.deepEqual(editedBranch.value.observations, []);
  assert.equal(editedBranch.value.selectedChoiceMustMateriallyDiverge, true);
  assert.equal(editedBranch.value.maximumSuggestedChoices, 3);
  assert.equal(Object.hasOwn(editedBranch.value, 'categories'), false, 'do not add categories to unrelated sections');
  assert.equal(screen.calls.some(call => call.path.endsWith('/approve')), false);
});

test('accepted or unchanged edited writing style keeps its observations and categories on save', async () => {
  for (const decisionIndex of [0, 1]) {
    const initial = makeGenerationResponse();
    const screen = await restoredRecovery({ generationProfile: initial });
    await click(screen, 'Recover');
    const section = screen.elements.writerGenerationSections.querySelector('[data-key="writing_style"]');
    await section.querySelectorAll('.writer-generation-decisions button')[decisionIndex].fire();
    await screen.elements.writerGenerationSave.fire(); await screen.flush();
    const call = screen.calls.find(call => call.options.method === 'PATCH');
    const saved = JSON.parse(call.options.body).settings.sections[0];
    assert.equal(saved.decision, decisionIndex ? 'edited' : 'accepted');
    assert.deepEqual(saved.value, initial.profile.draftSettings.sections[0].value);
    assert.deepEqual(saved.evidence, initial.profile.draftSettings.sections[0].evidence);
  }
});
