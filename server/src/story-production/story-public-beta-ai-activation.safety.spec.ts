import { StoryFixedRouteChoiceRefreshService } from './story-fixed-route-choice-refresh.service';
import { fixedRouteSuggestedChoices } from './story-fixed-route-markdown.policy';
import { StoryPublicationIntakeService } from './story-publication-intake.service';

describe('published legacy choice refresh', () => {
  function fixture(partCount = 9, storyKey: 'monster' | 'rebellion' = 'monster') {
    const parts = Array.from({ length: partCount }, (_, index) => ({
      id: `part-${index + 1}`, position: index + 1, title: { ko: `제${index + 1}장` },
    }));
    const scenes = parts.map((part) => ({ id: `scene-${part.position}`, partId: part.id }));
    const choices = parts.flatMap((part, index) => fixedRouteSuggestedChoices(
      storyKey, part.title.ko, part.position, parts[index + 1]?.id ?? null,
    ).map((choice) => ({
      id: `${part.id}-${choice.choiceKey}`, sceneId: scenes[index].id,
      choiceKey: choice.choiceKey, position: choice.position, label: { ko: choice.label },
      routeKind: choice.routeKind,
      targetSceneId: choice.targetPartKey ? scenes[index + 1].id : null,
      targetEndingKey: choice.targetEndingKey,
      declaredRejoinSceneId: null,
    })));
    const beats = scenes.map((scene, index) => ({
      id: `beat-${index + 1}`, sceneId: scene.id, position: 1,
      content: { ko: `제${index + 1}장에서 해원은 붉은 카세트를 들고 바다 앞에 섰다.` },
    }));
    const audits: Array<{ action: string; metadata: Record<string, unknown> }> = [];
    const work = { title: { ko: '내 이름을 먹지 않은 괴물' } };
    const generate = jest.fn(async (input: { parts: Array<{ partKey: string }> }) =>
      input.parts.map((part) => ({ partKey: part.partKey, alternatives: [
        `${part.partKey}의 카세트를 열어 목소리의 주인을 찾는다`,
        `${part.partKey}의 카세트를 숨기고 해주를 찾아간다`,
      ] })));
    const db = {
      storyPart: { findMany: jest.fn(async () => parts) },
      storyScene: { findMany: jest.fn(async () => scenes) },
      storyChoice: {
        findMany: jest.fn(async () => choices),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: { position: number } }) => {
          const row = choices.find((choice) => choice.id === where.id)!;
          row.position = data.position;
          return row;
        }),
        createMany: jest.fn(async ({ data }: { data: typeof choices }) => {
          choices.push(...data);
          return { count: data.length };
        }),
        deleteMany: jest.fn(async ({ where }: { where: {
          id: { in: string[] }; sceneId: string; position: { lt: number }; choiceKey: { in: string[] };
        } }) => {
          let count = 0;
          for (let index = choices.length - 1; index >= 0; index -= 1) {
            const choice = choices[index];
            if (where.id.in.includes(choice.id) && choice.sceneId === where.sceneId &&
                choice.position < where.position.lt && where.choiceKey.in.includes(choice.choiceKey)) {
              choices.splice(index, 1);
              count += 1;
            }
          }
          return { count };
        }),
      },
      storyBeat: { findMany: jest.fn(async ({ where }: { where: { sceneId: { in: string[] } } }) =>
        beats.filter((beat) => where.sceneId.in.includes(beat.sceneId))) },
      storyWork: { findFirst: jest.fn(async () => work) },
      storyRelease: { findFirst: jest.fn(async () => ({ id: 'release' })) },
      storyAuthorFinalReviewProof: { findFirst: jest.fn(async () => null as { id: string } | null) },
      auditEvent: {
        create: jest.fn(async ({ data }: { data: { action: string; metadata: Record<string, unknown> } }) => {
          audits.push({ action: data.action, metadata: data.metadata });
          return {};
        }),
        findMany: jest.fn(async () => audits.filter((audit) => audit.action === 'story_public_beta.ai_choices.staged')),
      },
      $queryRaw: jest.fn(async () => []),
      $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
    const service = new StoryFixedRouteChoiceRefreshService(db as never, () => ({ generate: generate as never }));
    return { service, db, work, parts, choices, beats, audits, generate };
  }

  it('refreshes one bounded batch and resumes without rewriting original or cached rows', async () => {
    const { service, db, choices, generate } = fixture();
    const original = choices[0];
    const cached = choices[1];
    const originalLabel = original.label;
    const cachedLabel = cached.label;
    await expect(service.status('monster', 'work')).resolves.toMatchObject({
      ready: false, remainingParts: 9, phase: 'preparing', publicChoiceSet: 'legacy',
    });

    await expect(service.refreshBatch('admin', 'monster', 'work', 'release')).resolves.toMatchObject({
      preparedParts: 8, remainingParts: 1, ready: false,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].parts).toHaveLength(8);
    expect(generate.mock.calls[0][0].parts[0]).toMatchObject({
      originalChoiceLabel: originalLabel.ko,
      endingExcerpt: expect.stringContaining('붉은 카세트를 들고'),
    });
    expect(original).toMatchObject({ position: 1, label: originalLabel, targetSceneId: 'scene-2' });
    expect(cached).toMatchObject({ id: 'part-1-branch-b', position: 2, label: cachedLabel });
    expect(choices.filter((choice) => choice.sceneId === 'scene-1' && choice.position > 0))
      .toHaveLength(3);
    expect(choices.filter((choice) => choice.sceneId === 'scene-1' && choice.position < 0)
      .map((choice) => choice.choiceKey)).toEqual(['ai-branch-b-v1', 'ai-branch-c-v1']);

    await expect(service.refreshBatch('admin', 'monster', 'work', 'release')).resolves.toMatchObject({
      preparedParts: 9, remainingParts: 0, ready: false, phase: 'awaiting_promotion',
    });
    expect(cached.position).toBe(2);
    await expect(service.status('monster', 'work')).resolves.toMatchObject({
      ready: false, remainingParts: 0, publicChoiceSet: 'legacy',
    });
    await expect(service.refreshBatch('admin', 'monster', 'work', 'release')).resolves.toMatchObject({
      preparedParts: 9, remainingParts: 0, ready: true,
    });
    expect(db.$transaction).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: 'Serializable', timeout: 30000,
    }));
    expect(cached).toMatchObject({ id: 'part-1-branch-b', position: -12, label: cachedLabel });
    expect(original).toMatchObject({ position: 1, label: originalLabel });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(db.storyChoice.createMany).toHaveBeenCalledTimes(9);
    await expect(service.status('monster', 'work')).resolves.toMatchObject({ ready: true, remainingParts: 0 });
    const updates = db.storyChoice.update.mock.calls.length;
    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .resolves.toMatchObject({ ready: true, phase: 'ready' });
    expect(db.storyChoice.update).toHaveBeenCalledTimes(updates);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('leaves an already-generated pair untouched', async () => {
    const { service, db, choices, generate } = fixture(1);
    choices[1].choiceKey = 'ai-branch-b-v1';
    choices[2].choiceKey = 'ai-branch-c-v1';
    choices[1].label = { ko: '해원의 선택으로 다른 길을 연다' };
    choices[2].label = { ko: '해주의 기록을 따라 진실을 알린다' };
    db.storyAuthorFinalReviewProof.findFirst.mockResolvedValue({ id: 'proof' });

    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .resolves.toMatchObject({ ready: true, remainingParts: 0 });
    expect(generate).not.toHaveBeenCalled();
    expect(db.storyChoice.update).not.toHaveBeenCalled();
    expect(db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it('adds two alternatives to an original-only published part', async () => {
    const { service, choices, db } = fixture(1);
    choices.splice(1, 2);

    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .resolves.toMatchObject({ ready: false, phase: 'awaiting_promotion', remainingParts: 0 });
    expect(db.storyChoice.update).not.toHaveBeenCalled();
    expect(choices.filter((choice) => choice.position > 0)).toHaveLength(1);
    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .resolves.toMatchObject({ ready: true, remainingParts: 0 });
    expect(choices.filter((choice) => choice.position > 0)).toHaveLength(3);
    expect(choices[0]).toMatchObject({ choiceKey: 'finish', position: 1, targetEndingKey: 'author_main' });
  });

  it('identifies the rebellion template without rewriting either legacy label', async () => {
    const { service, choices } = fixture(1, 'rebellion');
    const legacyLabels = choices.slice(1).map((choice) => choice.label.ko);

    await expect(service.refreshBatch('admin', 'rebellion', 'work', 'release'))
      .resolves.toMatchObject({ ready: false, phase: 'awaiting_promotion' });
    expect(choices.slice(1, 3).map((choice) => choice.label.ko)).toEqual(legacyLabels);
    expect(choices.slice(1, 3).map((choice) => choice.position)).toEqual([2, 3]);
    await service.refreshBatch('admin', 'rebellion', 'work', 'release');
    expect(choices.slice(1, 3).map((choice) => choice.position)).toEqual([-12, -13]);
  });

  it('uses durable prepared keys even when labels resemble the old template', async () => {
    const { service, choices, generate } = fixture(1);
    choices[1].choiceKey = 'ai-branch-b-v1';
    choices[2].choiceKey = 'ai-branch-c-v1';

    await expect(service.status('monster', 'work')).resolves.toMatchObject({ ready: true, remainingParts: 0 });
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not mistake changed legacy labels for prepared choices', async () => {
    const { service, choices, generate } = fixture(1);
    choices[1].label = { ko: '이미 독자가 고른 새 이름의 길' };
    choices[2].label = { ko: '이미 생성된 결과를 따라가는 길' };

    await expect(service.status('monster', 'work')).resolves.toMatchObject({ ready: false, remainingParts: 1 });
    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .resolves.toMatchObject({ ready: false, phase: 'awaiting_promotion' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(choices[1]).toMatchObject({ position: 2, label: { ko: '이미 독자가 고른 새 이름의 길' } });
  });

  it('rejects a mixed public legacy/prepared set without changing any choice', async () => {
    const { service, choices, generate } = fixture(2);
    choices[4].choiceKey = 'ai-branch-b-v1';
    choices[5].choiceKey = 'ai-branch-c-v1';
    await expect(service.status('monster', 'work'))
      .rejects.toMatchObject({ response: { code: 'STORY_LEGACY_CHOICES_SOURCE_CHANGED' } });
    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .rejects.toMatchObject({ response: { code: 'STORY_LEGACY_CHOICES_SOURCE_CHANGED' } });
    expect(generate).not.toHaveBeenCalled();
    expect(choices.every((choice) => choice.position > 0)).toBe(true);
  });

  it('refuses a mixed legacy and prepared key pair without paying for another batch', async () => {
    const { service, choices, generate } = fixture(1);
    choices[2].choiceKey = 'ai-branch-c-v1';

    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .rejects.toMatchObject({ response: { code: 'STORY_LEGACY_CHOICES_SOURCE_CHANGED' } });
    expect(generate).not.toHaveBeenCalled();
  });

  it('refuses protected authored rows before contacting the provider', async () => {
    const { service, db, generate } = fixture(1);
    db.storyAuthorFinalReviewProof.findFirst.mockResolvedValue({ id: 'proof' });

    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .rejects.toMatchObject({ response: { code: 'STORY_LEGACY_CHOICES_SOURCE_CHANGED' } });
    expect(generate).not.toHaveBeenCalled();
    expect(db.storyChoice.update).not.toHaveBeenCalled();
  });

  it('rejects a changed authored ending without installing the generated labels', async () => {
    const { service, db, beats, generate } = fixture(1);
    generate.mockImplementationOnce(async (input) => {
      beats[0].content.ko = '원고가 바뀌었다.';
      return input.parts.map((part) => ({ partKey: part.partKey, alternatives: [
        '카세트를 열어 목소리를 찾는다', '카세트를 숨기고 돌아간다',
      ] }));
    });

    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .rejects.toMatchObject({ response: { code: 'STORY_LEGACY_CHOICES_SOURCE_CHANGED' } });
    expect(db.storyChoice.update).not.toHaveBeenCalled();
    expect(db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it.each(['beat', 'work title', 'part title', 'original label'] as const)(
    'invalidates %s drift and regenerates without retiring public choices', async (changed) => {
      const { service, db, work, parts, choices, beats, audits, generate } = fixture(1);
      if (changed === 'beat') beats[0].content.ko = `${'앞'.repeat(400)}이전${'뒤'.repeat(1300)}`;
      await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
        .resolves.toMatchObject({ phase: 'awaiting_promotion', ready: false });
      expect(audits[0].metadata.sourceFingerprints).toEqual({
        'scene-1': expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      if (changed === 'beat') beats[0].content.ko = beats[0].content.ko.replace('이전', '변경');
      if (changed === 'work title') work.title.ko = '바뀐 작품 제목';
      if (changed === 'part title') parts[0].title.ko = '바뀐 파트 제목';
      if (changed === 'original label') choices[0].label = { ko: '바뀐 작가 선택지' };

      await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
        .resolves.toMatchObject({ phase: 'preparing', remainingParts: 1, preparedParts: 0 });
      expect(choices.slice(0, 3).map((choice) => choice.position)).toEqual([1, 2, 3]);
      expect(choices).toHaveLength(3);
      expect(db.storyChoice.update).not.toHaveBeenCalled();
      expect(db.storyChoice.deleteMany).toHaveBeenCalledTimes(1);
      expect(audits.some((audit) => audit.action === 'story_public_beta.ai_choices.invalidated')).toBe(true);
      expect(generate).toHaveBeenCalledTimes(1);
      await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
        .resolves.toMatchObject({ phase: 'awaiting_promotion', remainingParts: 0 });
      expect(generate).toHaveBeenCalledTimes(2);
      await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
        .resolves.toMatchObject({ phase: 'ready', ready: true });
      expect(choices.slice(0, 3).map((choice) => choice.position)).toEqual([1, -12, -13]);
    },
  );

  it('clears a stale hidden pair when a beat was removed, but does not pay to regenerate incomplete source', async () => {
    const { service, db, choices, beats, generate } = fixture(1);
    await service.refreshBatch('admin', 'monster', 'work', 'release');
    beats.splice(0, 1);

    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .resolves.toMatchObject({ phase: 'preparing', remainingParts: 1 });
    expect(choices.map((choice) => choice.position)).toEqual([1, 2, 3]);
    expect(db.storyChoice.deleteMany).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .rejects.toMatchObject({ response: { code: 'STORY_LEGACY_CHOICES_SOURCE_CHANGED' } });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('recovers only the changed scene in a partially staged work before another paid-capable batch', async () => {
    const { service, choices, beats, generate } = fixture(9);
    await service.refreshBatch('admin', 'monster', 'work', 'release');
    beats[0].content.ko = '변경된 첫 장 원고';

    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .resolves.toMatchObject({ phase: 'preparing', preparedParts: 7, remainingParts: 2 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(choices.filter((choice) => choice.sceneId === 'scene-1').map((choice) => choice.position))
      .toEqual([1, 2, 3]);
    expect(choices.filter((choice) => choice.sceneId === 'scene-2' && choice.position < 0)).toHaveLength(2);

    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .resolves.toMatchObject({ phase: 'awaiting_promotion', remainingParts: 0 });
    expect(generate.mock.calls[1][0].parts.map((part) => part.partKey)).toEqual(['part-1', 'part-9']);
    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .resolves.toMatchObject({ phase: 'ready', ready: true });
  });

  it('fails closed when a staged pair has no matching durable provenance', async () => {
    const { service, db, choices, audits, generate } = fixture(1);
    await service.refreshBatch('admin', 'monster', 'work', 'release');
    audits.splice(0, 1);

    await expect(service.refreshBatch('admin', 'monster', 'work', 'release'))
      .rejects.toMatchObject({ response: { code: 'STORY_LEGACY_CHOICES_SOURCE_CHANGED' } });
    expect(choices.slice(0, 3).map((choice) => choice.position)).toEqual([1, 2, 3]);
    expect(db.storyChoice.deleteMany).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('fixed-route publication choice provenance', () => {
  it.each(['monster', 'rebellion'])('stores generated %s alternatives under durable prepared keys', async (storyKey) => {
    const part = {
      partKey: 'part-1', title: '첫 장', position: 1, actNumber: 1,
      beats: [{ text: '해원이 카세트를 꺼냈다.', sourceSceneKey: 'part-1-scene-1' }],
      choices: [
        { choiceKey: 'finish', label: '작가의 결말을 따른다', position: 1, routeKind: 'writer_original',
          targetPartKey: null, targetEndingKey: 'author_main' },
        { choiceKey: 'branch-b', label: '옛 분기 B', position: 2, routeKind: 'generation_required',
          targetPartKey: null, targetEndingKey: null },
        { choiceKey: 'branch-c', label: '옛 분기 C', position: 3, routeKind: 'generation_required',
          targetPartKey: null, targetEndingKey: null },
      ],
    };
    const plan = {
      storyKey, slug: 'published-work', title: '작품', summary: '요약', coverPath: '/cover.png',
      manuscript: { locale: 'ko', contentHash: 'source-hash', structuredBody: {} },
      sourceBindingSha256: 'binding', parts: [part], prompts: [],
    };
    const job = {
      id: 'job', actorUserId: 'admin', status: 'queued', batchCursor: 0,
      workId: null, releaseId: null, planSnapshot: plan, updatedAt: new Date(),
    };
    let saved: unknown;
    const prisma = { storyPublicationImportJob: {
      findUnique: jest.fn().mockResolvedValue(job),
      updateMany: jest.fn().mockImplementation(async ({ data }) => { saved = data.planSnapshot; return { count: 1 }; }),
    } };
    const service = new StoryPublicationIntakeService(prisma as never, {} as never);
    jest.spyOn(service as any, 'generateChoiceBatch').mockResolvedValue([{
      partKey: 'part-1', alternatives: ['카세트를 열어 목소리를 찾는다', '카세트를 숨기고 해주에게 간다'],
    }]);

    await (service as any).prepareApprovedChoices('admin', 'job');
    const stored = (service as any).readStoredPlan(saved);
    expect(stored.parts[0].choices.map((choice: { choiceKey: string }) => choice.choiceKey))
      .toEqual(['finish', 'ai-branch-b-v1', 'ai-branch-c-v1']);
  });
});
