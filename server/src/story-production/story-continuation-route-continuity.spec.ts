import { continuationHash } from './story-continuation-context.policy';
import { assembleContinuationRouteContinuity, STORY_CONTINUATION_ROUTE_VIEW_VERSION } from './story-continuation-route-continuity';
import { storyAiSiblingContextKey } from './story-ai-sibling-outcome.policy';
import { appendStoryRoute } from './story-route-identity.store';

function fixture(count = 80) {
  const rows = Array.from({ length: count }, (_, index) => ({
    depth: index + 1,
    narrative_step: {
      sourceGeneratedSceneId: `scene-${index + 1}`,
      choiceId: `choice-${index + 1}`,
      generatedSceneId: `scene-${index + 2}`,
      readBeatPosition: index === 0 ? 1 : 2,
    },
  }));
  const otherBranch = [{
    depth: 1,
    narrative_step: {
      sourceGeneratedSceneId: 'branch-scene', choiceId: 'branch-choice',
      generatedSceneId: 'branch-result', readBeatPosition: 1,
    },
  }];
  const all = [...rows, ...otherBranch];
  const choices = all.map(({ narrative_step: step }) => ({
    id: step.choiceId, sceneId: step.sourceGeneratedSceneId,
    label: { ko: step.choiceId === 'choice-1' ? '초기 약속을 지킨다' : step.choiceId },
  }));
  const scenes = all.map(({ narrative_step: step }) => ({
    id: step.sourceGeneratedSceneId, title: { ko: step.sourceGeneratedSceneId },
  }));
  const beats = all.flatMap(({ narrative_step: step }) => [1, 2, 3].map((position) => ({
    sceneId: step.sourceGeneratedSceneId, position,
    content: { ko: position === 3 ? `읽지 않은 미래 ${step.sourceGeneratedSceneId}`
      : position === 1 ? `읽은 사건 ${step.sourceGeneratedSceneId}`
        : `두 번째 사건 ${step.sourceGeneratedSceneId}` },
  })));
  const prisma = {
    $queryRaw: jest.fn((_strings, routeNodeId) => routeNodeId === 'branch' ? otherBranch : rows),
    storyChoice: { findMany: jest.fn().mockResolvedValue([]) },
    storyCustomChoice: { findMany: jest.fn().mockResolvedValue([]) },
    storyScene: { findMany: jest.fn().mockResolvedValue([]) },
    storyAiGeneratedChoice: { findMany: jest.fn().mockImplementation(async ({ where }) =>
      choices.filter((choice) => where.id.in.includes(choice.id))) },
    storyAiGeneratedScene: { findMany: jest.fn().mockImplementation(async ({ where }) =>
      scenes.filter((scene) => where.id.in.includes(scene.id))) },
    storyAiGeneratedBeat: { findMany: jest.fn().mockImplementation(async ({ where }) =>
      beats.filter((beat) => where.sceneId.in.includes(beat.sceneId))
        .sort((left, right) => left.position - right.position)) },
  };
  const input = {
    routeNodeId: 'main', progressId: 'progress', workId: 'work', releaseId: 'release',
    userId: 'reader', locale: 'ko', pathSummary: rows.slice(-24).map((row) => row.narrative_step),
  };
  return { prisma, input };
}

