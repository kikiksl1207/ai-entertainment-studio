import { ConflictException } from '@nestjs/common';
import { StoryContinuationContextAssembler } from './story-continuation-context.assembler';
import {
  continuationExecutionFingerprint,
  continuationHash,
  continuationGenerationProfileSnapshot,
  continuationMemoryPins,
  continuationPathHash,
  continuationSourceHash,
  STORY_CONTINUATION_PROFILE_VIEW_VERSION,
} from './story-continuation-context.policy';
import {
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';
import { StoryContinuationClaim } from './story-continuation.repository';
import { sourceStoryContinuationLengthBounds } from './story-continuation-length.policy';
import { STORY_CONTINUATION_ROUTE_VIEW_VERSION } from './story-continuation-route-continuity';
import { STORY_CONTINUATION_PROMPT_VERSION } from './story-continuation-openai.schema';

const claim: StoryContinuationClaim = {
  continuationId: 'continuation-id', leaseToken: 'lease-token',
  attemptCount: 1, maxAttempts: 3, request: {} as never,
};

function fixture(progressExists = true, inputTokenLimit = 1000) {
  const scene = { id: 'scene-id', title: { ko: '장면' } };
  const beats = [
    { position: 1, beatType: 'paragraph', content: { ko: '현재 장면 본문' } },
    { position: 2, beatType: 'dialogue', content: { ko: '이어쓰기 직전 대사' } },
  ];
  const choice = { id: 'choice-b', label: { ko: '다른 길' } };
  const memories = [{
    id: 'memory-id', memoryType: 'event', revision: 1,
    content: { summary: '승인된 최소 기억' },
  }];
  const history = [{
    id: 'event-id', sceneId: 'prior', choiceId: 'choice-a', targetSceneId: 'scene-id',
  }];
  const pathSummary = [{ sceneId: 'prior' }];
  Object.assign(pathSummary[0], { choiceId: 'choice-a' });
  const semanticPath = [{
    sourceTitle: '이전 장면', choiceLabel: '이전 선택', targetTitle: null,
    explicitRejoin: false, endingType: null,
  }];
  const contextFingerprint = 'context-fingerprint';
  const memoryPins = continuationMemoryPins(memories);
  const sourceHash = continuationSourceHash({
    kind: 'canonical', locale: 'ko', title: scene.title, beats, choiceLabel: choice.label,
  });
  const pathHash = continuationPathHash(semanticPath);
  const continuation = {
    id: 'continuation-id', leaseToken: 'lease-token', userId: 'reader-id',
    workId: 'work-id', releaseId: 'release-id', progressId: 'progress-id',
    sourcePartId: 'part-id', sourceSceneId: 'scene-id', sourceGeneratedSceneId: null,
    recommendedChoiceId: 'choice-b', generatedChoiceId: null,
    sourceProgressRevision: 9, manuscriptVersionId: 'manuscript-id',
    analysisJobId: 'analysis-id', inputTokenLimit, locale: 'ko', contextFingerprint,
    contextReferences: {
      memoryPins,
      choiceEventIds: ['event-id'],
      sourceHash,
      pathHash,
      executionFingerprint: continuationExecutionFingerprint({
        contextFingerprint, sourceHash, pathHash, memoryPins,
      }),
    },
  };
  const prisma = {
    storyAiContinuation: { findUnique: jest.fn().mockResolvedValue(continuation) },
    storyReaderProgress: { findFirst: jest.fn().mockResolvedValue(progressExists ? { pathSummary } : null) },
    storyPart: { findFirst: jest.fn().mockResolvedValue({ id: 'part-id' }) },
    storyScene: {
      findFirst: jest.fn().mockResolvedValue(scene),
      findMany: jest.fn().mockResolvedValue([{ id: 'prior', title: { ko: '이전 장면' }, endingType: null }]),
    },
    storyBeat: { findMany: jest.fn().mockResolvedValue(beats) },
    storyChoice: {
      findFirst: jest.fn().mockResolvedValue(choice),
      findMany: jest.fn().mockResolvedValue([{
        id: 'choice-a', sceneId: 'prior', label: { ko: '이전 선택' }, targetEndingKey: null, declaredRejoinSceneId: null,
      }]),
    },
    storyAiGeneratedScene: { findMany: jest.fn().mockResolvedValue([]) },
    storyAiGeneratedChoice: { findMany: jest.fn().mockResolvedValue([]) },
    storyMemoryRecord: { findMany: jest.fn().mockResolvedValue(memories) },
    storyWorkGenerationProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    storyChoiceEvent: { findMany: jest.fn().mockResolvedValue(history) },
  };
  return { prisma, continuation, semanticPath, assembler: new StoryContinuationContextAssembler(prisma as never) };
}

describe('StoryContinuationContextAssembler', () => {
  it('revalidates pins and projects locale-only scene, choice, and approved memory content', async () => {
    const f = fixture();
    await expect(f.assembler.assemble(claim)).resolves.toEqual({
      sourceScene: {
        title: '장면',
        beats: [
          { beatType: 'paragraph', content: '현재 장면 본문' },
          { beatType: 'dialogue', content: '이어쓰기 직전 대사' },
        ],
      },
      selectedChoice: { label: '다른 길' },
      path: f.semanticPath,
      memories: [{ memoryType: 'event', content: '{"summary":"승인된 최소 기억"}' }],
      narrativeLength: sourceStoryContinuationLengthBounds('ko', [
        { beatType: 'paragraph', content: '현재 장면 본문' },
        { beatType: 'dialogue', content: '이어쓰기 직전 대사' },
      ]),
    });
    expect(f.prisma.storyReaderProgress.findFirst).toHaveBeenCalledWith({ where: {
      id: 'progress-id', userId: 'reader-id', workId: 'work-id',
      activeReleaseId: 'release-id', currentSceneId: 'scene-id', currentGeneratedSceneId: null,
      status: 'ai_pending', progressRevision: 10,
    } });
    expect(JSON.stringify(await f.assembler.assemble(claim))).not.toContain('scene-id');
  });

  it('resolves a queued continuation by its retired choice id and unchanged label', async () => {
    const f = fixture();
    f.prisma.storyChoice.findFirst.mockResolvedValue({
      id: 'choice-b', position: -2, label: { ko: '다른 길' },
    });

    await expect(f.assembler.assemble(claim)).resolves.toMatchObject({
      selectedChoice: { label: '다른 길' },
    });
    expect(f.prisma.storyChoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'choice-b' }),
    }));
    expect(f.prisma.storyChoice.findFirst.mock.calls[0][0].where).not.toHaveProperty('position');
  });

  it('passes writer-approved semantic memory in the requested locale', async () => {
    const f = fixture();
    const memories = [{
      id: 'approved-semantic-memory', memoryType: 'entity', revision: 1,
      content: { ko: '주인공: 왼손을 다친 채 항구에 도착한다.' },
    }];
    f.prisma.storyMemoryRecord.findMany.mockResolvedValue(memories);
    const memoryPins = continuationMemoryPins(memories);
    const references = f.continuation.contextReferences;
    f.continuation.contextReferences = {
      ...references,
      memoryPins,
      executionFingerprint: continuationExecutionFingerprint({
        contextFingerprint: f.continuation.contextFingerprint,
        sourceHash: references.sourceHash,
        pathHash: references.pathHash,
        memoryPins,
      }),
    };

    const context = await f.assembler.assemble(claim);
    expect(context.memories).toEqual([{
      memoryType: 'entity', content: '주인공: 왼손을 다친 채 항구에 도착한다.',
    }]);
  });

  it('reassembles approved memories in their pinned order, independent of database ordering', async () => {
    const f = fixture();
    const ordered = [
      { id: 'style-id', memoryType: 'style', revision: 1, content: { ko: '작가의 문체' } },
      { id: 'event-id', memoryType: 'event', revision: 1, content: { ko: '지나온 사건' } },
    ];
    f.prisma.storyMemoryRecord.findMany.mockResolvedValue([...ordered].reverse());
    const memoryPins = continuationMemoryPins(ordered);
    const references = f.continuation.contextReferences;
    f.continuation.contextReferences = {
      ...references,
      memoryPins,
      executionFingerprint: continuationExecutionFingerprint({
        contextFingerprint: f.continuation.contextFingerprint,
        sourceHash: references.sourceHash,
        pathHash: references.pathHash,
        memoryPins,
      }),
    };

    const context = await f.assembler.assemble(claim);
    expect(context.memories.map((memory) => memory.memoryType)).toEqual(['style', 'event']);
  });

  it('keeps an author-route plan explicitly separate from established reader facts', async () => {
    const f = fixture();
    Object.assign(f.continuation.contextReferences, { planningMemoryIds: ['memory-id'] });
    const context = await f.assembler.assemble(claim);
    expect(context.memories).toEqual([{
      memoryType: 'author_plan_event', content: '{"summary":"승인된 최소 기억"}',
    }]);
  });

  it.each([false, true])('reassembles a foreshadow only when explicitly pinned as an author plan: %s', async (planned) => {
    const f = fixture();
    const memories = [{ id: 'hint', memoryType: 'foreshadow', revision: 1,
      content: { ko: '원작 후반에서 어머니가 죽는다. 초반에 복선을 둔다.' } }];
    f.prisma.storyMemoryRecord.findMany.mockResolvedValue(memories);
    const memoryPins = continuationMemoryPins(memories);
    const references = f.continuation.contextReferences;
    f.continuation.contextReferences = {
      ...references, memoryPins,
      executionFingerprint: continuationExecutionFingerprint({
        contextFingerprint: f.continuation.contextFingerprint,
        sourceHash: references.sourceHash, pathHash: references.pathHash, memoryPins,
      }),
    };
    if (planned) Object.assign(f.continuation.contextReferences, { planningMemoryIds: ['hint'] });

    if (!planned) {
      await expect(f.assembler.assemble(claim)).rejects.toThrow('pinned_context_changed');
      expect(f.prisma.storyBeat.findMany).not.toHaveBeenCalled();
      return;
    }
    await expect(f.assembler.assemble(claim)).resolves.toMatchObject({ memories: [{
      memoryType: 'author_plan_foreshadow', content: memories[0].content.ko,
    }] });
  });

  it('rejects a planning reference that was not pinned for this continuation', async () => {
    const f = fixture();
    Object.assign(f.continuation.contextReferences, { planningMemoryIds: ['different-memory'] });
    await expect(f.assembler.assemble(claim)).rejects.toThrow('pinned_context_changed');
  });

  it('rejects a progress that no longer matches the pinned reader path', async () => {
    const f = fixture(false);
    await expect(f.assembler.assemble(claim)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects changed source beats before provider transmission', async () => {
    const f = fixture();
    f.prisma.storyBeat.findMany.mockResolvedValue([
      { position: 1, beatType: 'paragraph', content: { ko: '변경된 본문' } },
    ]);
    await expect(f.assembler.assemble(claim)).rejects.toThrow('pinned_context_changed');
  });

  it('pins and revalidates the exact route continuity view before dispatch', async () => {
    const f = fixture();
    const view = { version: STORY_CONTINUATION_ROUTE_VIEW_VERSION, actions: [], readEvidence: [] };
    const routeContinuityHash = continuationHash(view);
    Object.assign(f.continuation.contextReferences, {
      routeContinuityVersion: STORY_CONTINUATION_ROUTE_VIEW_VERSION,
      routeContinuityHash,
      executionFingerprint: continuationExecutionFingerprint({
        contextFingerprint: f.continuation.contextFingerprint,
        sourceHash: f.continuation.contextReferences.sourceHash,
        pathHash: f.continuation.contextReferences.pathHash,
        routeContinuityHash,
        routeContinuityVersion: STORY_CONTINUATION_ROUTE_VIEW_VERSION,
        memoryPins: f.continuation.contextReferences.memoryPins,
      }),
    });
    await expect(f.assembler.assemble(claim)).resolves.toMatchObject({ routeContinuity: view });
    Object.assign(f.continuation.contextReferences, { routeContinuityHash: 'stale' });
    await expect(f.assembler.assemble(claim)).rejects.toThrow('pinned_context_changed');
  });

  it('rejects a new-version continuation that lacks its route continuity pin', async () => {
    const f = fixture();
    Object.assign(f.continuation, { promptVersion: STORY_CONTINUATION_PROMPT_VERSION });
    await expect(f.assembler.assemble(claim)).rejects.toThrow('pinned_context_changed');
  });

  it('passes only read beats from the current generated source scene', async () => {
    const f = fixture();
    const generatedBeats = [
      { position: 1, beatType: 'paragraph', content: { ko: '읽은 시작' } },
      { position: 2, beatType: 'paragraph', content: { ko: '읽은 사건' } },
      { position: 3, beatType: 'paragraph', content: { ko: '아직 읽지 않은 반전' } },
    ];
    Object.assign(f.continuation, {
      sourceSceneId: null, sourceGeneratedSceneId: 'scene-id',
      recommendedChoiceId: null, generatedChoiceId: 'choice-b',
    });
    f.prisma.storyReaderProgress.findFirst.mockResolvedValue({
      pathSummary: [{ sceneId: 'prior', choiceId: 'choice-a' }], currentBeatPosition: 2,
    });
    Object.assign(f.prisma.storyAiGeneratedScene, { findFirst: jest.fn().mockResolvedValue({
      id: 'scene-id', title: { ko: '생성된 장면' },
    }) });
    Object.assign(f.prisma, {
      storyAiGeneratedBeat: { findMany: jest.fn().mockImplementation(async ({ where }) =>
        generatedBeats.filter((beat) => beat.position <= where.position.lte)) },
    });
    Object.assign(f.prisma.storyAiGeneratedChoice, { findFirst: jest.fn().mockResolvedValue({
      id: 'choice-b', label: { ko: '다른 길' },
    }) });
    const sourceHash = continuationSourceHash({
      kind: 'generated', locale: 'ko', title: { ko: '생성된 장면' },
      beats: generatedBeats.slice(0, 2), choiceLabel: { ko: '다른 길' },
    });
    Object.assign(f.continuation.contextReferences, {
      sourceHash,
      executionFingerprint: continuationExecutionFingerprint({
        contextFingerprint: f.continuation.contextFingerprint, sourceHash,
        pathHash: f.continuation.contextReferences.pathHash,
        memoryPins: f.continuation.contextReferences.memoryPins,
      }),
    });
    const context = await f.assembler.assemble(claim);
    expect(context.sourceScene.beats.map((beat) => beat.content)).toEqual(['읽은 시작', '읽은 사건']);
    expect(JSON.stringify(context)).not.toContain('아직 읽지 않은 반전');
    expect((f.prisma as any).storyAiGeneratedBeat.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sceneId: 'scene-id', position: { lte: 2 } },
    }));
  });

  it('rejects a changed semantic choice path before provider transmission', async () => {
    const f = fixture();
    f.prisma.storyChoice.findMany.mockResolvedValue([{
      id: 'choice-a', sceneId: 'prior', label: { ko: '바뀐 선택' }, targetEndingKey: null, declaredRejoinSceneId: null,
    }]);
    await expect(f.assembler.assemble(claim)).rejects.toThrow('pinned_context_changed');
  });

  it('rejects the complete outbound context when the input limit is exceeded', async () => {
    const f = fixture(true, 10);
    await expect(f.assembler.assemble(claim)).rejects.toThrow('approved_context_bound_exceeded');
  });

  it('revalidates and projects the exact creator-approved generation profile', async () => {
    const f = fixture();
    const approvedSettings = {
      schemaVersion: 'creator-generation-profile-v1' as const,
      kind: 'story' as const,
      sections: [
        'writing_style', 'scene_scale', 'canon', 'timeline', 'narrative_devices',
        'branch_behavior', 'visual_direction', 'visual_cast',
      ].map((key) => ({ key, decision: 'accepted' as const, value: { summary: `${key} lock` }, evidence: [] })),
    };
    const normalizedSettings = normalizeCreatorGenerationProfile('story', approvedSettings);
    const sourceFingerprint = 'a'.repeat(64);
    const profile = {
      id: 'profile-id', status: 'approved', profileVersion: 2, reviewRevision: 3,
      sourceFingerprint,
      approvedSettings: normalizedSettings,
      approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, normalizedSettings),
    };
    const snapshot = continuationGenerationProfileSnapshot(profile as never);
    (f.continuation.contextReferences as Record<string, unknown>).generationProfilePin = snapshot.pin;
    (f.continuation.contextReferences as Record<string, unknown>).generationProfileViewVersion = STORY_CONTINUATION_PROFILE_VIEW_VERSION;
    f.continuation.contextReferences.executionFingerprint = continuationExecutionFingerprint({
      contextFingerprint: f.continuation.contextFingerprint,
      sourceHash: f.continuation.contextReferences.sourceHash,
      pathHash: f.continuation.contextReferences.pathHash,
      memoryPins: f.continuation.contextReferences.memoryPins,
      generationProfilePin: snapshot.pin,
    });
    f.prisma.storyWorkGenerationProfile.findFirst.mockResolvedValue(profile);

    await expect(f.assembler.assemble(claim)).resolves.toMatchObject({
      generationProfile: {
        schemaVersion: 'creator-generation-profile-v1',
        sections: expect.arrayContaining([
          { key: 'writing_style', value: { summary: 'writing_style lock', referenceScope: 'production_constraint' } },
          { key: 'visual_cast', value: { summary: 'visual_cast lock', referenceScope: 'author_plan_not_route_history' } },
        ]),
      },
    });
    expect(f.prisma.storyWorkGenerationProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'profile-id', status: 'approved' }),
    }));
  });

  it('rejects a changed approved generation profile before provider transmission', async () => {
    const f = fixture();
    const pin = {
      id: 'profile-id', profileVersion: 1, reviewRevision: 1,
      sourceFingerprint: 'a'.repeat(64), approvedFingerprint: 'b'.repeat(64),
    };
    (f.continuation.contextReferences as Record<string, unknown>).generationProfilePin = pin;
    f.continuation.contextReferences.executionFingerprint = continuationExecutionFingerprint({
      contextFingerprint: f.continuation.contextFingerprint,
      sourceHash: f.continuation.contextReferences.sourceHash,
      pathHash: f.continuation.contextReferences.pathHash,
      memoryPins: f.continuation.contextReferences.memoryPins,
      generationProfilePin: pin,
    });
    f.prisma.storyWorkGenerationProfile.findFirst.mockResolvedValue(null);
    await expect(f.assembler.assemble(claim)).rejects.toThrow('pinned_context_changed');
  });

  it('rejects a queued profile continuation from a different prompt-view version', async () => {
    const f = fixture();
    (f.continuation.contextReferences as Record<string, unknown>).generationProfilePin = {
      id: 'profile-id', profileVersion: 1, reviewRevision: 1,
      sourceFingerprint: 'a'.repeat(64), approvedFingerprint: 'b'.repeat(64),
    };
    (f.continuation.contextReferences as Record<string, unknown>).generationProfileViewVersion = 'story-profile-prompt-v2';
    await expect(f.assembler.assemble(claim)).rejects.toThrow('pinned_context_changed');
    expect(f.prisma.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
  });
});
