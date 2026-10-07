import { Prisma } from '@prisma/client';
import {
  assertCreatorGenerationProfileApprovable, creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../../src/generation-profile/creator-generation-profile.policy';
import { canonicalReadScopeChecksum, canonicalReadTextHash } from '../../src/story-production/story-canonical-read.policy';
import { canonicalStorySourceChecksum } from '../../src/story-production/story-canonical-source.policy';
import { storyInteractionApprovalChecksum, validateStoryInteractionEvidence } from '../../src/story-production/story-interaction-approval.policy';
import { releaseChecksum } from '../../src/story-production/story-lifecycle.policy';

type Row = Record<string, any>;
type Query = { where: Row; select?: Row; take?: number; orderBy?: Row | Row[] };
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const ids = Object.fromEntries(['user', 'owner', 'artist', 'work', 'release', 'manuscript', 'profile',
  'progress', 'part', 'scene', 'beat', 'root', 'receipt', 'approval', 'generated', 'generatedRoute',
  'oldGenerated', 'newProfile'].map((key, index) => [key, uuid(index + 1)]));
const now = new Date('2026-10-07T00:00:00.000Z');
export const generatedText = 'UNAPPROVED GENERATED BODY LINE';

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return (expected as Row[]).some(clause => matches(row, clause));
    const actual = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('is' in expected) return !!actual && matches(actual, expected.is);
      if ('in' in expected) return expected.in.includes(actual);
      return Object.entries(expected).every(([operator, value]) => {
        const left = actual instanceof Date ? actual.getTime() : actual;
        const right = value instanceof Date ? value.getTime() : value;
        if (operator === 'gte') return left >= (right as number);
        if (operator === 'lte') return left <= (right as number);
        if (operator === 'gt') return left > (right as number);
        if (operator === 'not') return actual !== value;
        throw new Error(`Unsupported synthetic predicate: ${operator}`);
      });
    }
    return actual instanceof Date && expected instanceof Date ? actual.getTime() === expected.getTime() : actual === expected;
  });
}
function project(row: Row, select?: Row): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.entries(select).map(([key, value]) => [key,
    value && typeof value === 'object' && value.select && row[key]
      ? project(row[key], value.select) : row[key]]));
}
function rowsByQuery(rows: Row[], query: Query): Row[] {
  const selected = rows.filter(row => matches(row, query.where));
  const order = Array.isArray(query.orderBy) ? query.orderBy : query.orderBy ? [query.orderBy] : [];
  selected.sort((a, b) => {
    for (const rule of order) for (const [key, direction] of Object.entries(rule)) {
      const result = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
      if (result) return direction === 'desc' ? -result : result;
    }
    return 0;
  });
  return selected.slice(0, query.take).map(row => project(row, query.select));
}

