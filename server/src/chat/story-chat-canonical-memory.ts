import { Prisma, type StoryInteractionApproval } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { assertCreatorGenerationProfileApprovable, creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { releaseChecksum } from '../story-production/story-lifecycle.policy';
import { canonicalStorySourceChecksum, validCanonicalStoryText } from '../story-production/story-canonical-source.policy';
import { canonicalReadScopeChecksum, canonicalReadTextHash, StoryCanonicalReadIdentity } from '../story-production/story-canonical-read.policy';
import { storyInteractionApprovalChecksum, validateStoryInteractionEvidence } from '../story-production/story-interaction-approval.policy';
import { isPublicStorySourceSafe, STORY_LOCALES } from '../story-production/story-production.policy';
import type { StoryChatMemoryItem } from './story-chat-memory';

export type CanonicalMemoryProgress = {
  id: string; workId: string; activeReleaseId: string | null; routeNodeId: string | null;
  progressRevision: number; storyVersion: number;
  participantArtist: {
    identityProfileId: string | null; identityProfileVersion: number | null;
    identityReviewRevision: number | null; identitySourceFingerprint: string | null;
    identityApprovedFingerprint: string | null;
  } | null;
};

type Route = { id: string; routeHash: string; targetSceneId: string | null; depth: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const EMPTY = () => ({ items: [] as StoryChatMemoryItem[], fingerprint: releaseChecksum([]) });

function title(value: Prisma.JsonValue, locale: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const language of [...new Set([locale, ...STORY_LOCALES])]) {
    const text = value[language];
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  return null;
}

// Both records are necessary: author attribution is not a reader's experience,
// and a reader's confirmation is not author approval of the character's role.
export async function loadCanonicalStoryMemory(
  prisma: PrismaService | Prisma.TransactionClient, input: { userId: string; artistId: string }, progress: CanonicalMemoryProgress,
  transaction?: Prisma.TransactionClient,
): Promise<{ items: StoryChatMemoryItem[]; fingerprint: string }> {
  const identity = progress.participantArtist;
  if (![input.userId, input.artistId, progress.id, progress.workId, progress.activeReleaseId,
    progress.routeNodeId, identity?.identityProfileId].every(value => typeof value === 'string' && UUID.test(value)) ||
    !Number.isSafeInteger(progress.storyVersion) || progress.storyVersion < 1 ||
    !Number.isSafeInteger(progress.progressRevision) || progress.progressRevision < 1 || !identity) return EMPTY();

  const read = async (db: Prisma.TransactionClient) => {
    const current = await db.storyReaderProgress.findFirst({ where: { id: progress.id, userId: input.userId,
      workId: progress.workId, activeReleaseId: progress.activeReleaseId, routeNodeId: progress.routeNodeId,
      storyVersion: progress.storyVersion, progressRevision: progress.progressRevision,
      status: { in: ['active', 'completed'] }, participantArtist: { is: { artistId: input.artistId } } },
      select: { participantArtist: { select: { identityProfileId: true, identityProfileVersion: true,
        identityReviewRevision: true, identitySourceFingerprint: true, identityApprovedFingerprint: true } } } });
    if (!current?.participantArtist || Object.entries(identity)
      .some(([key, value]) => current.participantArtist![key as keyof typeof identity] !== value)) return EMPTY();
    const work = await db.storyWork.findFirst({ where: { id: progress.workId, activeReleaseId: progress.activeReleaseId,
      publishedVersion: progress.storyVersion, status: 'published', fixtureSource: false },
      select: { id: true, ownerUserId: true, slug: true, fixtureSource: true, coverManifest: true, title: true, priceLumina: true } });
    if (!work || !isPublicStorySourceSafe({ slug: work.slug, fixtureSource: work.fixtureSource, manifest: work.coverManifest })) return EMPTY();
    const release = await db.storyRelease.findFirst({ where: { id: progress.activeReleaseId!, workId: work.id,
      version: progress.storyVersion, status: 'active' }, select: { id: true, checksum: true, manuscriptVersionId: true } });
    const manuscript = release && await db.storyManuscriptVersion.findFirst({ where: {
      id: release.manuscriptVersionId, workId: work.id, ownerUserId: work.ownerUserId }, select: { id: true, contentHash: true } });
    if (!release || !manuscript || !HASH.test(release.checksum) || !HASH.test(manuscript.contentHash)) return EMPTY();
    const artist = await db.artist.findFirst({ where: { id: input.artistId, status: 'active' }, select: { id: true, displayName: true } });
    const profile = artist && await db.artistStoryIdentityProfile.findFirst({ where: { artistId: artist.id },
      orderBy: { profileVersion: 'desc' }, select: { id: true, status: true, approvedAt: true, approvedByUserId: true,
        approvedSettings: true, approvedFingerprint: true, sourceFingerprint: true, profileVersion: true, reviewRevision: true } });
    if (!artist || !profile || profile.status !== 'approved' || !profile.approvedAt || !profile.approvedByUserId ||
      !profile.approvedSettings || !profile.approvedFingerprint || !HASH.test(profile.approvedFingerprint) ||
      !HASH.test(profile.sourceFingerprint) || profile.reviewRevision < 1 || profile.id !== identity.identityProfileId ||
      profile.profileVersion !== identity.identityProfileVersion || profile.reviewRevision !== identity.identityReviewRevision ||
      profile.sourceFingerprint !== identity.identitySourceFingerprint || profile.approvedFingerprint !== identity.identityApprovedFingerprint) return EMPTY();
    try {
      const normalized = normalizeCreatorGenerationProfile('artist', profile.approvedSettings);
      assertCreatorGenerationProfileApprovable(normalized);
      if (creatorGenerationProfileFingerprint(profile.sourceFingerprint, normalized) !== profile.approvedFingerprint) return EMPTY();
    } catch { return EMPTY(); }
    const identityPinHash = releaseChecksum({ artistId: artist.id, displayName: artist.displayName,
      identityProfileId: profile.id, profileVersion: profile.profileVersion, reviewRevision: profile.reviewRevision,
      sourceFingerprint: profile.sourceFingerprint, approvedFingerprint: profile.approvedFingerprint });
    const nodes = await db.$queryRaw<Route[]>`
      WITH RECURSIVE ancestry AS (
        SELECT id, parent_id, depth, route_hash, target_scene_id, 1 AS distance
        FROM story_progress_route_nodes
        WHERE id = ${progress.routeNodeId}::uuid AND progress_id = ${progress.id}::uuid
          AND work_id = ${work.id}::uuid AND release_id = ${release.id}::uuid
        UNION ALL
        SELECT n.id, n.parent_id, n.depth, n.route_hash, n.target_scene_id, a.distance + 1
        FROM story_progress_route_nodes n JOIN ancestry a ON n.id = a.parent_id
        WHERE n.progress_id = ${progress.id}::uuid AND n.work_id = ${work.id}::uuid
          AND n.release_id = ${release.id}::uuid AND n.depth = a.depth - 1 AND a.distance < 12
      ) SELECT id, depth, route_hash AS "routeHash", target_scene_id AS "targetSceneId" FROM ancestry ORDER BY depth DESC
    `;
    const routes = new Map(nodes.filter(node => UUID.test(node.id) && HASH.test(node.routeHash) && node.targetSceneId)
      .map(node => [node.id, node]));
    if (!routes.size) return EMPTY();
    const receipts = await db.storyCanonicalReadReceipt.findMany({ where: { userId: input.userId, progressId: progress.id,
      workId: work.id, ownerUserId: work.ownerUserId, releaseId: release.id, releaseChecksum: release.checksum,
      manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash, storyVersion: progress.storyVersion,
      routeNodeId: { in: [...routes.keys()] }, invalidatedAt: null, resetCommandId: null },
      orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }], take: 240 });
    if (!receipts.length) return EMPTY();
    const beatIds = [...new Set(receipts.map(row => row.beatId))];
    const scopes = [...new Map(receipts.map(row => [JSON.stringify([row.beatId, row.locale, row.sourceChecksum]), row])).values()];
    const matching = Prisma.join(scopes.map(row => Prisma.sql`(beat_id = ${row.beatId}::uuid
      AND locale = ${row.locale} AND source_checksum = ${row.sourceChecksum})`), ' OR ');
    // Deduplicate and filter language/source in SQL before limiting the batch.
    // Prisma's client-side distinct could fetch the entire approval history.
    const approvals = await db.$queryRaw<StoryInteractionApproval[]>(Prisma.sql`
      SELECT * FROM (
        SELECT DISTINCT ON (approval_checksum) id, owner_user_id AS "ownerUserId", work_id AS "workId",
          release_id AS "releaseId", release_checksum AS "releaseChecksum", manuscript_version_id AS "manuscriptVersionId",
          manuscript_hash AS "manuscriptHash", part_id AS "partId", scene_id AS "sceneId", beat_id AS "beatId",
          artist_id AS "artistId", identity_profile_id AS "identityProfileId", identity_pin_hash AS "identityPinHash",
          locale, source_checksum AS "sourceChecksum", interaction_kind AS "interactionKind", evidence_start AS "evidenceStart",
          evidence_text AS "evidenceText", memory_text AS "memoryText", approval_checksum AS "approvalChecksum",
          idempotency_key AS "idempotencyKey", status, revision, approved_at AS "approvedAt",
          revoked_at AS "revokedAt", created_at AS "createdAt"
        FROM story_interaction_approvals
        WHERE work_id = ${work.id}::uuid AND owner_user_id = ${work.ownerUserId}::uuid
          AND release_id = ${release.id}::uuid AND release_checksum = ${release.checksum}
          AND manuscript_version_id = ${manuscript.id}::uuid AND manuscript_hash = ${manuscript.contentHash}
          AND artist_id = ${artist.id}::uuid AND identity_profile_id = ${profile.id}::uuid AND identity_pin_hash = ${identityPinHash}
          AND status = 'approved' AND revision = 1 AND revoked_at IS NULL AND (${matching})
        ORDER BY approval_checksum, created_at DESC, id DESC
      ) approved ORDER BY "createdAt" DESC, id DESC LIMIT 480
    `);
    if (!approvals.length) return EMPTY();
    const beats = await db.storyBeat.findMany({ where: { id: { in: beatIds }, position: { gte: 1, lte: 40 },
      beatType: { in: ['paragraph', 'narration', 'dialogue'] } },
      select: { id: true, sceneId: true, position: true, beatType: true, content: true, sourceSceneKey: true } });
    const scenes = await db.storyScene.findMany({ where: { id: { in: [...new Set(beats.map(beat => beat.sceneId))] },
      status: 'published', fixtureSource: false }, select: { id: true, partId: true, sceneKey: true, position: true,
        title: true, visualManifest: true } });
    const parts = await db.storyPart.findMany({ where: { id: { in: [...new Set(scenes.map(scene => scene.partId))] },
      workId: work.id, status: 'published', fixtureSource: false },
      select: { id: true, position: true, actNumber: true, priceLumina: true } });
    const byBeat = new Map(beats.map(row => [row.id, row]));
    const byScene = new Map(scenes.map(row => [row.id, row]));
    const byPart = new Map(parts.map(row => [row.id, row]));
    const now = new Date();
    const entitlements = work.priceLumina.isZero() && parts.every(part => part.priceLumina.isZero()) ? []
      : await db.userEntitlement.findMany({ where: { userId: input.userId,
        entitlementType: { in: ['story_work', 'story_season', 'story_part'] }, referenceId: { in: [work.id, ...byPart.keys()] },
        revokedAt: null, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { referenceId: true } });
    if (transaction) {
      // The caller re-reads this snapshot after these bounded rows are locked.
      // Hold the proof and source rows until the chat turns commit together.
      for (const [table, ids] of [
        ['story_progress_route_nodes', nodes.map(row => row.id)],
        ['story_canonical_read_receipts', receipts.map(row => row.id)],
        ['story_interaction_approvals', approvals.map(row => row.id)],
        ['story_beats', beats.map(row => row.id)],
        ['story_scenes', scenes.map(row => row.id)],
        ['story_parts', parts.map(row => row.id)],
      ] as const) {
        if (ids.length) await db.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(table)}
          WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
      }
      await db.$queryRaw(Prisma.sql`SELECT id FROM user_entitlements WHERE user_id = ${input.userId}::uuid
        AND reference_id IN (${Prisma.join([work.id, ...byPart.keys()].map(id => Prisma.sql`${id}::uuid`))})
        AND entitlement_type IN ('story_work', 'story_season', 'story_part') ORDER BY id FOR SHARE`);
    }
    const accessible = new Set(entitlements.map(row => row.referenceId));
    const items: StoryChatMemoryItem[] = [];
    const proof: unknown[] = [];
    const seen = new Set<string>();
    for (const receipt of receipts) {
      const route = routes.get(receipt.routeNodeId), beat = byBeat.get(receipt.beatId);
      const scene = beat && byScene.get(beat.sceneId), part = scene && byPart.get(scene.partId);
      if (!route || !beat || !scene || !part || route.targetSceneId !== scene.id || receipt.routeHash !== route.routeHash ||
        receipt.sceneId !== scene.id || receipt.partId !== part.id || receipt.beatPosition !== beat.position ||
        receipt.actNumber !== part.actNumber || receipt.invalidatedAt !== null || receipt.resetCommandId !== null ||
        !Number.isSafeInteger(receipt.progressRevision) || receipt.progressRevision < 1 || receipt.progressRevision > progress.progressRevision ||
        !STORY_LOCALES.includes(receipt.locale as typeof STORY_LOCALES[number]) ||
        !isPublicStorySourceSafe({ manifest: scene.visualManifest }) ||
        ((!work.priceLumina.isZero() || !part.priceLumina.isZero()) && !accessible.has(work.id) && !accessible.has(part.id))) continue;
      const content = beat.content && typeof beat.content === 'object' && !Array.isArray(beat.content) ? beat.content : {};
      const sourceText = content[receipt.locale];
      if (!validCanonicalStoryText(sourceText)) continue;
      const sourceChecksum = canonicalStorySourceChecksum({ workId: work.id, ownerUserId: work.ownerUserId,
        releaseId: release.id, releaseChecksum: release.checksum, manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash,
        partId: part.id, partPosition: part.position, sceneId: scene.id, sceneKey: scene.sceneKey, scenePosition: scene.position,
        beatId: beat.id, beatPosition: beat.position, beatType: beat.beatType, sourceSceneKey: beat.sourceSceneKey,
        locale: receipt.locale, sourceText });
      const readIdentity: StoryCanonicalReadIdentity = { userId: input.userId, progressId: progress.id, workId: work.id,
        ownerUserId: work.ownerUserId, releaseId: release.id, releaseChecksum: release.checksum,
        manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash, partId: part.id, sceneId: scene.id,
        beatId: beat.id, beatPosition: beat.position, actNumber: part.actNumber, locale: receipt.locale,
        sourceChecksum, sourceTextHash: canonicalReadTextHash(sourceText), routeNodeId: route.id, routeHash: route.routeHash,
        storyVersion: progress.storyVersion, progressRevision: receipt.progressRevision };
      if (Object.entries(readIdentity).some(([key, value]) => receipt[key as keyof typeof receipt] !== value) ||
        receipt.scopeChecksum !== canonicalReadScopeChecksum(readIdentity)) continue;
      const approvalIdentity = { ownerUserId: work.ownerUserId, workId: work.id, releaseId: release.id,
        releaseChecksum: release.checksum, manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash,
        partId: part.id, sceneId: scene.id, beatId: beat.id, artistId: artist.id, identityProfileId: profile.id,
        identityPinHash, locale: receipt.locale, sourceChecksum };
      for (const approval of approvals) {
        if (seen.has(approval.approvalChecksum) || approval.status !== 'approved' || approval.revision !== 1 || approval.revokedAt !== null ||
          Object.entries(approvalIdentity).some(([key, value]) => approval[key as keyof typeof approval] !== value)) continue;
        try {
          const evidence = validateStoryInteractionEvidence(sourceText, { ...approval,
            interactionKind: approval.interactionKind as 'action' | 'dialogue', interactionReviewed: true });
          if (approval.approvalChecksum !== storyInteractionApprovalChecksum(approvalIdentity, evidence)) continue;
        } catch { continue; }
        const workTitle = title(work.title, receipt.locale), sceneTitle = title(scene.title, receipt.locale);
        if (!workTitle || !sceneTitle) continue;
        items.push({ workTitle, sceneTitle, artistDialogue: approval.memoryText,
          interactionKind: approval.interactionKind as 'action' | 'dialogue', evidenceSource: 'canonical_author_approved' });
        proof.push({ receiptId: receipt.id, scopeChecksum: receipt.scopeChecksum,
          approvalId: approval.id, approvalChecksum: approval.approvalChecksum });
        seen.add(approval.approvalChecksum);
        if (items.length >= 6) return { items, fingerprint: releaseChecksum({ items, proof }) };
      }
    }
    return items.length ? { items, fingerprint: releaseChecksum({ items, proof }) } : EMPTY();
  };
  if (transaction) return read(transaction);
  return (prisma as PrismaService).$transaction(async db => {
    await db.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
    return read(db);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 });
}
