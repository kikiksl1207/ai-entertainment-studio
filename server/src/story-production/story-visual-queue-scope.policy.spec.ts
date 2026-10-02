import { ServiceUnavailableException } from '@nestjs/common';
import { StoryVisualQueueScope, STORY_VISUAL_QUEUE_LEGACY_SLUGS } from './story-visual-queue-scope.policy';

describe('StoryVisualQueueScope', () => {
  const workId = 'abcdef01-2345-4000-8000-000000000001';
  const releaseId = 'abcdef01-2345-4000-8000-000000000002';
  const otherWorkId = '00000000-0000-4000-8000-000000000003';
  const otherReleaseId = '00000000-0000-4000-8000-000000000004';
  const releaseChecksum = 'a'.repeat(64);
  const entry = { workId, releaseId, releaseChecksum };
  const work = { id: workId, slug: 'additional-story' };
  const release = { id: releaseId, checksum: releaseChecksum };
  const legacyFilter = { slug: { in: [
    'records-of-the-burning-sea-imjin-war',
    'norse-myth-loki-crossroads',
  ] } };
  const invalidMessage = 'Story visual queue configuration is invalid';

  function scope(value?: unknown) {
    const values: Record<string, unknown> = { STORY_IMAGE_QUEUE_RELEASES: value };
    const subject = new StoryVisualQueueScope({ get: (key: string) => values[key] } as never);
    return { subject, values };
  }

  function expectInvalid(subject: StoryVisualQueueScope) {
    const actions = [
      () => subject.workFilter(),
      () => subject.allows(work, release),
      ...STORY_VISUAL_QUEUE_LEGACY_SLUGS.map(slug => () => subject.allows({ ...work, slug }, release)),
    ];
    for (const action of actions) {
      expect(action).toThrow(ServiceUnavailableException);
      expect(action).toThrow(new ServiceUnavailableException(invalidMessage));
    }
  }

  it.each([
    ['absent', undefined],
    ['empty string', ''],
    ['empty array', '[]'],
  ])('defaults to only the two legacy slugs for %s config', (_label, value) => {
    const { subject } = scope(value);
    expect(STORY_VISUAL_QUEUE_LEGACY_SLUGS).toEqual(legacyFilter.slug.in);
    expect(subject.workFilter()).toEqual(legacyFilter);
    expect(subject.allows(work, release)).toBe(false);
    for (const slug of STORY_VISUAL_QUEUE_LEGACY_SLUGS) {
      expect(subject.allows({ id: otherWorkId, slug }, { id: otherReleaseId, checksum: 'b'.repeat(64) })).toBe(true);
    }
  });

  it('adds only explicit work/release tuples and preserves both legacy stories', () => {
    const { subject } = scope(JSON.stringify([entry]));
    expect(subject.workFilter()).toEqual({ OR: [legacyFilter, { id: workId, activeReleaseId: releaseId }] });
    expect(subject.allows(work, release)).toBe(true);
    expect(subject.allows({ ...work, slug: 'renamed-story' }, release)).toBe(true);
    expect(subject.allows({ id: otherWorkId, slug: work.slug }, release)).toBe(false);
    for (const slug of STORY_VISUAL_QUEUE_LEGACY_SLUGS) {
      expect(subject.allows({ id: otherWorkId, slug }, { id: otherReleaseId, checksum: 'b'.repeat(64) })).toBe(true);
    }
  });

  it.each([
    ['work', { ...work, id: otherWorkId }, release],
    ['release', work, { ...release, id: otherReleaseId }],
    ['checksum', work, { ...release, checksum: 'b'.repeat(64) }],
    ['checksum case', work, { ...release, checksum: releaseChecksum.toUpperCase() }],
  ])('rejects additional eligibility after %s drift', (_label, candidateWork, candidateRelease) => {
    expect(scope(JSON.stringify([entry])).subject.allows(candidateWork, candidateRelease)).toBe(false);
  });

  it('normalizes configured UUIDs to the lowercase database representation', () => {
    const { subject } = scope(JSON.stringify([{
      ...entry, workId: workId.toUpperCase(), releaseId: releaseId.toUpperCase(),
    }]));
    expect(subject.workFilter()).toEqual({ OR: [legacyFilter, { id: workId, activeReleaseId: releaseId }] });
    expect(subject.allows(work, release)).toBe(true);
    expect(subject.allows({ ...work, id: workId.toUpperCase() }, { ...release, id: releaseId.toUpperCase() })).toBe(true);
  });

  it.each([1, 2, 3, 4, 5])('accepts UUID version %i', version => {
    const candidate = { ...entry,
      workId: workId.replace('-4000-', `-${version}000-`),
      releaseId: releaseId.replace('-4000-', `-${version}000-`),
    };
    const { subject } = scope(JSON.stringify([candidate]));
    expect(subject.allows({ ...work, id: candidate.workId }, { ...release, id: candidate.releaseId })).toBe(true);
  });

  it.each(['8', '9', 'a', 'b'])('accepts the UUID variant starting with %s', variant => {
    const candidate = { ...entry,
      workId: workId.replace('-8000-', `-${variant}000-`),
      releaseId: releaseId.replace('-8000-', `-${variant}000-`),
    };
    expect(scope(JSON.stringify([candidate])).subject.allows(
      { ...work, id: candidate.workId }, { ...release, id: candidate.releaseId },
    )).toBe(true);
  });

  it.each(['[]', '', undefined])('withdraws additional eligibility immediately when config becomes %p', value => {
    const { subject, values } = scope(JSON.stringify([entry]));
    expect(subject.workFilter()).toEqual({ OR: [legacyFilter, { id: workId, activeReleaseId: releaseId }] });
    expect(subject.allows(work, release)).toBe(true);
    values.STORY_IMAGE_QUEUE_RELEASES = value;
    expect(subject.workFilter()).toEqual(legacyFilter);
    expect(subject.allows(work, release)).toBe(false);
    for (const slug of STORY_VISUAL_QUEUE_LEGACY_SLUGS) {
      expect(subject.allows({ ...work, slug }, release)).toBe(true);
    }
  });

  it('revalidates a replacement tuple without retaining the previous release binding', () => {
    const { subject, values } = scope(JSON.stringify([entry]));
    expect(subject.allows(work, release)).toBe(true);
    const replacement = { ...entry, releaseId: otherReleaseId, releaseChecksum: 'b'.repeat(64) };
    values.STORY_IMAGE_QUEUE_RELEASES = JSON.stringify([replacement]);
    expect(subject.allows(work, release)).toBe(false);
    expect(subject.allows(work, { id: otherReleaseId, checksum: replacement.releaseChecksum })).toBe(true);
    expect(subject.workFilter()).toEqual({ OR: [legacyFilter, { id: workId, activeReleaseId: otherReleaseId }] });
  });

  it.each([
    ['bad JSON', '{bad'],
    ['nonstring', [entry]],
    ['invalid entry', JSON.stringify([entry, { ...entry, releaseChecksum: 'invalid' }])],
    ['oversized', '[]' + ' '.repeat(16 * 1024)],
  ])('never falls back to previously valid entries after %s config', (_label, invalidValue) => {
    const { subject, values } = scope(JSON.stringify([entry]));
    expect(subject.allows(work, release)).toBe(true);
    subject.workFilter();
    values.STORY_IMAGE_QUEUE_RELEASES = invalidValue;
    expectInvalid(subject);
    expectInvalid(subject);
    values.STORY_IMAGE_QUEUE_RELEASES = JSON.stringify([entry]);
    expect(subject.allows(work, release)).toBe(true);
    values.STORY_IMAGE_QUEUE_RELEASES = '[]';
    expect(subject.allows(work, release)).toBe(false);
  });

  it.each(['{bad', ' ', 'undefined', '[', '[null,]'])('rejects malformed JSON %p with only the generic error', value => {
    expectInvalid(scope(value).subject);
  });

  it.each([null, false, true, 0, 1, [], [entry], entry, new String('[]')])('rejects nonstring config %p', value => {
    expectInvalid(scope(value).subject);
  });

  it.each([null, false, true, 0, '[]', {}, entry])('requires an array instead of parsed value %p', value => {
    expectInvalid(scope(JSON.stringify(value)).subject);
  });

  it.each([
    null, false, 1, 'entry', [], {},
    { workId, releaseId },
    { workId, releaseChecksum },
    { releaseId, releaseChecksum },
    { workId, releaseId, checksum: releaseChecksum },
    { ...entry, freeAccess: true },
    { ...entry, extra: null },
  ])('rejects any entry not having exactly the three required fields: %p', candidate => {
    expectInvalid(scope(JSON.stringify([candidate])).subject);
  });

  it('rejects unexpected own __proto__ properties', () => {
    const value = JSON.stringify([{ ...entry, ['__proto__']: {} }]);
    expectInvalid(scope(value).subject);
  });

  it.each([
    undefined, null, 123, true,
    '00000000-0000-0000-0000-000000000000',
    'abcdef01-2345-0000-8000-000000000001',
    'abcdef01-2345-6000-8000-000000000001',
    'abcdef01-2345-7000-8000-000000000001',
    'abcdef01-2345-4000-7000-000000000001',
    'abcdef01-2345-4000-c000-000000000001',
    'abcdef01234540008000000000000001',
    `${workId}\n`, ` ${workId}`, `${workId} `,
  ])('requires exact v1-v5 UUID strings for both IDs: %p', value => {
    for (const key of ['workId', 'releaseId']) {
      expectInvalid(scope(JSON.stringify([{ ...entry, [key]: value }])).subject);
    }
  });

  it.each([
    undefined, null, 123, true, [], {},
    'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65),
    `${releaseChecksum}\n`, ` ${releaseChecksum}`, `${releaseChecksum} `,
  ])('requires an exact lowercase 64-character hex checksum: %p', value => {
    expectInvalid(scope(JSON.stringify([{ ...entry, releaseChecksum: value }])).subject);
  });

  it.each([
    entry,
    { ...entry, releaseChecksum: 'b'.repeat(64) },
    { ...entry, workId: workId.toUpperCase(), releaseId: releaseId.toUpperCase() },
  ])('rejects duplicate work/release identities regardless of checksum or UUID case: %p', duplicate => {
    expectInvalid(scope(JSON.stringify([entry, duplicate])).subject);
  });

  it('allows distinct work/release pairs that share only a work or release ID', () => {
    const entries = [entry, { ...entry, releaseId: otherReleaseId }, { ...entry, workId: otherWorkId }];
    const { subject } = scope(JSON.stringify(entries));
    expect(subject.workFilter()).toEqual({ OR: [legacyFilter,
      ...entries.map(item => ({ id: item.workId, activeReleaseId: item.releaseId }))] });
    for (const item of entries) {
      expect(subject.allows({ ...work, id: item.workId }, { id: item.releaseId, checksum: item.releaseChecksum })).toBe(true);
    }
  });

  it('fails the whole configuration rather than ignoring one invalid entry', () => {
    expectInvalid(scope(JSON.stringify([entry, null])).subject);
    expectInvalid(scope(JSON.stringify([null, entry])).subject);
  });

  it('accepts ten additional entries and rejects an eleventh', () => {
    const entries = Array.from({ length: 11 }, (_, index) => ({ ...entry,
      workId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }));
    const { subject } = scope(JSON.stringify(entries.slice(0, 10)));
    expect(subject.workFilter()).toEqual({ OR: [legacyFilter,
      ...entries.slice(0, 10).map(item => ({ id: item.workId, activeReleaseId: item.releaseId }))] });
    for (const item of entries.slice(0, 10)) {
      expect(subject.allows({ ...work, id: item.workId }, release)).toBe(true);
    }
    expectInvalid(scope(JSON.stringify(entries)).subject);
  });

  it('accepts exactly 16 KiB of config and rejects one byte more before parsing', () => {
    const json = JSON.stringify([entry]);
    const value = json + ' '.repeat(16 * 1024 - Buffer.byteLength(json, 'utf8'));
    expect(scope(value).subject.allows(work, release)).toBe(true);
    const parse = jest.spyOn(JSON, 'parse');
    try {
      expectInvalid(scope(value + ' ').subject);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it('bounds config by UTF-8 bytes rather than character count', () => {
    const value = `["${'\u00e9'.repeat(8192)}"]`;
    expect(value.length).toBeLessThan(16 * 1024);
    expect(Buffer.byteLength(value, 'utf8')).toBeGreaterThan(16 * 1024);
    const parse = jest.spyOn(JSON, 'parse');
    try {
      expectInvalid(scope(value).subject);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it('does not let callers mutate a returned work filter to expand subsequent eligibility', () => {
    const { subject } = scope(JSON.stringify([entry]));
    const filter = subject.workFilter();
    filter.OR = [{ id: otherWorkId, activeReleaseId: otherReleaseId }];
    expect(subject.workFilter()).toEqual({ OR: [legacyFilter, { id: workId, activeReleaseId: releaseId }] });
    expect(subject.allows({ id: otherWorkId, slug: work.slug }, { id: otherReleaseId, checksum: releaseChecksum })).toBe(false);
  });
});
