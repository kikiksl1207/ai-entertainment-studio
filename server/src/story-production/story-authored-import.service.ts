import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, StoryManuscriptVersion, StoryRelease } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthoredImportDto } from './dto/story-authored-import.dto';
import { missingAuthoredSceneVisual } from './story-authored-beat-visual.policy';
import { AUTHORED_INITIAL_IMPORT_CONTRACT } from './story-authored-import.contract';
import { authoredHash, prepareAuthoredSourceMap } from './story-authored-source-map.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { prepareManuscript } from './story-manuscript-file.policy';
import { manuscriptContentHash } from './story-production.policy';
import { authoredMaterializedSnapshot } from './story-authored-materialized.snapshot';
import { lockAuthorMaterializedRows, validAuthorFinalReviewProof } from './story-author-final-review.store';
export { authoredMaterializedSnapshot } from './story-authored-materialized.snapshot';

function conflict(code: string): never {
  throw new ConflictException({ code, message: 'Authored initial import conditions are not satisfied' });
}
function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
function manuscriptSource(version: StoryManuscriptVersion) {
  const body = record(version.structuredBody);
  const intake = record(body.intake);
  const source = record(intake.source);
  if (intake.identityVersion !== 2 || source.kind !== 'utf8_json_file' || typeof source.rawText !== 'string') {
    conflict('AUTHORED_COMPLETE_FILE_INTAKE_REQUIRED');
  }
  const prepared = prepareManuscript(Buffer.from(source.rawText, 'utf8'));
  if (prepared.contentHash !== version.contentHash || source.sha256 !== prepared.source.sha256 ||
      source.byteLength !== prepared.source.byteLength || version.locale !== prepared.locale || intake.locale !== prepared.locale ||
      manuscriptContentHash({ identityVersion: 2, locale: version.locale, parts: body.parts }) !== version.contentHash) {
    conflict('AUTHORED_MANUSCRIPT_CONTENT_CHANGED');
  }
  return prepared;
}
function assertReleaseIdentity(release: StoryRelease, expected: string) {
  const computed = releaseChecksum({ manuscriptVersionId: release.manuscriptVersionId,
    branchGraphSnapshot: release.branchGraphSnapshot, endingSetSnapshot: release.endingSetSnapshot,
    sceneAssetManifest: release.sceneAssetManifest, localizedDisplaySnapshot: release.localizedDisplaySnapshot });
  if (computed !== release.checksum || computed !== expected) conflict('AUTHORED_RELEASE_CONTENT_CHANGED');
}


export async function verifyAuthoredImportDraftTx(tx: Prisma.TransactionClient, workId: string, releaseId: string) {
  const receipt = await tx.storyAuthoredImport.findUnique({ where: { workId } });
  if (!receipt) return;
  if (receipt.releaseId !== releaseId) conflict('AUTHORED_IMPORTED_RELEASE_MISMATCH');
  const [release, manuscript, work] = await Promise.all([
    tx.storyRelease.findUnique({ where: { id: releaseId } }),
    tx.storyManuscriptVersion.findUnique({ where: { id: receipt.manuscriptVersionId } }),
    tx.storyWork.findUnique({ where: { id: workId } }),
  ]);
  if (!release || !manuscript || !work || work.ownerUserId !== receipt.ownerUserId ||
      manuscript.ownerUserId !== receipt.ownerUserId || manuscript.workId !== workId ||
      release.workId !== workId || release.manuscriptVersionId !== manuscript.id ||
      manuscript.contentHash !== receipt.manuscriptContentHash || work.customChoiceEnabled) conflict('AUTHORED_IMPORTED_BINDING_CHANGED');
  assertReleaseIdentity(release, receipt.releaseChecksum);
  manuscriptSource(manuscript);
  const snapshot = await authoredMaterializedSnapshot(tx, workId);
  const visualPrompts = await tx.storyVisualPrompt.findMany({
    where: { workId, releaseId },
    select: { sourceSceneKey: true, promptSha256: true, sourceBindingSha256: true },
  });
  const authoredSceneKeys = new Set(snapshot.beats.map(beat => beat.sourceSceneKey).filter(Boolean));
  if (snapshot.parts.length !== receipt.partCount || snapshot.scenes.length !== receipt.partCount ||
      snapshot.beats.length !== receipt.beatCount || snapshot.choices.length !== receipt.choiceCount ||
      new Set(snapshot.beats.map(beat => beat.sourceSceneKey)).size !== receipt.sourceSceneCount ||
      visualPrompts.length !== receipt.sourceSceneCount ||
      visualPrompts.some(prompt => !authoredSceneKeys.has(prompt.sourceSceneKey) ||
        prompt.sourceBindingSha256 !== receipt.sourceMapSha256) ||
      snapshot.scenes.some(scene => scene.endingType !== null) ||
      snapshot.choices.filter(choice => choice.targetEndingKey !== null).length !== 1 ||
      snapshot.choices.some(choice => choice.position > 1 && (choice.routeKind !== 'generation_required' ||
        choice.targetSceneId !== null || choice.targetEndingKey !== null || choice.declaredRejoinSceneId !== null)) ||
      releaseChecksum(snapshot) !== receipt.materializedChecksum) conflict('AUTHORED_MATERIALIZED_CONTENT_CHANGED');
  if (release.status !== 'candidate' || work.activeReleaseId !== null || work.publishedAt !== null ||
      snapshot.parts.some(part => part.status !== 'draft') || snapshot.scenes.some(scene => scene.status !== 'draft')) {
    conflict('AUTHORED_PRIVATE_CANDIDATE_REQUIRED');
  }
  return { receipt, release, manuscript, work, snapshot };
}

