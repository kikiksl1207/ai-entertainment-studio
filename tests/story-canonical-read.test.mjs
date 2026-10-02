import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Load the complete public policy IIFE, without extracting production helpers.
const source = await readFile(new URL('../pages/story-canonical-read.js', import.meta.url), 'utf8');
const window = { crypto: webcrypto, TextEncoder };
runInNewContext(source, { window, crypto: webcrypto, ArrayBuffer, TextEncoder, Uint8Array }, {
  filename: 'pages/story-canonical-read.js', timeout: 1000,
});
const policy = window.LuminaCanonicalRead;
const clone = (value) => structuredClone(value);
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = (digit) => digit.repeat(64);
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const localText = {
  ko: '\ud55c\uae00 \uc774\uc57c\uae30', en: 'An exact story.', ja: '\u7269\u8a9e\u306e\u672c\u6587',
  'zh-Hans': '\u6545\u4e8b\u6b63\u6587', 'zh-Hant': '\u6545\u4e8b\u5167\u6587',
};
const invalidTexts = [
  ['missing', undefined], ['null', null], ['number', 12], ['object', { value: 'text' }],
  ['boxed string', new String('text')], ['empty', ''], ['whitespace only', ' \t\r\n '],
  ['one trimmed ASCII code point', ' a '], ['one trimmed astral code point', ' \ud83d\ude80 '],
  ['NUL', 'valid\0text'], ['lone high surrogate', 'ab\ud800'],
  ['lone low surrogate', '\udc00ab'], ['reversed surrogate pair', 'ab\udc00\ud800'],
  ['high surrogate followed by ASCII', '\ud800x'],
  ['surrogate between valid pairs', '\ud83d\ude80\ud800\ud83d\ude80'],
  ['64001 UTF-16 code units', 'a'.repeat(64001)],
];

function context(locale = 'en') {
  const members = ['paragraph', 'narration', 'dialogue'].map((type, index) => ({
    id: uuid(10 + index), position: index + 1, type,
    content: { value: `${localText[locale]} ${index + 1}`, locale, fallback: false },
  }));
  return {
    userId: uuid(1), sceneIdentity: uuid(1), progressId: uuid(2), workId: uuid(3), locale,
    progress: {
      progressId: uuid(2), status: 'active', revision: 7, storyVersion: 3, currentAct: 2,
      part: { id: uuid(4) }, scene: { id: uuid(5) }, currentGeneratedSceneId: null,
    },
    scene: { id: uuid(5), beats: clone(members), isGenerated: false },
    members,
  };
}

function changeMember(value, change, index = 0) {
  change(value.members[index]);
  value.scene.beats[index] = clone(value.members[index]);
}

function fixture(locale = 'en', index = 0) {
  const input = context(locale);
  const target = policy.target(input);
  assert.ok(target, 'The independent canonical fixture must produce a target');
  const member = target.members[index];
  const textHash = sha256(member.text);
  const identity = {
    userId: input.userId, progressId: input.progressId, workId: input.workId,
    ownerUserId: uuid(20), releaseId: uuid(21), releaseChecksum: hash('a'),
    manuscriptVersionId: uuid(22), manuscriptHash: hash('b'),
    partId: input.progress.part.id, sceneId: input.scene.id,
    beatId: member.id, beatPosition: member.position, actNumber: input.progress.currentAct,
    locale, sourceChecksum: hash('c'), sourceTextHash: textHash,
    routeNodeId: uuid(23), routeHash: hash('d'),
    storyVersion: input.progress.storyVersion, progressRevision: input.progress.revision,
  };
  const preview = {
    contract: 'story-canonical-read-review-v1', identity,
    sourceChecksum: identity.sourceChecksum, sourceTextHash: textHash,
    scopeChecksum: hash('e'), expectedRevision: identity.progressRevision,
    confirmationRecorded: false, readerMemoryApplied: false,
  };
  const receipt = {
    contract: 'story-canonical-read-receipt-v1', receiptId: uuid(24),
    progressId: identity.progressId, workId: identity.workId, sceneId: identity.sceneId,
    beatId: identity.beatId, sourceChecksum: preview.sourceChecksum,
    sourceTextHash: preview.sourceTextHash, scopeChecksum: preview.scopeChecksum,
    locale, routeNodeId: identity.routeNodeId, progressRevision: identity.progressRevision,
    invalidatedAt: null, confirmedAt: '2026-10-02T00:00:00.000Z',
    readerMemoryApplied: false, idempotentReplay: false,
  };
  return { input, target, member, textHash, preview, receipt };
}

