import { Prisma } from '@prisma/client';
import {
  assertCreatorGenerationProfileApprovable, creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';
import {
  canonicalReadScopeChecksum, canonicalReadTextHash, StoryCanonicalReadIdentity,
} from '../story-production/story-canonical-read.policy';
import { canonicalStorySourceChecksum } from '../story-production/story-canonical-source.policy';
import {
  StoryInteractionEvidence, storyInteractionApprovalChecksum, validateStoryInteractionEvidence,
} from '../story-production/story-interaction-approval.policy';
import { releaseChecksum } from '../story-production/story-lifecycle.policy';
import { STORY_LOCALES } from '../story-production/story-production.policy';
import { CanonicalMemoryProgress, loadCanonicalStoryMemory } from './story-chat-canonical-memory';

const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const ids = {
  user: uuid(1), owner: uuid(2), artist: uuid(3), work: uuid(4), release: uuid(5), manuscript: uuid(6),
  profile: uuid(7), progress: uuid(8), part: uuid(9), scene: uuid(10), beat: uuid(11),
  root: uuid(12), receipt: uuid(13), approval: uuid(14), other: uuid(15),
};
const now = new Date('2026-10-01T00:00:00.000Z');
const actionQuote = 'Mira opened the door.';
const dialogueQuote = '  Stay here.  ';
const source = `\uD83D\uDE80 ${actionQuote}\nMira: ${dialogueQuote}`;
const empty = { items: [], fingerprint: releaseChecksum([]) };

type Row = Record<string, unknown>;
type Query = { where: Row; take?: number; select?: Row };

// Delegate filters and raw-query filter/dedup doubles model the fixture contract only.
// They do not execute SQL or replace PostgreSQL scope, DISTINCT/LIMIT, or isolation tests.
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return (expected as Row[]).some(clause => matches(row, clause));
    const actual = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const condition = expected as Row;
      if ('is' in condition) return !!actual && matches(actual as Row, condition.is as Row);
      if ('in' in condition) return (condition.in as unknown[]).includes(actual);
      return Object.entries(condition).every(([operator, value]) => {
        const left = actual instanceof Date ? actual.getTime() : actual as number;
        const right = value instanceof Date ? value.getTime() : value as number;
        if (operator === 'gte') return left >= right;
        if (operator === 'lte') return left <= right;
        if (operator === 'gt') return left > right;
        if (operator === 'not') return actual !== value;
        throw new Error(`Unsupported fixture predicate: ${operator}`);
      });
    }
    return actual === expected;
  });
}

