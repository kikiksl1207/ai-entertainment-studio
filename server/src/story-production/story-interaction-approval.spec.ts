import 'reflect-metadata';
import { BadRequestException, ConflictException, HttpException, ParseUUIDPipe, RequestMethod, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, METHOD_METADATA, PARAMTYPES_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Prisma, StoryInteractionApproval } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { ApproveStoryInteractionDto, RevokeStoryInteractionDto, StoryInteractionReviewQueryDto } from './dto/story-interaction-approval.dto';
import { StoryInteractionApprovalController } from './story-interaction-approval.controller';
import { StoryInteractionEvidence, validateStoryInteractionEvidence } from './story-interaction-approval.policy';
import { StoryInteractionApprovalService } from './story-interaction-approval.service';
import { releaseChecksum } from './story-lifecycle.policy';

const owner = '11111111-1111-4111-8111-111111111111';
const workId = '22222222-2222-4222-8222-222222222222';
const beatId = '33333333-3333-4333-8333-333333333333';
const artistId = '44444444-4444-4444-8444-444444444444';
const releaseId = '55555555-5555-4555-8555-555555555555';
const manuscriptId = '66666666-6666-4666-8666-666666666666';
const partId = '77777777-7777-4777-8777-777777777777';
const sceneId = '88888888-8888-4888-8888-888888888888';
const profileId = '99999999-9999-4999-8999-999999999999';
const approvalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const quote = 'Mira opened the door.';
const source = `\uD83D\uDE80 ${quote} "Stay here."`;
const now = new Date('2026-10-01T00:00:00.000Z');

function evidence(change: Partial<StoryInteractionEvidence> = {}): StoryInteractionEvidence {
  return { interactionKind: 'action', evidenceStart: 3, evidenceText: quote,
    memoryText: 'Mira opened the door for me.', interactionReviewed: true, ...change };
}

function matches(row: object | null, where: Record<string, unknown>) {
  return !!row && Object.entries(where).every(([field, value]) =>
    (row as Record<string, unknown>)[field] === value);
}

type AuditData = { actorUserId: string; actorType: string; action: string; targetType: string;
  targetId: string; metadata: Record<string, string> };
type CreateApproval = Omit<StoryInteractionApproval, 'id' | 'status' | 'revision' | 'approvedAt' | 'revokedAt' | 'createdAt'>;

// Only staged approval/audit writes are simulated. No SQL, constraints, isolation, or concurrency is emulated.
// Passing this suite is not PostgreSQL rollback proof, reader-memory proof, AI quality, or operational readiness.
function fixture() {
  const work = { id: workId, ownerUserId: owner, status: 'published', fixtureSource: false,
    activeReleaseId: releaseId as string | null, defaultLocale: 'ko' };
  const release = { id: releaseId, workId, manuscriptVersionId: manuscriptId, status: 'active', checksum: 'a'.repeat(64) };
  const manuscript = { id: manuscriptId, workId, ownerUserId: owner, contentHash: 'b'.repeat(64) };
  const part = { id: partId, workId, position: 1, status: 'published', fixtureSource: false };
  const scene = { id: sceneId, partId, sceneKey: 'scene-one', position: 2, status: 'published', fixtureSource: false };
  const beat = { id: beatId, sceneId, position: 3, beatType: 'paragraph', sourceSceneKey: 'original-one',
    content: { ko: `${source}\n\uD55C\uAD6D\uC5B4`, en: `${source}\nEnglish`, ja: `${source}\n\u65E5\u672C\u8A9E`,
      'zh-Hans': `${source}\n\u7B80\u4F53`, 'zh-Hant': `${source}\n\u7E41\u9AD4` } as Record<string, unknown> };
  const artist = { id: artistId, displayName: 'Mira', status: 'active' };
  const settings = normalizeCreatorGenerationProfile('artist', { schemaVersion: 'creator-generation-profile-v1',
    kind: 'artist', sections: ['fixed_identity', 'adaptable_presentation'].map(section => ({
      key: section, decision: 'accepted', value: { description: 'Reviewed identity' }, evidence: [],
    })) });
  const profile = { id: profileId, artistId, profileVersion: 2, reviewRevision: 1, status: 'approved',
    approvedAt: now as Date | null, approvedByUserId: owner as string | null, approvedSettings: settings as unknown,
    sourceFingerprint: 'c'.repeat(64), approvedFingerprint: creatorGenerationProfileFingerprint('c'.repeat(64), settings) };
  let committed: StoryInteractionApproval[] = [], staged: StoryInteractionApproval[] = [];
  let audits: AuditData[] = [], stagedAudits: AuditData[] = [];
  const findApproval = (where: Record<string, unknown>) => staged.find(row => matches(row, where)) ?? null;
  const tx = {
    $queryRaw: jest.fn(async (_sql: Prisma.Sql) => []),
    storyWork: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(work, where) ? work : null) },
    storyRelease: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(release, where) ? release : null) },
    storyManuscriptVersion: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(manuscript, where) ? manuscript : null) },
    storyPart: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(part, where) ? part : null) },
    storyScene: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(scene, where) ? scene : null) },
    storyBeat: { findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(beat, where) ? beat : null) },
    artist: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(artist, where) ? artist : null) },
    artistStoryIdentityProfile: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(profile, where) ? profile : null) },
    storyInteractionApproval: {
      findMany: jest.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
        staged.filter(row => matches(row, where)).slice(0, take)),
      findUnique: jest.fn(async ({ where }: { where: { ownerUserId_workId_idempotencyKey: Record<string, unknown> } }) =>
        findApproval(where.ownerUserId_workId_idempotencyKey)),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => findApproval(where)),
      create: jest.fn(async ({ data }: { data: CreateApproval }) => {
        const row: StoryInteractionApproval = { ...data, id: approvalId, status: 'approved', revision: 1,
          approvedAt: now, revokedAt: null, createdAt: now };
        staged.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<StoryInteractionApproval> }) => {
        const rows = staged.filter(row => matches(row, where));
        rows.forEach(row => Object.assign(row, data));
        return { count: rows.length };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const row = findApproval(where);
        if (!row) throw new Error('Synthetic approval missing');
        return row;
      }),
    },
    auditEvent: { create: jest.fn(async ({ data }: { data: AuditData }) => { stagedAudits.push(data); return { id: other, ...data }; }) },
    // Tripwires: author approval must never apply reader memory or modify source/profile state.
    storyReaderProgress: { updateMany: jest.fn() },
    storyReaderActorMemory: { upsert: jest.fn() },
  };
  const prisma = { $transaction: jest.fn(async (run: (db: typeof tx) => Promise<unknown>, _options?: unknown) => {
    staged = committed.map(row => ({ ...row }));
    stagedAudits = audits.map(row => ({ ...row, metadata: { ...row.metadata } }));
    const result = await run(tx);
    committed = staged.map(row => ({ ...row }));
    audits = stagedAudits.map(row => ({ ...row, metadata: { ...row.metadata } }));
    return result;
  }) };
  const service = new StoryInteractionApprovalService(prisma as never);
  const review = (locale = 'en') => service.review(owner, workId, beatId, { artistId, locale });
  const input = async (change: Partial<ApproveStoryInteractionDto> = {}): Promise<ApproveStoryInteractionDto> => {
    const current = await review(change.locale ?? 'en');
    return { artistId, locale: 'en', idempotencyKey: key,
      expectedSourceChecksum: current.identity.sourceChecksum,
      expectedIdentityPinHash: current.identity.identityPinHash, ...evidence(), ...change };
  };
  const approve = (body: ApproveStoryInteractionDto) => service.approve(owner, workId, beatId, body);
  return { work, release, manuscript, part, scene, beat, artist, profile, tx, prisma, service, review, input, approve,
    rows: () => committed, audits: () => audits };
}