describe('continuation route continuity', () => {
  it('persists the read boundary in new route nodes', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'next-node' });
    const tx = { storyProgressRouteNode: {
      findFirst: jest.fn().mockResolvedValue({ id: 'parent', depth: 1, routeHash: 'a'.repeat(64) }),
      create,
    } };
    await appendStoryRoute(tx as never, {
      id: 'progress', workId: 'work', activeReleaseId: 'release', routeNodeId: 'parent',
    }, { kind: 'private' }, 1, {
      sourceGeneratedSceneId: 'read-scene', choiceId: 'chosen', customChoiceId: 'custom-choice',
      generatedSceneId: 'next-scene', readBeatPosition: 3,
    });
    expect(create.mock.calls[0][0].data.narrativeStep).toMatchObject({
      sourceGeneratedSceneId: 'read-scene', choiceId: 'chosen', customChoiceId: 'custom-choice',
      generatedSceneId: 'next-scene', readBeatPosition: 3,
    });
  });

  it('keeps an approved private-input choice without exposing unrelated reader input', async () => {
    const { prisma, input } = fixture(0);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ depth: 1, narrative_step: {
      sourceSceneId: 'source-scene', customChoiceId: 'custom-choice', generatedSceneId: 'result-scene',
    } }]);
    prisma.storyScene.findMany.mockResolvedValue([{ id: 'source-scene', title: { ko: '선택 장면' } }]);
    prisma.storyCustomChoice.findMany.mockResolvedValue([{ id: 'custom-choice', sceneId: 'source-scene',
      privateInput: '나는 문을 잠그고 증거를 숨긴다' }]);
    const view = await assembleContinuationRouteContinuity(prisma, input);
    expect(view.actions).toEqual([{ step: 1, choiceLabel: '나는 문을 잠그고 증거를 숨긴다' }]);
    expect(prisma.storyCustomChoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ progressId: 'progress', userId: 'reader',
        workId: 'work', status: 'completed', moderationDecision: 'allow' }),
    }));
  });

  it('does not block legacy private-input routes whose choice ID was never persisted', async () => {
    const { prisma, input } = fixture(0);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ depth: 1, narrative_step: {
      sourceSceneId: 'source-scene', generatedSceneId: 'result-scene', provenance: 'ai_generated',
    } }]);
    const view = await assembleContinuationRouteContinuity(prisma, input);
    expect(view.actions).toEqual([]);
    expect(view.readEvidence).toEqual([]);
    expect(prisma.storyCustomChoice.findMany).not.toHaveBeenCalled();
  });

  it('retains early actions after 75+ steps but never includes unread or unchosen material', async () => {
    const { prisma, input } = fixture();
    const view = await assembleContinuationRouteContinuity(prisma, input);
    expect(view.version).toBe(STORY_CONTINUATION_ROUTE_VIEW_VERSION);
    expect(view.actions).toHaveLength(80);
    expect(view.actions[0].choiceLabel).toBe('초기 약속을 지킨다');
    expect(view.actions.at(-1)?.choiceLabel).toBe('choice-80');
    expect(view.readEvidence[0]).toEqual({ step: 1, text: '읽은 사건 scene-1' });
    expect(view.readEvidence.at(-1)?.text).toContain('두 번째 사건 scene-80');
    expect(JSON.stringify(view)).not.toContain('읽지 않은 미래');
    expect(JSON.stringify(view)).not.toContain('branch-choice');
    expect(prisma.storyAiGeneratedScene.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'reader', progressId: 'progress', status: 'ready' }),
    }));
  });

  it('uses only the surviving ancestor chain after a route reset or branch change', async () => {
    const { prisma, input } = fixture();
    const main = await assembleContinuationRouteContinuity(prisma, input);
    const branchRows = await prisma.$queryRaw(null, 'branch');
    delete (branchRows[0].narrative_step as { readBeatPosition?: number }).readBeatPosition;
    const branch = await assembleContinuationRouteContinuity(prisma, { ...input, routeNodeId: 'branch' });
    expect(branch.actions.map((action) => action.choiceLabel)).toEqual(['branch-choice']);
    expect(branch.readEvidence).toEqual([]);
    expect(continuationHash(branch)).not.toBe(continuationHash(main));
  });

  it('is bounded and hashes identically for the same route and read evidence', async () => {
    const { prisma, input } = fixture(128);
    prisma.storyAiGeneratedChoice.findMany.mockImplementation(async ({ where }) =>
      where.id.in.map((id: string) => ({ id, sceneId: id.replace('choice', 'scene'),
        label: { ko: '매우 긴 선택의 결과'.repeat(30) } })));
    const first = await assembleContinuationRouteContinuity(prisma, input);
    const second = await assembleContinuationRouteContinuity(prisma, input);
    expect(first.actions[0].step).toBe(1);
    expect(first.actions.at(-1)?.step).toBe(128);
    expect(Buffer.byteLength(JSON.stringify(first), 'utf8')).toBeLessThanOrEqual(6_000);
    expect(continuationHash(first)).toBe(continuationHash(second));
  });

  it('retains the origin and latest choices across a 265-step authored route', async () => {
    const { prisma, input } = fixture(265);
    const rows = await prisma.$queryRaw(null, 'main');
    prisma.$queryRaw.mockImplementation((_strings, ...values) => {
      const walkLimit = values.find((value) => typeof value === 'number') as number;
      return rows.slice(-walkLimit);
    });

    const view = await assembleContinuationRouteContinuity(prisma, input);

    expect(view.actions[0]).toEqual({ step: 1, choiceLabel: '초기 약속을 지킨다' });
    expect(view.actions.at(-1)).toEqual({ step: 265, choiceLabel: 'choice-265' });
  });

  it('preserves the first and newest read events when evidence exceeds the byte budget', async () => {
    const { prisma, input } = fixture(16);
    prisma.storyAiGeneratedBeat.findMany.mockImplementation(async ({ where }) =>
      where.sceneId.in.flatMap((sceneId: string) => [1, 2].map((position) => ({
        sceneId, position, content: { ko: `${sceneId} ${'긴 사건 '.repeat(30)}` },
      }))));

    const view = await assembleContinuationRouteContinuity(prisma, input);

    expect(view.readEvidence.some((event) => event.step === 1)).toBe(true);
    expect(view.readEvidence.some((event) => event.step === 16)).toBe(true);
    expect(view.readEvidence.map((event) => event.step)).toEqual(
      [...view.readEvidence.map((event) => event.step)].sort((a, b) => a - b),
    );
  });

  it('keeps sibling reuse identity stable for identical evidence and distinct for changed evidence', async () => {
    const { prisma, input } = fixture(2);
    const first = await assembleContinuationRouteContinuity(prisma, input);
    const same = await assembleContinuationRouteContinuity(prisma, input);
    const key = (routeContinuityHash: string) => storyAiSiblingContextKey({
      workId: 'work', releaseId: 'release', releaseChecksum: 'checksum',
      manuscriptVersionId: 'manuscript', source: { kind: 'canonical', sceneId: 'source' },
      route: { kind: 'shared', hash: 'same-route' }, locale: 'ko',
      promptVersion: 'story-continuation-v8', outputSchemaVersion: 'story-continuation-output-v1',
      approvedContext: { sourceScene: { title: 'source', beats: [{ beatType: 'paragraph', content: 'source' }] },
        selectedChoice: { label: 'go' }, path: [], memories: [], routeContinuity: first },
      pins: { routeContinuityHash, routeContinuityVersion: STORY_CONTINUATION_ROUTE_VIEW_VERSION },
    });
    const original = continuationHash(first);
    expect(key(continuationHash(same))).toBe(key(original));
    prisma.storyAiGeneratedBeat.findMany.mockImplementation(async () => [{
      sceneId: 'scene-1', position: 1, content: { ko: '바뀐 실제 독서 사건' },
    }]);
    const changed = await assembleContinuationRouteContinuity(prisma, input);
    expect(key(continuationHash(changed))).not.toBe(key(original));
  });

  it('requires a recorded read position before using an older generated scene as event evidence', async () => {
    const { prisma, input } = fixture(1);
    const pathSummary: [] = [];
    const rows = await prisma.$queryRaw(null, 'main');
    delete (rows[0].narrative_step as { readBeatPosition?: number }).readBeatPosition;
    const view = await assembleContinuationRouteContinuity(prisma, { ...input, pathSummary });
    expect(view.actions).toHaveLength(1);
    expect(view.readEvidence).toEqual([]);
    const matchingSummary = [{ ...rows[0].narrative_step, readBeatPosition: 1 }];
    const withReadEvidence = await assembleContinuationRouteContinuity(prisma, {
      ...input, pathSummary: matchingSummary,
    });
    expect(withReadEvidence.readEvidence).toEqual([{ step: 1, text: '읽은 사건 scene-1' }]);
  });
});