function fixture(locale: string = 'en', kind: 'action' | 'dialogue' = 'action') {
  const input = { userId: ids.user, artistId: ids.artist };
  const work = { id: ids.work, ownerUserId: ids.owner, activeReleaseId: ids.release, publishedVersion: 2,
    status: 'published', fixtureSource: false, slug: 'door-at-dawn', coverManifest: {},
    title: { en: 'Door at Dawn' }, priceLumina: new Prisma.Decimal(0) };
  const manuscript = { id: ids.manuscript, workId: ids.work, ownerUserId: ids.owner,
    contentHash: canonicalReadTextHash(source) };
  const release = { id: ids.release, workId: ids.work, manuscriptVersionId: ids.manuscript,
    version: 2, status: 'active', checksum: releaseChecksum({ manuscriptHash: manuscript.contentHash, version: 2 }) };
  const part = { id: ids.part, workId: ids.work, position: 1, actNumber: 2,
    status: 'published', fixtureSource: false, priceLumina: new Prisma.Decimal(0) };
  const scene = { id: ids.scene, partId: ids.part, sceneKey: 'door', position: 2,
    status: 'published', fixtureSource: false, title: { en: 'The Door' }, visualManifest: {} };
  const beat = { id: ids.beat, sceneId: ids.scene, position: 3, beatType: 'paragraph', sourceSceneKey: 'manuscript-door',
    content: Object.fromEntries(STORY_LOCALES.map(language => [language, `${source}\n${language}`])) as Record<string, unknown> };
  const artist = { id: ids.artist, displayName: 'Mira', status: 'active' };
  const settings = normalizeCreatorGenerationProfile('artist', {
    schemaVersion: 'creator-generation-profile-v1', kind: 'artist',
    sections: ['fixed_identity', 'adaptable_presentation'].map(key => ({
      key, decision: 'accepted', value: { description: 'Reviewed identity' }, evidence: [],
    })),
  });
  assertCreatorGenerationProfileApprovable(settings);
  const profile = { id: ids.profile, artistId: ids.artist, profileVersion: 2, reviewRevision: 3,
    status: 'approved', approvedAt: now as Date | null, approvedByUserId: ids.owner as string | null,
    approvedSettings: settings as unknown, sourceFingerprint: releaseChecksum({ artist: 'Mira', revision: 3 }),
    approvedFingerprint: '' };
  profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, settings);
  const pin = () => ({ identityProfileId: profile.id, identityProfileVersion: profile.profileVersion,
    identityReviewRevision: profile.reviewRevision, identitySourceFingerprint: profile.sourceFingerprint,
    identityApprovedFingerprint: profile.approvedFingerprint });
  const progress: CanonicalMemoryProgress & { currentBeatPosition: number; pathSummary: unknown[] } = {
    id: ids.progress, workId: ids.work, activeReleaseId: ids.release, routeNodeId: ids.root,
    progressRevision: 7, storyVersion: 2, participantArtist: pin(), currentBeatPosition: 0, pathSummary: [],
  };
  const reader = { ...progress, userId: ids.user, status: 'active',
    participantArtist: { artistId: ids.artist, ...pin() } };
  const routes = [{ id: ids.root, routeHash: releaseChecksum({ root: ids.root }), targetSceneId: ids.scene, depth: 0 }];
  const sourceChecksum = canonicalStorySourceChecksum({ workId: work.id, ownerUserId: work.ownerUserId,
    releaseId: release.id, releaseChecksum: release.checksum, manuscriptVersionId: manuscript.id,
    manuscriptHash: manuscript.contentHash, partId: part.id, partPosition: part.position,
    sceneId: scene.id, sceneKey: scene.sceneKey, scenePosition: scene.position, beatId: beat.id,
    beatPosition: beat.position, beatType: beat.beatType, sourceSceneKey: beat.sourceSceneKey,
    locale, sourceText: beat.content[locale] as string });
  const readIdentity: StoryCanonicalReadIdentity = { userId: ids.user, progressId: progress.id,
    workId: work.id, ownerUserId: work.ownerUserId, releaseId: release.id, releaseChecksum: release.checksum,
    manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash, partId: part.id,
    sceneId: scene.id, beatId: beat.id, beatPosition: beat.position, actNumber: part.actNumber,
    locale, sourceChecksum, sourceTextHash: canonicalReadTextHash(beat.content[locale] as string),
    routeNodeId: ids.root, routeHash: routes[0].routeHash, storyVersion: progress.storyVersion,
    progressRevision: progress.progressRevision };
  const receipt = { ...readIdentity, id: ids.receipt, scopeChecksum: canonicalReadScopeChecksum(readIdentity),
    idempotencyKey: uuid(16), confirmedAt: now, invalidatedAt: null as Date | null, resetCommandId: null as string | null };
  const identityPinHash = () => releaseChecksum({ artistId: artist.id, displayName: artist.displayName,
    identityProfileId: profile.id, profileVersion: profile.profileVersion, reviewRevision: profile.reviewRevision,
    sourceFingerprint: profile.sourceFingerprint, approvedFingerprint: profile.approvedFingerprint });
  const approvalIdentity = () => ({ ownerUserId: work.ownerUserId, workId: work.id, releaseId: release.id,
    releaseChecksum: release.checksum, manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash,
    partId: part.id, sceneId: scene.id, beatId: beat.id, artistId: artist.id, identityProfileId: profile.id,
    identityPinHash: identityPinHash(), locale, sourceChecksum });
  const evidence: StoryInteractionEvidence = { interactionKind: kind,
    evidenceStart: kind === 'action' ? 3 : source.indexOf(dialogueQuote),
    evidenceText: kind === 'action' ? actionQuote : dialogueQuote,
    memoryText: kind === 'action' ? 'Mira opened the door for me.' : dialogueQuote, interactionReviewed: true };
  const checkedEvidence = validateStoryInteractionEvidence(beat.content[locale] as string, evidence);
  const approval = { ...approvalIdentity(), ...checkedEvidence, id: ids.approval,
    approvalChecksum: storyInteractionApprovalChecksum(approvalIdentity(), checkedEvidence),
    idempotencyKey: uuid(17), status: 'approved', revision: 1, approvedAt: now,
    revokedAt: null as Date | null, createdAt: now };
  const receipts = [receipt], approvals = [approval];
  const entitlements: Array<{ userId: string; entitlementType: string; referenceId: string;
    revokedAt: Date | null; startsAt: Date; expiresAt: Date | null }> = [];
  const first = (row: Row) => jest.fn(async ({ where }: Query) => matches(row, where) ? row : null);
  const many = <T extends Row>(rows: T[]) => jest.fn(async ({ where, take }: Query) =>
    rows.filter(row => matches(row, where)).slice(0, take));
  const ancestryQuery = jest.fn(async (_sql: TemplateStringsArray, ..._values: unknown[]) => routes);
  const approvalQuery = jest.fn(async (query: Prisma.Sql) => {
    const [workId, ownerUserId, releaseId, releaseChecksum, manuscriptVersionId, manuscriptHash,
      artistId, identityProfileId, identityPinHash, ...scopeValues] = query.values;
    if (!scopeValues.length || scopeValues.length % 3) throw new Error('Expected nonempty receipt scope triples');
    const scopes: Row[] = [];
    for (let index = 0; index < scopeValues.length; index += 3) {
      scopes.push({ beatId: scopeValues[index], locale: scopeValues[index + 1], sourceChecksum: scopeValues[index + 2] });
    }
    const scoped = approvals.filter(row => matches(row, { workId, ownerUserId, releaseId, releaseChecksum,
      manuscriptVersionId, manuscriptHash, artistId, identityProfileId, identityPinHash,
      status: 'approved', revision: 1, revokedAt: null, OR: scopes }))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
    const checksums = new Set<string>();
    return scoped.filter(row => {
      if (checksums.has(row.approvalChecksum)) return false;
      checksums.add(row.approvalChecksum);
      return true;
    }).slice(0, 480);
  });
  const db = {
    $executeRaw: jest.fn(async (_sql: Prisma.Sql) => 0),
    $queryRaw: jest.fn(async (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) =>
      Array.isArray(query) ? ancestryQuery(query as TemplateStringsArray, ...values) : approvalQuery(query as Prisma.Sql)),
    storyReaderProgress: { findFirst: jest.fn(async ({ where }: Query) => {
      if (!matches(reader, where)) return null;
      const { artistId: _artistId, ...identity } = reader.participantArtist;
      return { participantArtist: identity };
    }) },
    storyWork: { findFirst: first(work) }, storyRelease: { findFirst: first(release) },
    storyManuscriptVersion: { findFirst: first(manuscript) }, artist: { findFirst: first(artist) },
    artistStoryIdentityProfile: { findFirst: first(profile) },
    storyCanonicalReadReceipt: { findMany: many(receipts) },
    storyInteractionApproval: { findMany: jest.fn(() => { throw new Error('Client-side approval lookup forbidden'); }) },
    storyBeat: { findMany: many([beat]) },
    storyScene: { findMany: many([scene]) }, storyPart: { findMany: many([part]) },
    userEntitlement: { findMany: many(entitlements) },
  };
  const prisma = { $transaction: jest.fn(async (run: (tx: typeof db) => Promise<unknown>, _options: unknown) => run(db)) };
  const load = () => loadCanonicalStoryMemory(prisma as never, input, progress);
  const item = { workTitle: 'Door at Dawn', sceneTitle: 'The Door', artistDialogue: evidence.memoryText,
    interactionKind: kind, evidenceSource: 'canonical_author_approved' };
  const proof = () => ({ receiptId: receipt.id, scopeChecksum: receipt.scopeChecksum,
    approvalId: approval.id, approvalChecksum: approval.approvalChecksum });
  const resignReceipt = () => {
    const identity = Object.fromEntries(Object.keys(readIdentity).map(key => [key, receipt[key as keyof typeof receipt]]));
    receipt.scopeChecksum = canonicalReadScopeChecksum(identity as StoryCanonicalReadIdentity);
  };
  const resignApproval = () => {
    const identity = Object.fromEntries(Object.keys(approvalIdentity()).map(key => [key, approval[key as keyof typeof approval]]));
    const storedEvidence = { interactionKind: approval.interactionKind, evidenceStart: approval.evidenceStart,
      evidenceText: approval.evidenceText, memoryText: approval.memoryText };
    approval.approvalChecksum = storyInteractionApprovalChecksum(identity, storedEvidence);
  };
  return { input, work, release, manuscript, part, scene, beat, artist, profile, settings, progress, reader,
    routes, receipt, approval, receipts, approvals, entitlements, db, prisma, load, item, proof,
    ancestryQuery, approvalQuery,
    pin, identityPinHash, resignReceipt, resignApproval };
}

