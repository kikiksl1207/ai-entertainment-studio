import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-current-fit.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../pages/creator-body-current-fit.css', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../pages/creator-body-preview.js', import.meta.url), 'utf8');
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-' + String(n).padStart(12, '0');
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const bytes = value => new TextEncoder().encode(value);
const preview = (locale = 'ko', revision = 7) => ({
  contract: 'story-author-body-preview-v1', workId: id(1), locale, readOnly: true, imageGenerationStarted: false,
  progress: { progressId: id(2), revision, storyVersion: 3, status: 'active', currentBeatPosition: 2,
    scene: { id: id(3), isGenerated: false, title: 'CURRENT_PRIVATE_SCENE', endingType: null,
      beats: [{ id: id(4), position: 1, type: 'narration', content: 'PRIVATE_BODY_NOT_RETAINED' },
        { id: id(5), position: 2, type: 'dialogue', content: '  Complete source text.  ' }] },
    choices: [{ id: id(6), label: 'Existing route', routeKind: 'canonical' },
      { id: id(7), label: 'First continuation', routeKind: 'generation_required' },
      { id: id(10), label: 'Second continuation', routeKind: 'generation_required' }] }
});
const diagnostic = (locale = 'ko', revision = 7) => ({
  contract: 'story-author-current-fit-v1', locale, sourceScope: 'latest_private_approval_and_current_reader_source',
  readOnly: true, providerCalls: 0, operatingWrites: 0, dispatchAuthorized: false, semanticQualityVerified: false,
  legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated', outcome: 'request_checked', currentSourceState: 'validated',
  approvalReferenceVerified: true, progressRevision: revision, manuscriptVersion: 4, analysisVersion: 5, profileVersion: 6, reviewRevision: 2,
  diagnostic: { version: 'story-fixed-cap-fit-v1', budgetMethod: 'js_tiktoken_o200k_base_v1', contextSource: 'caller_supplied_context',
    fixedInputTokenLimit: 32768, fixedOutputTokenLimit: 8192, inputFit: 'within_policy_bound', reason: 'fixed_cap_input_policy_fit',
    inputTokenBudget: 500, requestBytes: 1500,
    narrativeLength: { measurement: 'narrative-nonwhite-codepoints-v1', referenceUnits: 100, minUnits: 80, targetUnits: 100, maxUnits: 120 },
    writingStylePresent: true, outputFit: 'unmeasured', multiStageFit: 'unimplemented', currentApprovalVerified: false,
    dispatchAuthorized: false, semanticQualityVerified: false, providerCalls: 0 }
});
function unmeasured(reason = 'provider_context_invalid', locale = 'ko', revision = 7) {
  const value = diagnostic(locale, revision);
  Object.assign(value.diagnostic, { inputFit: 'unmeasured', reason, inputTokenBudget: null, requestBytes: null, narrativeLength: null, writingStylePresent: null });
  return value;
}
function unavailable(reason = 'context_unavailable', locale = 'ko') {
  const value = diagnostic(locale);
  Object.assign(value, { outcome: 'current_source_unavailable', currentSourceState: 'unavailable', reason, approvalReferenceVerified: false,
    progressRevision: null, manuscriptVersion: null, analysisVersion: null, profileVersion: null, reviewRevision: null, diagnostic: null });
  return value;
}
function response(value, { status = 200, raw = JSON.stringify(value), chunks = null, length = null, type = 'application/json; charset=utf-8', reader = null } = {}) {
  let index = 0;
  const stats = { reads: 0, cancelled: 0, released: 0, textReads: 0, jsonReads: 0 };
  const content = chunks || [bytes(raw)];
  const stream = reader || { read: async () => { stats.reads++; return index < content.length ? { done: false, value: content[index++] } : { done: true }; },
    cancel: async () => { stats.cancelled++; }, releaseLock: () => { stats.released++; } };
  return { status, stats, headers: { get: name => name === 'content-length' ? length : name === 'content-type' ? type : null },
    body: { getReader: () => stream, cancel: async () => { stats.cancelled++; } },
    text: () => { stats.textReads++; throw new Error('Unbounded text fallback forbidden'); },
    json: () => { stats.jsonReads++; throw new Error('Unbounded JSON fallback forbidden'); } };
}
function library(extra = {}) {
  const vm = createContext({ window: extra.window || {}, TextEncoder, TextDecoder, Uint8Array, AbortController });
  runInContext(previewSource, vm);
  Object.assign(vm, extra);
  runInContext(source, vm);
  return { api: vm.window.LuminaCreatorBodyCurrentFit, vm };
}
function screen(handler, onChange = () => {}) {
  let owner = { ownerId: id(8), epoch: 1 }, workId = id(1), sourceLocale = 'ko', language = 'ko', shown = true, authorized = true;
  const calls = [], states = [], { api, vm } = library();
  const controller = api.createController({ fetch: (url, options) => {
    calls.push({ url, options });
    return handler ? handler({ url, options, sourceLocale, calls }) : response(url.includes('/current-fit?') ? diagnostic(sourceLocale) : preview(sourceLocale));
  }, identity: () => owner, isCurrent: value => authorized && !!owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    context: () => ({ workId, locale: sourceLocale }), locale: () => language, visible: () => shown,
    onChange: state => { states.push(clone(state)); onChange(state); } });
  return { ...controller, api, vm, calls, states, set: { owner: value => { owner = value; }, work: value => { workId = value; },
    source: value => { sourceLocale = value; }, language: value => { language = value; }, shown: value => { shown = value; }, authorized: value => { authorized = value; } } };
}
const cleared = view => {
  const state = view.snapshot(); assert.equal(state.data, null); assert.equal(state.progressRevision, null);
  assert.equal(state.storyVersion, null); assert.equal(state.selectedChoiceId, ''); assert.deepEqual(clone(state.choices), []);
};
async function choose(view, choiceId = id(7)) { assert.equal(await view.refresh(), true); assert.equal(view.selectChoice(choiceId), true); }
const parse = (value, locale = 'ko', revision = 7) => library().api.parseDiagnostic(value, locale, revision);