async function rejection(promise: Promise<unknown>, status: number, code: string) {
  try { await promise; } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    expect((error as HttpException).getResponse()).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected rejection: ${code}`);
}

function noWrites(f: ReturnType<typeof fixture>) {
  expect(f.tx.storyInteractionApproval.create).not.toHaveBeenCalled();
  expect(f.tx.storyInteractionApproval.updateMany).not.toHaveBeenCalled();
  expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  expect(f.tx.storyReaderActorMemory.upsert).not.toHaveBeenCalled();
  expect(f.rows()).toEqual([]);
  expect(f.audits()).toEqual([]);
}

describe('StoryInteractionApprovalService isolated author-review contract', () => {
  it.each(locales)('reads and approves only the exact %s source, without memory application', async locale => {
    const f = fixture();
    const current = await f.review(locale);
    expect(current.sourceText).toBe(f.beat.content[locale]);
    expect(current).toMatchObject({ proposalApproved: false, readerMemoryApplied: false, approvals: [],
      identity: { locale, ownerUserId: owner, workId, beatId, artistId, identityProfileId: profileId } });
    expect(current.identity.sourceChecksum).toBe(releaseChecksum({ contract: 'story-canonical-interaction-source-v1',
      workId, ownerUserId: owner, releaseId, releaseChecksum: f.release.checksum,
      manuscriptVersionId: manuscriptId, manuscriptHash: f.manuscript.contentHash,
      partId, partPosition: f.part.position, sceneId, sceneKey: f.scene.sceneKey, scenePosition: f.scene.position,
      beatId, beatPosition: f.beat.position, beatType: f.beat.beatType, sourceSceneKey: f.beat.sourceSceneKey,
      locale, sourceText: f.beat.content[locale] }));
    noWrites(f);
    const body = await f.input({ locale });
    const result = await f.approve(body);
    expect(result).toMatchObject({ status: 'approved', revision: 1, locale, evidenceStart: 3,
      evidenceText: quote, memoryText: body.memoryText, readerMemoryApplied: false });
    expect(f.rows()).toHaveLength(1);
    expect(f.rows()[0]).not.toHaveProperty('interactionReviewed');
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
    expect(f.tx.storyReaderActorMemory.upsert).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });

  it.each(locales)('does not fall back from missing %s to another available locale', async locale => {
    const f = fixture();
    const body = await f.input({ locale });
    delete f.beat.content[locale];
    await rejection(f.review(locale), 409, 'STORY_INTERACTION_TRANSLATION_UNAVAILABLE');
    await rejection(f.approve(body), 409, 'STORY_INTERACTION_TRANSLATION_UNAVAILABLE');
    noWrites(f);
  });

  it.each(['KO', 'en-US', 'zh', 'zh-hans', '', undefined])('rejects nonexact locale %s', async locale => {
    const f = fixture();
    await rejection(f.service.review(owner, workId, beatId, { artistId, locale } as StoryInteractionReviewQueryDto),
      400, 'STORY_INTERACTION_LOCALE_INVALID');
    noWrites(f);
  });

  it.each(['', 'x', '  ', 'ok\0', 'ok\uD800', 'ok\uDC00', 'x'.repeat(64001), 42, null])(
    'rejects unavailable/malformed localized source (case %#)', async text => {
      const f = fixture();
      f.beat.content.en = text;
      await rejection(f.review(), 409, 'STORY_INTERACTION_TRANSLATION_UNAVAILABLE');
      noWrites(f);
    });

  it('accepts valid surrogate pairs and the 64000 UTF-16 source boundary without trimming', async () => {
    const f = fixture();
    const text = `  ${source}`.padEnd(64000, ' ');
    f.beat.content.en = text;
    expect((await f.review()).sourceText).toBe(text);
    const body = await f.input({ evidenceStart: 5 });
    expect((await f.approve(body)).evidenceStart).toBe(5);
  });

  it.each([false, undefined, 'true', 1])('identity approval is not explicit event consent (%s)', async consent => {
    const f = fixture();
    const body = await f.input();
    await rejection(f.approve({ ...body, interactionReviewed: consent } as ApproveStoryInteractionDto),
      400, 'STORY_INTERACTION_EVIDENCE_INVALID');
    noWrites(f);
  });

  it.each([
    { status: 'draft' }, { status: 'proposed' }, { approvedAt: null }, { approvedByUserId: null }, { reviewRevision: 0 },
    { approvedSettings: null }, { approvedSettings: { schemaVersion: 'wrong' } },
    { approvedFingerprint: 'd'.repeat(64) }, { sourceFingerprint: 'bad' },
  ])('event consent cannot replace invalid/unapproved actor identity (case %#)', async change => {
    const f = fixture();
    const body = await f.input();
    Object.assign(f.profile, change);
    await rejection(f.approve(body), 409, 'STORY_INTERACTION_ARTIST_APPROVAL_REQUIRED');
    noWrites(f);
  });

  it('rejects a missing current identity profile and an inactive artist', async () => {
    for (const missingProfile of [true, false]) {
      const f = fixture();
      const body = await f.input();
      if (missingProfile) f.tx.artistStoryIdentityProfile.findFirst.mockResolvedValueOnce(null);
      else f.artist.status = 'inactive';
      await rejection(f.approve(body), 409, 'STORY_INTERACTION_ARTIST_APPROVAL_REQUIRED');
      noWrites(f);
    }
  });

  it.each(['missing-section', 'proposed', 'unknown'])('rejects hash-valid but incomplete actor review: %s', async change => {
    const f = fixture();
    const body = await f.input();
    const settings = normalizeCreatorGenerationProfile('artist', f.profile.approvedSettings);
    if (change === 'missing-section') settings.sections = settings.sections.slice(0, 1);
    else settings.sections[0].decision = change === 'proposed' ? 'proposed' : 'unknown';
    f.profile.approvedSettings = settings;
    f.profile.approvedFingerprint = creatorGenerationProfileFingerprint(f.profile.sourceFingerprint, settings);
    await rejection(f.approve(body), 409, 'STORY_INTERACTION_ARTIST_APPROVAL_REQUIRED');
    noWrites(f);
  });

  it('requests actor/profile share locks before reading the current identity profile', async () => {
    const f = fixture();
    const body = await f.input();
    f.tx.artistStoryIdentityProfile.findFirst.mockClear();
    await f.approve(body);
    const calls = f.tx.$queryRaw.mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls[0][0].sql).toContain('FOR UPDATE');
    expect(calls[1][0].sql).toContain('FOR SHARE OF b, s, p');
    expect(calls[2][0].sql).toContain('FROM artists');
    expect(calls[3][0].sql).toContain('artist_story_identity_profiles');
    expect(calls[3][0].sql).toContain('FOR SHARE');
    expect(calls[3][0].values).toContain(artistId);
    expect(f.tx.$queryRaw.mock.invocationCallOrder[3]).toBeLessThan(
      f.tx.artistStoryIdentityProfile.findFirst.mock.invocationCallOrder[0]);
    expect(f.tx.artistStoryIdentityProfile.findFirst).toHaveBeenLastCalledWith({
      where: { artistId }, orderBy: { profileVersion: 'desc' } });
  });

  it('review uses a repeatable read and selects only current source/identity approvals', async () => {
    const f = fixture();
    const result = await f.review();
    expect(f.prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.storyInteractionApproval.findMany).toHaveBeenCalledWith({ where: { workId, beatId,
      artistId, locale: 'en', sourceChecksum: result.identity.sourceChecksum,
      identityPinHash: result.identity.identityPinHash }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51 });
    noWrites(f);
  });

  it('caps review projection at 50 and marks the 51st row only as moreApprovals', async () => {
    const f = fixture();
    await f.approve(await f.input());
    const row = f.rows()[0];
    f.tx.storyInteractionApproval.findMany.mockResolvedValueOnce(Array.from({ length: 51 }, () => ({ ...row })));
    const result = await f.review();
    expect(result.approvals).toHaveLength(50);
    expect(result.moreApprovals).toBe(true);
    expect(result.proposalApproved).toBe(false);
    expect(result.readerMemoryApplied).toBe(false);
    expect(f.tx.storyInteractionApproval.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it.each(['ownerUserId', 'workId', 'releaseId', 'releaseChecksum', 'manuscriptVersionId', 'manuscriptHash',
    'partId', 'sceneId', 'beatId', 'artistId', 'identityProfileId', 'identityPinHash', 'locale', 'sourceChecksum'] as const)(
    'review and same-payload replay recheck stored identity field %s', async field => {
      const f = fixture();
      const body = await f.input();
      await f.approve(body);
      const row = { ...f.rows()[0], [field]: field === 'locale' ? 'ja' : field.endsWith('Hash') ||
        field.endsWith('Checksum') ? '0'.repeat(64) : other };
      // Bypass only the delegate filter to model a corrupt/mis-scoped persisted result.
      f.tx.storyInteractionApproval.findMany.mockResolvedValueOnce([row]);
      f.tx.storyInteractionApproval.findUnique.mockResolvedValueOnce(row);
      await rejection(f.review(), 409, 'STORY_INTERACTION_APPROVAL_CHANGED');
      await rejection(f.approve(body), 409, 'STORY_INTERACTION_APPROVAL_CHANGED');
      expect(f.tx.storyInteractionApproval.create).toHaveBeenCalledTimes(1);
      expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    });

  it.each([
    { status: 'approved', revision: 2, revokedAt: null },
    { status: 'approved', revision: 1, revokedAt: now },
    { status: 'revoked', revision: 1, revokedAt: now },
    { status: 'revoked', revision: 2, revokedAt: null },
    { status: 'draft', revision: 1, revokedAt: null },
  ])('review/replay reject invalid stored revision-state combinations (case %#)', async change => {
    const f = fixture();
    const body = await f.input();
    await f.approve(body);
    Object.assign(f.rows()[0], change);
    await rejection(f.review(), 409, 'STORY_INTERACTION_APPROVAL_CHANGED');
    await rejection(f.approve(body), 409, 'STORY_INTERACTION_APPROVAL_CHANGED');
    expect(f.tx.storyInteractionApproval.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it.each(['offset', 'quote', 'memory', 'checksum'])('review/replay reject corrupt stored %s, not just a hash-shaped row', async change => {
    const f = fixture();
    const body = await f.input();
    await f.approve(body);
    const row = f.rows()[0];
    if (change === 'offset') row.evidenceStart++;
    if (change === 'quote') row.evidenceText = 'Mira closed the door.';
    if (change === 'memory') row.memoryText = 'Tampered but syntactically valid memory.';
    if (change === 'checksum') row.approvalChecksum = '0'.repeat(64);
    const evidenceChanged = change === 'offset' || change === 'quote';
    await rejection(f.review(), 409, evidenceChanged ? 'STORY_INTERACTION_EVIDENCE_SOURCE_CHANGED' : 'STORY_INTERACTION_APPROVAL_CHANGED');
    await rejection(f.approve(body), 409, evidenceChanged ? 'STORY_INTERACTION_EVIDENCE_SOURCE_CHANGED' :
      change === 'checksum' ? 'STORY_INTERACTION_IDEMPOTENCY_CONFLICT' : 'STORY_INTERACTION_APPROVAL_CHANGED');
    expect(f.tx.storyInteractionApproval.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it.each(['owner', 'work', 'beat', 'artist', 'key'])('rejects malformed %s UUID at the service boundary', async field => {
    const f = fixture();
    const body = await f.input();
    await rejection(f.service.approve(field === 'owner' ? 'bad' : owner, field === 'work' ? 'bad' : workId,
      field === 'beat' ? 'bad' : beatId, { ...body,
        artistId: field === 'artist' ? 'bad' : artistId, idempotencyKey: field === 'key' ? 'bad' : key }),
    400, 'STORY_INTERACTION_ID_INVALID');
    noWrites(f);
  });

  it.each(['owner', 'work', 'beat'])('rejects valid but wrong %s scope without mutation', async field => {
    const f = fixture();
    const body = await f.input();
    await rejection(f.service.approve(field === 'owner' ? other : owner, field === 'work' ? other : workId,
      field === 'beat' ? other : beatId, body), 404,
    field === 'beat' ? 'STORY_INTERACTION_BEAT_UNAVAILABLE' : 'STORY_INTERACTION_WORK_UNAVAILABLE');
    noWrites(f);
  });

  it.each([
    ['work', { status: 'draft' }, 'STORY_INTERACTION_WORK_UNAVAILABLE'],
    ['work', { fixtureSource: true }, 'STORY_INTERACTION_WORK_UNAVAILABLE'],
    ['work', { activeReleaseId: null }, 'STORY_INTERACTION_WORK_UNAVAILABLE'],
    ['part', { workId: other }, 'STORY_INTERACTION_BEAT_UNAVAILABLE'],
    ['part', { fixtureSource: true }, 'STORY_INTERACTION_BEAT_UNAVAILABLE'],
    ['scene', { status: 'draft' }, 'STORY_INTERACTION_BEAT_UNAVAILABLE'],
    ['scene', { fixtureSource: true }, 'STORY_INTERACTION_BEAT_UNAVAILABLE'],
    ['beat', { beatType: 'choice' }, 'STORY_INTERACTION_BEAT_UNAVAILABLE'],
  ] as const)('rejects unavailable work/beat ancestry (case %#)', async (target, change, code) => {
    const f = fixture();
    const body = await f.input();
    Object.assign(f[target], change);
    await rejection(f.approve(body), 404, code);
    noWrites(f);
  });

  it.each(['release', 'manuscript'])('rejects wrong-work %s ancestry', async target => {
    const f = fixture();
    const body = await f.input();
    if (target === 'release') f.release.workId = other;
    else f.manuscript.ownerUserId = other;
    await rejection(f.approve(body), 409, 'STORY_INTERACTION_SOURCE_CHANGED');
    noWrites(f);
  });

  it.each(['text', 'release', 'manuscript', 'beatPosition', 'sceneKey', 'partPosition',
    'artistName', 'profileRevision', 'profileVersion', 'profileFingerprint'])('rejects stale source/identity after %s changes', async change => {
    const f = fixture();
    const body = await f.input();
    if (change === 'text') f.beat.content.en = `${source}\nChanged source`;
    if (change === 'release') f.release.checksum = 'e'.repeat(64);
    if (change === 'manuscript') f.manuscript.contentHash = 'f'.repeat(64);
    if (change === 'beatPosition') f.beat.position++;
    if (change === 'sceneKey') f.scene.sceneKey = 'changed';
    if (change === 'partPosition') f.part.position++;
    if (change === 'artistName') f.artist.displayName = 'New name';
    if (change === 'profileRevision') f.profile.reviewRevision++;
    if (change === 'profileVersion') f.profile.profileVersion++;
    if (change === 'profileFingerprint') {
      f.profile.sourceFingerprint = 'd'.repeat(64);
      f.profile.approvedFingerprint = creatorGenerationProfileFingerprint(f.profile.sourceFingerprint,
        normalizeCreatorGenerationProfile('artist', f.profile.approvedSettings));
    }
    await rejection(f.approve(body), 409, 'STORY_INTERACTION_SOURCE_CHANGED');
    noWrites(f);
  });

  it.each(['expectedSourceChecksum', 'expectedIdentityPinHash'] as const)('rejects stale/malformed %s', async field => {
    for (const value of ['0'.repeat(64), 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), undefined]) {
      const f = fixture();
      const body = await f.input();
      await rejection(f.approve({ ...body, [field]: value } as ApproveStoryInteractionDto),
        value === '0'.repeat(64) ? 409 : 400,
        value === '0'.repeat(64) ? 'STORY_INTERACTION_SOURCE_CHANGED' : 'STORY_INTERACTION_CHECKSUM_INVALID');
      noWrites(f);
    }
  });

  it('same key/payload (including uppercase UUID) returns one approval and one audit', async () => {
    const f = fixture();
    const body = await f.input();
    const first = await f.approve(body);
    expect(await f.approve({ ...body, idempotencyKey: key.toUpperCase() })).toEqual(first);
    expect(f.tx.storyInteractionApproval.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.rows()).toHaveLength(1);
    expect(f.rows()[0].idempotencyKey).toBe(key);
    expect(f.tx.storyInteractionApproval.findUnique).toHaveBeenLastCalledWith({ where: {
      ownerUserId_workId_idempotencyKey: { ownerUserId: owner, workId, idempotencyKey: key } } });
  });

  it.each(['memory', 'quote', 'kind', 'locale'])('same key with different %s payload conflicts', async change => {
    const f = fixture();
    const body = await f.input();
    await f.approve(body);
    const modified = { ...body };
    if (change === 'memory') modified.memoryText = 'A different reviewed action.';
    if (change === 'quote' || change === 'kind') {
      modified.evidenceStart = source.indexOf('Stay here.');
      modified.evidenceText = 'Stay here.';
      if (change === 'kind') { modified.interactionKind = 'dialogue'; modified.memoryText = modified.evidenceText; }
    }
    if (change === 'locale') Object.assign(modified, await f.input({ locale: 'ja' }));
    await rejection(f.approve(modified), 409, 'STORY_INTERACTION_IDEMPOTENCY_CONFLICT');
    expect(f.rows()).toHaveLength(1);
    expect(f.tx.storyInteractionApproval.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('records only ID/hash metadata in audit, never source, quote or memory', async () => {
    const f = fixture();
    const result = await f.approve(await f.input());
    expect(f.audits()).toEqual([{ actorUserId: owner, actorType: 'user', action: 'story_interaction.approved',
      targetType: 'story_interaction_approval', targetId: result.approvalId,
      metadata: { workId, beatId, artistId, locale: 'en', sourceChecksum: result.sourceChecksum,
        approvalChecksum: result.approvalChecksum } }]);
    expect(JSON.stringify(f.audits())).not.toContain(quote);
    expect(JSON.stringify(f.audits())).not.toContain(result.memoryText);
  });

  it('stores exact dialogue memory and rejects paraphrased dialogue before any write', async () => {
    const f = fixture();
    f.beat.beatType = 'dialogue';
    const body = await f.input({ interactionKind: 'dialogue', evidenceStart: source.indexOf('Stay here.'),
      evidenceText: 'Stay here.', memoryText: 'Stay here.' });
    await rejection(f.approve({ ...body, memoryText: 'Mira asked me to stay.' }),
      400, 'STORY_INTERACTION_EVIDENCE_INVALID');
    noWrites(f);
    const approved = await f.approve(body);
    expect(approved).toMatchObject({ interactionKind: 'dialogue', evidenceText: 'Stay here.', memoryText: 'Stay here.' });
    expect(await f.approve(body)).toEqual(approved);
  });

  it('wrong UTF-16 offset/exact quote fails before creating an approval or audit', async () => {
    const f = fixture();
    const body = await f.input();
    await rejection(f.approve({ ...body, evidenceStart: 2 }), 409, 'STORY_INTERACTION_EVIDENCE_SOURCE_CHANGED');
    await rejection(f.approve({ ...body, evidenceText: 'Mira closed the door.' }), 409, 'STORY_INTERACTION_EVIDENCE_SOURCE_CHANGED');
    noWrites(f);
  });

  it('revoke/revoke replay/approve replay never reapproves or reapplies reader memory', async () => {
    const f = fixture();
    const body = await f.input();
    const approved = await f.approve(body);
    const withdrawal = { expectedRevision: 1, expectedApprovalChecksum: approved.approvalChecksum };
    const revoked = await f.service.revoke(owner, workId, approved.approvalId, withdrawal);
    expect(revoked).toMatchObject({ status: 'revoked', revision: 2, readerMemoryApplied: false,
      approvalChecksum: approved.approvalChecksum, approvedAt: approved.approvedAt });
    expect(revoked.revokedAt).not.toBeNull();
    expect(await f.service.revoke(owner, workId, approved.approvalId, withdrawal)).toEqual(revoked);
    expect(await f.approve(body)).toEqual(revoked);
    expect(f.tx.storyInteractionApproval.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyInteractionApproval.updateMany).toHaveBeenCalledTimes(1);
    expect(f.audits().map(row => row.action)).toEqual(['story_interaction.approved', 'story_interaction.revoked']);
    expect(f.audits().map(row => row.actorType)).toEqual(['user', 'user']);
    expect(f.audits()[1].metadata).toEqual({ workId, approvalChecksum: approved.approvalChecksum });
    expect((await f.review()).approvals).toEqual([revoked]);
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
    expect(f.tx.storyReaderActorMemory.upsert).not.toHaveBeenCalled();
  });

  it('withdrawal remains possible after source unpublication, supersession and actor deactivation', async () => {
    const f = fixture();
    const approved = await f.approve(await f.input());
    f.work.status = 'draft'; f.work.activeReleaseId = null; f.beat.content = {}; f.artist.status = 'inactive';
    f.tx.artistStoryIdentityProfile.findFirst.mockClear();
    expect(await f.service.revoke(owner, workId, approved.approvalId, {
      expectedRevision: 1, expectedApprovalChecksum: approved.approvalChecksum })).toMatchObject({ status: 'revoked' });
    expect(f.tx.artistStoryIdentityProfile.findFirst).not.toHaveBeenCalled();
  });

  it.each(['owner', 'work', 'approval', 'checksum', 'revision', 'cas'])('refuses invalid revoke %s without committing', async change => {
    const f = fixture();
    const approved = await f.approve(await f.input());
    const snapshot = f.rows().map(row => ({ ...row }));
    const body = { expectedRevision: change === 'revision' ? 2 : 1,
      expectedApprovalChecksum: change === 'checksum' ? '0'.repeat(64) : approved.approvalChecksum };
    if (change === 'cas') f.tx.storyInteractionApproval.updateMany.mockResolvedValueOnce({ count: 0 });
    await rejection(f.service.revoke(change === 'owner' ? other : owner, change === 'work' ? other : workId,
      change === 'approval' ? other : approved.approvalId, body),
    ['owner', 'work', 'approval'].includes(change) ? 404 : change === 'revision' ? 400 : 409,
    ['owner', 'work'].includes(change) ? 'STORY_INTERACTION_WORK_UNAVAILABLE' :
      change === 'approval' ? 'STORY_INTERACTION_APPROVAL_UNAVAILABLE' :
        change === 'revision' ? 'STORY_INTERACTION_REVISION_INVALID' : 'STORY_INTERACTION_APPROVAL_CHANGED');
    expect(f.rows()).toEqual(snapshot);
    expect(f.audits()).toHaveLength(1);
  });

  it.each(['create', 'audit'])('approve %s failure leaves no committed approval/audit in the transaction double', async point => {
    const f = fixture();
    const body = await f.input();
    const failure = new Error(`Injected ${point} failure`);
    if (point === 'create') f.tx.storyInteractionApproval.create.mockRejectedValueOnce(failure);
    else f.tx.auditEvent.create.mockRejectedValueOnce(failure);
    await expect(f.approve(body)).rejects.toBe(failure);
    expect(f.rows()).toEqual([]); expect(f.audits()).toEqual([]);
    expect(f.prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (point === 'audit') expect(f.tx.storyInteractionApproval.create).toHaveBeenCalledTimes(1);
    else expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['update', 'audit', 'reread'])('revoke %s failure preserves the approved row/audit in the transaction double', async point => {
    const f = fixture();
    const approved = await f.approve(await f.input());
    const snapshot = f.rows().map(row => ({ ...row }));
    const failure = new Error(`Injected ${point} failure`);
    if (point === 'update') f.tx.storyInteractionApproval.updateMany.mockRejectedValueOnce(failure);
    if (point === 'audit') f.tx.auditEvent.create.mockRejectedValueOnce(failure);
    if (point === 'reread') f.tx.storyInteractionApproval.findUniqueOrThrow.mockRejectedValueOnce(failure);
    await expect(f.service.revoke(owner, workId, approved.approvalId, {
      expectedRevision: 1, expectedApprovalChecksum: approved.approvalChecksum })).rejects.toBe(failure);
    expect(f.rows()).toEqual(snapshot); expect(f.audits()).toHaveLength(1);
    expect(f.tx.storyInteractionApproval.updateMany).toHaveBeenCalledWith({
      where: { id: approved.approvalId, status: 'approved', revision: 1 },
      data: { status: 'revoked', revision: 2, revokedAt: expect.any(Date) } });
  });

  it.each([['P2034', 'STORY_INTERACTION_SOURCE_CHANGED'], ['P2002', 'STORY_INTERACTION_IDEMPOTENCY_CONFLICT']])(
    'maps %s without retrying or committing synthetic writes', async (code, expected) => {
      const f = fixture();
      const body = await f.input();
      f.tx.storyInteractionApproval.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
        'Injected database conflict', { code, clientVersion: 'unit-test' }));
      f.prisma.$transaction.mockClear();
      await rejection(f.approve(body), 409, expected);
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(f.rows()).toEqual([]); expect(f.audits()).toEqual([]);
    });
});

describe('exact interaction evidence policy', () => {
  it('counts minimum text length as Unicode characters like the SQL constraint, not UTF-16 units', () => {
    const rocket = '\uD83D\uDE80';
    expect(() => validateStoryInteractionEvidence(`${rocket} launch`, evidence({ evidenceStart: 0,
      evidenceText: rocket }))).toThrow(BadRequestException);
    expect(() => validateStoryInteractionEvidence(source, evidence({ memoryText: rocket }))).toThrow(BadRequestException);
    expect(validateStoryInteractionEvidence(`${rocket} launch`, evidence({ evidenceStart: 0,
      evidenceText: `${rocket} launch`, memoryText: `${rocket}${rocket}` }))).toMatchObject({ memoryText: `${rocket}${rocket}` });
  });
  it('preserves UTF-16 offsets, whitespace and action memory independently of the exact quote', () => {
    expect(validateStoryInteractionEvidence(source, evidence())).toEqual({ interactionKind: 'action',
      evidenceStart: 3, evidenceText: quote, memoryText: 'Mira opened the door for me.' });
    expect(validateStoryInteractionEvidence('  exact quote  ', evidence({ evidenceStart: 0,
      evidenceText: '  exact quote  ', memoryText: '  exact memory  ' }))).toMatchObject({
      evidenceText: '  exact quote  ', memoryText: '  exact memory  ' });
  });

  it('dialogue memory must equal the exact source quote, not a paraphrase or a trimmed version', () => {
    const exact = ' Stay here. ';
    expect(validateStoryInteractionEvidence(exact, evidence({ interactionKind: 'dialogue',
      evidenceStart: 0, evidenceText: exact, memoryText: exact }))).toMatchObject({ memoryText: exact });
    for (const memoryText of ['Stay here.', 'Mira told me to stay.']) {
      expect(() => validateStoryInteractionEvidence(exact, evidence({ interactionKind: 'dialogue',
        evidenceStart: 0, evidenceText: exact, memoryText }))).toThrow(BadRequestException);
    }
  });

  it.each([2, 4, 64000])('rejects wrong exact offset %s even when the quote exists elsewhere', offset => {
    expect(() => validateStoryInteractionEvidence(source, evidence({ evidenceStart: offset }))).toThrow(ConflictException);
  });

  it('does not normalize composed/decomposed Unicode or select another occurrence', () => {
    expect(() => validateStoryInteractionEvidence('caf\u00E9', evidence({ evidenceStart: 0,
      evidenceText: 'cafe\u0301' }))).toThrow(ConflictException);
    expect(validateStoryInteractionEvidence('echo / echo', evidence({ evidenceStart: 7,
      evidenceText: 'echo' }))).toMatchObject({ evidenceStart: 7 });
    expect(() => validateStoryInteractionEvidence(source, evidence({ evidenceText: quote.toLowerCase() }))).toThrow(ConflictException);
  });

  it.each([-1, 0.5, NaN, Infinity, 64001, Number.MAX_SAFE_INTEGER + 1, '3', undefined])(
    'rejects invalid numeric offset (case %#)', evidenceStart => {
      expect(() => validateStoryInteractionEvidence(source, { ...evidence(), evidenceStart } as StoryInteractionEvidence))
        .toThrow(BadRequestException);
    });

  it.each(['evidenceText', 'memoryText'] as const)('rejects invalid %s Unicode/NUL/type/length', field => {
    const max = field === 'evidenceText' ? 2000 : 400;
    for (const value of ['', 'x', '  ', 'ok\0', 'ok\uD800', 'ok\uDC00', 'x'.repeat(max + 1),
      '\uD83D\uDE80'.repeat(max / 2 + 1), null, 42]) {
      expect(() => validateStoryInteractionEvidence(source, { ...evidence(), [field]: value } as StoryInteractionEvidence))
        .toThrow(BadRequestException);
    }
  });

  it('accepts exact evidence/memory length boundaries and rejects the effective 401-character dialogue limit', () => {
    const text = 'x'.repeat(2000), memoryText = 'm'.repeat(400);
    expect(validateStoryInteractionEvidence(text, evidence({ evidenceStart: 0, evidenceText: text, memoryText })))
      .toMatchObject({ evidenceText: text, memoryText });
    const dialogue = 'd'.repeat(400);
    expect(validateStoryInteractionEvidence(dialogue, evidence({ evidenceStart: 0, interactionKind: 'dialogue',
      evidenceText: dialogue, memoryText: dialogue }))).toMatchObject({ memoryText: dialogue });
    expect(() => validateStoryInteractionEvidence(`${dialogue}d`, evidence({ evidenceStart: 0,
      interactionKind: 'dialogue', evidenceText: `${dialogue}d`, memoryText: `${dialogue}d` }))).toThrow(BadRequestException);
  });

  it.each(['', 'ok\0', 'ok\uD800', 'ok\uDC00', 'x'.repeat(64001)])('rejects malformed source independently (case %#)', text => {
    expect(() => validateStoryInteractionEvidence(text, evidence())).toThrow(ConflictException);
  });
});

describe('interaction approval controller metadata and DTOs (no HTTP server)', () => {
  const valid = { artistId, locale: 'en', idempotencyKey: key, expectedSourceChecksum: 'a'.repeat(64),
    expectedIdentityPinHash: 'b'.repeat(64), ...evidence() };

  it('requires JWT and private/no-store on every route, with UUID pipes and exact DTO parameter types', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StoryInteractionApprovalController)).toBe(
      'me/creator-studio/stories/:workId/interactions');
    expect(Reflect.getMetadata(GUARDS_METADATA, StoryInteractionApprovalController)).toEqual([JwtAuthGuard]);
    for (const [method, path, verb, dto, targetParam] of [
      ['review', 'beats/:beatId', RequestMethod.GET, StoryInteractionReviewQueryDto, 'beatId'],
      ['approve', 'beats/:beatId/approve', RequestMethod.POST, ApproveStoryInteractionDto, 'beatId'],
      ['revoke', ':approvalId/revoke', RequestMethod.POST, RevokeStoryInteractionDto, 'approvalId'],
    ] as const) {
      const handler = StoryInteractionApprovalController.prototype[method];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
      expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
      expect(Reflect.getMetadata(PARAMTYPES_METADATA, StoryInteractionApprovalController.prototype, method)[3]).toBe(dto);
      const args = Object.values(Reflect.getMetadata(ROUTE_ARGS_METADATA, StoryInteractionApprovalController, method)) as
        Array<{ data?: string; pipes?: unknown[] }>;
      for (const name of ['workId', targetParam]) expect(args).toContainEqual(expect.objectContaining({ data: name, pipes: [ParseUUIDPipe] }));
    }
  });

  it('forwards only the authenticated user ID, scoped IDs and unchanged payload', async () => {
    const approvals = { review: jest.fn().mockResolvedValue({}), approve: jest.fn().mockResolvedValue({}), revoke: jest.fn().mockResolvedValue({}) };
    const controller = new StoryInteractionApprovalController(approvals as never);
    const user = { id: owner, ownerUserId: other };
    const query = { artistId, locale: 'ja' };
    const withdrawal = { expectedRevision: 1, expectedApprovalChecksum: 'c'.repeat(64) };
    await controller.review(user as never, workId, beatId, query);
    await controller.approve(user as never, workId, beatId, valid);
    await controller.revoke(user as never, workId, approvalId, withdrawal);
    expect(approvals.review).toHaveBeenCalledWith(owner, workId, beatId, query);
    expect(approvals.approve).toHaveBeenCalledWith(owner, workId, beatId, valid);
    expect(approvals.revoke).toHaveBeenCalledWith(owner, workId, approvalId, withdrawal);
  });

  it.each(locales)('accepts exact %s review/approval DTOs and revision-one revoke DTO', async locale => {
    expect(await validate(plainToInstance(StoryInteractionReviewQueryDto, { artistId, locale }))).toEqual([]);
    expect(await validate(plainToInstance(ApproveStoryInteractionDto, { ...valid, locale }))).toEqual([]);
    expect(await validate(plainToInstance(RevokeStoryInteractionDto, {
      expectedRevision: 1, expectedApprovalChecksum: 'c'.repeat(64) }))).toEqual([]);
  });

  it('rejects malformed/missing inherited and approval fields without boolean or number coercion', async () => {
    for (const [field, values] of Object.entries({ artistId: [undefined, 'bad', `${artistId}\0`],
      locale: [undefined, 'en-US', 'zh', 'zh-hans'], idempotencyKey: [undefined, 'bad'],
      expectedSourceChecksum: [undefined, 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)],
      expectedIdentityPinHash: [undefined, 'bad'], interactionKind: [undefined, 'thought', 'ACTION'],
      evidenceStart: [undefined, -1, 0.5, 64001, '3'], evidenceText: [undefined, 42, 'x'.repeat(2001)],
      memoryText: [undefined, 42, 'x'.repeat(401)], interactionReviewed: [undefined, false, 'true', 1] })) {
      for (const value of values) expect(await validate(plainToInstance(ApproveStoryInteractionDto, { ...valid, [field]: value })))
        .not.toEqual([]);
    }
    for (const expectedRevision of [undefined, 0, 2, 1.5, '1']) expect(await validate(plainToInstance(RevokeStoryInteractionDto, {
      expectedRevision, expectedApprovalChecksum: 'c'.repeat(64) }))).not.toEqual([]);
    expect(await validate(plainToInstance(RevokeStoryInteractionDto, { expectedRevision: 1,
      expectedApprovalChecksum: 'C'.repeat(64) }))).not.toEqual([]);
  });

  it('strict validation rejects forged ownership, status and memory-application fields', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    for (const extras of [{ ownerUserId: other }, { workId: other }, { status: 'approved' }, { readerMemoryApplied: true }]) {
      await expect(pipe.transform({ ...valid, ...extras }, { type: 'body', metatype: ApproveStoryInteractionDto }))
        .rejects.toBeInstanceOf(BadRequestException);
    }
    // DTO decorators bound transport fields; exact quote, NUL, Unicode and consent semantics stay in policy/service.
    expect(await validate(plainToInstance(ApproveStoryInteractionDto, { ...valid, evidenceText: 'ok\0' }))).toEqual([]);
    expect(() => validateStoryInteractionEvidence(source, { ...valid, evidenceText: 'ok\0' })).toThrow(BadRequestException);
  });
});
