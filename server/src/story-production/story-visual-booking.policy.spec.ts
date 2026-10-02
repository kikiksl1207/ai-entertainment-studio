import { parsedStoryVisualBooking, storyVisualBookingIdentity, storyVisualBookingMatches } from './story-visual-booking.policy';

describe('Story visual booking identity', () => {
  const basis = { workId: 'work', releaseId: 'release', releaseChecksum: 'a'.repeat(64), sourceSceneKey: 'scene',
    promptSha256: 'b'.repeat(64), variantKey: 'default', sourceKind: 'studio_reviewed', sourceBindingSha256: 'c'.repeat(64),
    visualBibleVersion: 'v1', visualBibleFingerprint: 'd'.repeat(64), authorApprovalIdentitySha256: 'e'.repeat(64),
    sceneGuidanceApprovalSha256: 'f'.repeat(64), coverSourceFingerprint: '1'.repeat(64), workVisualReferenceChecksum: null,
    effectivePromptSha256: '2'.repeat(64), provider: 'openai', model: 'gpt-image-2', quality: 'high', size: '1024x1536',
    requestContractVersion: 'request-v5' };
  it('is deterministic, bounded and contains no prompt, prose or image payload', () => {
    const snapshot = storyVisualBookingIdentity(basis);
    expect(parsedStoryVisualBooking(snapshot)).toEqual(snapshot);
    expect(storyVisualBookingMatches(snapshot, basis)).toEqual(snapshot);
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(8192);
  });
  it.each(Object.keys(basis))('rejects changed %s without rewriting its checksum', key => {
    const snapshot = storyVisualBookingIdentity(basis);
    expect(parsedStoryVisualBooking({ ...snapshot, [key]: 'changed' })).toBeNull();
  });
  it.each([null, [], {}, { ...storyVisualBookingIdentity(basis), promptText: 'private' },
    { ...storyVisualBookingIdentity(basis), contract: 'other' },
    storyVisualBookingIdentity({ ...basis, variantKey: 'artist:other' })])('rejects missing, extra or invalid fields: %p', value => {
    expect(parsedStoryVisualBooking(value)).toBeNull();
  });
  it('rejects a valid booking used for another scene/release/checksum', () => {
    const snapshot = storyVisualBookingIdentity(basis);
    for (const key of ['workId', 'releaseId', 'releaseChecksum', 'sourceSceneKey', 'promptSha256']) {
      expect(storyVisualBookingMatches(snapshot, { ...basis, [key]: 'other' })).toBeNull();
    }
  });
});
