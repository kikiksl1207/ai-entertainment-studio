import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, catalog, starters, response, deferred, settle, plain, SLUG, DRAFT } from './helpers/character-chat-catalog-current-20261007.mjs';

test('catalog: existing authenticated GET maps current structured server fields without changing signed-out preview', { timeout: 5000 }, async () => {
  const h = harness(), context = h.api.basicChatContext();
  const result = await h.api.fetchCharacterCatalog(SLUG, context);
  assert.deepEqual(h.calls, [{ path: '/api/v1/chat/character-catalog', method: 'GET', hasAuthorization: true, hasBody: false }]);
  assert.deepEqual(plain(result), { statusLine: 'Synthetic status \u00b7 Synthetic description', welcomeMessage: 'Synthetic greeting',
    lastMessagePreview: 'Synthetic greeting', starters: [{ key: 'A', label: 'Synthetic choice', message: 'Synthetic message' }] });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_MARKER|RAM_PRIVATE_ID|\[object Object\]/);
  h.api.catalogCallbackFor(SLUG, context)(result);
  assert.equal(h.$('chatHeroSummary').textContent, result.statusLine);
  assert.equal(h.$('chatWelcomeText').textContent, result.welcomeMessage);
  assert.equal(h.$('chatStarterCard').hidden, false);
  assert.equal(h.$('chatInput').value, DRAFT);
  const out = harness({ signedIn: false }); out.api.renderWelcomeBubble(SLUG, null);
  const preview = out.snapshot();
  assert.equal(await out.api.fetchCharacterCatalog(SLUG), null);
  assert.equal(await out.api.fetchStarterPrompts(SLUG), null);
  assert.equal(out.calls.length, 0); assert.deepEqual(out.snapshot(), preview);
});

test('catalog: malformed payload and unproved flat aliases fail closed; actual strings remain literal safe text', { timeout: 5000 }, async () => {
  const invalid = [null, [], false,
    { status: 'Flat status', greeting: 'Flat greeting' },
    { statusLine: 'Legacy alias', welcomeMessage: 'Legacy alias' },
    ...['labelKo', 'descriptionKo'].flatMap(field => [null, [], {}, false, 3, ''].map(value => {
      const data = catalog(); data.status[field] = value; return data;
    })),
    ...[null, [], {}, false, 3, ''].map(value => { const data = catalog(); data.greeting.text = value; return data; }),
  ];
  for (const data of invalid) {
    const h = harness({ catalogReply: () => response(data) }); const before = h.snapshot();
    const result = await h.api.fetchCharacterCatalog(SLUG);
    assert.equal(result, null); h.api.catalogCallbackFor(SLUG, h.api.basicChatContext())(result);
    assert.deepEqual(h.snapshot(), before, 'No malformed success or fallback object rendered');
  }
  for (const status of [403, 500]) {
    const h = harness({ catalogReply: () => response({ message: 'Synthetic error' }, status) });
    assert.equal(await h.api.fetchCharacterCatalog(SLUG), null); assert.equal(h.calls.length, 1);
  }
  const data = catalog(); data.greeting.text = '<img src=x onerror=invalid>literal';
  data.starterOptions = [null, { key: {}, label: 'Bad key', message: 'Bad' },
    { key: 'X', label: {}, message: 'Bad label' }, { key: 'Y', label: 'Bad body', message: {} },
    { key: 'A', label: '<b>literal option</b>', message: '' }, ...catalog().starterOptions];
  const h = harness({ catalogReply: () => response(data) }), result = await h.api.fetchCharacterCatalog(SLUG);
  assert.deepEqual(plain(result.starters), [{ key: 'A', label: '<b>literal option</b>', message: '' }]);
  h.api.catalogCallbackFor(SLUG, h.api.basicChatContext())(result);
  assert.equal(h.$('chatWelcomeText').textContent, data.greeting.text);
  assert.match(h.$('chatStarterOptions').textContent, /<b>literal option<\/b>/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_MARKER|Bad key|Bad label|Bad body/);
});

test('entry: late catalog/starter success or error cannot revive retired route; normal account-only sidebar context survives', { timeout: 5000 }, async () => {
  for (const fail of [false, true]) {
    const lateCatalog = deferred(), lateStarter = deferred();
    const h = harness({ catalogReply: () => lateCatalog.promise, starterReply: () => lateStarter.promise });
    const entry = h.api.basicChatContext(), callback = h.api.catalogCallbackFor(SLUG, entry), job = h.start();
    await settle(); assert.equal(h.calls.length, 2);
    h.api.invalidateBasicStoryRoute();
    assert.equal(h.api.isConversationListContextCurrent(entry), true, 'Sidebar account scope is not changed by room retirement');
    assert.equal(h.api.isBasicChatContextCurrent(entry), false);
    const retired = h.snapshot(); assert.equal(retired.draft, DRAFT); assert.equal(retired.sendDisabled, true);
    lateCatalog.resolve(response(catalog()));
    lateStarter.resolve(fail ? response({ message: 'Late synthetic failure' }, 403) : response(starters()));
    await job; await settle();
    callback({ statusLine: 'Late projected status', welcomeMessage: 'Late projected greeting', starters: catalog().starterOptions });
    h.api.applyFinalStarter(SLUG, entry, starters());
    assert.deepEqual(h.snapshot(), retired, 'Completion, catch fallback and final callback all remain retired');
    assert.equal(await h.api.fetchCharacterCatalog(SLUG), null);
    assert.equal(await h.api.fetchStarterPrompts(SLUG), null); assert.equal(h.calls.length, 2);
  }
  const normal = harness(); await normal.start(); await settle();
  assert.equal(normal.calls.length, 2); assert.equal(normal.$('chatStarterCard').hidden, false);
  assert.equal(normal.api.basicChatState.routeInvalidated, false); assert.equal(normal.$('chatInput').value, DRAFT);
  const catalogLate = deferred(), starterLate = deferred();
  const changed = harness({ catalogReply: () => catalogLate.promise, starterReply: () => starterLate.promise });
  const entry = changed.api.basicChatContext(), pending = changed.start(); await settle(); changed.switchAccount();
  const before = changed.snapshot(); catalogLate.resolve(response(catalog())); starterLate.resolve(response(starters()));
  await pending; await settle(); assert.deepEqual(changed.snapshot(), before);
  assert.equal(changed.api.isConversationListContextCurrent(entry), false, 'Independent account change still invalidates sidebar context');
});