// Adapted from the pinned canonical fixture; no SQL, provider or real storage runs.
export function fixture() {
  const source = 'Mira opened the door.\nMira: Stay here.';
  const work: Row = { id: ids.work, ownerUserId: ids.owner, activeReleaseId: ids.release, publishedVersion: 2,
    status: 'published', fixtureSource: false, slug: 'synthetic-door-at-dawn', coverManifest: {},
    title: { en: 'Synthetic Door' }, priceLumina: new Prisma.Decimal(0) };
  const manuscript: Row = { id: ids.manuscript, workId: ids.work, ownerUserId: ids.owner, contentHash: canonicalReadTextHash(source) };
  const release: Row = { id: ids.release, workId: ids.work, manuscriptVersionId: ids.manuscript, version: 2,
    status: 'active', checksum: releaseChecksum({ manuscriptHash: manuscript.contentHash, version: 2 }) };
  const part: Row = { id: ids.part, workId: ids.work, position: 1, actNumber: 2,
    status: 'published', fixtureSource: false, priceLumina: new Prisma.Decimal(0) };
  const scene: Row = { id: ids.scene, partId: ids.part, sceneKey: 'door', position: 2,
    status: 'published', fixtureSource: false, title: { en: 'Synthetic Canonical Scene' }, visualManifest: {} };
  const beat: Row = { id: ids.beat, sceneId: ids.scene, position: 3, beatType: 'paragraph',
    sourceSceneKey: 'synthetic-manuscript-door', content: { en: source } };
  const artist: Row = { id: ids.artist, displayName: 'Mira', status: 'active' };
  const settings = normalizeCreatorGenerationProfile('artist', {
    schemaVersion: 'creator-generation-profile-v1', kind: 'artist',
    sections: ['fixed_identity', 'adaptable_presentation'].map(key => ({ key, decision: 'accepted',
      value: { description: 'Synthetic reviewed identity' }, evidence: [] })),
  });
  assertCreatorGenerationProfileApprovable(settings);
  const profile: Row = { id: ids.profile, artistId: ids.artist, profileVersion: 2, reviewRevision: 3,
    status: 'approved', approvedAt: now, approvedByUserId: ids.owner, approvedSettings: settings,
    sourceFingerprint: releaseChecksum({ artist: 'Mira', revision: 3 }) };
  profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, settings);
  const profiles = [profile];
  const identity = { artistId: ids.artist, identityProfileId: profile.id, identityProfileVersion: profile.profileVersion,
    identityReviewRevision: profile.reviewRevision, identitySourceFingerprint: profile.sourceFingerprint,
    identityApprovedFingerprint: profile.approvedFingerprint };
  const reader: Row = { id: ids.progress, userId: ids.user, workId: ids.work, activeReleaseId: ids.release,
    routeNodeId: ids.generatedRoute, progressRevision: 7, storyVersion: 2, status: 'active',
    currentSceneId: null, currentGeneratedSceneId: ids.generated, currentBeatPosition: 1,
    pathSummary: [{ generatedSceneId: ids.generated }], participantArtist: identity };
  const root: Row = { id: ids.root, progressId: ids.progress, workId: ids.work, releaseId: ids.release,
    routeHash: releaseChecksum({ root: ids.root }), targetSceneId: ids.scene, depth: 0 };
  const privateRoute: Row = { id: ids.generatedRoute, progressId: ids.progress, workId: ids.work,
    releaseId: ids.release, parentId: ids.root, routeHash: null, targetSceneId: null, depth: 1 };
  const generated: Row = { id: ids.generated, userId: ids.user, workId: ids.work, releaseId: ids.release,
    progressId: ids.progress, status: 'ready', title: { en: 'Synthetic Private BODY' } };
  const generatedBeat: Row = { sceneId: ids.generated, position: 1, beatType: 'dialogue', content: { en: `Mira: ${generatedText}` } };
  const generatedScenes = [generated], generatedBeats = [generatedBeat];
  const sourceChecksum = canonicalStorySourceChecksum({ workId: work.id, ownerUserId: work.ownerUserId,
    releaseId: release.id, releaseChecksum: release.checksum, manuscriptVersionId: manuscript.id,
    manuscriptHash: manuscript.contentHash, partId: part.id, partPosition: part.position,
    sceneId: scene.id, sceneKey: scene.sceneKey, scenePosition: scene.position, beatId: beat.id,
    beatPosition: beat.position, beatType: beat.beatType, sourceSceneKey: beat.sourceSceneKey, locale: 'en', sourceText: source });
  const readIdentity = { userId: ids.user, progressId: ids.progress, workId: work.id, ownerUserId: work.ownerUserId,
    releaseId: release.id, releaseChecksum: release.checksum, manuscriptVersionId: manuscript.id,
    manuscriptHash: manuscript.contentHash, partId: part.id, sceneId: scene.id, beatId: beat.id,
    beatPosition: beat.position, actNumber: part.actNumber, locale: 'en' as const, sourceChecksum,
    sourceTextHash: canonicalReadTextHash(source), routeNodeId: ids.root, routeHash: root.routeHash,
    storyVersion: reader.storyVersion, progressRevision: reader.progressRevision };
  const receipt: Row = { ...readIdentity, id: ids.receipt, scopeChecksum: canonicalReadScopeChecksum(readIdentity),
    idempotencyKey: uuid(30), confirmedAt: now, invalidatedAt: null, resetCommandId: null };
  const identityPinHash = releaseChecksum({ artistId: artist.id, displayName: artist.displayName,
    identityProfileId: profile.id, profileVersion: profile.profileVersion, reviewRevision: profile.reviewRevision,
    sourceFingerprint: profile.sourceFingerprint, approvedFingerprint: profile.approvedFingerprint });
  const approvalIdentity = { ownerUserId: work.ownerUserId, workId: work.id, releaseId: release.id,
    releaseChecksum: release.checksum, manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash,
    partId: part.id, sceneId: scene.id, beatId: beat.id, artistId: artist.id, identityProfileId: profile.id,
    identityPinHash, locale: 'en' as const, sourceChecksum };
  const checked = validateStoryInteractionEvidence(source, { interactionKind: 'action', evidenceStart: 0,
    evidenceText: 'Mira opened the door.', memoryText: 'Mira opened the door for me.', interactionReviewed: true });
  const approval: Row = { ...approvalIdentity, ...checked, id: ids.approval,
    approvalChecksum: storyInteractionApprovalChecksum(approvalIdentity, checked), idempotencyKey: uuid(31),
    status: 'approved', revision: 1, approvedAt: now, revokedAt: null, createdAt: now };
  const receipts = [receipt], approvals = [approval];
  const first = (rows: Row[]) => jest.fn(async (query: Query) => rowsByQuery(rows, query)[0] || null);
  const many = (rows: Row[]) => jest.fn(async (query: Query) => rowsByQuery(rows, query));
  const db: Row = {
    $executeRaw: jest.fn(async () => 0),
    $queryRaw: jest.fn(async (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
      if (Array.isArray(query)) {
        if (!String(query).includes('WITH RECURSIVE ancestry')) throw new Error('Unexpected tagged synthetic SQL');
        return values[0] === ids.root ? [root] : [privateRoute, root];
      }
      const sql = query as Prisma.Sql;
      if (!sql.sql.includes('FROM story_interaction_approvals')) throw new Error('Unexpected synthetic approval SQL');
      const [workId, ownerUserId, releaseId, checksum, manuscriptVersionId, manuscriptHash,
        artistId, identityProfileId, pinHash, ...scopeValues] = sql.values;
      if (!scopeValues.length || scopeValues.length % 3) throw new Error('Expected receipt scope triples');
      const scopes: Row[] = [];
      for (let i = 0; i < scopeValues.length; i += 3) scopes.push({ beatId: scopeValues[i], locale: scopeValues[i + 1], sourceChecksum: scopeValues[i + 2] });
      return approvals.filter(row => matches(row, { workId, ownerUserId, releaseId, releaseChecksum: checksum,
        manuscriptVersionId, manuscriptHash, artistId, identityProfileId, identityPinHash: pinHash,
        status: 'approved', revision: 1, revokedAt: null, OR: scopes }));
    }),
    storyReaderProgress: { findMany: many([reader]), findFirst: first([reader]) },
    storyProgressRouteNode: { findFirst: first([privateRoute, root]) },
    storyWork: { findFirst: first([work]) }, storyRelease: { findFirst: first([release]) },
    storyManuscriptVersion: { findFirst: first([manuscript]) }, artist: { findFirst: first([artist]) },
    artistStoryIdentityProfile: { findFirst: first(profiles) },
    storyAiGeneratedScene: { findMany: many(generatedScenes) }, storyAiGeneratedBeat: { findMany: many(generatedBeats) },
    storyCanonicalReadReceipt: { findMany: many(receipts) },
    storyBeat: { findMany: many([beat]) }, storyScene: { findMany: many([scene]) }, storyPart: { findMany: many([part]) },
    userEntitlement: { findMany: many([]) },
  };
  let afterFirstCanonicalRead: (() => void) | null = null;
  let canonicalReads = 0;
  const prisma: Row = { ...db, $transaction: jest.fn(async (read: (tx: Row) => Promise<unknown>) => {
    const result = await read(db); canonicalReads++;
    if (canonicalReads === 1) afterFirstCanonicalRead?.();
    return result;
  }) };
  const input = { userId: ids.user, artistId: ids.artist, artistDisplayName: artist.displayName, progressId: ids.progress };
  const canonicalItem = { workTitle: 'Synthetic Door', sceneTitle: 'Synthetic Canonical Scene',
    artistDialogue: checked.memoryText, interactionKind: 'action', evidenceSource: 'canonical_author_approved' };
  return { input, prisma, db, work, reader, profile, profiles, beat, receipt, receipts, approval, approvals,
    generated, generatedBeat, generatedScenes, generatedBeats, canonicalItem,
    noProof: () => { receipts.length = 0; approvals.length = 0; },
    noGenerated: () => { generatedScenes.length = 0; generatedBeats.length = 0;
      reader.currentGeneratedSceneId = null; reader.currentSceneId = ids.scene; reader.routeNodeId = ids.root;
      reader.pathSummary = []; reader.currentBeatPosition = 0; },
    changeAfterFirstCanonicalRead: (change: () => void) => { afterFirstCanonicalRead = change; },
  };
}