test('CURRENT-FIT: two explicit GET commands retain actual generation choices and pin preview revision', async () => {
  const view = screen(); view.syncContext(); view.snapshot();
  assert.equal(view.calls.length, 0); assert.equal(await view.check(), false);
  assert.equal(await view.refresh(), true);
  assert.deepEqual(clone(view.snapshot().choices), [{ id: id(7), label: 'First continuation' }, { id: id(10), label: 'Second continuation' }]);
  assert.equal(view.snapshot().selectedChoiceId, ''); assert.equal(view.snapshot().canCheck, false);
  assert.equal(await view.check(), false); assert.equal(view.calls.length, 1);
  assert.equal(view.selectChoice(id(7)), true); assert.equal(await view.check(), true);
  assert.equal(view.calls[0].url, '/api/v1/me/creator-studio/stories/' + id(1) + '/body-preview?locale=ko');
  assert.equal(view.calls[1].url, '/api/v1/me/creator-studio/stories/' + id(1) + '/body-preview/current-fit?locale=ko&choiceId=' + id(7) + '&expectedProgressRevision=7');
  for (const { options } of view.calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options._retried, true);
    assert.deepEqual(clone(options.headers), { 'Cache-Control': 'no-store', Accept: 'application/json' });
    assert.deepEqual(clone(options.identity), { ownerId: id(8), epoch: 1 }); assert.equal(options.body, undefined); assert.equal(options.signal.aborted, false);
  }
  assert.deepEqual(clone(view.snapshot().data), diagnostic()); assert.equal(view.snapshot().messageKey, 'within');
  view.syncContext(); view.snapshot(); assert.equal(view.calls.length, 2);
});

test('CURRENT-FIT: refresh delegates to the actual preview parser and retains no scene/body/progress IDs', async () => {
  const view = screen(), original = view.vm.window.LuminaCreatorBodyPreview.parsePreview, calls = [];
  view.vm.window.LuminaCreatorBodyPreview.parsePreview = (raw, context) => { calls.push(clone(context)); return original(raw, context); };
  await view.refresh(); assert.deepEqual(calls, [{ workId: id(1), locale: 'ko' }]);
  const states = JSON.stringify(view.states);
  for (const secret of ['CURRENT_PRIVATE_SCENE', 'PRIVATE_BODY_NOT_RETAINED', id(2), id(3), id(4), id(5)]) assert.equal(states.includes(secret), false);
  assert.equal(view.snapshot().storyVersion, 3); assert.equal(view.snapshot().progressRevision, 7);
});

test('CURRENT-FIT: invalid owner/work/source/UI locale, visibility and missing preview parser dispatch nothing', async () => {
  for (const [key, value] of [['work', '../unsafe'], ['work', '00000000-0000-0000-0000-000000000000'], ['work', ''],
    ['source', 'zh'], ['source', null], ['language', 'es'], ['owner', null], ['owner', { ownerId: 'unsafe', epoch: 1 }],
    ['owner', { ownerId: id(8), epoch: -1 }], ['owner', { ownerId: id(8), epoch: '1' }], ['shown', false], ['authorized', false]]) {
    const view = screen(); view.set[key](value); assert.equal(await view.refresh(), false); assert.equal(await view.check(), false);
    cleared(view); assert.equal(view.calls.length, 0);
  }
  const view = screen(); delete view.vm.window.LuminaCreatorBodyPreview.parsePreview;
  assert.equal(await view.refresh(), false); assert.equal(view.snapshot().messageKey, 'unavailable'); assert.equal(view.calls.length, 0);
});

test('CURRENT-FIT: missing, completed, incomplete and non-generating paths cannot enable a check', async () => {
  const cases = [
    [v => { v.progress = null; }, 'noProgress'],
    [v => { v.progress.status = 'completed'; v.progress.scene = null; v.progress.choices = []; }, 'ended'],
    [v => { v.progress.scene = null; v.progress.choices = []; }, 'noScene'],
    [v => { v.progress.currentBeatPosition = 1; }, 'notRead'],
    [v => { delete v.progress.currentBeatPosition; }, 'notRead'],
    [v => { v.progress.scene.beats[0].position = 2; v.progress.scene.beats[1].position = 3; v.progress.currentBeatPosition = 3; }, 'notRead'],
    [v => { v.progress.scene.endingType = 'good'; v.progress.choices = []; }, 'ended'],
    [v => { v.progress.choices = [v.progress.choices[0]]; }, 'noChoice']
  ];
  for (const [mutate, key] of cases) {
    const value = preview(); mutate(value); const view = screen(() => response(value));
    assert.equal(await view.refresh(), true); assert.equal(view.snapshot().messageKey, key);
    assert.equal(view.snapshot().canCheck, false); assert.equal(view.selectChoice(id(7)), false);
    assert.equal(await view.check(), false); assert.equal(view.calls.length, 1);
  }
});

test('CURRENT-FIT: fully read generated scenes use the same explicit choice and revision contract', async () => {
  const value = preview(); value.progress.scene.isGenerated = true;
  const view = screen(({ url }) => response(url.includes('/current-fit?') ? diagnostic() : value));
  await choose(view); assert.equal(await view.check(), true); assert.equal(view.snapshot().data.progressRevision, 7);
  assert.equal(view.calls[1].url.endsWith('&choiceId=' + id(7) + '&expectedProgressRevision=7'), true);
});

test('CURRENT-FIT: inclusive input cap, zero revision and exact odd 80-120 bounds parse without mutation', () => {
  for (const [budget, fit, reason] of [[32768, 'within_policy_bound', 'fixed_cap_input_policy_fit'], [32769, 'exceeds_policy_bound', 'provider_input_bound_exceeded']]) {
    const value = diagnostic('ko', 0); Object.assign(value.diagnostic, { inputTokenBudget: budget, inputFit: fit, reason });
    Object.assign(value.diagnostic.narrativeLength, { referenceUnits: 101, minUnits: 81, targetUnits: 101, maxUnits: 121 });
    const parsed = parse(freeze(value), 'ko', 0); assert.deepEqual(clone(parsed), value); assert.notEqual(parsed, value);
    parsed.diagnostic.inputTokenBudget = 1; assert.equal(value.diagnostic.inputTokenBudget, budget);
  }
});

