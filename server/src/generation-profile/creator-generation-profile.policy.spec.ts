import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  ARTIST_PROFILE_SECTION_KEYS,
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  assertCreatorGenerationProfileApprovable,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from './creator-generation-profile.policy';

function profile(kind: 'story' | 'artist', decision = 'accepted') {
  const keys = kind === 'story' ? STORY_PROFILE_SECTION_KEYS : ARTIST_PROFILE_SECTION_KEYS;
  return {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind,
    sections: keys.map((key) => ({
      key,
      decision,
      value: { summary: `${key} settings` },
      evidence: [{ sourceType: kind === 'story' ? 'manuscript' : 'visual', sourceRef: `${key}:1`, summary: 'Evidence' }],
    })),
  };
}

describe('creator generation profile policy', () => {
  it('normalizes section order and creates one stable source-bound fingerprint', () => {
    const input = profile('story');
    input.sections.reverse();
    const first = normalizeCreatorGenerationProfile('story', input);
    const second = normalizeCreatorGenerationProfile('story', profile('story'));
    expect(first.sections.map((section) => section.key)).toEqual(
      [...STORY_PROFILE_SECTION_KEYS].sort((left, right) => left.localeCompare(right)),
    );
    expect(creatorGenerationProfileFingerprint('a'.repeat(64), first))
      .toBe(creatorGenerationProfileFingerprint('a'.repeat(64), second));
    expect(creatorGenerationProfileFingerprint('a'.repeat(64), first))
      .not.toBe(creatorGenerationProfileFingerprint('b'.repeat(64), second));
  });

  it('blocks approval while proposals or blocking unknowns remain', () => {
    const proposed = normalizeCreatorGenerationProfile('story', profile('story', 'proposed'));
    expect(() => assertCreatorGenerationProfileApprovable(proposed)).toThrow(ConflictException);

    const unknown = profile('story');
    unknown.sections.find((section) => section.key === 'timeline')!.decision = 'unknown';
    expect(() => assertCreatorGenerationProfileApprovable(
      normalizeCreatorGenerationProfile('story', unknown),
    )).toThrow(ConflictException);
  });

  it('allows an explicitly unknown optional narrative device after required review is complete', () => {
    const input = profile('story');
    input.sections.find((section) => section.key === 'narrative_devices')!.decision = 'unknown';
    const normalized = normalizeCreatorGenerationProfile('story', input);
    expect(() => assertCreatorGenerationProfileApprovable(normalized)).not.toThrow();
  });

  it('requires both artist identity and transformation settings to be confirmed', () => {
    const input = profile('artist');
    input.sections.find((section) => section.key === 'fixed_identity')!.decision = 'unknown';
    expect(() => assertCreatorGenerationProfileApprovable(
      normalizeCreatorGenerationProfile('artist', input),
    )).toThrow(ConflictException);
  });

  it('rejects unknown sections and prototype-shaped payloads', () => {
    const input = profile('story');
    (input.sections[0] as { key: string }).key = 'provider_override';
    expect(() => normalizeCreatorGenerationProfile('story', input)).toThrow(BadRequestException);
    expect(() => normalizeCreatorGenerationProfile('story', Object.create({
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
      kind: 'story',
      sections: [],
    }))).toThrow(BadRequestException);
  });
});