async function cases(t, entries, check) {
  for (const [name, value] of entries) await t.test(name, () => check(value));
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('the IIFE exposes all five policy functions without browser or application dependencies', () => {
  assert.ok(policy);
  for (const name of ['target', 'hashText', 'previewMatches', 'receiptMatches', 'pageScope']) {
    assert.equal(typeof policy[name], 'function', name);
  }
});

test('target projects exact identities and all three canonical text beat types', () => {
  const input = context();
  const target = policy.target(input);
  assert.equal(typeof target.key, 'string');
  assert.ok(target.key.length);
  const { key, ...projected } = clone(target);
  assert.deepEqual(projected, {
    userId: input.userId, progressId: input.progressId, workId: input.workId,
    sceneId: input.scene.id, partId: input.progress.part.id, locale: input.locale,
    revision: 7, storyVersion: 3, actNumber: 2,
    members: input.members.map(({ id, position, type, content }) => ({ id, position, type, text: content.value })),
  });
  assert.equal(policy.target(clone(input)).key, key);
  input.progress.status = 'completed';
  assert.ok(policy.target(input), 'Completed author scenes remain canonical');
});

test('canonical target, preview, hash, and receipt work in every supported locale', async (t) => {
  await cases(t, locales.map((locale) => [locale, locale]), async (locale) => {
    const f = fixture(locale);
    assert.equal(f.target.locale, locale);
    assert.equal(f.member.text, f.input.members[0].content.value);
    assert.equal(await policy.hashText(f.member.text, webcrypto), f.textHash);
    assert.equal(policy.previewMatches(f.preview, f.target, f.member, f.textHash), true);
    assert.equal(policy.receiptMatches(f.receipt, f.preview), true);
    assert.ok(policy.pageScope(f.preview));
  });
});

test('target rejects missing or malformed outer context', async (t) => {
  const entries = [undefined, null, false, 1, 'context', [], {}].map((value, index) => [`outer ${index}`, value]);
  for (const field of ['userId', 'sceneIdentity', 'progressId', 'workId', 'locale', 'progress', 'scene', 'members']) {
    const input = context();
    delete input[field];
    entries.push([`missing ${field}`, input]);
  }
  await cases(t, entries, (input) => assert.equal(policy.target(input), null));
});

test('target rejects foreign, generated, missing, and unsupported scene contexts', async (t) => {
  const mutations = [
    ['foreign reader', (v) => { v.sceneIdentity = uuid(99); }],
    ['foreign progress', (v) => { v.progress.progressId = uuid(99); }],
    ['foreign scene', (v) => { v.progress.scene.id = uuid(99); }],
    ['generated scene', (v) => { v.scene.isGenerated = true; }],
    ['ready delivery', (v) => { v.scene.deliveryState = 'ready'; }],
    ['generated progress', (v) => { v.progress.currentGeneratedSceneId = v.scene.id; }],
    ['foreign generated progress', (v) => { v.progress.currentGeneratedSceneId = uuid(99); }],
    ['missing part', (v) => { v.progress.part = null; }],
    ['missing progress scene', (v) => { v.progress.scene = null; }],
    ['non-array members', (v) => { v.members = {}; }],
    ['empty members', (v) => { v.members = []; }],
  ];
  for (const locale of ['', 'fr', 'EN', 'zh', 'en-US', null]) {
    mutations.push([`unsupported locale ${locale}`, (v) => { v.locale = locale; }]);
  }
  for (const status of ['', 'paused', 'ai_pending', null, 1]) {
    mutations.push([`unsupported status ${status}`, (v) => { v.progress.status = status; }]);
  }
  await cases(t, mutations, (mutate) => {
    const input = context();
    mutate(input);
    assert.equal(policy.target(input), null);
  });
});

test('target rejects malformed UUIDs and non-positive or unsafe revision pins', async (t) => {
  const mutations = [];
  for (const field of ['userId', 'progressId', 'workId']) {
    for (const bad of ['', 'not-a-uuid', null, 1]) {
      mutations.push([`${field}: ${bad}`, (v) => { v[field] = bad; }]);
    }
  }
  for (const field of ['part', 'scene']) {
    mutations.push([`invalid progress ${field} UUID`, (v) => { v.progress[field].id = 'not-a-uuid'; }]);
  }
  mutations.push(['invalid scene UUID', (v) => {
    v.scene.id = v.progress.scene.id = 'not-a-uuid';
  }]);
  for (const field of ['revision', 'storyVersion', 'currentAct']) {
    for (const bad of [undefined, null, 0, -1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      mutations.push([`${field}: ${bad}`, (v) => { v.progress[field] = bad; }]);
    }
  }
  await cases(t, mutations, (mutate) => {
    const input = context();
    mutate(input);
    assert.equal(policy.target(input), null);
  });
});

test('target rejects duplicate, non-text, and malformed page members', async (t) => {
  const mutations = [
    ['null member', (v) => { v.members[0] = null; }],
    ['duplicate member ID', (v) => { changeMember(v, (b) => { b.id = v.members[1].id; }); }],
    ['duplicate member position', (v) => { changeMember(v, (b) => { b.position = v.members[1].position; }); }],
    ['invalid member UUID', (v) => { changeMember(v, (b) => { b.id = 'not-a-uuid'; }); }],
    ['missing content', (v) => { changeMember(v, (b) => { delete b.content; }); }],
    ['null content', (v) => { changeMember(v, (b) => { b.content = null; }); }],
    ['raw string content', (v) => { changeMember(v, (b) => { b.content = 'Exact text'; }); }],
    ['array content', (v) => { changeMember(v, (b) => { b.content = []; }); }],
    ['fallback content', (v) => { changeMember(v, (b) => { b.content.fallback = true; }); }],
    ['missing fallback pin', (v) => { changeMember(v, (b) => { delete b.content.fallback; }); }],
    ['string false fallback', (v) => { changeMember(v, (b) => { b.content.fallback = 'false'; }); }],
    ['foreign content locale', (v) => { changeMember(v, (b) => { b.content.locale = 'ko'; }); }],
    ['missing content locale', (v) => { changeMember(v, (b) => { delete b.content.locale; }); }],
    ['invalid later member rejects whole page', (v) => { changeMember(v, (b) => { b.content.fallback = true; }, 2); }],
  ];
  for (const type of ['image', 'audio', 'video', 'choice', '', null, undefined]) {
    mutations.push([`unsupported beat type ${type}`, (v) => { changeMember(v, (b) => { b.type = type; }); }]);
  }
  for (const position of [undefined, null, 0, -1, 41, 1.5, '1', NaN, Infinity]) {
    mutations.push([`invalid beat position ${position}`, (v) => { changeMember(v, (b) => { b.position = position; }); }]);
  }
  await cases(t, mutations, (mutate) => {
    const input = context();
    mutate(input);
    assert.equal(policy.target(input), null);
  });
});

test('target rejects every invalid exact-source text without salvaging another member', async (t) => {
  await cases(t, invalidTexts, (text) => {
    const input = context();
    changeMember(input, (member) => { member.content.value = text; }, 1);
    assert.equal(policy.target(input), null);
  });
});

test('target requires ascending member positions and accepts a complete 40-beat page', async (t) => {
  await cases(t, [
    ['reversed members', (v) => { v.members.reverse(); }],
    ['out-of-order members', (v) => { [v.members[0], v.members[1]] = [v.members[1], v.members[0]]; }],
    ['41-member page', (v) => {
      v.members = Array.from({ length: 41 }, (_, index) => ({
        ...clone(v.members[0]), id: uuid(100 + index), position: index + 1,
      }));
      v.scene.beats = clone(v.members);
    }],
  ], (mutate) => {
    const input = context();
    mutate(input);
    assert.equal(policy.target(input), null);
  });
  const input = context();
  input.members = Array.from({ length: 40 }, (_, index) => ({
    ...clone(input.members[0]), id: uuid(100 + index), position: index + 1,
  }));
  input.scene.beats = clone(input.members);
  const target = policy.target(input);
  assert.ok(target);
  assert.equal(target.members.length, 40);
  assert.deepEqual(Array.from(target.members, (member) => member.position),
    Array.from({ length: 40 }, (_, index) => index + 1));
  input.progress.revision = input.progress.storyVersion = input.progress.currentAct = 1;
  assert.ok(policy.target(input));
});

test('target preserves whitespace, decomposition, astral pairs, and text length boundaries', async (t) => {
  const texts = [
    ['exact whitespace', ' \tA\r\nB\u00a0 '], ['decomposed accent', 'Cafe\u0301'],
    ['two astral code points', '\ud83d\ude80\ud83c\udf1f'],
    ['one astral plus ASCII', '\ud83d\ude80x'], ['two-code-point decomposed letter', 'e\u0301'],
    ['64000 ASCII code units', 'a'.repeat(64000)],
    ['64000 astral code units', '\ud83d\ude80'.repeat(32000)],
  ];
  await cases(t, texts, (text) => {
    const input = context();
    changeMember(input, (member) => { member.content.value = text; });
    assert.equal(policy.target(input)?.members[0].text, text);
  });
  const boundary = context();
  changeMember(boundary, (member) => { member.position = 40; }, 2);
  assert.equal(policy.target(boundary)?.members[2].position, 40);
});

test('hashText hashes exact UTF-8 bytes with native SHA-256', async (t) => {
  const texts = [
    ['known vector', 'abc'], ['whitespace', '  abc\r\n'], ['composed', 'Caf\u00e9'],
    ['decomposed', 'Cafe\u0301'], ['astral', '\ud83d\ude80\ud83c\udf1f'],
    ['maximum length', 'a'.repeat(64000)],
    ...locales.map((locale) => [locale, localText[locale]]),
  ];
  await cases(t, texts, async (text) => {
    const result = await policy.hashText(text, webcrypto);
    assert.match(result, /^[a-f0-9]{64}$/);
    assert.equal(result, sha256(text));
  });
  assert.equal(await policy.hashText('abc', webcrypto),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(await policy.hashText(' abc ', webcrypto), await policy.hashText('abc', webcrypto));
  assert.notEqual(await policy.hashText('Caf\u00e9', webcrypto), await policy.hashText('Cafe\u0301', webcrypto));
});

test('hashText rejects invalid source before invoking digest', async (t) => {
  await cases(t, invalidTexts, async (text) => {
    let calls = 0;
    const crypto = { subtle: { digest: async () => { calls++; throw new Error('Unexpected digest'); } } };
    await assert.rejects(async () => policy.hashText(text, crypto));
    assert.equal(calls, 0);
  });
});

test('hashText requires subtle.digest, uses SHA-256 and exact bytes, and propagates digest failure', async (t) => {
  await cases(t, [undefined, null, {}, { subtle: null }, { subtle: {} }, { subtle: { digest: false } }]
    .map((crypto, index) => [`unavailable digest ${index}`, crypto]), async (crypto) => {
    await assert.rejects(async () => policy.hashText('Valid text', crypto));
  });
  let calls = 0;
  const text = ' \tCafe\u0301 \ud83d\ude80\r\n';
  const crypto = { subtle: { digest: async (algorithm, bytes) => {
    calls++;
    assert.equal(algorithm, 'SHA-256');
    assert.deepEqual(Array.from(new Uint8Array(bytes)), Array.from(new TextEncoder().encode(text)));
    return webcrypto.subtle.digest(algorithm, bytes);
  } } };
  assert.equal(await policy.hashText(text, crypto), sha256(text));
  assert.equal(calls, 1);
  const failure = new Error('Digest unavailable');
  await assert.rejects(async () => policy.hashText(text, { subtle: { digest: async () => { throw failure; } } }),
    (error) => error === failure);
});

test('hashText rejects malformed digest results instead of accepting truncated or typed-array hashes', async (t) => {
  const results = [
    ['missing result', undefined], ['null result', null], ['string result', hash('a')],
    ['object result', { byteLength: 32 }], ['typed array result', new Uint8Array(32)],
    ['empty buffer', new ArrayBuffer(0)], ['31-byte buffer', new ArrayBuffer(31)],
    ['33-byte buffer', new ArrayBuffer(33)],
  ];
  await cases(t, results, async (result) => {
    await assert.rejects(async () => policy.hashText('Valid text', { subtle: { digest: async () => result } }));
  });
});

test('previewMatches rejects stale target and member identity pins', async (t) => {
  const f = fixture();
  const pins = {
    userId: uuid(99), progressId: uuid(99), workId: uuid(99), partId: uuid(99), sceneId: uuid(99),
    beatId: uuid(99), beatPosition: 40, actNumber: 3, locale: 'ko', storyVersion: 4, progressRevision: 8,
  };
  for (const [pin, replacement] of Object.entries(pins)) {
    await t.test(`stale ${pin}`, () => {
      const preview = clone(f.preview);
      preview.identity[pin] = replacement;
      if (pin === 'progressRevision') preview.expectedRevision = replacement;
      assert.equal(policy.previewMatches(preview, f.target, f.member, f.textHash), false);
    });
  }
  assert.equal(policy.previewMatches(f.preview, f.target, f.target.members[1], f.textHash), false);
  assert.equal(policy.previewMatches(f.preview, f.target, f.member, hash('f')), false);
});

test('previewMatches rejects malformed envelopes and missing required identity pins', async (t) => {
  const f = fixture();
  await cases(t, [undefined, null, false, 'preview', [], {}].map((value, index) => [`outer ${index}`, value]),
    (value) => assert.equal(policy.previewMatches(value, f.target, f.member, f.textHash), false));
  for (const pin of Object.keys(f.preview.identity)) {
    await t.test(`missing identity ${pin}`, () => {
      const preview = clone(f.preview);
      delete preview.identity[pin];
      assert.equal(policy.previewMatches(preview, f.target, f.member, f.textHash), false);
      assert.equal(policy.pageScope(preview), null);
      assert.equal(policy.receiptMatches(f.receipt, preview), false);
    });
  }
  const mutations = [
    ['wrong contract', (p) => { p.contract = 'story-canonical-read-review-v2'; }],
    ['missing identity', (p) => { delete p.identity; }],
    ['null identity', (p) => { p.identity = null; }],
    ['confirmation already recorded', (p) => { p.confirmationRecorded = true; }],
    ['missing confirmation flag', (p) => { delete p.confirmationRecorded; }],
    ['reader memory applied', (p) => { p.readerMemoryApplied = true; }],
    ['missing memory flag', (p) => { delete p.readerMemoryApplied; }],
    ['stale expected revision', (p) => { p.expectedRevision++; }],
    ['string expected revision', (p) => { p.expectedRevision = String(p.expectedRevision); }],
    ['missing expected revision', (p) => { delete p.expectedRevision; }],
    ['outer source checksum differs', (p) => { p.sourceChecksum = hash('f'); }],
    ['outer source text hash differs', (p) => { p.sourceTextHash = hash('f'); }],
  ];
  await cases(t, mutations, (mutate) => {
    const preview = clone(f.preview);
    mutate(preview);
    assert.equal(policy.previewMatches(preview, f.target, f.member, f.textHash), false);
    assert.equal(policy.pageScope(preview), null);
    assert.equal(policy.receiptMatches(f.receipt, preview), false);
  });
  assert.equal(policy.previewMatches(f.preview, null, f.member, f.textHash), false);
  assert.equal(policy.previewMatches(f.preview, f.target, null, f.textHash), false);
});

test('previewMatches enforces lowercase SHA-256 checksum and text-hash shapes', async (t) => {
  const f = fixture();
  for (const field of ['releaseChecksum', 'manuscriptHash', 'routeHash', 'sourceChecksum', 'sourceTextHash', 'scopeChecksum']) {
    for (const bad of [undefined, null, '', 'a'.repeat(63), 'a'.repeat(65), hash('A'), hash('g'), ` ${hash('a')}`]) {
      await t.test(`${field}: ${String(bad).slice(0, 12)}`, () => {
        const preview = clone(f.preview);
        if (Object.hasOwn(preview, field)) preview[field] = bad;
        if (Object.hasOwn(preview.identity, field)) preview.identity[field] = bad;
        assert.equal(policy.previewMatches(preview, f.target, f.member, f.textHash), false);
        assert.equal(policy.pageScope(preview), null);
        assert.equal(policy.receiptMatches(f.receipt, preview), false);
      });
    }
  }
});

test('preview validation rejects invalid UUIDs, numeric pins, flags, and caller hashes', async (t) => {
  const f = fixture();
  const uuidFields = ['userId', 'progressId', 'workId', 'ownerUserId', 'releaseId',
    'manuscriptVersionId', 'partId', 'sceneId', 'beatId', 'routeNodeId'];
  for (const field of uuidFields) {
    await t.test(`invalid UUID ${field}`, () => {
      const preview = clone(f.preview);
      preview.identity[field] = 'not-a-uuid';
      assert.equal(policy.previewMatches(preview, f.target, f.member, f.textHash), false);
      assert.equal(policy.pageScope(preview), null);
    });
  }
  for (const field of ['beatPosition', 'actNumber', 'storyVersion', 'progressRevision']) {
    for (const bad of [0, -1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await t.test(`invalid ${field}: ${bad}`, () => {
        const preview = clone(f.preview);
        preview.identity[field] = bad;
        if (field === 'progressRevision') preview.expectedRevision = bad;
        assert.equal(policy.previewMatches(preview, f.target, f.member, f.textHash), false);
        assert.equal(policy.pageScope(preview), null);
      });
    }
  }
  for (const field of ['confirmationRecorded', 'readerMemoryApplied']) {
    for (const bad of [null, 0, 'false']) {
      await t.test(`invalid ${field}: ${bad}`, () => {
        const preview = clone(f.preview);
        preview[field] = bad;
        assert.equal(policy.previewMatches(preview, f.target, f.member, f.textHash), false);
        assert.equal(policy.pageScope(preview), null);
      });
    }
  }
  for (const bad of [undefined, null, '', hash('A'), hash('g'), 'a'.repeat(63)]) {
    assert.equal(policy.previewMatches(f.preview, f.target, f.member, bad), false);
  }
  const preview = clone(f.preview);
  preview.identity.beatPosition = 41;
  assert.equal(policy.pageScope(preview), null);
});

test('old previews cannot match a changed revision, version, act, locale, or user target', async (t) => {
  const f = fixture();
  const mutations = [
    ['revision', (v) => { v.progress.revision++; }],
    ['story version', (v) => { v.progress.storyVersion++; }],
    ['act', (v) => { v.progress.currentAct++; }],
    ['part', (v) => { v.progress.part.id = uuid(99); }],
    ['scene', (v) => { v.scene.id = uuid(99); v.progress.scene.id = uuid(99); }],
    ['work', (v) => { v.workId = uuid(99); }],
    ['progress', (v) => { v.progressId = uuid(99); v.progress.progressId = uuid(99); }],
    ['reader', (v) => { v.userId = uuid(99); v.sceneIdentity = uuid(99); }],
    ['locale', (v) => { v.locale = 'ko'; v.members.forEach((b, i) => changeMember(v, (m) => { m.content.locale = 'ko'; }, i)); }],
    ['exact displayed text', (v) => { changeMember(v, (m) => { m.content.value += ' '; }); }],
  ];
  await cases(t, mutations, (mutate) => {
    const input = clone(f.input);
    mutate(input);
    const target = policy.target(input);
    assert.ok(target);
    assert.notEqual(target.key, f.target.key);
    const member = target.members[0];
    assert.equal(policy.previewMatches(f.preview, target, member, sha256(member.text)), false);
  });
});

test('pageScope batches different beats and exact texts while retaining every page identity pin', async (t) => {
  const first = fixture();
  const second = fixture('en', 1);
  second.preview.sourceChecksum = second.preview.identity.sourceChecksum = hash('f');
  second.preview.scopeChecksum = hash('0');
  assert.equal(policy.previewMatches(second.preview, second.target, second.member, second.textHash), true);
  const scope = policy.pageScope(first.preview);
  assert.ok(scope);
  assert.deepEqual(clone(policy.pageScope(second.preview)), clone(scope));
  const third = fixture('en', 2);
  third.preview.sourceChecksum = third.preview.identity.sourceChecksum = hash('1');
  third.preview.scopeChecksum = hash('2');
  assert.equal(policy.previewMatches(third.preview, third.target, third.member, third.textHash), true);
  assert.deepEqual(clone(policy.pageScope(third.preview)), clone(scope));
  const beatFields = new Set(['beatId', 'beatPosition', 'sourceChecksum', 'sourceTextHash']);
  for (const [pin, value] of Object.entries(first.preview.identity)) {
    if (beatFields.has(pin)) continue;
    await t.test(`page pin ${pin}`, () => {
      const preview = clone(first.preview);
      preview.identity[pin] = typeof value === 'number' ? value + 1
        : pin === 'locale' ? 'ko' : value.length === 64 ? hash('f') : uuid(99);
      if (pin === 'progressRevision') preview.expectedRevision = preview.identity.progressRevision;
      assert.notDeepEqual(clone(policy.pageScope(preview)), clone(scope));
    });
  }
});

test('pageScope rejects malformed envelopes rather than returning a batch key', async (t) => {
  await cases(t, [undefined, null, false, 'preview', [], {}].map((value, index) => [`outer ${index}`, value]),
    (value) => assert.equal(policy.pageScope(value), null));
});

test('receiptMatches accepts fresh confirmation and explicit idempotent replay', () => {
  const f = fixture();
  assert.equal(policy.receiptMatches(f.receipt, f.preview), true);
  const replay = { ...clone(f.receipt), idempotentReplay: true };
  assert.equal(policy.receiptMatches(replay, f.preview), true);
});

test('receiptMatches rejects every mismatched preview identity and checksum', async (t) => {
  const f = fixture();
  const fields = ['progressId', 'workId', 'sceneId', 'beatId', 'sourceChecksum', 'sourceTextHash',
    'scopeChecksum', 'locale', 'routeNodeId', 'progressRevision'];
  for (const field of fields) {
    await t.test(`stale receipt ${field}`, () => {
      const receipt = clone(f.receipt);
      const value = receipt[field];
      receipt[field] = typeof value === 'number' ? value + 1
        : field === 'locale' ? 'ko' : value.length === 64 ? hash('f') : uuid(99);
      assert.equal(policy.receiptMatches(receipt, f.preview), false);
    });
    await t.test(`missing receipt ${field}`, () => {
      const receipt = clone(f.receipt);
      delete receipt[field];
      assert.equal(policy.receiptMatches(receipt, f.preview), false);
    });
  }
  const otherBeat = fixture('en', 1);
  assert.equal(policy.receiptMatches(f.receipt, otherBeat.preview), false);
  assert.equal(policy.receiptMatches(otherBeat.receipt, f.preview), false);
});

test('receiptMatches rejects invalid, invalidated, unconfirmed, and memory-applied receipts', async (t) => {
  const f = fixture();
  await cases(t, [undefined, null, false, 'receipt', [], {}].map((value, index) => [`outer ${index}`, value]),
    (value) => assert.equal(policy.receiptMatches(value, f.preview), false));
  const mutations = [
    ['wrong contract', (r) => { r.contract = 'story-canonical-read-receipt-v2'; }],
    ['missing contract', (r) => { delete r.contract; }],
    ['invalid receipt ID', (r) => { r.receiptId = 'receipt'; }],
    ['missing receipt ID', (r) => { delete r.receiptId; }],
    ['invalidated', (r) => { r.invalidatedAt = '2026-10-02T01:00:00.000Z'; }],
    ['missing invalidation pin', (r) => { delete r.invalidatedAt; }],
    ['false invalidation pin', (r) => { r.invalidatedAt = false; }],
    ['missing confirmation time', (r) => { delete r.confirmedAt; }],
    ['null confirmation time', (r) => { r.confirmedAt = null; }],
    ['empty confirmation time', (r) => { r.confirmedAt = ''; }],
    ['invalid confirmation time', (r) => { r.confirmedAt = 'not-a-date'; }],
    ['date without confirmation time', (r) => { r.confirmedAt = '2026-10-02'; }],
    ['impossible month', (r) => { r.confirmedAt = '2026-13-02T00:00:00.000Z'; }],
    ['numeric confirmation time', (r) => { r.confirmedAt = 1790899200000; }],
    ['reader memory applied', (r) => { r.readerMemoryApplied = true; }],
    ['missing memory flag', (r) => { delete r.readerMemoryApplied; }],
    ['missing replay flag', (r) => { delete r.idempotentReplay; }],
    ['string replay flag', (r) => { r.idempotentReplay = 'false'; }],
    ['numeric replay flag', (r) => { r.idempotentReplay = 0; }],
  ];
  await cases(t, mutations, (mutate) => {
    const receipt = clone(f.receipt);
    mutate(receipt);
    assert.equal(policy.receiptMatches(receipt, f.preview), false);
  });
  assert.equal(policy.receiptMatches(f.receipt, null), false);
});

test('receipts cannot replay across locales and remain strictly typed', async (t) => {
  const f = fixture();
  for (const locale of locales.filter((locale) => locale !== 'en')) {
    await t.test(`foreign receipt locale ${locale}`, () => {
      const other = fixture(locale);
      assert.equal(policy.receiptMatches(f.receipt, other.preview), false);
      assert.equal(policy.receiptMatches(other.receipt, f.preview), false);
    });
  }
  const receipt = clone(f.receipt);
  receipt.progressRevision = String(receipt.progressRevision);
  assert.equal(policy.receiptMatches(receipt, f.preview), false);
  for (const field of ['sourceChecksum', 'sourceTextHash', 'scopeChecksum']) {
    const invalid = clone(f.receipt);
    invalid[field] = invalid[field].toUpperCase();
    assert.equal(policy.receiptMatches(invalid, f.preview), false);
  }
});

test('policy helpers do not mutate frozen context, target, preview, or receipt fixtures', async () => {
  const f = fixture();
  const before = clone(f);
  freeze(f);
  assert.deepEqual(clone(policy.target(f.input)), before.target);
  assert.equal(await policy.hashText(f.member.text, webcrypto), f.textHash);
  assert.equal(policy.previewMatches(f.preview, f.target, f.member, f.textHash), true);
  assert.equal(policy.receiptMatches(f.receipt, f.preview), true);
  assert.ok(policy.pageScope(f.preview));
  assert.deepEqual(clone(f), before);
});
