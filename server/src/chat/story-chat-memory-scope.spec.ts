import { releaseChecksum } from '../story-production/story-lifecycle.policy';
import type { StoryChatMemoryContext } from './story-chat-memory';
import { storyChatMemoryMarker, storyChatMemoryMarkerMatches } from './story-chat-memory-scope';

describe('story chat memory scope', () => {
  const item = { workTitle: 'Work', sceneTitle: 'Scene', artistDialogue: 'Literal dialogue' };
  const empty: StoryChatMemoryContext = { source: 'no_verified_interaction', items: [] };
  const legacy: StoryChatMemoryContext = { source: 'attributed_story_dialogue', items: [item] };
  const proofFingerprint = releaseChecksum({ receiptId: 'private-receipt', approvalId: 'private-approval' });
  const canonical: StoryChatMemoryContext = { ...legacy, canonicalProofFingerprint: proofFingerprint };
  const current = storyChatMemoryMarker(legacy);

  it('hashes the versioned contract and exposes only the marker fields', () => {
    expect(current).toEqual({
      version: 1,
      source: legacy.source,
      checksum: releaseChecksum({
        contract: 'story-chat-memory-scope-v1', source: legacy.source, items: legacy.items,
        canonicalProofFingerprint: null,
      }),
    });
    const marker = storyChatMemoryMarker(canonical);
    expect(marker).toEqual({
      version: 1,
      source: canonical.source,
      checksum: releaseChecksum({
        contract: 'story-chat-memory-scope-v1', source: canonical.source, items: canonical.items,
        canonicalProofFingerprint: proofFingerprint,
      }),
    });
    const serialized = JSON.stringify(marker);
    for (const privateValue of [...Object.values(item), proofFingerprint, 'private-receipt', 'private-approval']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('distinguishes empty, legacy, and canonical contexts with identical legacy/canonical items', () => {
    const checksums = [empty, legacy, canonical].map(context => storyChatMemoryMarker(context).checksum);
    expect(new Set(checksums).size).toBe(3);
    expect(storyChatMemoryMarker({ source: legacy.source, items: [] }).checksum)
      .not.toBe(storyChatMemoryMarker(empty).checksum);
  });

  it('treats an absent and explicitly undefined proof fingerprint identically', () => {
    expect(storyChatMemoryMarker({ ...legacy, canonicalProofFingerprint: undefined })).toEqual(current);
  });

  it('invalidates a changed proof even when source and items are unchanged', () => {
    const previous = storyChatMemoryMarker(canonical);
    const changed = storyChatMemoryMarker({
      ...canonical, canonicalProofFingerprint: releaseChecksum({ receiptId: 'new-private-receipt' }),
    });
    expect(changed.checksum).not.toBe(previous.checksum);
    expect(storyChatMemoryMarkerMatches(previous, changed)).toBe(false);
    expect(storyChatMemoryMarkerMatches(previous, current)).toBe(false);
    expect(storyChatMemoryMarkerMatches(current, previous)).toBe(false);
  });

  it.each(['workTitle', 'sceneTitle', 'artistDialogue'] as const)('invalidates a changed item %s', field => {
    const changed = storyChatMemoryMarker({ ...canonical, items: [{ ...item, [field]: 'Changed' }] });
    const previous = storyChatMemoryMarker(canonical);
    expect(changed.checksum).not.toBe(previous.checksum);
    expect(storyChatMemoryMarkerMatches(previous, changed)).toBe(false);
  });

  it('includes interaction kind and evidence source in the item checksum', () => {
    const dialogue: StoryChatMemoryContext = {
      ...canonical,
      items: [{ ...item, interactionKind: 'dialogue', evidenceSource: 'canonical_author_approved' }],
    };
    const action = storyChatMemoryMarker({ ...dialogue, items: [{ ...dialogue.items[0], interactionKind: 'action' }] });
    expect(action.checksum).not.toBe(storyChatMemoryMarker(dialogue).checksum);
    expect(storyChatMemoryMarker(dialogue).checksum).not.toBe(storyChatMemoryMarker(canonical).checksum);
    expect(storyChatMemoryMarker({ ...canonical, items: [{ ...item, interactionKind: 'dialogue' }] }).checksum)
      .not.toBe(storyChatMemoryMarker(dialogue).checksum);
  });

  it('is stable across context and nested item property order', () => {
    const reordered: StoryChatMemoryContext = {
      canonicalProofFingerprint: proofFingerprint,
      items: [{ artistDialogue: item.artistDialogue, sceneTitle: item.sceneTitle, workTitle: item.workTitle }],
      source: legacy.source,
    };
    expect(storyChatMemoryMarker(reordered)).toEqual(storyChatMemoryMarker(canonical));
  });

  it('preserves item array order', () => {
    const second = { ...item, artistDialogue: 'Second dialogue' };
    expect(storyChatMemoryMarker({ ...legacy, items: [item, second] }).checksum)
      .not.toBe(storyChatMemoryMarker({ ...legacy, items: [second, item] }).checksum);
  });

  it.each([
    ['Unicode composition', '\u00e9', 'e\u0301'],
    ['CRLF', 'First\r\nSecond', 'First\nSecond'],
    ['surrounding whitespace', ' Dialogue ', 'Dialogue'],
  ])('does not normalize literal text: %s', (_label, original, normalized) => {
    const marker = storyChatMemoryMarker({ ...legacy, items: [{ ...item, artistDialogue: original }] });
    const changed = storyChatMemoryMarker({ ...legacy, items: [{ ...item, artistDialogue: normalized }] });
    expect(marker.checksum).not.toBe(changed.checksum);
    expect(storyChatMemoryMarkerMatches(marker, changed)).toBe(false);
  });

  it('matches the current context by value without mutating its input', () => {
    const context = structuredClone(canonical);
    const before = structuredClone(context);
    const marker = storyChatMemoryMarker(context);
    expect(context).toEqual(before);
    expect(storyChatMemoryMarkerMatches(marker, storyChatMemoryMarker(canonical))).toBe(true);
    expect(storyChatMemoryMarkerMatches(JSON.parse(JSON.stringify(marker)), marker)).toBe(true);
    expect(storyChatMemoryMarkerMatches(storyChatMemoryMarker(empty), storyChatMemoryMarker(empty))).toBe(true);
  });

  it('matches marker fields independently of property order', () => {
    expect(storyChatMemoryMarkerMatches({
      checksum: current.checksum, source: current.source, version: current.version,
    }, current)).toBe(true);
  });

  it.each([
    ['null', null], ['undefined', undefined], ['array', []], ['marker array', [current]],
    ['array with marker fields', Object.assign([], current)],
    ['string', JSON.stringify(current)], ['number', 1], ['boolean', true],
    ['empty object', {}],
    ['missing version', { source: current.source, checksum: current.checksum }],
    ['missing source', { version: current.version, checksum: current.checksum }],
    ['missing checksum', { version: current.version, source: current.source }],
    ['wrong key', { version: current.version, source: current.source, hash: current.checksum }],
    ['extra key', { ...current, items: [item] }],
    ['extra proof', { ...current, canonicalProofFingerprint: proofFingerprint }],
    ['extra undefined key', { ...current, extra: undefined }],
    ['symbol key', { ...current, [Symbol('extra')]: true }],
    ['hidden extra key', Object.defineProperty({ ...current }, 'extra', { value: true })],
    ['inherited marker fields', Object.create(current)],
    ['wrong version', { ...current, version: 2 }],
    ['string version', { ...current, version: '1' }],
    ['missing version value', { ...current, version: undefined }],
    ['unknown source', { ...current, source: 'canonical' }],
    ['null source', { ...current, source: null }],
    ['number source', { ...current, source: 1 }],
  ] as Array<[string, unknown]>)('rejects an invalid marker shape: %s', (_label, value) => {
    expect(storyChatMemoryMarkerMatches(value, current)).toBe(false);
  });

  it.each([
    ['uppercase', current.checksum.toUpperCase()], ['empty', ''],
    ['short', 'a'.repeat(63)], ['long', 'a'.repeat(65)], ['nonhex', 'g'.repeat(64)],
    ['leading space', ` ${current.checksum}`], ['trailing space', `${current.checksum} `],
    ['trailing newline', `${current.checksum}\n`], ['trailing CRLF', `${current.checksum}\r\n`],
    ['null', null], ['undefined', undefined], ['number', 123],
    ['boxed string', new String(current.checksum)],
  ] as Array<[string, unknown]>)('rejects an invalid checksum: %s', (_label, checksum) => {
    expect(storyChatMemoryMarkerMatches({ ...current, checksum }, current)).toBe(false);
  });

  it('rejects a valid but mismatched source or checksum', () => {
    expect(storyChatMemoryMarkerMatches({ ...current, source: empty.source }, current)).toBe(false);
    expect(storyChatMemoryMarkerMatches({ ...current, checksum: releaseChecksum('different scope') }, current))
      .toBe(false);
  });
});
