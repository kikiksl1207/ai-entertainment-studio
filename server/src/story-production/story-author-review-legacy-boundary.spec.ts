import { createHash, randomUUID } from 'crypto';
import { assertAuthoredImportPublicationTx } from './story-authored-import.service';
import type { AuthoredMaterializedSnapshot } from './story-authored-materialized.snapshot';
import { AUTHOR_FINAL_REVIEW_VERSION, verifiedWholePartReferences } from './story-author-final-review.policy';
import { resolveContinuationAuthorSegment } from './story-continuation-author-anchor';

// Synthetic legacy shapes, not an inspection or migration of the accepted Imjin b51 database.
describe('legacy publication versus receipt-backed continuation authority', () => {
  function fixture() {
    const input = {
      userId: randomUUID(), workId: randomUUID(), releaseId: randomUUID(),
      manuscriptVersionId: randomUUID(), progressId: randomUUID(),
      sourcePartId: randomUUID(), sourceSceneId: randomUUID(),
      locale: 'ko', model: 'gpt-4.1-2025-04-14',
    };
    const tx = {
      storyAuthoredImport: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), upsert: jest.fn() },
      storyAuthorFinalReviewProof: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      storyAuthorFinalReviewRevocation: { findUnique: jest.fn().mockResolvedValue(null) },
      storyWork: { findUnique: jest.fn().mockResolvedValue({ id: input.workId, ownerUserId: input.userId }) },
      storyRelease: { findUnique: jest.fn().mockResolvedValue({ id: input.releaseId, workId: input.workId,
        manuscriptVersionId: input.manuscriptVersionId }) },
      storyManuscriptVersion: { findUnique: jest.fn().mockResolvedValue({ id: input.manuscriptVersionId,
        workId: input.workId, ownerUserId: input.userId }) },
      storyPart: { findFirst: jest.fn() },
      storyScene: { findFirst: jest.fn() },
      storyBeat: { findMany: jest.fn(), updateMany: jest.fn() },
      storyAiGeneratedScene: { findFirst: jest.fn() },
      $queryRaw: jest.fn(),
    };
    const proof = {
      id: randomUUID(), workId: input.workId, releaseId: input.releaseId,
      manuscriptVersionId: input.manuscriptVersionId, ownerUserId: input.userId,
      authoredImportId: randomUUID(), contractVersion: AUTHOR_FINAL_REVIEW_VERSION, anchorScope: true,
    };
    return { input, tx, proof };
  }

  it('leaves the no-receipt publication guard on its legacy path without creating approval', async () => {
    const { input, tx } = fixture();
    await expect(assertAuthoredImportPublicationTx(tx as never, input.workId, input.releaseId))
      .resolves.toBeUndefined();
    expect(tx.storyAuthorFinalReviewProof.findUnique).not.toHaveBeenCalled();
    expect(tx.storyAuthorFinalReviewProof.create).not.toHaveBeenCalled();
    expect(tx.storyAuthoredImport.create).not.toHaveBeenCalled();
    expect(tx.storyAuthoredImport.upsert).not.toHaveBeenCalled();
    expect(tx.storyBeat.updateMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(['canonical', 'generated'] as const)('does not turn legacy %s readability into an anchor', async source => {
    const { input, tx } = fixture();
    const request = source === 'canonical' ? input : {
      ...input, sourceSceneId: null, sourceGeneratedSceneId: randomUUID(),
    };
    await expect(resolveContinuationAuthorSegment(tx as never, request))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_PROOF_REQUIRED' } });
    expect(tx.storyBeat.findMany).not.toHaveBeenCalled();
    expect(tx.storyAiGeneratedScene.findFirst).not.toHaveBeenCalled();
    expect(tx.storyAuthoredImport.findUnique).not.toHaveBeenCalled();
    expect(tx.storyAuthoredImport.create).not.toHaveBeenCalled();
    expect(tx.storyAuthorFinalReviewProof.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('does not treat publication-only approval as continuation approval', async () => {
    const { input, tx, proof } = fixture();
    tx.storyAuthorFinalReviewProof.findUnique.mockResolvedValue({ ...proof, anchorScope: false });
    await expect(resolveContinuationAuthorSegment(tx as never, input))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_PROOF_REQUIRED' } });
    expect(tx.storyBeat.findMany).not.toHaveBeenCalled();
  });

  it('does not recover revoked authority from still-readable published content', async () => {
    const { input, tx, proof } = fixture();
    tx.storyAuthorFinalReviewProof.findUnique.mockResolvedValue(proof);
    tx.storyAuthorFinalReviewRevocation.findUnique.mockResolvedValue({ proofId: proof.id });
    await expect(resolveContinuationAuthorSegment(tx as never, input))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_PROOF_REVOKED' } });
    expect(tx.storyWork.findUnique).not.toHaveBeenCalled();
    expect(tx.storyBeat.findMany).not.toHaveBeenCalled();
  });

  it('fails closed for a proof-shaped record without its actual receipt binding', async () => {
    const { input, tx, proof } = fixture();
    tx.storyAuthorFinalReviewProof.findUnique.mockResolvedValue(proof);
    await expect(resolveContinuationAuthorSegment(tx as never, input))
      .rejects.toMatchObject({ response: { code: 'AUTHOR_FINAL_REVIEW_BINDING_CHANGED' } });
    expect(tx.storyAuthoredImport.findUnique).toHaveBeenCalledWith({ where: { id: proof.authoredImportId } });
    expect(tx.storyBeat.findMany).not.toHaveBeenCalled();
    expect(tx.storyAuthoredImport.upsert).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('whole-part mapping never invents legacy source keys', () => {
  function fixture() {
    const partId = randomUUID();
    const sceneId = randomUUID();
    const text = 'Synthetic approved source text.';
    const snapshot: AuthoredMaterializedSnapshot = {
      parts: [{ id: partId, seasonKey: 's1', actNumber: 1, position: 1, status: 'draft',
        title: { ko: 'Same title' }, priceLumina: '0', fixtureSource: false }],
      scenes: [{ id: sceneId, partId, sceneKey: 'container-1', position: 1, status: 'draft',
        title: { ko: 'Same title' }, visualManifest: {}, endingType: null, fixtureSource: false }],
      beats: [{ id: randomUUID(), sceneId, position: 1, beatType: 'narration', content: { ko: text },
        sourceSceneKey: 'source-1', visualManifest: null }],
      choices: [],
    };
    const provenance = { contract: 'story-authored-source-spans-v1', parts: [{ scenes: [{
      sourceSceneKey: 'source-1', beatCount: 1, firstBeatPosition: 1,
      textBytes: Buffer.byteLength(text), textSha256: createHash('sha256').update(text).digest('hex'),
    }] }] };
    return { snapshot, provenance };
  }

  it('accepts explicit verified mapping without making proposed bounds into approval', () => {
    const { snapshot, provenance } = fixture();
    const refs = verifiedWholePartReferences(snapshot, provenance, 'ko', true);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ sourcePartId: snapshot.parts[0].id,
      sourceSceneId: snapshot.scenes[0].id, sourceSceneKeys: ['source-1'], length: { locale: 'ko' } });
    expect(refs[0]).not.toHaveProperty('proofId');
    expect(refs[0]).not.toHaveProperty('approved');
  });

  it('rejects missing receipt provenance instead of synthesizing it from current rows', () => {
    const { snapshot } = fixture();
    const before = JSON.stringify(snapshot);
    expect(() => verifiedWholePartReferences(snapshot, null, 'ko', true))
      .toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'AUTHOR_SOURCE_MAPPING_UNSUPPORTED' }) }));
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it.each([true, false])('rejects missing sourceSceneKey even for includeAnchor=%s', includeAnchor => {
    const { snapshot, provenance } = fixture();
    snapshot.beats[0].sourceSceneKey = null;
    const before = JSON.stringify({ snapshot, provenance });
    expect(() => verifiedWholePartReferences(snapshot, provenance, 'ko', includeAnchor))
      .toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'AUTHOR_SOURCE_MAPPING_UNSUPPORTED' }) }));
    expect(JSON.stringify({ snapshot, provenance })).toBe(before);
  });

  it('does not substitute title, position, or matching prose for the exact source key', () => {
    const { snapshot, provenance } = fixture();
    snapshot.beats[0].sourceSceneKey = 'legacy-key-with-identical-text';
    const before = JSON.stringify({ snapshot, provenance });
    expect(() => verifiedWholePartReferences(snapshot, provenance, 'ko', true))
      .toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'AUTHOR_SOURCE_MAPPING_CHANGED' }) }));
    expect(JSON.stringify({ snapshot, provenance })).toBe(before);
  });
});