test('CURRENT-FIT: prepared-request bytes are safe integers independent of reference-text bounds', () => {
  for (const count of [256001, Number.MAX_SAFE_INTEGER]) {
    const value = diagnostic(); value.diagnostic.requestBytes = count;
    assert.equal(parse(freeze(value)).diagnostic.requestBytes, count);
  }
  for (const count of [0, -1, 1.5, '256001', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const value = diagnostic(); value.diagnostic.requestBytes = count;
    assert.throws(() => parse(value));
  }
});

test('CURRENT-FIT: large prepared-request metadata renders an input-exceeded result without enabling execution', async () => {
  const value = diagnostic();
  Object.assign(value.diagnostic, { requestBytes: 256001, inputTokenBudget: 32769,
    inputFit: 'exceeds_policy_bound', reason: 'provider_input_bound_exceeded' });
  const view = mounted(({ url }) => response(url.includes('/current-fit?') ? value : preview()));
  await mountedCheck(view);
  assert.match(view.host.textContent, /입력 허용량 초과/);
  assert.match(view.host.textContent, /실행 미승인/);
  assert.equal(view.calls.length, 2);
});

test('CURRENT-FIT: unavailable source has only finite reasons and null versions, not an invented zero', () => {
  const reasons = ['progress_unavailable', 'progress_changed', 'release_unavailable', 'approval_unavailable', 'source_scope_mismatch',
    'source_unavailable', 'choice_unavailable', 'source_not_fully_read', 'capability_unavailable', 'fixed_cap_settings_mismatch', 'context_unavailable'];
  for (const reason of reasons) assert.deepEqual(clone(parse(freeze(unavailable(reason)))), unavailable(reason));
  for (const mutate of [v => { v.reason = '__proto__'; }, v => { v.reason = 'PRIVATE_ERROR'; }, v => { v.progressRevision = 0; },
    v => { v.profileVersion = 0; }, v => { v.approvalReferenceVerified = true; }, v => { v.diagnostic = diagnostic().diagnostic; }, v => { delete v.reason; }]) {
    const value = unavailable(); mutate(value); assert.throws(() => parse(value));
  }
});

test('CURRENT-FIT: all recognized unmeasured errors preserve null fields and never imply output measurement', () => {
  for (const reason of ['fixed_cap_request_limits_mismatch', 'provider_pin_mismatch', 'provider_version_mismatch', 'provider_locale_invalid',
    'provider_request_limits_invalid', 'provider_context_invalid', 'provider_model_encoding_unknown', 'provider_input_bound_exceeded',
    'author_length_profile_invalid', 'author_length_locale_unsupported', 'author_length_beats_invalid', 'author_length_beat_type_invalid',
    'author_length_locale_mismatch', 'author_length_text_invalid', 'author_length_byte_limit', 'author_length_unicode_invalid',
    'author_length_reference_empty', 'provider_narrative_schema_unavailable']) assert.deepEqual(clone(parse(freeze(unmeasured(reason)))), unmeasured(reason));
  for (const field of ['inputTokenBudget', 'requestBytes', 'narrativeLength', 'writingStylePresent']) {
    const value = unmeasured(); value.diagnostic[field] = 0; assert.throws(() => parse(value));
  }
});

test('CURRENT-FIT: exact contracts, readonly flags, legal/paid status and numeric versions fail closed', () => {
  const mutations = [v => { v.contract = 'v2'; }, v => { v.locale = 'en'; }, v => { v.sourceScope = 'other'; },
    v => { v.readOnly = false; }, v => { v.operatingWrites = 1; }, v => { v.legalAuthorization = 'approved'; },
    v => { v.paidApproval = 'approved'; }, v => { v.approvalReferenceVerified = false; }, v => { v.currentSourceState = 'unknown'; },
    v => { v.outcome = 'ready'; }, v => { v.progressRevision = 8; }, v => { v.progressRevision = '7'; },
    v => { delete v.diagnostic; }, v => { v.extra = 'PRIVATE'; }];
  for (const field of ['manuscriptVersion', 'analysisVersion', 'profileVersion', 'reviewRevision']) for (const value of [0, -1, 1.5, '1', null, 2147483648]) mutations.push(v => { v[field] = value; });
  for (const level of ['root', 'diagnostic']) for (const flag of ['providerCalls', 'dispatchAuthorized', 'semanticQualityVerified']) {
    mutations.push(v => { (level === 'root' ? v : v.diagnostic)[flag] = true; });
    mutations.push(v => { delete (level === 'root' ? v : v.diagnostic)[flag]; });
  }
  for (const mutate of mutations) { const value = diagnostic(); mutate(value); assert.throws(() => parse(value)); }
  for (const value of [null, [], false, 'unsafe']) assert.throws(() => parse(value));
  for (const revision of [null, -1, '7', NaN, Infinity, 2147483648]) assert.throws(() => parse(diagnostic(), 'ko', revision));
});

test('CURRENT-FIT: cap, fit/reason/count and exact narrative range contradictions are rejected', () => {
  const mutations = [d => { d.fixedInputTokenLimit = 65536; }, d => { d.fixedOutputTokenLimit = 16384; },
    d => { d.budgetMethod = 'estimate'; }, d => { d.contextSource = 'paid_lease'; }, d => { d.currentApprovalVerified = true; },
    d => { d.outputFit = 'within_policy_bound'; }, d => { d.multiStageFit = 'implemented'; }, d => { d.inputFit = 'ready'; },
    d => { d.inputTokenBudget = 32769; }, d => { d.inputTokenBudget = 0; }, d => { d.inputTokenBudget = '500'; },
    d => { d.requestBytes = 0; }, d => { d.requestBytes = Number.MAX_SAFE_INTEGER + 1; }, d => { d.writingStylePresent = 'true'; },
    d => { d.reason = 'provider_input_bound_exceeded'; }, d => { d.reason = '__proto__'; }, d => { d.reason = ['fixed_cap_input_policy_fit']; },
    d => { d.narrativeLength = null; }, d => { d.private = 'unsafe'; }];
  for (const mutate of mutations) { const value = diagnostic(); mutate(value.diagnostic); assert.throws(() => parse(value)); }
  for (const mutate of [b => { b.measurement = 'bytes'; }, b => { b.referenceUnits = 0; }, b => { b.referenceUnits = 256001; },
    b => { b.referenceUnits = '100'; }, b => { b.minUnits = 79; }, b => { b.targetUnits = 99; }, b => { b.maxUnits = 121; },
    b => { b.maxUnits = Infinity; }, b => { b.secret = 'PRIVATE'; }, b => { delete b.minUnits; }]) {
    const value = diagnostic(); mutate(value.diagnostic.narrativeLength); assert.throws(() => parse(value));
  }
  const unknown = unmeasured('new_server_code'); assert.throws(() => parse(unknown));
});

test('CURRENT-FIT: private extra response fields at every level never enter states', async () => {
  const secret = '<img src=x onerror=private()>PRIVATE_REQUEST';
  for (const level of ['root', 'diagnostic', 'bounds']) {
    const value = diagnostic(); (level === 'root' ? value : level === 'diagnostic' ? value.diagnostic : value.diagnostic.narrativeLength).raw = secret;
    const view = screen(({ url }) => response(url.includes('/current-fit?') ? value : preview()));
    await choose(view); assert.equal(await view.check(), false); cleared(view);
    assert.equal(view.snapshot().messageKey, 'invalid'); assert.equal(JSON.stringify(view.states).includes(secret), false);
  }
});

test('CURRENT-FIT: wrong preview owner scope, locale and malformed choices cannot bypass the shared parser', async () => {
  for (const mutate of [v => { v.workId = id(9); }, v => { v.locale = 'en'; }, v => { v.readOnly = false; },
    v => { v.progress.choices[1].id = 'unsafe'; }, v => { v.progress.choices[1].id = id(6); },
    v => { v.progress.choices[1].label = '\uD800'; }, v => { v.progress.scene.beats[0].content = '\u0000'; }]) {
    const value = preview(); mutate(value); const view = screen(() => response(value));
    assert.equal(await view.refresh(), false); cleared(view); assert.equal(view.snapshot().messageKey, 'invalid'); assert.equal(view.calls.length, 1);
  }
});

test('CURRENT-FIT: diagnostic 16 KiB limit accepts the boundary and cancels the next byte', async () => {
  const raw = JSON.stringify(diagnostic());
  for (const extra of [0, 1]) {
    const res = response(null, { raw: raw + ' '.repeat(16384 - Buffer.byteLength(raw) + extra) });
    const view = screen(({ url }) => url.includes('/current-fit?') ? res : response(preview())); await choose(view);
    assert.equal(await view.check(), extra === 0); assert.equal(res.stats.textReads, 0); assert.equal(res.stats.jsonReads, 0);
    assert.equal(res.stats.released, 1); assert.equal(res.stats.cancelled, extra); if (extra) cleared(view);
  }
});

test('CURRENT-FIT: preview uses its separate 256 KiB bound without inflating the diagnostic bound', async () => {
  const raw = JSON.stringify(preview());
  for (const extra of [0, 1]) {
    const res = response(null, { raw: raw + ' '.repeat(262144 - Buffer.byteLength(raw) + extra) }), view = screen(() => res);
    assert.equal(await view.refresh(), extra === 0); assert.equal(res.stats.cancelled, extra); assert.equal(res.stats.released, 1);
    assert.equal(res.stats.textReads, 0); assert.equal(res.stats.jsonReads, 0); if (extra) cleared(view);
  }
  assert.equal(library().api.maxBytes, 16384); assert.equal(library().api.previewMaxBytes, 262144);
});

test('CURRENT-FIT: malformed length and non-JSON/UTF-8 headers cancel before reading either body', async () => {
  for (const mode of ['refresh', 'check']) {
    const ceiling = mode === 'refresh' ? 262144 : 16384;
    for (const options of [{ length: String(ceiling + 1) }, { length: '-1' }, { length: '1.5' }, { length: 'NaN' },
      { length: '9007199254740993' }, { type: 'text/html' }, { type: 'application/json; charset=latin1' }, { type: 'application/json; x=private' }]) {
      const res = response(mode === 'refresh' ? preview() : diagnostic(), options);
      const view = screen(({ url }) => mode === 'refresh' || url.includes('/current-fit?') ? res : response(preview()));
      if (mode === 'check') await choose(view);
      assert.equal(await view[mode](), false); cleared(view); assert.equal(view.snapshot().messageKey, 'invalid');
      assert.equal(res.stats.reads, 0); assert.equal(res.stats.cancelled, 1);
    }
  }
});

test('CURRENT-FIT: fatal UTF-8 handles split multibyte preview text and rejects malformed, truncated and nonbyte chunks', async () => {
  const value = preview(); value.progress.choices[1].label = '\uD55C\uD83C\uDFAC';
  const split = Array.from(bytes(JSON.stringify(value)), byte => new Uint8Array([byte]));
  const view = screen(() => response(null, { chunks: split })); assert.equal(await view.refresh(), true);
  assert.equal(view.snapshot().choices[0].label, '\uD55C\uD83C\uDFAC');
  for (const chunks of [[new Uint8Array([0xff])], [new Uint8Array([0xe2, 0x82])], [bytes('{broken')], [[123]]]) {
    const res = response(null, { chunks }), bad = screen(() => res); assert.equal(await bad.refresh(), false); cleared(bad);
    assert.equal(bad.snapshot().messageKey, 'invalid'); assert.equal(res.stats.cancelled, 1); assert.equal(res.stats.released, 1);
  }
});

test('CURRENT-FIT: missing stream, nonnumeric status and empty bodies never use JSON/text fallbacks', async () => {
  for (const result of [null, { status: 200, json: () => { throw new Error('Forbidden'); } }, { status: '200' }, response(null, { raw: '' })]) {
    const view = screen(() => result); assert.equal(await view.refresh(), false); cleared(view); assert.equal(view.snapshot().messageKey, 'invalid');
  }
});

test('CURRENT-FIT: HTTP failures clear preview/results, cancel unread bodies and do not retry or fall back', async () => {
  for (const [status, key] of [[401, 'unauthenticated'], [403, 'forbidden'], [404, 'unavailable'], [409, 'changed'], [500, 'server'], [503, 'server'], [400, 'unavailable']]) {
    const res = response(null, { status }), view = screen(({ url }) => url.includes('/current-fit?') ? res : response(preview()));
    await choose(view); assert.equal(await view.check(), false); cleared(view); assert.equal(view.snapshot().messageKey, key);
    assert.equal(res.stats.reads, 0); assert.equal(res.stats.cancelled, 1); view.syncContext(); assert.equal(view.calls.length, 2);
  }
});

test('CURRENT-FIT: network errors and forged error kinds expose only a finite connection status', async () => {
  const secret = 'PRIVATE_DB_OR_PROVIDER_ERROR';
  const view = screen(({ url }) => { if (url.includes('/current-fit?')) throw Object.assign(new Error(secret), { kind: 'within' }); return response(preview()); });
  await choose(view); assert.equal(await view.check(), false); cleared(view); assert.equal(view.snapshot().messageKey, 'transport');
  assert.equal(JSON.stringify(view.states).includes(secret), false); assert.equal(view.calls.length, 2);
});

test('CURRENT-FIT: duplicate refresh/check commands stay single-flight and ignore stale tickets', async () => {
  const first = deferred(), second = deferred(), view = screen(({ calls }) => calls.length === 1 ? first.promise : second.promise);
  const refreshing = view.refresh(), refreshTicket = view.snapshot().ticket;
  assert.equal(await view.refresh(refreshTicket), false); assert.equal(await view.check(), false); assert.equal(view.calls.length, 1);
  first.resolve(response(preview())); assert.equal(await refreshing, true); view.selectChoice(id(7));
  assert.equal(await view.check(refreshTicket), false); assert.equal(view.calls.length, 1);
  const checking = view.check(); assert.equal(view.snapshot().busy, true);
  assert.equal(await view.check(), false); assert.equal(await view.refresh(), false); assert.equal(view.calls.length, 2);
  second.resolve(response(diagnostic())); assert.equal(await checking, true);
});

test('CURRENT-FIT: only retained generation UUIDs can be selected and a choice never triggers a request', async () => {
  const view = screen(); await view.refresh(); const ticket = view.snapshot().ticket;
  for (const value of [id(6), id(11), 'unsafe', '../route', null]) assert.equal(view.selectChoice(value), false);
  assert.equal(view.selectChoice(id(7), ticket - 1), false); assert.equal(view.calls.length, 1);
  assert.equal(view.selectChoice(id(7), ticket), true); assert.equal(view.selectChoice(id(7)), true);
  assert.equal(view.snapshot().progressRevision, 7); assert.equal(view.snapshot().storyVersion, 3); assert.equal(view.calls.length, 1);
});

test('CURRENT-FIT: changing a pending choice aborts the old check and preserves the preview revision', async () => {
  for (const success of [true, false]) {
    const held = deferred(), view = screen(({ url }) => url.includes('/current-fit?') ? held.promise : response(preview()));
    await choose(view); const checking = view.check(), signal = view.calls[1].options.signal;
    assert.equal(view.snapshot().canSelect, true); assert.equal(view.selectChoice(id(10)), true); assert.equal(signal.aborted, true);
    const before = clone(view.snapshot()); assert.equal(before.selectedChoiceId, id(10)); assert.equal(before.progressRevision, 7); assert.equal(before.data, null);
    if (success) held.resolve(response(diagnostic())); else held.reject(new Error('OLD_PRIVATE_ERROR'));
    assert.equal(await checking, false); assert.deepEqual(clone(view.snapshot()), before); assert.equal(view.calls.length, 2);
  }
});

test('CURRENT-FIT: changing or clearing a completed selection erases the result without implicit check', async () => {
  const view = screen(); await choose(view); await view.check(); assert.ok(view.snapshot().data);
  view.selectChoice(id(10)); assert.equal(view.snapshot().data, null); assert.equal(view.snapshot().progressRevision, 7); assert.equal(view.calls.length, 2);
  assert.equal(view.selectChoice(''), true); assert.equal(view.snapshot().canCheck, false); assert.equal(view.snapshot().choices.length, 2);
});

test('CURRENT-FIT: diagnostic revision mismatch is rejected instead of rebinding to newer progress', async () => {
  const view = screen(({ url }) => response(url.includes('/current-fit?') ? diagnostic('ko', 8) : preview()));
  await choose(view); assert.equal(await view.check(), false); cleared(view); assert.equal(view.snapshot().messageKey, 'invalid');
  assert.equal(view.calls[1].url.endsWith('expectedProgressRevision=7'), true);
});

for (const [name, change] of [['owner', v => v.set.owner({ ownerId: id(9), epoch: 2 })], ['work', v => v.set.work(id(9))],
  ['source locale', v => v.set.source('ja')], ['UI locale', v => v.set.language('en')], ['visibility', v => v.set.shown(false)],
  ['auth epoch', v => v.set.owner({ ownerId: id(8), epoch: 2 })], ['auth expiry', v => v.set.authorized(false)]]) {
  test('CURRENT-FIT: ' + name + ' resets all state and rejects late preview/check completion', async () => {
    for (const mode of ['refresh', 'check']) for (const success of [true, false]) {
      const held = deferred(), view = screen(({ url }) => mode === 'refresh' || url.includes('/current-fit?') ? held.promise : response(preview()));
      if (mode === 'check') await choose(view);
      const pending = view[mode](), count = view.calls.length; change(view); view.syncContext(); cleared(view);
      assert.equal(view.calls[count - 1].options.signal.aborted, true); const before = clone(view.snapshot());
      if (success) held.resolve(response(mode === 'refresh' ? preview() : diagnostic())); else held.reject(new Error('OLD_PRIVATE'));
      assert.equal(await pending, false); assert.deepEqual(clone(view.snapshot()), before); assert.equal(view.calls.length, count);
    }
    const loaded = screen(); await choose(loaded); await loaded.check(); change(loaded); loaded.syncContext(); cleared(loaded); assert.equal(loaded.calls.length, 2);
  });
}

test('CURRENT-FIT: A-B-A owner epochs and explicit same-context invalidation reject the old ticket', async () => {
  for (const identity of [true, false]) {
    const held = deferred(), view = screen(({ url }) => url.includes('/current-fit?') ? held.promise : response(preview()));
    await choose(view); const pending = view.check();
    if (identity) { view.set.owner({ ownerId: id(9), epoch: 2 }); view.syncContext(); view.set.owner({ ownerId: id(8), epoch: 3 }); view.syncContext(); }
    else view.invalidate();
    held.resolve(response(diagnostic())); assert.equal(await pending, false); cleared(view); assert.equal(view.calls.length, 2);
  }
});

test('CURRENT-FIT: a stale stream chunk cannot parse or unlock a newer pending preview read', async () => {
  const chunk = deferred(), started = deferred(), next = deferred(); let reads = 0, cancelled = 0, released = 0;
  const heldResponse = response(null, { reader: { read: () => { reads++; started.resolve(); return chunk.promise; },
    cancel: async () => { cancelled++; }, releaseLock: () => { released++; } } });
  const view = screen(({ calls }) => calls.length === 1 ? heldResponse : next.promise), first = view.refresh();
  await started.promise; view.invalidate(); const second = view.refresh();
  chunk.resolve({ done: false, value: bytes(JSON.stringify(preview())) });
  assert.equal(await first, false); assert.equal(view.snapshot().busy, true); cleared(view);
  assert.equal(reads, 1); assert.equal(cancelled, 1); assert.equal(released, 1);
  next.resolve(response(preview('ko', 8))); assert.equal(await second, true); assert.equal(view.snapshot().progressRevision, 8); assert.equal(view.calls.length, 2);
});

test('CURRENT-FIT: auth expiry during a chunk is checked before decoding and stops further reads', async () => {
  let view, reads = 0, cancelled = 0, released = 0;
  const res = response(null, { reader: { read: async () => { reads++; view.set.authorized(false); return { done: false, value: new Uint8Array([0xff]) }; },
    cancel: async () => { cancelled++; }, releaseLock: () => { released++; } } });
  view = screen(() => res); assert.equal(await view.refresh(), false); cleared(view); assert.equal(view.snapshot().messageKey, 'unauthenticated');
  assert.equal(reads, 1); assert.equal(cancelled, 1); assert.equal(released, 1); assert.equal(view.calls.length, 1);
});

test('CURRENT-FIT: reentrant state invalidation aborts before transport and detached snapshots cannot mutate choices/results', async () => {
  let view; view = screen(undefined, state => { if (state.busy) view.invalidate(); });
  assert.equal(await view.refresh(), false); cleared(view); assert.equal(view.calls.length, 0);
  const loaded = screen(); await choose(loaded); await loaded.check();
  const snapshot = loaded.snapshot(); snapshot.choices[0].label = 'unsafe'; snapshot.data.diagnostic.inputTokenBudget = 999;
  assert.equal(loaded.snapshot().choices[0].label, 'First continuation'); assert.equal(loaded.snapshot().data.diagnostic.inputTokenBudget, 500);
});

// Deliberately synthetic: no browser, authentication server, database or provider runtime.
const walk = node => [node, ...node.children.flatMap(walk)];
class Element {
  constructor(tag = 'div', name = '') {
    this.tagName = tag.toUpperCase(); this.id = name; this.children = []; this.listeners = new Map(); this.attributes = {};
    this.dataset = {}; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this._text = '';
    const classes = new Set(); this.classList = { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
  fire(name, event = {}) { let result; for (const callback of this.listeners.get(name) || []) result = callback({ type: name, target: this, ...event }); return result; }
  closest(selector) { return selector === '[data-section]' && this.getAttribute('data-section') !== null ? this : null; }
}
function mounted(handler) {
  const window = new Element(), document = new Element(), shell = new Element('main', 'studioShell'), section = new Element('section', 'writer-manuscript');
  const host = new Element('section', 'writerBodyCurrentFit'), bodyPreview = new Element('section', 'writerBodyPreview'), trial = new Element('section', 'writerBodyTrial');
  const work = new Element('select', 'writerManuscriptWork'), sourceLocale = new Element('select', 'writerManuscriptLocale');
  section.classList.add('is-active'); work.value = id(1); sourceLocale.value = 'ko'; section.append(work, sourceLocale, bodyPreview, host, trial); shell.append(section);
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko'; document.visibilityState = 'visible';
  document.getElementById = name => walk(shell).find(node => node.id === name) || null; document.createElement = tag => new Element(tag);
  let owner = { ownerId: id(8), epoch: 1 }, language = 'ko', accessToken = 'SYNTHETIC_EXISTING_TOKEN', refreshes = 0;
  const calls = [], observers = [], icons = [];
  window.getAuth = () => ({ accessToken, refreshToken: 'DO_NOT_REFRESH' }); window.luminaI18n = { getLocale: () => language };
  window.lucide = { icons: { RefreshCw: { name: 'RefreshCw' }, ClipboardCheck: { name: 'ClipboardCheck' } },
    createElement: icon => { icons.push(icon); return new Element('svg'); } };
  window.LuminaCreatorStudioApi = { identity: () => owner, isCurrent: value => !!owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    fetch: (url, options) => {
      if (!options.token || !options._retried) refreshes++; calls.push({ url, options });
      return handler ? handler({ url, options, calls, locale: sourceLocale.value })
        : response(url.includes('/current-fit?') ? diagnostic(sourceLocale.value) : preview(sourceLocale.value));
    } };
  class MutationObserver { constructor(callback) { this.callback = callback; } observe(target, options) { observers.push({ target, options, callback: this.callback }); } }
  const { api } = library({ window, document, MutationObserver, fetch: () => { throw new Error('Global transport forbidden'); } });
  const node = name => document.getElementById(name);
  return { api, window, document, shell, section, host, bodyPreview, trial, work, sourceLocale, calls, icons, observers, node,
    refresh: () => node('writerBodyCurrentFitRefresh').fire('click'), check: () => node('writerBodyCurrentFitCheck').fire('click'),
    select: (value = id(7)) => { const control = node('writerBodyCurrentFitChoice'); control.value = value; return control.fire('change'); },
    setOwner: value => { owner = value; }, setToken: value => { accessToken = value; }, locale: value => { language = value; }, refreshes: () => refreshes,
    mutate: target => { for (const observer of observers.filter(item => item.target === target)) observer.callback([{ type: 'attributes' }]); } };
}
const metadata = view => view.node('writerBodyCurrentFitContent');
const row = (view, key) => metadata(view).children.find(node => node.children[0].textContent === view.api.copy[view.host.lang][key])?.children[1].textContent;
async function mountedCheck(view) { await view.refresh(); view.select(); await view.check(); }
const emptyDOM = view => {
  assert.equal(metadata(view).children.length, 0); assert.equal(metadata(view).hidden, true);
  assert.equal(view.node('writerBodyCurrentFitChoice').value, ''); assert.equal(view.node('writerBodyCurrentFitChoice').children.length, 1);
  assert.equal(view.node('writerBodyCurrentFitCheck').disabled, true);
};

test('CURRENT-FIT: actual IIFE mounts one unframed sibling with native select and two icon controls, without requests', () => {
  const view = mounted(); assert.equal(view.api.mount(view.host), null); assert.equal(view.calls.length, 0); emptyDOM(view);
  assert.deepEqual(view.section.children.map(node => node.id), ['writerManuscriptWork', 'writerManuscriptLocale', 'writerBodyPreview', 'writerBodyCurrentFit', 'writerBodyTrial']);
  assert.equal(view.icons.length, 2); assert.equal(view.icons[0], view.window.lucide.icons.RefreshCw); assert.equal(view.icons[1], view.window.lucide.icons.ClipboardCheck);
  assert.equal(walk(view.host).filter(node => node.tagName === 'SELECT').length, 1); assert.equal(walk(view.host).filter(node => node.tagName === 'BUTTON').length, 2);
  for (const button of walk(view.host).filter(node => node.tagName === 'BUTTON')) {
    assert.equal(button.type, 'button'); assert.ok(button.title); assert.equal(button.getAttribute('aria-label'), button.title); assert.equal(button.children[0].getAttribute('aria-hidden'), 'true');
  }
  assert.equal(walk(view.host).filter(node => ['ARTICLE', 'INPUT', 'TEXTAREA', 'A', 'IMG'].includes(node.tagName)).length, 0);
});

test('CURRENT-FIT: mounted explicit token-pinned GETs bypass refresh, retain native options and leave siblings alone', async () => {
  const view = mounted(); view.bodyPreview.textContent = 'EXISTING_PREVIEW'; view.trial.textContent = 'EXISTING_COMMAND_JOURNAL';
  await view.refresh(); const select = view.node('writerBodyCurrentFitChoice'), options = select.children;
  assert.equal(select.value, ''); assert.equal(view.node('writerBodyCurrentFitCheck').disabled, true);
  view.select(); assert.equal(select.children, options); assert.equal(view.calls.length, 1);
  await view.check(); assert.equal(select.children, options); assert.equal(view.calls.length, 2);
  for (const { options } of view.calls) { assert.equal(options.token, 'SYNTHETIC_EXISTING_TOKEN'); assert.equal(options._retried, true); }
  assert.equal(view.refreshes(), 0); assert.equal(view.bodyPreview.textContent, 'EXISTING_PREVIEW'); assert.equal(view.trial.textContent, 'EXISTING_COMMAND_JOURNAL');
  assert.equal(row(view, 'range'), '80 - 120'); assert.equal(row(view, 'input'), '32768'); assert.equal(row(view, 'budget'), '500');
  for (const event of ['focus', 'pageshow', 'lumina:localechange']) view.window.fire(event);
  assert.equal(view.calls.length, 2);
});

test('CURRENT-FIT: missing and reentrant late auth tokens cannot issue a GET for a changed context', async () => {
  for (const change of ['missing', 'owner', 'work', 'source', 'language']) {
    const view = mounted();
    if (change === 'missing') view.setToken(null);
    else view.window.getAuth = () => {
      if (change === 'owner') view.setOwner({ ownerId: id(9), epoch: 2 });
      if (change === 'work') view.work.value = id(9);
      if (change === 'source') view.sourceLocale.value = 'ja';
      if (change === 'language') view.locale('en');
      return { accessToken: 'SYNTHETIC_OTHER_TOKEN' };
    };
    assert.equal(await view.refresh(), false); assert.equal(view.calls.length, 0); assert.equal(view.refreshes(), 0); emptyDOM(view);
  }
});

for (const language of locales) test('CURRENT-FIT: ' + language + ' business labels keep independent source locale and numeric versions', async () => {
  const view = mounted(); view.locale(language); view.sourceLocale.value = 'ja'; view.sourceLocale.fire('change');
  await mountedCheck(view); const c = view.api.copy[language]; assert.equal(view.host.lang, language);
  assert.equal(view.calls[0].url.endsWith('?locale=ja'), true); assert.equal(view.calls[1].url.includes('/current-fit?locale=ja&choiceId='), true);
  assert.equal(view.node('writerBodyCurrentFitRefresh').title, c.refresh); assert.equal(view.node('writerBodyCurrentFitCheck').title, c.check);
  for (const label of [c.within, c.manuscript, c.analysis, c.profile, c.review, c.reference, c.range, c.output, c.style, c.legal, c.paid]) assert.ok(view.host.textContent.includes(label), label);
  for (const [key, value] of [['revision', '7'], ['story', '3'], ['manuscript', '4'], ['analysis', '5'], ['profile', '6'], ['review', '2'],
    ['output', c.unmeasured], ['style', c.notVerified], ['legal', c.notEvaluated], ['paid', c.notEvaluated], ['dispatch', c.notAuthorized]]) assert.equal(row(view, key), value);
  assert.equal(row(view, 'source'), '\u65e5\u672c\u8a9e');
  assert.doesNotMatch(view.host.textContent, /story-author-current-fit|story-fixed-cap-fit|within_policy_bound|fixed_cap_input_policy_fit|not_evaluated/);
});

test('CURRENT-FIT: five dictionaries have identical finite labels and no output/style success language', () => {
  const { api } = library(), keys = Object.keys(api.copy.ko).sort();
  for (const language of locales) {
    assert.deepEqual(Object.keys(api.copy[language]).sort(), keys);
    for (const [key, text] of Object.entries(api.copy[language])) assert.ok(typeof text === 'string' && (key === 'hidden' || text.length > 0));
  }
  assert.equal(api.copy.en.within, 'Within input allowance'); assert.equal(api.copy.en.notVerified, 'Quality unverified');
  assert.equal(api.copy.en.notEvaluated, 'Not evaluated'); assert.equal(api.copy.en.unmeasured, 'Unmeasured');
});

test('CURRENT-FIT: lifecycle, profile save, manuscript acceptance and progress events reset every field without a GET', async () => {
  for (const name of ['storage', 'lumina:authchange', 'lumina:auth-expired', 'pagehide', 'creator:manuscript-accepted',
    'creator:generation-profile-changed', 'lumina:author-body-trial-progress-changed']) {
    const view = mounted(); await mountedCheck(view); view.window.fire(name); emptyDOM(view); assert.equal(view.calls.length, 2);
  }
  for (const name of ['visibilitychange', 'lumina:auth-expired']) {
    const view = mounted(); await mountedCheck(view); view.document.fire(name); emptyDOM(view); assert.equal(view.calls.length, 2);
  }
});

test('CURRENT-FIT: work/source/UI locale, visibility and tab mutations erase displayed versions', async () => {
  for (const change of ['work', 'source', 'language', 'shell', 'section', 'host', 'document', 'tab', 'hide-show', 'control-mutation']) {
    const view = mounted(); await mountedCheck(view);
    if (change === 'work') { view.work.value = id(9); view.work.fire('input'); }
    if (change === 'source') { view.sourceLocale.value = 'en'; view.sourceLocale.fire('change'); }
    if (change === 'language') { view.locale('en'); view.window.fire('lumina:localechange'); }
    if (change === 'shell') { view.shell.hidden = true; view.mutate(view.shell); }
    if (change === 'section') { view.section.classList.remove('is-active'); view.mutate(view.section); }
    if (change === 'host') { view.host.hidden = true; view.mutate(view.host); }
    if (change === 'document') { view.document.documentElement.lang = 'en'; view.mutate(view.document.documentElement); }
    if (change === 'tab') { const tab = new Element('button'); tab.setAttribute('data-section', 'artist-list'); view.document.fire('click', { target: tab }); }
    if (change === 'hide-show') { view.section.classList.remove('is-active'); view.section.classList.add('is-active'); view.mutate(view.section); }
    if (change === 'control-mutation') { view.sourceLocale.value = 'ja'; view.mutate(view.sourceLocale); }
    emptyDOM(view); assert.equal(view.calls.length, 2, change); assert.equal(view.refreshes(), 0);
  }
});

test('CURRENT-FIT: profile reset and newer explicit preview cannot be overwritten by a late diagnostic', async () => {
  const held = deferred(), view = mounted(({ url, calls }) => {
    if (url.includes('/current-fit?')) return held.promise;
    return response(preview('ko', calls.length === 1 ? 7 : 8));
  });
  await view.refresh(); view.select(); const pending = view.check();
  view.window.fire('creator:generation-profile-changed'); emptyDOM(view); assert.equal(view.calls[1].options.signal.aborted, true);
  await view.refresh(); const before = view.host.textContent; held.resolve(response(diagnostic()));
  assert.equal(await pending, false); assert.equal(view.host.textContent, before); assert.equal(row(view, 'revision'), '8'); assert.equal(view.calls.length, 3);
});

test('CURRENT-FIT: choice change cancels mounted check immediately and clears diagnostics in the DOM', async () => {
  const held = deferred(), view = mounted(({ url }) => url.includes('/current-fit?') ? held.promise : response(preview()));
  await view.refresh(); view.select(); const pending = view.check(); view.select(id(10));
  assert.equal(view.calls[1].options.signal.aborted, true); assert.equal(view.node('writerBodyCurrentFitCheck').disabled, false);
  assert.equal(row(view, 'budget'), undefined); assert.equal(row(view, 'revision'), '7');
  held.resolve(response(diagnostic())); assert.equal(await pending, false); assert.equal(row(view, 'budget'), undefined); assert.equal(view.calls.length, 2);
});

test('CURRENT-FIT: unmeasured/unavailable displays null measurements and rejects injected private fields', async () => {
  const view = mounted(({ url }) => response(url.includes('/current-fit?') ? unmeasured() : preview())); await mountedCheck(view);
  const c = view.api.copy.ko;
  for (const key of ['reference', 'range', 'budget', 'output']) assert.equal(row(view, key), c.unmeasured);
  assert.equal(row(view, 'input'), '32768'); assert.equal(row(view, 'style'), c.notVerified); assert.equal(row(view, 'legal'), c.notEvaluated);
  const absent = mounted(({ url }) => response(url.includes('/current-fit?') ? unavailable('progress_changed') : preview())); await mountedCheck(absent);
  assert.equal(absent.node('writerBodyCurrentFitChoice').children.length, 1); assert.equal(absent.node('writerBodyCurrentFitCheck').disabled, true);
  assert.equal(row(absent, 'revision'), c.unmeasured); assert.equal(absent.node('writerBodyCurrentFitState').textContent, c.changed);
  const attack = '<img src=x onerror=steal()>PRIVATE_BODY', value = diagnostic(); value.raw = attack;
  const invalid = mounted(({ url }) => response(url.includes('/current-fit?') ? value : preview())); await mountedCheck(invalid); emptyDOM(invalid);
  assert.equal(invalid.host.textContent.includes(attack), false); assert.equal(walk(invalid.host).filter(node => ['IMG', 'SCRIPT', 'IFRAME', 'INPUT', 'TEXTAREA', 'A'].includes(node.tagName)).length, 0);
});

test('CURRENT-FIT: narrow readonly transport, text-only rendering and fixed responsive icon/select layout', () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|setInterval|setTimeout|\.json\(|\.text\(|method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /\/generate|\/approve|\/payments|\/auth\/refresh|console\.|createObjectURL/);
  assert.match(source, /new TextDecoder\("utf-8", \{ fatal: true \}\)/); assert.match(source, /_retried: true, cache: "no-store"/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 44px/); assert.match(css, /width: 44px;\s*height: 44px/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/); assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /letter-spacing: 0/); assert.match(css, /@media print/);
  assert.doesNotMatch(css, /box-shadow|linear-gradient|\d(?:vw|cqw)|min-width:\s*\d{3}px/);
});