describe('loadCanonicalStoryMemory isolated reader/author proof', () => {
  it.each(['action', 'dialogue'] as const)('accepts approved %s at the current root even with cursor zero', async kind => {
    const f = fixture('en', kind);
    expect(f.progress.currentBeatPosition).toBe(0);
    expect(await f.load()).toEqual({ items: [f.item], fingerprint: releaseChecksum({ items: [f.item], proof: [f.proof()] }) });
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 });
    expect(f.db.$executeRaw.mock.calls[0][0].sql).toBe('SET TRANSACTION READ ONLY');
  });

  it.each(STORY_LOCALES)('accepts only matching exact %s receipt and author approval', async locale => {
    const f = fixture(locale);
    expect((await f.load()).items).toEqual([f.item]);
  });

  it('accepts completed progress at the root without a path summary or moved cursor', async () => {
    const f = fixture(); f.reader.status = 'completed';
    expect(f.progress.pathSummary).toEqual([]);
    expect(f.progress.currentBeatPosition).toBe(0);
    expect((await f.load()).items).toEqual([f.item]);
  });

  it('compares equal participant pins independently of JSON property order', async () => {
    const f = fixture();
    const original = f.progress.participantArtist!;
    f.progress.participantArtist = {
      identityApprovedFingerprint: original.identityApprovedFingerprint,
      identitySourceFingerprint: original.identitySourceFingerprint,
      identityReviewRevision: original.identityReviewRevision,
      identityProfileVersion: original.identityProfileVersion,
      identityProfileId: original.identityProfileId,
    };
    expect(f.progress.participantArtist).toEqual(original);
    expect((await f.load()).items).toEqual([f.item]);
  });

  it.each([1, 6, 7])('accepts an ancestor receipt at revision %s no later than current revision', async revision => {
    const f = fixture();
    f.progress.routeNodeId = ids.other; f.reader.routeNodeId = ids.other;
    f.routes.unshift({ id: ids.other, routeHash: releaseChecksum({ child: ids.other }), targetSceneId: uuid(18), depth: 1 });
    f.receipt.progressRevision = revision; f.resignReceipt();
    expect((await f.load()).items).toEqual([f.item]);
    const [sql, ...values] = f.ancestryQuery.mock.calls[0];
    expect(sql.join(' ')).toContain('WITH RECURSIVE ancestry');
    expect(sql.join(' ')).toContain('n.depth = a.depth - 1');
    expect(sql.join(' ')).toContain('a.distance < 12');
    expect(values).toEqual([ids.other, ids.progress, ids.work, ids.release, ids.progress, ids.work, ids.release]);
    expect(f.db.storyCanonicalReadReceipt.findMany.mock.calls[0][0].where.routeNodeId).toEqual({ in: [ids.other, ids.root] });
  });

  it('binds account, progress, release, manuscript and current artist approval in scoped queries', async () => {
    const f = fixture(); await f.load();
    expect(f.db.storyReaderProgress.findFirst.mock.calls[0][0].where).toMatchObject({ id: ids.progress,
      userId: ids.user, workId: ids.work, activeReleaseId: ids.release, routeNodeId: ids.root,
      storyVersion: 2, progressRevision: 7, participantArtist: { is: { artistId: ids.artist } } });
    expect(f.db.storyCanonicalReadReceipt.findMany.mock.calls[0][0]).toEqual({ take: 240,
      orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }],
      where: { userId: ids.user, progressId: ids.progress, ownerUserId: ids.owner, workId: ids.work,
        releaseId: ids.release, releaseChecksum: f.release.checksum, manuscriptVersionId: ids.manuscript,
        manuscriptHash: f.manuscript.contentHash, storyVersion: 2, routeNodeId: { in: [ids.root] },
        invalidatedAt: null, resetCommandId: null } });
    expect(f.approvalQuery.mock.calls[0][0].values).toEqual([ids.work, ids.owner, ids.release, f.release.checksum,
      ids.manuscript, f.manuscript.contentHash, ids.artist, ids.profile, f.identityPinHash(),
      ids.beat, f.receipt.locale, f.receipt.sourceChecksum]);
    expect(f.db.storyInteractionApproval.findMany).not.toHaveBeenCalled();
    expect(f.db.artistStoryIdentityProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { artistId: ids.artist }, orderBy: { profileVersion: 'desc' } }));
  });

  it('parameterizes every approval scope/pin and applies exact receipt OR and SQL DISTINCT before the unique limit', async () => {
    const f = fixture();
    const translated = fixture('ja');
    f.receipts.push({ ...f.receipt, id: uuid(20) }, { ...translated.receipt, id: uuid(21) });
    expect((await f.load()).items).toEqual([f.item]);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(Array.isArray(f.db.$queryRaw.mock.calls[0][0])).toBe(true);
    expect(Array.isArray(f.db.$queryRaw.mock.calls[1][0])).toBe(false);
    expect(f.db.$queryRaw.mock.calls[1]).toEqual([f.approvalQuery.mock.calls[0][0]]);
    const query = f.approvalQuery.mock.calls[0][0];
    const sql = query.sql.replace(/\s+/g, ' ').trim();
    expect(query.values).toEqual([ids.work, ids.owner, ids.release, f.release.checksum,
      ids.manuscript, f.manuscript.contentHash, ids.artist, ids.profile, f.identityPinHash(),
      ids.beat, 'en', f.receipt.sourceChecksum, ids.beat, 'ja', translated.receipt.sourceChecksum]);
    expect(sql).toMatch(/^SELECT \* FROM \( SELECT DISTINCT ON \(approval_checksum\)/);
    expect(sql).toContain('FROM story_interaction_approvals WHERE work_id = ?::uuid AND owner_user_id = ?::uuid');
    expect(sql).toContain('AND release_id = ?::uuid AND release_checksum = ?');
    expect(sql).toContain('AND manuscript_version_id = ?::uuid AND manuscript_hash = ?');
    expect(sql).toContain('AND artist_id = ?::uuid AND identity_profile_id = ?::uuid AND identity_pin_hash = ?');
    expect(sql).toContain("AND status = 'approved' AND revision = 1 AND revoked_at IS NULL AND ((beat_id = ?::uuid AND locale = ? AND source_checksum = ?) OR (beat_id = ?::uuid AND locale = ? AND source_checksum = ?))");
    expect(sql).toMatch(/ORDER BY approval_checksum, created_at DESC, id DESC \) approved ORDER BY "createdAt" DESC, id DESC LIMIT 480$/);
    expect(sql.match(/\bLIMIT\b/g)).toHaveLength(1);
    expect(sql.indexOf('WHERE work_id')).toBeLessThan(sql.indexOf('LIMIT 480'));
    expect(sql).not.toContain(ids.work);
    expect(sql).not.toContain(f.receipt.sourceChecksum);
    expect(sql).not.toContain(f.identityPinHash());
    expect(f.db.storyInteractionApproval.findMany).not.toHaveBeenCalled();
  });

  it('keeps untrusted locale scope text in SQL parameters rather than interpolating it', async () => {
    const f = fixture(); const untrusted = "en' OR TRUE --";
    f.receipt.locale = untrusted; f.resignReceipt();
    expect(await f.load()).toEqual(empty);
    const query = f.approvalQuery.mock.calls[0][0];
    expect(query.values).toContain(untrusted);
    expect(query.sql).not.toContain(untrusted);
  });

  it('loads verified memory using only required source projections, without manuscript bodies or release graphs', async () => {
    const f = fixture();
    const project = (row: Row, fields: string[]) => Object.fromEntries(fields.map(field => [field, row[field]]));
    const first: Array<[jest.Mock, Row, string[]]> = [
      [f.db.storyWork.findFirst, f.work, ['id', 'ownerUserId', 'slug', 'fixtureSource', 'coverManifest', 'title', 'priceLumina']],
      [f.db.storyRelease.findFirst, f.release, ['id', 'checksum', 'manuscriptVersionId']],
      [f.db.storyManuscriptVersion.findFirst, f.manuscript, ['id', 'contentHash']],
      [f.db.artist.findFirst, f.artist, ['id', 'displayName']],
      [f.db.artistStoryIdentityProfile.findFirst, f.profile, ['id', 'status', 'approvedAt', 'approvedByUserId',
        'approvedSettings', 'approvedFingerprint', 'sourceFingerprint', 'profileVersion', 'reviewRevision']],
    ];
    const many: Array<[jest.Mock, Row[], string[]]> = [
      [f.db.storyBeat.findMany, [f.beat], ['id', 'sceneId', 'position', 'beatType', 'content', 'sourceSceneKey']],
      [f.db.storyScene.findMany, [f.scene], ['id', 'partId', 'sceneKey', 'position', 'title', 'visualManifest']],
      [f.db.storyPart.findMany, [f.part], ['id', 'position', 'actNumber', 'priceLumina']],
    ];
    for (const [delegate, row, fields] of first) {
      delegate.mockImplementation(async ({ where, select }: Query) => {
        expect(select).toEqual(Object.fromEntries(fields.map(field => [field, true])));
        return matches(row, where) ? project(row, fields) : null;
      });
    }
    for (const [delegate, rows, fields] of many) {
      delegate.mockImplementation(async ({ where, select }: Query) => {
        expect(select).toEqual(Object.fromEntries(fields.map(field => [field, true])));
        return rows.filter(row => matches(row, where)).map(row => project(row, fields));
      });
    }
    expect(await f.load()).toEqual({ items: [f.item],
      fingerprint: releaseChecksum({ items: [f.item], proof: [f.proof()] }) });
    for (const [delegate] of [...first, ...many]) expect(delegate).toHaveBeenCalledTimes(1);
  });

  it.each(['user', 'artist', 'progress', 'work', 'release', 'route', 'profile', 'missing-pin']) (
    'returns empty before opening a transaction for invalid %s UUID/pin', async field => {
      const f = fixture();
      if (field === 'user') f.input.userId = 'user-1';
      if (field === 'artist') f.input.artistId = 'artist-1';
      if (field === 'progress') f.progress.id = 'progress-1';
      if (field === 'work') f.progress.workId = 'work-1';
      if (field === 'release') f.progress.activeReleaseId = null;
      if (field === 'route') f.progress.routeNodeId = 'route-1';
      if (field === 'profile') f.progress.participantArtist!.identityProfileId = 'profile-1';
      if (field === 'missing-pin') f.progress.participantArtist = null;
      expect(await f.load()).toEqual(empty);
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
    });

  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid progress revision/version %s before TX', async value => {
    for (const field of ['progressRevision', 'storyVersion'] as const) {
      const f = fixture(); f.progress[field] = value;
      expect(await f.load()).toEqual(empty); expect(f.prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it.each(['receipt', 'approval'])('requires a %s instead of legacy cursors or colon attribution', async missing => {
    const f = fixture();
    f.progress.currentBeatPosition = 40;
    f.progress.pathSummary = [{ sceneId: ids.scene, readBeatPosition: 40 }];
    if (missing === 'receipt') f.receipts.length = 0; else f.approvals.length = 0;
    expect(await f.load()).toEqual(empty);
  });

  it.each(['userId', 'status', 'routeNodeId', 'progressRevision', 'activeReleaseId', 'storyVersion', 'artist', 'pin']) (
    'rejects changed current progress %s', async field => {
      const f = fixture();
      if (field === 'artist') f.reader.participantArtist.artistId = ids.other;
      else if (field === 'pin') f.reader.participantArtist.identityApprovedFingerprint = releaseChecksum('new pin');
      else Object.assign(f.reader, { [field]: field === 'status' ? 'reset' :
        field === 'progressRevision' || field === 'storyVersion' ? 8 : ids.other });
      expect(await f.load()).toEqual(empty);
      expect(f.db.storyWork.findFirst).not.toHaveBeenCalled();
    });

  it.each(['identityProfileId', 'identityProfileVersion', 'identityReviewRevision',
    'identitySourceFingerprint', 'identityApprovedFingerprint'] as const)(
    'rejects a changed current database participant field: %s', async field => {
      const f = fixture();
      Object.assign(f.reader.participantArtist, { [field]: field === 'identityProfileVersion' ||
        field === 'identityReviewRevision' ? 99 : field === 'identityProfileId' ? ids.other : releaseChecksum(`new ${field}`) });
      expect(await f.load()).toEqual(empty);
      expect(f.db.storyWork.findFirst).not.toHaveBeenCalled();
      expect(f.db.storyCanonicalReadReceipt.findMany).not.toHaveBeenCalled();
    });

  it.each(['absent', 'invalid-id', 'invalid-hash', 'no-target', 'other-target'])('rejects %s route ancestry', async change => {
    const f = fixture();
    if (change === 'absent') f.routes.length = 0;
    if (change === 'invalid-id') f.routes[0].id = 'not-a-uuid';
    if (change === 'invalid-hash') f.routes[0].routeHash = 'invalid';
    if (change === 'no-target') f.routes[0].targetSceneId = '';
    if (change === 'other-target') f.routes[0].targetSceneId = ids.other;
    expect(await f.load()).toEqual(empty);
  });

  it.each(['userId', 'progressId', 'workId', 'ownerUserId', 'releaseId', 'releaseChecksum',
    'manuscriptVersionId', 'manuscriptHash', 'partId', 'sceneId', 'beatId', 'beatPosition', 'actNumber',
    'routeNodeId', 'routeHash', 'storyVersion', 'sourceChecksum', 'sourceTextHash', 'scopeChecksum'] as const)(
    'rechecks stored receipt %s even if a delegate returns an out-of-scope row', async field => {
      const f = fixture();
      Object.assign(f.receipt, { [field]: ['beatPosition', 'actNumber', 'storyVersion'].includes(field) ? 39 :
        /Hash|Checksum/.test(field) ? releaseChecksum(`wrong ${field}`) : ids.other });
      if (field !== 'scopeChecksum') f.resignReceipt();
      f.db.storyCanonicalReadReceipt.findMany.mockResolvedValueOnce([f.receipt]);
      expect(await f.load()).toEqual(empty);
    });

  it.each([0, -1, 1.5, 8, Number.MAX_SAFE_INTEGER + 1])('rejects a checksum-valid invalid/future receipt revision %s', async revision => {
    const f = fixture(); f.receipt.progressRevision = revision; f.resignReceipt();
    expect(await f.load()).toEqual(empty);
  });

  it.each(['invalidated', 'reset'])('rejects %s receipts even when returned by the delegate', async change => {
    const f = fixture();
    if (change === 'invalidated') f.receipt.invalidatedAt = now; else f.receipt.resetCommandId = ids.other;
    f.db.storyCanonicalReadReceipt.findMany.mockResolvedValueOnce([f.receipt]);
    expect(await f.load()).toEqual(empty);
  });

  it.each(['ownerUserId', 'workId', 'releaseId', 'releaseChecksum', 'manuscriptVersionId', 'manuscriptHash',
    'partId', 'sceneId', 'beatId', 'artistId', 'identityProfileId', 'identityPinHash', 'locale',
    'sourceChecksum', 'approvalChecksum'] as const)('rechecks stored author approval %s', async field => {
      const f = fixture();
      Object.assign(f.approval, { [field]: field === 'locale' ? 'ja' :
        /Hash|Checksum/.test(field) ? releaseChecksum(`wrong ${field}`) : ids.other });
      if (field !== 'approvalChecksum') f.resignApproval();
      f.approvalQuery.mockResolvedValueOnce([f.approval]);
      expect(await f.load()).toEqual(empty);
    });

  it.each([{ status: 'revoked' }, { status: 'proposed' }, { revision: 2 }, { revokedAt: now }]) (
    'rejects revoked/unapproved event consent (case %#)', async change => {
      const f = fixture(); Object.assign(f.approval, change);
      f.approvalQuery.mockResolvedValueOnce([f.approval]);
      expect(await f.load()).toEqual(empty);
    });

  it.each(['KO', 'en-US', 'zh', 'zh-hans', ''])('rejects nonexact receipt locale %s despite valid scope checksum', async locale => {
    const f = fixture(); f.receipt.locale = locale; f.resignReceipt();
    expect(await f.load()).toEqual(empty);
  });

  it('does not apply a hash-valid author approval from another locale with identical evidence', async () => {
    const f = fixture(); f.approval.locale = 'ja'; f.resignApproval();
    expect(await f.load()).toEqual(empty);
  });

  it.each(['missing', 'mutated', 'whitespace', 'source-key', 'scene-key', 'part-position']) (
    'rejects %s exact source instead of falling back or normalizing', async change => {
      const f = fixture();
      if (change === 'missing') delete f.beat.content.en;
      if (change === 'mutated') f.beat.content.en = `${f.beat.content.en}\nChanged source`;
      if (change === 'whitespace') f.beat.content.en = ` ${f.beat.content.en}`;
      if (change === 'source-key') f.beat.sourceSceneKey = 'other-source';
      if (change === 'scene-key') f.scene.sceneKey = 'other-scene';
      if (change === 'part-position') f.part.position = 2;
      expect(await f.load()).toEqual(empty);
    });

  it.each(['', 'x', 'ok\0', 'ok\uD800', 'x'.repeat(64001), null, 42])('rejects malformed exact source (case %#)', async value => {
    const f = fixture(); f.beat.content.en = value;
    expect(await f.load()).toEqual(empty);
  });

  it.each(['offset', 'quote', 'memory', 'kind', 'paraphrased-dialogue']) (
    'uses actual evidence validation even with a recomputed checksum: %s', async change => {
      const f = fixture('en', change === 'paraphrased-dialogue' ? 'dialogue' : 'action');
      if (change === 'offset') f.approval.evidenceStart = 2;
      if (change === 'quote') f.approval.evidenceText = 'Mira closed the door.';
      if (change === 'memory') f.approval.memoryText = 'x'.repeat(401);
      if (change === 'kind') Object.assign(f.approval, { interactionKind: 'thought' });
      if (change === 'paraphrased-dialogue') f.approval.memoryText = dialogueQuote.trim();
      f.resignApproval(); expect(await f.load()).toEqual(empty);
    });

  it.each(['draft', 'no-date', 'no-reviewer', 'no-settings', 'schema', 'settings-mutated', 'fingerprint', 'source-hash', 'review']) (
    'rejects invalid current artist approval: %s', async change => {
      const f = fixture();
      if (change === 'draft') f.profile.status = 'draft';
      if (change === 'no-date') f.profile.approvedAt = null;
      if (change === 'no-reviewer') f.profile.approvedByUserId = null;
      if (change === 'no-settings') f.profile.approvedSettings = null;
      if (change === 'schema') f.profile.approvedSettings = { schemaVersion: 'invalid' };
      if (change === 'settings-mutated') f.settings.sections[0].value.description = 'Changed identity settings';
      if (change === 'fingerprint') f.profile.approvedFingerprint = releaseChecksum('wrong approved settings');
      if (change === 'source-hash') f.profile.sourceFingerprint = 'invalid';
      if (change === 'review') f.profile.reviewRevision = 0;
      f.progress.participantArtist = f.pin(); Object.assign(f.reader.participantArtist, f.pin());
      Object.assign(f.approval, { identityPinHash: f.identityPinHash() }); f.resignApproval();
      expect(await f.load()).toEqual(empty);
    });

  it.each(['missing-section', 'proposed', 'unknown', 'removed'])('rejects hash-valid incomplete settings: %s', async change => {
    const f = fixture();
    if (change === 'missing-section') f.settings.sections.pop();
    else f.settings.sections[0].decision = change as 'proposed' | 'unknown' | 'removed';
    f.profile.approvedFingerprint = creatorGenerationProfileFingerprint(f.profile.sourceFingerprint, f.settings);
    f.progress.participantArtist = f.pin(); Object.assign(f.reader.participantArtist, f.pin());
    f.approval.identityPinHash = f.identityPinHash(); f.resignApproval();
    expect(() => assertCreatorGenerationProfileApprovable(f.settings)).toThrow();
    expect(await f.load()).toEqual(empty);
  });

  it.each(['name', 'profile-version', 'review-revision', 'source-fingerprint', 'approved-fingerprint', 'inactive']) (
    'rejects changed current artist pin: %s', async change => {
      const f = fixture();
      if (change === 'name') f.artist.displayName = 'Mira Renamed';
      if (change === 'profile-version') f.profile.profileVersion++;
      if (change === 'review-revision') f.profile.reviewRevision++;
      if (change === 'source-fingerprint') f.profile.sourceFingerprint = releaseChecksum('new identity');
      if (change === 'approved-fingerprint') f.profile.approvedFingerprint = releaseChecksum('new approval');
      if (change === 'inactive') f.artist.status = 'inactive';
      expect(await f.load()).toEqual(empty);
    });

  it.each(['work', 'release', 'manuscript', 'artist', 'profile', 'beat', 'scene', 'part']) (
    'fails closed when %s is unavailable', async missing => {
      const f = fixture();
      if (missing === 'work') f.db.storyWork.findFirst.mockResolvedValueOnce(null);
      if (missing === 'release') f.db.storyRelease.findFirst.mockResolvedValueOnce(null);
      if (missing === 'manuscript') f.db.storyManuscriptVersion.findFirst.mockResolvedValueOnce(null);
      if (missing === 'artist') f.db.artist.findFirst.mockResolvedValueOnce(null);
      if (missing === 'profile') f.db.artistStoryIdentityProfile.findFirst.mockResolvedValueOnce(null);
      if (missing === 'beat') f.db.storyBeat.findMany.mockResolvedValueOnce([]);
      if (missing === 'scene') f.db.storyScene.findMany.mockResolvedValueOnce([]);
      if (missing === 'part') f.db.storyPart.findMany.mockResolvedValueOnce([]);
      expect(await f.load()).toEqual(empty);
    });

  it.each(['unpublished', 'fixture', 'superseded', 'manuscript-mutated', 'bad-release-hash', 'bad-manuscript-hash',
    'foreign-part', 'draft-scene', 'unsupported-beat', 'beat-position'])('rejects unavailable source/release: %s', async change => {
      const f = fixture();
      if (change === 'unpublished') f.work.status = 'draft';
      if (change === 'fixture') f.work.fixtureSource = true;
      if (change === 'superseded') f.work.activeReleaseId = ids.other;
      if (change === 'manuscript-mutated') f.manuscript.contentHash = canonicalReadTextHash('changed manuscript');
      if (change === 'bad-release-hash') f.release.checksum = 'invalid';
      if (change === 'bad-manuscript-hash') f.manuscript.contentHash = 'invalid';
      if (change === 'foreign-part') f.part.workId = ids.other;
      if (change === 'draft-scene') f.scene.status = 'draft';
      if (change === 'unsupported-beat') f.beat.beatType = 'choice';
      if (change === 'beat-position') f.beat.position = 41;
      expect(await f.load()).toEqual(empty);
    });

  it.each(['work', 'part'])('requires the reader entitlement for paid %s', async target => {
    const f = fixture(); f[target as 'work' | 'part'].priceLumina = new Prisma.Decimal(10);
    expect(await f.load()).toEqual(empty);
    expect(f.db.userEntitlement.findMany.mock.calls[0][0].where).toMatchObject({ userId: ids.user,
      entitlementType: { in: ['story_work', 'story_season', 'story_part'] }, referenceId: { in: [ids.work, ids.part] },
      revokedAt: null, startsAt: { lte: expect.any(Date) }, OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] });
  });

  it.each([ids.work, ids.part])('accepts current work/part access %s', async referenceId => {
    const f = fixture(); f.part.priceLumina = new Prisma.Decimal(10);
    f.entitlements.push({ userId: ids.user, entitlementType: referenceId === ids.work ? 'story_work' : 'story_part',
      referenceId, revokedAt: null, startsAt: new Date(0), expiresAt: null });
    expect((await f.load()).items).toEqual([f.item]);
  });

  it.each(['other-user', 'other-reference', 'revoked', 'expired', 'future'])('rejects unusable paid access: %s', async change => {
    const f = fixture(); f.part.priceLumina = new Prisma.Decimal(10);
    f.entitlements.push({ userId: change === 'other-user' ? ids.other : ids.user,
      entitlementType: 'story_part', referenceId: change === 'other-reference' ? ids.other : ids.part,
      revokedAt: change === 'revoked' ? now : null,
      startsAt: change === 'future' ? new Date('2999-01-01') : new Date(0),
      expiresAt: change === 'expired' ? new Date(0) : null });
    expect(await f.load()).toEqual(empty);
  });

  it('deduplicates repeated receipts and repeated evidence for the same approval', async () => {
    const f = fixture();
    f.receipts.push({ ...f.receipt, id: ids.other }, { ...f.receipt });
    f.approvals.push({ ...f.approval });
    expect(await f.load()).toEqual({ items: [f.item], fingerprint: releaseChecksum({ items: [f.item], proof: [f.proof()] }) });
  });

  it('models server checksum dedup for identical evidence with different approval IDs', async () => {
    const f = fixture();
    const latest = { ...f.approval, id: uuid(40), idempotencyKey: uuid(41), createdAt: new Date(now.getTime() + 1) };
    f.approvals.push({ ...f.approval, id: uuid(42) }, latest);
    expect(await f.load()).toEqual({ items: [f.item], fingerprint: releaseChecksum({ items: [f.item],
      proof: [{ ...f.proof(), approvalId: latest.id }] }) });
    expect(f.approvalQuery.mock.results).toHaveLength(1);
    expect(await f.approvalQuery.mock.results[0].value).toEqual([latest]);
  });

  it('also deduplicates identical checksums if raw results contain different approval IDs', async () => {
    const f = fixture();
    f.approvalQuery.mockResolvedValueOnce([f.approval, { ...f.approval, id: uuid(40) }, { ...f.approval, id: uuid(41) }]);
    expect(await f.load()).toEqual({ items: [f.item], fingerprint: releaseChecksum({ items: [f.item], proof: [f.proof()] }) });
  });

  it('models exact-locale filtering before 480 newer unrelated approvals can crowd out matching evidence', async () => {
    const f = fixture('en'); const translated = fixture('ja');
    f.approvals.unshift(...Array.from({ length: 480 }, (_, index) => {
      translated.approval.memoryText = `Reviewed translated action ${index}.`;
      translated.resignApproval();
      return { ...translated.approval, id: uuid(3000 + index), createdAt: new Date(now.getTime() + index + 1) };
    }));
    expect(await f.load()).toEqual({ items: [f.item], fingerprint: releaseChecksum({ items: [f.item], proof: [f.proof()] }) });
    expect(await f.approvalQuery.mock.results[0].value).toEqual([f.approval]);
  });

  it('models source scope filtering before a newer checksum for the same beat/locale', async () => {
    const f = fixture();
    f.approvals.unshift({ ...f.approval, id: uuid(40), sourceChecksum: releaseChecksum('other source'),
      approvalChecksum: releaseChecksum('other source approval'), createdAt: new Date(now.getTime() + 1) });
    expect(await f.load()).toEqual({ items: [f.item], fingerprint: releaseChecksum({ items: [f.item], proof: [f.proof()] }) });
    expect(await f.approvalQuery.mock.results[0].value).toEqual([f.approval]);
  });

  it('models checksum dedup before limiting unique approvals, preserving a second distinct memory behind 480 clones', async () => {
    const f = fixture(); const original = { ...f.approval };
    f.approval.id = uuid(50); f.approval.memoryText = 'A second reviewed action.'; f.resignApproval();
    const second = { ...f.approval, createdAt: new Date(now.getTime() - 1) };
    f.approvals.splice(0, 1, ...Array.from({ length: 480 }, (_, index) => ({ ...original,
      id: uuid(4000 + index), createdAt: new Date(now.getTime() + index + 1) })), second);
    const selected = f.approvals[479];
    const items = [f.item, { ...f.item, artistDialogue: second.memoryText }];
    const proof = [selected, second].map(row => ({ receiptId: f.receipt.id, scopeChecksum: f.receipt.scopeChecksum,
      approvalId: row.id, approvalChecksum: row.approvalChecksum }));
    expect(await f.load()).toEqual({ items, fingerprint: releaseChecksum({ items, proof }) });
    expect(await f.approvalQuery.mock.results[0].value).toEqual([selected, second]);
  });

  it.each(['receipt', 'approval'])('does not scan beyond its finite %s batch', async target => {
    const f = fixture();
    if (target === 'receipt') {
      const valid = { ...f.receipt };
      f.receipts.splice(0, 1, ...Array.from({ length: 240 }, (_, index) => ({ ...valid,
        id: uuid(1000 + index), scopeChecksum: releaseChecksum(`invalid receipt ${index}`) })), valid);
    } else {
      const valid = { ...f.approval };
      f.approvals.splice(0, 1, ...Array.from({ length: 480 }, (_, index) => ({ ...valid,
        id: uuid(2000 + index), approvalChecksum: releaseChecksum(`invalid approval ${index}`) })), valid);
    }
    expect(await f.load()).toEqual(empty);
    expect(f.db.storyCanonicalReadReceipt.findMany).toHaveBeenCalledTimes(1);
    expect(f.approvalQuery).toHaveBeenCalledTimes(1);
  });

  it('bounds independently approved evidence to six items and includes only their proofs', async () => {
    const f = fixture();
    for (let index = 1; index <= 7; index++) {
      f.approval.id = uuid(30 + index); f.approval.memoryText = `Reviewed action ${index}.`; f.resignApproval();
      f.approvals.push({ ...f.approval, createdAt: new Date(now.getTime() - index) });
    }
    f.approvals.shift();
    const result = await f.load();
    const items = f.approvals.slice(0, 6).map(row => ({ ...f.item, artistDialogue: row.memoryText }));
    const proof = f.approvals.slice(0, 6).map(row => ({ receiptId: f.receipt.id, scopeChecksum: f.receipt.scopeChecksum,
      approvalId: row.id, approvalChecksum: row.approvalChecksum }));
    expect(result).toEqual({ items, fingerprint: releaseChecksum({ items, proof }) });
    expect(result.items).toHaveLength(6);
  });

  it('changes the fingerprint when receipt/approval identity changes even with identical visible memory', async () => {
    const f = fixture(); const first = await f.load();
    f.receipt.id = ids.other; const second = await f.load();
    f.approval.id = uuid(19); const third = await f.load();
    expect(first.items).toEqual(second.items); expect(second.items).toEqual(third.items);
    expect(new Set([first.fingerprint, second.fingerprint, third.fingerprint]).size).toBe(3);
  });

  it.each(['transaction', 'read-only', 'ancestry', 'receipt', 'approval'])('propagates %s read failures without manufacturing memory', async point => {
    const f = fixture(); const failure = new Error(`Injected ${point} failure`);
    if (point === 'transaction') f.prisma.$transaction.mockRejectedValueOnce(failure);
    if (point === 'read-only') f.db.$executeRaw.mockRejectedValueOnce(failure);
    if (point === 'ancestry') f.db.$queryRaw.mockRejectedValueOnce(failure);
    if (point === 'receipt') f.db.storyCanonicalReadReceipt.findMany.mockRejectedValueOnce(failure);
    if (point === 'approval') f.approvalQuery.mockRejectedValueOnce(failure);
    await expect(f.load()).rejects.toBe(failure);
  });
});
