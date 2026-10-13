import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// SOURCE-authored, UNRUN by the independent author. No init, browser or real transport.
const sourceUrl = new URL('../pages/character-chat.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const initMarker = '  if (document.readyState === "loading") {';
assert.equal(source.split(initMarker).length, 2, 'one existing init marker');
const expose = `  window.__greetingOriginTest = {
    basicGreetingOriginKind, basicGreetingOriginCopy, syncGreetingOriginLabels,
    basicChatMessageElement, renderWelcomeBubble
  };\n`;
const copy = {
  'ko-KR': { intro: '\ud504\ub85c\ud544 \uc18c\uac1c', saved: '\uc800\uc7a5\ub41c \uc778\uc0ac\ub9d0', unverified: '\uc800\uc7a5\ub41c \uc778\uc0ac\ub9d0 \u00b7 \uc131\uaca9 \uae30\uc900 \ubbf8\ud655\uc778' },
  'en-US': { intro: 'Profile introduction', saved: 'Saved greeting', unverified: 'Saved greeting \u00b7 Character basis unverified' },
  'ja-JP': { intro: '\u30d7\u30ed\u30d5\u30a3\u30fc\u30eb\u7d39\u4ecb', saved: '\u4fdd\u5b58\u3055\u308c\u305f\u6328\u62f6', unverified: '\u4fdd\u5b58\u3055\u308c\u305f\u6328\u62f6 \u00b7 \u4eba\u7269\u8a2d\u5b9a\u306f\u672a\u78ba\u8a8d' },
  'zh-CN': { intro: '\u4e2a\u4eba\u8d44\u6599\u4ecb\u7ecd', saved: '\u5df2\u4fdd\u5b58\u7684\u95ee\u5019', unverified: '\u5df2\u4fdd\u5b58\u7684\u95ee\u5019 \u00b7 \u89d2\u8272\u4f9d\u636e\u672a\u6838\u5b9e' },
  'zh-TW': { intro: '\u500b\u4eba\u8cc7\u6599\u4ecb\u7d39', saved: '\u5df2\u5132\u5b58\u7684\u554f\u5019', unverified: '\u5df2\u5132\u5b58\u7684\u554f\u5019 \u00b7 \u89d2\u8272\u4f9d\u64da\u672a\u6838\u5be6' },
};
const prose = 'Synthetic original prose <em>must remain literal</em>.';
const createdAt = '2026-09-27T10:11:12.000Z';
const coverages = ['public_traits_and_tone_only', 'public_traits_tone_and_conversation_facts'];
function marker(overrides = {}) {
  return { status: 'approved_public_fields_locked', version: 'approved-public-persona-lock-20261013.v3',
    release: 'approved-public-artists-2026-09-27', personalityAuthority: 'exact_approved_public_release',
    mutableProfileValuesApproved: false, binding: 'b'.repeat(64), sourceSha256: 'a'.repeat(64),
    coverage: coverages[0], ...overrides };
}
function greeting(lock = marker(), overrides = {}) {
  return { senderType: 'artist', messageType: 'opening_greeting', body: prose, createdAt,
    safetyMetadata: { artistPersonaLock: lock }, ...overrides };
}
function nodes(root) { return root.children.flatMap(child => [child, ...nodes(child)]); }
function matches(node, selector) {
  const id = selector.match(/#([\w-]+)/), cls = selector.match(/\.([\w-]+)/);
  const attr = selector.match(/\[([\w-]+)\]/);
  return (!id || node.id === id[1]) && (!cls || node.className.split(/\s+/).includes(cls[1])) &&
    (!attr || node.hasAttribute(attr[1]));
}
function select(root, selector) {
  return nodes(root).filter(node => selector.split(',').some(branch => {
    const parts = branch.trim().split(/\s+/);
    if (!matches(node, parts.pop())) return false;
    let ancestor = node.parentNode;
    while (parts.length) {
      const part = parts.pop();
      while (ancestor && !matches(ancestor, part)) ancestor = ancestor.parentNode;
      if (!ancestor) return false;
      ancestor = ancestor.parentNode;
    }
    return true;
  }));
}
function element(tag = 'div', id = '') {
  const node = { tagName: tag.toUpperCase(), id, children: [], parentNode: null, className: '', dataset: {}, hidden: false,
    text: '', attributes: {},
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { this.text = String(value); this.children.forEach(child => { child.parentNode = null; }); this.children = []; },
    set innerHTML(_) { throw new Error('HTML writes are forbidden'); },
    append(...children) { children.forEach(child => { child.parentNode = this; this.children.push(child); }); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    hasAttribute(name) { return name === 'data-chat-greeting-origin' ? Object.hasOwn(this.dataset, 'chatGreetingOrigin') : Object.hasOwn(this.attributes, name); },
    querySelectorAll(selector) { return select(this, selector); },
  };
  node.classList = { add(value) { node.className = [...new Set([...node.className.split(/\s+/).filter(Boolean), value])].join(' '); } };
  return node;
}
function harness() {
  let locale = 'ko-KR', tone = { welcomeMessage: 'Synthetic static welcome' };
  const effects = [], freshClocks = [];
  const blocked = name => () => { effects.push(name); throw new Error('Forbidden side effect: ' + name); };
  const storage = { getItem: blocked('storage read'), setItem: blocked('storage write'), removeItem: blocked('storage remove'), clear: blocked('storage clear') };
  const elements = Object.fromEntries(['chatThread', 'chatWelcomeBubble', 'chatWelcomeText', 'chatWelcomeTime', 'foreignLabels'].map(id => [id, element('div', id)]));
  const body = element('body'); body.append(...Object.values(elements));
  const window = { location: { search: '', pathname: '/character-chat', hostname: 'synthetic.invalid' },
    LUMINA_API_BASE: 'https://synthetic.invalid', luminaI18n: { getRegionalLocale: () => locale },
    LuminaStaticData: { getChatTone: () => tone }, localStorage: storage, sessionStorage: storage,
    addEventListener() {}, fetch: blocked('window.fetch'), apiFetch: blocked('window.apiFetch'),
    LuminaCms: { hydrate: blocked('CMS') }, getAuth: blocked('auth'), getAccessToken: blocked('token') };
  class ObservedDate extends Date {
    constructor(...args) { if (!args.length) freshClocks.push('current clock'); super(...args); }
  }
  const document = { readyState: 'loading', body, addEventListener() {},
    getElementById: id => elements[id] || null, createElement: tag => element(tag),
    querySelectorAll: selector => select(body, selector) };
  vm.runInNewContext(source.replace(initMarker, () => expose + initMarker), {
    window, document, URLSearchParams, Date: ObservedDate, fetch: blocked('fetch'), apiFetch: blocked('apiFetch'),
    localStorage: storage, sessionStorage: storage, setTimeout: blocked('timer'), setInterval: blocked('interval'),
  }, { filename: sourceUrl.pathname, timeout: 3000 });
  return { api: window.__greetingOriginTest, elements, effects, freshClocks,
    locale(value) { locale = value; }, tone(value) { tone = value; } };
}
function origin(item) { return item.querySelectorAll('.dm-bubble-origin'); }
function time(item) { return item.querySelectorAll('.dm-bubble-time'); }
function text(item) { return item.querySelectorAll('.dm-bubble-text')[0]; }
function getter(object, key, calls) {
  Object.defineProperty(object, key, { configurable: true, enumerable: true,
    get() { calls.push(key); throw new Error('Accessor evaluated: ' + key); } });
  return object;
}

const classification = [
  ['ordinary artist is not a greeting', () => greeting(marker(), { messageType: 'text' }), null],
  ['user opening type is not an artist greeting', () => greeting(marker(), { senderType: 'user' }), null],
  ['legacy opening type is unverified', () => greeting(undefined, { safetyMetadata: undefined }), 'unverified'],
  ['legacy safety purpose alone is unverified', () => greeting(undefined, { messageType: 'text', safetyMetadata: { purpose: 'opening_greeting' } }), 'unverified'],
  ['stored traits and tone marker is saved only', () => greeting(marker()), 'saved'],
  ['stored conversation-facts coverage is saved only', () => greeting(marker({ coverage: coverages[1] })), 'saved'],
  ['own safety purpose can identify a stored greeting', () => greeting(marker(), { messageType: 'text', safetyMetadata: { purpose: 'opening_greeting', artistPersonaLock: marker() } }), 'saved'],
  ['different valid hashes never establish current approval', () => greeting(marker({ binding: 'c'.repeat(64), sourceSha256: 'd'.repeat(64) })), 'saved'],
];
for (const [name, fixture, expected] of classification) test(name, () => {
  assert.equal(harness().api.basicGreetingOriginKind(fixture()), expected);
});

const malformed = [
  ['unverified status', { status: 'unverified' }], ['future version', { version: 'approved-public-persona-lock-20261013.v4' }],
  ['future release', { release: 'approved-public-artists-2026-10-13' }], ['CMS authority', { personalityAuthority: 'current_cms' }],
  ['mutable values true', { mutableProfileValuesApproved: true }], ['mutable values numeric false', { mutableProfileValuesApproved: 0 }],
  ['empty binding', { binding: '' }], ['short binding', { binding: 'b'.repeat(63) }], ['uppercase binding', { binding: 'B'.repeat(64) }],
  ['nonhex binding', { binding: 'g'.repeat(64) }], ['short source hash', { sourceSha256: 'a'.repeat(63) }],
  ['uppercase source hash', { sourceSha256: 'A'.repeat(64) }], ['nonstr source hash', { sourceSha256: 123 }],
  ['unknown coverage', { coverage: 'all_personality_and_relationships' }], ['array coverage', { coverage: [coverages[0]] }],
];
for (const [name, overrides] of malformed) test('malformed marker: ' + name, () => {
  assert.equal(harness().api.basicGreetingOriginKind(greeting(marker(overrides))), 'unverified');
});

test('malformed inputs and marker containers do not invent approval', () => {
  const { api } = harness();
  for (const input of [null, undefined, [], 'opening_greeting', 42, {}]) assert.equal(api.basicGreetingOriginKind(input), null);
  for (const lock of [null, [], 'approved', 42, true]) assert.equal(api.basicGreetingOriginKind(greeting(lock)), 'unverified');
});
test('message accessors are not evaluated by classification', () => {
  const { api } = harness(), calls = [];
  assert.equal(api.basicGreetingOriginKind(getter(greeting(), 'senderType', calls)), null);
  assert.equal(api.basicGreetingOriginKind(getter(greeting(), 'messageType', calls)), null);
  assert.equal(api.basicGreetingOriginKind(getter(greeting(), 'safetyMetadata', calls)), 'unverified');
  assert.deepEqual(calls, []);
});
test('purpose and marker accessors remain unevaluated', () => {
  const { api } = harness(), calls = [];
  const purpose = getter({ artistPersonaLock: marker() }, 'purpose', calls);
  assert.equal(api.basicGreetingOriginKind(greeting(marker(), { messageType: 'text', safetyMetadata: purpose })), null);
  assert.equal(api.basicGreetingOriginKind(greeting(marker(), { safetyMetadata: getter({}, 'artistPersonaLock', calls) })), 'unverified');
  assert.deepEqual(calls, []);
});
test('every stored-marker accessor fails closed without evaluation', () => {
  const { api } = harness(), calls = [];
  for (const key of Object.keys(marker())) assert.equal(api.basicGreetingOriginKind(greeting(getter(marker(), key, calls))), 'unverified', key);
  assert.deepEqual(calls, []);
});
test('inherited message metadata and marker fields are not own evidence', () => {
  const { api } = harness();
  assert.equal(api.basicGreetingOriginKind(Object.create(greeting())), null);
  assert.equal(api.basicGreetingOriginKind(greeting(Object.create(marker()))), 'unverified');
  assert.equal(api.basicGreetingOriginKind(greeting(marker(), { safetyMetadata: Object.create({ artistPersonaLock: marker() }) })), 'unverified');
});
test('every required stored field must be present as own data', () => {
  const { api } = harness();
  for (const key of Object.keys(marker())) { const lock = marker(); delete lock[key]; assert.equal(api.basicGreetingOriginKind(greeting(lock)), 'unverified', key); }
});

for (const [locale, expected] of Object.entries(copy)) test('neutral origin copy for ' + locale, () => {
  const h = harness(); h.locale(locale);
  for (const kind of ['intro', 'saved', 'unverified']) {
    assert.equal(h.api.basicGreetingOriginCopy(kind, locale), expected[kind]);
    assert.equal(h.api.basicGreetingOriginCopy(kind), expected[kind]);
  }
  assert.notEqual(expected.saved, expected.unverified);
});
test('unsupported locales including inherited keys fall back to Korean', () => {
  const h = harness();
  for (const locale of ['fr-FR', '', '__proto__', 'toString', 'constructor']) {
    h.locale(locale);
    for (const kind of ['intro', 'saved', 'unverified']) assert.equal(h.api.basicGreetingOriginCopy(kind), copy['ko-KR'][kind]);
  }
});
test('closed kinds do not expose arbitrary or inherited copy fields', () => {
  const { api } = harness();
  for (const kind of [null, undefined, '', 'approved', 'current', 'quality', '__proto__', 'toString', 'constructor'])
    assert.equal(api.basicGreetingOriginCopy(kind, 'en-US'), '');
});
test('legacy greeting origin is a text span before its unchanged real timestamp', () => {
  const h = harness(), item = h.api.basicChatMessageElement(greeting(null));
  const label = origin(item)[0], timestamp = time(item)[0];
  assert.equal(label.tagName, 'SPAN'); assert.equal(label.dataset.chatGreetingOrigin, 'unverified');
  assert.equal(label.textContent, copy['ko-KR'].unverified); assert.equal(text(item).textContent, prose);
  assert.equal(timestamp.textContent, new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  assert(label.parentNode.children.indexOf(label) < label.parentNode.children.indexOf(timestamp));
  assert.deepEqual(h.freshClocks, []);
});
test('stored marker produces only the neutral saved span, not a current or quality badge', () => {
  const h = harness(); h.locale('en-US');
  const item = h.api.basicChatMessageElement(greeting(marker()));
  assert.equal(origin(item).length, 1); assert.equal(origin(item)[0].dataset.chatGreetingOrigin, 'saved');
  assert.equal(origin(item)[0].textContent, 'Saved greeting');
  assert.doesNotMatch(origin(item)[0].textContent, /approved|current|verified|quality|canonical/i);
  assert.equal(text(item).textContent, prose);
});
test('ordinary artist and user prose and timestamps are unchanged with no origin span', () => {
  const h = harness();
  for (const message of [greeting(marker(), { messageType: 'text' }), greeting(marker(), { senderType: 'user' })]) {
    const item = h.api.basicChatMessageElement(message);
    assert.equal(origin(item).length, 0); assert.equal(text(item).textContent, prose);
    assert.equal(time(item)[0].textContent, new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  }
});
test('CMS static and summary welcome prose stays intact while fake clock becomes intro', () => {
  for (const [artist, tone, expected] of [
    [{ welcomeMessage: 'Synthetic CMS introduction' }, null, 'Synthetic CMS introduction'],
    [null, { welcomeMessage: 'Synthetic static introduction' }, 'Synthetic static introduction'],
    [{ summary: 'Synthetic profile summary' }, null, 'Synthetic profile summary'],
  ]) {
    const h = harness(); h.tone(tone); h.api.renderWelcomeBubble('synthetic-artist', artist);
    assert.equal(h.elements.chatWelcomeText.textContent, expected);
    assert.equal(h.elements.chatWelcomeTime.textContent, copy['ko-KR'].intro);
    assert.equal(h.elements.chatWelcomeTime.dataset.chatGreetingOrigin, 'intro');
    assert(h.elements.chatWelcomeTime.className.split(/\s+/).includes('dm-bubble-origin'));
    assert.deepEqual(h.freshClocks, []); assert.deepEqual(h.effects, []);
  }
});
test('locale sync changes only owned greeting labels, preserving prose times and foreign nodes', () => {
  const h = harness(); h.api.renderWelcomeBubble('synthetic-artist', { welcomeMessage: prose });
  const saved = h.api.basicChatMessageElement(greeting()), legacy = h.api.basicChatMessageElement(greeting(null));
  const user = h.api.basicChatMessageElement(greeting(marker(), { senderType: 'user' }));
  h.elements.chatThread.append(saved, legacy, user);
  const foreign = element('span'); foreign.dataset.chatGreetingOrigin = 'unverified'; foreign.textContent = 'Foreign sentinel';
  h.elements.foreignLabels.append(foreign);
  const originalTimes = [saved, legacy, user].map(item => time(item)[0].textContent);
  for (const [locale, expected] of Object.entries(copy)) {
    h.locale(locale); h.api.syncGreetingOriginLabels(); h.api.syncGreetingOriginLabels();
    assert.equal(origin(saved)[0].textContent, expected.saved); assert.equal(origin(legacy)[0].textContent, expected.unverified);
    assert.equal(h.elements.chatWelcomeTime.textContent, expected.intro);
    assert.equal(h.elements.chatWelcomeText.textContent, prose); assert.equal(foreign.textContent, 'Foreign sentinel');
    assert.deepEqual([saved, legacy, user].map(item => time(item)[0].textContent), originalTimes);
    for (const item of [saved, legacy, user]) assert.equal(text(item).textContent, prose);
    assert.equal(origin(saved).length, 1); assert.equal(origin(legacy).length, 1); assert.equal(origin(user).length, 0);
  }
  assert.deepEqual(h.effects, []); assert.deepEqual(h.freshClocks, []);
});
test('existing locale syncCopy wires label sync before note input and check copy', () => {
  const start = source.indexOf('    function syncCopy() {');
  assert(start >= 0);
  const block = source.slice(start, source.indexOf('\n    }', start));
  const sync = block.indexOf('syncGreetingOriginLabels();'); assert(sync >= 0);
  for (const anchor of ['if (note)', 'if (input)', 'if (check)']) assert(block.indexOf(anchor) > sync, anchor);
  assert(source.includes('window.addEventListener("lumina:localechange", syncCopy);'));
});
test('classification rendering and relabeling never auto-fetch regenerate or write storage', () => {
  const h = harness(); h.api.renderWelcomeBubble('synthetic-artist', { welcomeMessage: prose });
  for (const message of [greeting(), greeting(null)]) {
    h.api.basicGreetingOriginKind(message); h.elements.chatThread.append(h.api.basicChatMessageElement(message));
  }
  h.locale('en-US'); h.api.syncGreetingOriginLabels();
  assert.deepEqual(h.effects, []); assert.deepEqual(h.freshClocks, []);
});
