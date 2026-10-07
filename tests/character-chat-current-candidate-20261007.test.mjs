import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, deferred, response, draft, history, sessionId } from './helpers/character-chat-current-candidate-20261007.mjs';

const names = [
  "exact route409 retires the old room and late callbacks while preserving the locked draft",
  "normal send and general409 preserve their existing independent behavior",
  "memory409 preserves the current room and retryable draft"
];

test(names[0], { timeout: 5000 }, async () => {
  const late = deferred();
  let reads = 0;
  const h = await harness({
    generate: () => response({ error: { code: 'STORY_CHAT_ROUTE_CHANGED' } }, 409),
    readHistory: () => ++reads === 1 ? late.promise : response(history),
  });
  const before = h.api.basicChatContext();
  const pending = h.api.readBasicMessages(before).then(
    () => ({ accepted: true }), error => ({ accepted: false, authChanged: error.chatAuthChanged === true }));
  try {
    await h.submit();
    late.resolve(response([{ id: 'late-old', senderType: 'artist', body: 'Synthetic late route' }]));
    const outcome = await pending;
    h.api.applyStarterResponse('synthetic-artist', { artist: { displayName: 'Synthetic Artist', welcomeMessage: 'Synthetic late welcome' } });
    assert.equal(h.api.basicChatState.routeInvalidated, true, 'exact route409 must latch the composer closed');
    assert.equal(h.api.basicChatState.epoch, before.epoch, 'a route conflict is not an account change');
    assert.equal(h.api.basicChatState.routeEpoch, before.routeEpoch + 1);
    assert.equal(h.api.isBasicChatContextCurrent(before), false);
    assert.equal(h.api.isConversationListContextCurrent(before), true);
    assert.equal(outcome.accepted, false, 'cancellation-ignoring history must be rejected');
    assert.equal(outcome.authChanged, true);
    assert.equal(h.requests.find(request => request.signal)?.signal.aborted, true);
    assert.equal(h.api.basicChatState.controllers.size, 0);
    assert.equal(h.api.basicChatState.loadPromise, null);
    assert.equal(h.api.basicChatState.sessionId, null);
    assert.equal(h.api.basicChatState.knownMessageIds.size, 0);
    assert.equal(h.api.basicChatState.uncertain, false);
    assert.equal(h.api.basicChatState.uncertainBody, null);
    assert.equal(h.api.basicChatState.uncertainKind, null);
    assert.equal(h.api.basicChatState.busy, false);
    assert.equal(h.elements.chatInputForm['aria-busy'], 'false');
    assert.equal(h.elements.chatThread.children.length, 0);
    assert.equal(h.elements.chatWelcomeBubble.hidden, true);
    assert.equal(h.elements.chatCheckMessages.hidden, true);
    assert.equal(h.elements.chatInput.value, draft);
    assert.equal(h.elements.chatSendBtn.disabled, true);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'routeChanged');
    assert.equal(h.requests.filter(request => request.method === 'POST').length, 1);
    const count = h.requests.length;
    await h.check();
    await h.submit();
    assert.equal(h.requests.length, count, 'no automatic or repeated request after retirement');
    assert.equal(h.elements.chatInput.value, draft);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'routeChanged');
  } finally {
    late.resolve(response(history));
    await pending;
  }
});

test(names[1], { timeout: 5000 }, async () => {
  for (const mode of ['normal', 'general409']) {
    const h = await harness(mode === 'general409'
      ? { generate: () => response({ code: 'OTHER_CONFLICT' }, 409) } : {});
    const before = h.api.basicChatContext();
    await h.submit();
    assert.equal(Boolean(h.api.basicChatState.routeInvalidated), false, mode);
    assert.equal(h.api.isBasicChatContextCurrent(before), true, mode);
    assert.equal(h.api.basicChatState.sessionId, sessionId, mode);
    assert.equal(h.api.basicChatState.uncertain, false, mode);
    assert.equal(h.api.basicChatState.busy, false, mode);
    assert.equal(h.requests.filter(request => request.method === 'POST').length, 1, mode);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, mode === 'normal' ? 'sent' : 'failed', mode);
    assert.equal(h.elements.chatInput.value, mode === 'normal' ? '' : draft, mode);
    assert.equal(h.elements.chatThread.children.length, mode === 'normal' ? 3 : 1, mode);
    assert.equal(h.api.basicChatState.knownMessageIds.size, mode === 'normal' ? 3 : 1, mode);
    assert.equal(h.elements.chatSendBtn.disabled, mode === 'normal', mode);
    assert.equal(h.elements.chatCheckMessages.hidden, true, mode);
  }
});

test(names[2], { timeout: 5000 }, async () => {
  const h = await harness({ generate: () => response({ code: 'STORY_CHAT_MEMORY_CHANGED' }, 409) });
  const before = h.api.basicChatContext();
  await h.submit();
  assert.equal(Boolean(h.api.basicChatState.routeInvalidated), false);
  assert.equal(h.api.isBasicChatContextCurrent(before), true);
  assert.equal(h.api.basicChatState.sessionId, sessionId);
  assert.equal(h.api.basicChatState.knownMessageIds.size, 1);
  assert.equal(h.api.basicChatState.uncertain, false);
  assert.equal(h.api.basicChatState.busy, false);
  assert.equal(h.elements.chatThread.children.length, 1);
  assert.equal(h.elements.chatInput.value, draft);
  assert.equal(h.elements.chatSendBtn.disabled, false);
  assert.equal(h.elements.chatCheckMessages.hidden, true);
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'memoryChanged');
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 1);
});