export async function assertAuthoredImportPublicationTx(tx: Prisma.TransactionClient, workId: string, releaseId: string) {
  const receipt = await tx.storyAuthoredImport.findUnique({ where: { workId } });
  if (!receipt) return;
  await lockAuthorMaterializedRows(tx, workId);
  const work = await tx.storyWork.findUnique({ where: { id: workId } });
  if (work?.activeReleaseId === releaseId && work.publishedAt !== null &&
      ['published', 'sale_suspended'].includes(work.status)) {
    await validAuthorFinalReviewProof(tx, { workId, releaseId, scope: 'publication' });
    return;
  }
  const verified = await verifyAuthoredImportDraftTx(tx, workId, releaseId);
  if (!verified) conflict('AUTHORED_IMPORT_REVIEW_BINDING_REQUIRED');
  await validAuthorFinalReviewProof(tx, { workId, releaseId, scope: 'publication' });
  return { partIds: verified!.snapshot.parts.map(part => part.id), sceneIds: verified!.snapshot.scenes.map(scene => scene.id) };
}

@Injectable()
export class StoryAuthoredImportService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(ownerUserId: string, workId: string, body: StoryAuthoredImportDto,
    sourceMap: Buffer, idempotencyKey?: string) {
    try {
      return await this.executePrivate(ownerUserId, workId, body, sourceMap, idempotencyKey);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Prisma and parser failures can carry private text. Never let those
      // payloads reach global exception logging or the response boundary.
      throw new ServiceUnavailableException({ code: 'AUTHORED_IMPORT_FAILED',
        message: 'Authored import failed; no partial materialization was committed' });
    }
  }

  private async executePrivate(ownerUserId: string, workId: string, body: StoryAuthoredImportDto,
    sourceMap: Buffer, idempotencyKey?: string) {
    const work = await this.prisma.storyWork.findFirst({ where: { id: workId, ownerUserId } });
    if (!work) throw new NotFoundException('Story work not found');
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({
      where: { id: body.manuscriptVersionId, workId, ownerUserId } });
    const release = await this.prisma.storyRelease.findFirst({ where: { id: body.releaseId, workId,
      manuscriptVersionId: body.manuscriptVersionId } });
    if (!manuscript || !release) throw new NotFoundException('Authored import binding not found');
    const preparedManuscript = manuscriptSource(manuscript);
    assertReleaseIdentity(release, body.expectedReleaseChecksum);
    if (body.expectedManuscriptHash !== preparedManuscript.contentHash) conflict('AUTHORED_MANUSCRIPT_BINDING_MISMATCH');
    const prepared = prepareAuthoredSourceMap(sourceMap, preparedManuscript,
      { endingKey: body.endingKey, evidenceSegment: body.endingEvidenceSegment });
    if (prepared.sourceMapSha256 !== body.expectedSourceMapSha256 || prepared.declaredPackageSha256 !== body.expectedPackageSha256) {
      conflict('AUTHORED_SOURCE_MAP_BINDING_MISMATCH');
    }
    const binding = { workId, ownerUserId, releaseId: release.id, manuscriptVersionId: manuscript.id,
      manuscriptContentHash: manuscript.contentHash, releaseChecksum: release.checksum,
      sourceMapSha256: prepared.sourceMapSha256, declaredPackageSha256: prepared.declaredPackageSha256,
      submittedInventorySha256: prepared.submittedInventorySha256 };
    const planChecksum = releaseChecksum({ contract: AUTHORED_INITIAL_IMPORT_CONTRACT, binding,
      locale: prepared.locale, parts: prepared.parts, endingResolution: prepared.endingResolution });
    const report = { contract: AUTHORED_INITIAL_IMPORT_CONTRACT, mode: 'dry_run' as 'dry_run' | 'apply',
      validation: 'covered_source_bytes_and_manuscript_verified', sourceMapSha256: prepared.sourceMapSha256,
      identityEvidence: prepared.identityEvidence,
      manuscriptContentHash: manuscript.contentHash, planChecksum, counts: prepared.counts,
      applyExecuted: false, publishReady: false, requiredNextAction: 'review_binding_contract_required',
      readiness: { assets: 'missing', translations: 'source_locale_only', ending: 'owner_intent_not_approval',
        rights: 'not_granted_by_import', price: 'not_approved_by_import', capability: 'not_granted_by_import' } };
    if (body.apply !== true) return report;
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200 || idempotencyKey.includes('\0')) {
      conflict('AUTHORED_IDEMPOTENCY_KEY_REQUIRED');
    }
    const keyHash = authoredHash(idempotencyKey);
    const apply = () => this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_releases WHERE id = ${release.id}::uuid FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_manuscript_versions WHERE id = ${manuscript.id}::uuid FOR SHARE`);
      const lockedWork = await tx.storyWork.findFirst({ where: { id: workId, ownerUserId } });
      const lockedRelease = await tx.storyRelease.findUnique({ where: { id: release.id } });
      const lockedManuscript = await tx.storyManuscriptVersion.findUnique({ where: { id: manuscript.id } });
      if (!lockedWork || !lockedRelease || !lockedManuscript || lockedManuscript.ownerUserId !== ownerUserId ||
          lockedManuscript.workId !== workId || lockedRelease.workId !== workId || lockedRelease.manuscriptVersionId !== manuscript.id) {
        conflict('AUTHORED_IMPORTED_BINDING_CHANGED');
      }
      assertReleaseIdentity(lockedRelease, release.checksum);
      if (manuscriptSource(lockedManuscript).contentHash !== manuscript.contentHash) conflict('AUTHORED_MANUSCRIPT_CONTENT_CHANGED');
      const existing = await tx.storyAuthoredImport.findUnique({ where: { workId } });
      if (existing) {
        if (existing.ownerUserId !== ownerUserId || existing.idempotencyKeyHash !== keyHash || existing.planChecksum !== planChecksum) {
          conflict('AUTHORED_IMPORT_ALREADY_BOUND');
        }
        const current = await authoredMaterializedSnapshot(tx, workId);
        if (releaseChecksum(current) !== existing.materializedChecksum) conflict('AUTHORED_MATERIALIZED_CONTENT_CHANGED');
        return { receiptId: existing.id, idempotentReplay: true };
      }
      if (!['draft', 'intake_received', 'reviewing', 'revision_requested', 'release_ready'].includes(lockedWork.status) ||
          lockedWork.activeReleaseId !== null || lockedWork.publishedAt !== null || lockedWork.customChoiceEnabled ||
          lockedWork.releaseRevision !== body.expectedRevision || lockedRelease.status !== 'candidate') conflict('AUTHORED_PRIVATE_CANDIDATE_REQUIRED');
      if (await tx.storyPart.count({ where: { workId } }) || await tx.storyReaderProgress.count({ where: { workId } })) {
        conflict('AUTHORED_INITIAL_WORK_NOT_EMPTY');
      }
      const partRows = prepared.parts.map(part => ({ id: randomUUID(), workId, seasonKey: 'season-1',
        actNumber: part.actNumber, position: part.position, status: 'draft', title: { [prepared.locale]: part.title },
        priceLumina: lockedWork.priceLumina, fixtureSource: lockedWork.fixtureSource }));
      const sceneRows = prepared.parts.map((part, i) => ({ id: randomUUID(), partId: partRows[i].id,
        sceneKey: `${part.partKey}-main`, position: 1, status: 'draft', title: { [prepared.locale]: part.title },
        endingType: null, fixtureSource: lockedWork.fixtureSource, visualManifest: missingAuthoredSceneVisual(`${part.partKey}-main`) }));
      const byPartKey = new Map(prepared.parts.map((part, i) => [part.partKey, sceneRows[i].id]));
      await tx.storyPart.createMany({ data: partRows });
      await tx.storyScene.createMany({ data: sceneRows });
      const beatRows = prepared.parts.flatMap((part, i) => part.packing.beats.map(beat => ({
        sceneId: sceneRows[i].id, position: beat.position, beatType: 'narration', content: { [prepared.locale]: beat.text },
        sourceSceneKey: beat.sourceSceneKey, visualManifest: missingAuthoredSceneVisual(beat.sourceSceneKey) })));
      for (let i = 0; i < beatRows.length; i += 256) await tx.storyBeat.createMany({ data: beatRows.slice(i, i + 256) });
      const visualPromptRows = prepared.parts.flatMap(part => part.visualPrompts.map(prompt => ({
        workId,
        releaseId: release.id,
        releaseChecksum: release.checksum,
        sourceSceneKey: prompt.sourceSceneKey,
        promptText: prompt.promptText,
        promptSha256: prompt.promptSha256,
        sourceKind: 'authored_import',
        sourceBindingSha256: prepared.sourceMapSha256,
      })));
      for (let i = 0; i < visualPromptRows.length; i += 256) {
        await tx.storyVisualPrompt.createMany({ data: visualPromptRows.slice(i, i + 256) });
      }
      const choiceRows = prepared.parts.flatMap((part, i) => part.choices.map(choice => ({
        sceneId: sceneRows[i].id, choiceKey: choice.choiceKey, position: choice.readerOrdinal,
        label: { [prepared.locale]: choice.label }, routeKind: choice.routeKind,
        targetSceneId: choice.destination?.kind === 'part' ? byPartKey.get(choice.destination.partKey) : null,
        targetEndingKey: choice.destination?.kind === 'ending' ? choice.destination.endingKey : null,
        declaredRejoinSceneId: null })));
      for (let i = 0; i < choiceRows.length; i += 256) await tx.storyChoice.createMany({ data: choiceRows.slice(i, i + 256) });
      const snapshot = await authoredMaterializedSnapshot(tx, workId);
      const receipt = await tx.storyAuthoredImport.create({ data: { ...binding, idempotencyKeyHash: keyHash,
        contract: AUTHORED_INITIAL_IMPORT_CONTRACT, locale: prepared.locale, planChecksum,
        materializedChecksum: releaseChecksum(snapshot), partCount: prepared.counts.parts,
        sourceSceneCount: prepared.counts.sourceScenes, beatCount: prepared.counts.beats,
        choiceCount: prepared.counts.choices, actCount: prepared.counts.acts,
        provenance: prepared.provenance as Prisma.InputJsonValue,
        endingResolution: prepared.endingResolution as Prisma.InputJsonValue } });
      await tx.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user',
        action: 'story_authored_import.private_materialized', targetType: 'story_work', targetId: workId,
        metadata: { receiptId: receipt.id, planChecksum, partCount: prepared.counts.parts,
          sourceSceneCount: prepared.counts.sourceScenes, visualPromptCount: visualPromptRows.length,
          publishReady: false } } });
      return { receiptId: receipt.id, idempotentReplay: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 30000 });
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return { ...report, mode: 'apply', applyExecuted: true, ...await apply() }; }
      catch (error) {
        if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) continue;
        throw error;
      }
    }
    conflict('AUTHORED_IMPORT_RETRY_LIMIT');
  }
}
