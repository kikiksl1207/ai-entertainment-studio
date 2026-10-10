import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { isUUID } from 'class-validator';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import { assembleContinuationSemanticPath, stableContinuationJson } from './story-continuation-context.policy';
import {
  readStoryContinuationDiagnosticContext,
  StoryContinuationDiagnosticContextUnavailable,
  type StoryContinuationDiagnosticContextInput,
} from './story-continuation-diagnostic-context';
import { assembleContinuationRouteContinuity } from './story-continuation-route-continuity';

function fixture(sourceKind: 'canonical' | 'generated' = 'canonical') {
  const input: StoryContinuationDiagnosticContextInput = {
    userId: '00000000-0000-4000-8000-000000000064', workId: '00000000-0000-4000-8000-000000000065', releaseId: '00000000-0000-4000-8000-000000000066', manuscriptVersionId: '00000000-0000-4000-8000-000000000067', analysisJobId: '00000000-0000-4000-8000-000000000068',
    locale: 'ko', sourceKind,
    progress: { id: '00000000-0000-4000-8000-000000000069', userId: '00000000-0000-4000-8000-000000000064', workId: '00000000-0000-4000-8000-000000000065', activeReleaseId: '00000000-0000-4000-8000-000000000066',
      status: 'active', progressRevision: 7, currentSceneId: '00000000-0000-4000-8000-00000000006d', currentGeneratedSceneId: null,
      currentBeatPosition: 2, routeNodeId: '00000000-0000-4000-8000-000000000076', pathSummary: [{
        sceneId: '00000000-0000-4000-8000-00000000006c', choiceId: '00000000-0000-4000-8000-00000000006f', nextSceneId: '00000000-0000-4000-8000-00000000006d',
        readBeatPosition: 2, explicitRejoin: false,
      }] },
    part: { id: '00000000-0000-4000-8000-00000000006b', position: 2 },
    scene: { id: '00000000-0000-4000-8000-00000000006d', partId: '00000000-0000-4000-8000-00000000006b', title: { ko: '  Current source title  ' } },
    choice: { id: '00000000-0000-4000-8000-000000000070', sceneId: '00000000-0000-4000-8000-00000000006d', routeKind: 'generation_required',
      label: { ko: '  Current explicit choice tail  ' } },
    generationProfile: {
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
      sections: [
        { key: 'branch_behavior', value: { summary: '  Full branch condition and exception  ' } },
        { key: 'writing_style', value: {
          summary: '  Full style summary '.repeat(40) + ' SUMMARY_TAIL  ',
          genericApprovedRule: { keep: '  GENERIC_TAIL  ', order: ['first', 'middle', 'last'] },
          observations: ['first', 'middle', 'last'].map((word) => ({
            title: `  ${word} title  `, detail: `${word} detail `.repeat(40) + ` ${word}_TAIL  `,
          })),
          categories: ['first', 'middle', 'last'].map((word) => ({ category: word,
            observations: [`  ${word} pattern `.repeat(30) + ` ${word}_CATEGORY_TAIL  `] })),
        } },
        { key: 'scene_scale', value: { summary: '  Entire approved scene scale  ' } },
      ],
    },
  };
  const parts = [{ id: '00000000-0000-4000-8000-00000000006a', position: 1 }, { id: '00000000-0000-4000-8000-00000000006b', position: 2 }];
  const scenes: any[] = [
    { id: '00000000-0000-4000-8000-00000000006c', partId: '00000000-0000-4000-8000-00000000006a', sceneKey: 's1-main', title: { ko: 'Prior source' }, endingType: null },
    { id: '00000000-0000-4000-8000-00000000006d', partId: '00000000-0000-4000-8000-00000000006b', sceneKey: 's2-main', title: input.scene.title, endingType: null },
    { id: '00000000-0000-4000-8000-00000000006e', partId: '00000000-0000-4000-8000-00000000006b', sceneKey: 's2-second', title: { ko: 'Other authored scene' }, endingType: null },
  ];
  const choices: any[] = [
    { id: '00000000-0000-4000-8000-00000000006f', sceneId: '00000000-0000-4000-8000-00000000006c', label: { ko: 'Prior explicit choice' },
      targetEndingKey: null, declaredRejoinSceneId: null }, input.choice,
  ];
  const generatedScenes: any[] = [];
  const generatedChoices: any[] = [];
  const canonicalBeats: any[] = [
    { sceneId: '00000000-0000-4000-8000-00000000006d', position: 1, beatType: 'paragraph', content: { ko: '  ABCD  ' } },
    { sceneId: '00000000-0000-4000-8000-00000000006d', position: 2, beatType: 'dialogue', content: { ko: ' EFGHIJ \n' } },
    { sceneId: '00000000-0000-4000-8000-00000000006e', position: 1, beatType: 'paragraph', content: { ko: 'X'.repeat(90) } },
    { sceneId: '00000000-0000-4000-8000-00000000006e', position: 2, beatType: 'scene_break', content: { ko: '---' } },
  ];
  const generatedBeats: any[] = [];
  const routeRows: any[] = [
    { id: '00000000-0000-4000-8000-000000000075', parent_id: null, depth: 0, step_kind: 'root', target_scene_id: '00000000-0000-4000-8000-00000000006c',
      source_shared_result_id: null, route_hash: 'a'.repeat(64), narrative_step: null },
    { id: '00000000-0000-4000-8000-000000000076', parent_id: '00000000-0000-4000-8000-000000000075', depth: 1, step_kind: 'canonical', target_scene_id: '00000000-0000-4000-8000-00000000006d',
      source_shared_result_id: null, route_hash: 'b'.repeat(64), narrative_step: input.progress.pathSummary[0] },
  ];
  if (sourceKind === 'generated') {
    const step = { sourceSceneId: '00000000-0000-4000-8000-00000000006d', sourceGeneratedSceneId: null, choiceId: '00000000-0000-4000-8000-000000000070',
      generatedSceneId: '00000000-0000-4000-8000-000000000071', readBeatPosition: 2, provenance: 'ai_generated' };
    input.progress.pathSummary.push(step);
    input.progress.currentSceneId = null;
    input.progress.currentGeneratedSceneId = '00000000-0000-4000-8000-000000000071';
    input.progress.routeNodeId = '00000000-0000-4000-8000-000000000077';
    input.scene = { id: '00000000-0000-4000-8000-000000000071', sourcePartId: '00000000-0000-4000-8000-00000000006b', sharedResultId: null,
      title: { ko: '  Generated source title  ' }, endingType: null };
    input.choice = { id: '00000000-0000-4000-8000-000000000073', sceneId: '00000000-0000-4000-8000-000000000071', routeKind: 'generation_required',
      label: { ko: '  Generated explicit choice  ' } };
    generatedScenes.push(input.scene);
    generatedChoices.push(input.choice);
    generatedBeats.push(
      { sceneId: '00000000-0000-4000-8000-000000000071', position: 1, beatType: 'paragraph', content: { ko: 'MNOP' } },
      { sceneId: '00000000-0000-4000-8000-000000000071', position: 2, beatType: 'dialogue', content: { ko: 'QRSTUV' } },
      { sceneId: '00000000-0000-4000-8000-000000000071', position: 3, beatType: 'paragraph', content: { ko: 'UNREAD_FUTURE' } },
    );
    routeRows.push({ id: '00000000-0000-4000-8000-000000000077', parent_id: '00000000-0000-4000-8000-000000000076', depth: 2, step_kind: 'canonical', target_scene_id: null,
      source_shared_result_id: null, route_hash: 'c'.repeat(64), narrative_step: step });
  }
  const memory = (id: string, memoryType: string, partKey: string | null, content: any) => ({
    id, memoryKey: id, memoryType, partKey, revision: 3, content,
    workId: '00000000-0000-4000-8000-000000000065', manuscriptVersionId: '00000000-0000-4000-8000-000000000067', analysisJobId: '00000000-0000-4000-8000-000000000068', status: 'approved',
  });
  const memoryRows: any[] = [
    ...Array.from({ length: 8 }, (_, i) => memory(`style-${i}`, 'style', null, `  style-${i} TAIL  `)),
    memory('prior-event', 'event', 's1', 'established prior event'),
    memory('current-event', 'event', 's2', 'established current event'),
    memory('hint', 'foreshadow', 's1', 'future hint on a reached part'),
    memory('future', 'event', 's3', 'future authored event'),
    memory('unvisited', 'branch', 's0', 'unvisited authored branch'),
    memory('global', 'entity', null, { z: '  structured tail  ', a: 'structured first' }),
    { ...memory('wrong-analysis', 'event', 's2', 'OTHER_ANALYSIS'), analysisJobId: '00000000-0000-4000-8000-00000000007f' },
    { ...memory('wrong-manuscript', 'style', null, 'OTHER_MANUSCRIPT'), manuscriptVersionId: '00000000-0000-4000-8000-000000000080' },
  ];
  const events = [{ sceneId: '00000000-0000-4000-8000-00000000006c', targetSceneId: '00000000-0000-4000-8000-00000000006d' }];
  const rawQueries: Array<{ sql: string; values: unknown[] }> = [];
  const forbidden = jest.fn(() => { throw new Error('unexpected_write_or_dependency'); });
  const delegate = (reads: Record<string, jest.Mock>): Record<string, jest.Mock> => new Proxy(reads, {
    get: (target, key) => typeof key === 'string' && key in target ? target[key as string] : forbidden,
  });
  const byIds = (rows: any[], where: any) => {
    if (!Array.isArray(where.id.in) || where.id.in.some((id: unknown) => typeof id !== 'string' || !isUUID(id))) {
      throw new Error('synthetic_uuid_query_shape_invalid');
    }
    return rows.filter((row) => where.id.in.includes(row.id));
  };
  const db = {
    storyPart: delegate({ findMany: jest.fn(async ({ where }) =>
      parts.filter((row) => !where.position || row.position <= where.position.lte)) }),
    storyScene: delegate({ findMany: jest.fn(async ({ where }) => {
      if (typeof where.partId === 'string') return scenes.filter((row) => row.partId === where.partId);
      const rows = byIds(scenes, where);
      return rows.filter((row) => (!where.partId || where.partId.in.includes(row.partId)) &&
        (!where.sceneKey || row.sceneKey.endsWith(where.sceneKey.endsWith)));
    }) }),
    storyChoice: delegate({ findMany: jest.fn(async ({ where }) => byIds(choices, where)) }),
    storyCustomChoice: delegate({ findMany: jest.fn(async () => []) }),
    storyAiGeneratedScene: delegate({ findMany: jest.fn(async ({ where }) => byIds(generatedScenes, where)) }),
    storyAiGeneratedChoice: delegate({ findMany: jest.fn(async ({ where }) => byIds(generatedChoices, where)) }),
    storyBeat: delegate({ findMany: jest.fn(async ({ where, take }) => canonicalBeats
      .filter((row) => typeof where.sceneId === 'string' ? row.sceneId === where.sceneId : where.sceneId.in.includes(row.sceneId))
      .slice(0, take)) }),
    storyAiGeneratedBeat: delegate({ findMany: jest.fn(async ({ where, take }) => generatedBeats
      .filter((row) => (typeof where.sceneId === 'string' ? row.sceneId === where.sceneId : where.sceneId.in.includes(row.sceneId)) &&
        (!where.position || row.position <= where.position.lte)).slice(0, take)) }),
    storyChoiceEvent: delegate({ findMany: jest.fn(async () => events) }),
    storyMemoryRecord: delegate({ findMany: jest.fn(async ({ where, orderBy, take }) => memoryRows
      .filter((row) => ['workId', 'manuscriptVersionId', 'analysisJobId', 'status'].every((key) => row[key] === where[key]))
      .filter((row) => typeof where.memoryType === 'string' ? row.memoryType === where.memoryType : where.memoryType.in.includes(row.memoryType))
      .filter((row) => !where.partKey || where.partKey.in.includes(row.partKey))
      .filter((row) => !where.OR || row.partKey === null || !where.OR[1].partKey.notIn.includes(row.partKey))
      .sort((left, right) => {
        for (const order of orderBy) {
          const [key, direction] = Object.entries(order)[0];
          const compared = String(left[key] ?? '').localeCompare(String(right[key] ?? ''));
          if (compared) return direction === 'asc' ? compared : -compared;
        }
        return 0;
      }).slice(0, take)) }),
    storyProgressArtistParticipant: delegate({ findUnique: jest.fn(async () => null) }),
    artistStoryIdentityProfile: delegate({ findFirst: jest.fn(async () => null) }),
    artistAsset: delegate({ findMany: jest.fn(async () => []) }),
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      rawQueries.push({ sql, values });
      if (/\b(?:INSERT|UPDATE|DELETE|FOR\s+SHARE|FOR\s+UPDATE|LOCK|CREATE|ALTER|SET)\b/i.test(sql)) return forbidden();
      return sql.includes('step_kind') ? routeRows : routeRows.filter((row) => row.narrative_step !== null)
        .map((row) => ({ depth: row.depth, narrative_step: row.narrative_step }));
    }),
    $executeRaw: forbidden, $queryRawUnsafe: forbidden, $executeRawUnsafe: forbidden, $transaction: forbidden,
  };
  const tx = new Proxy(db, { get: (target, key) => key in target ? Reflect.get(target, key) : forbidden });
  return { input, db, tx, forbidden, rawQueries, parts, scenes, choices, generatedScenes, generatedChoices,
    canonicalBeats, generatedBeats, routeRows, memoryRows, memory, events };
}

async function read(f: ReturnType<typeof fixture>) {
  return readStoryContinuationDiagnosticContext(f.tx as never, f.input);
}

function addParticipant(f: ReturnType<typeof fixture>) {
  const settings = { schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'artist', sections: [
    { key: 'fixed_identity', decision: 'accepted', value: { hair: '  identity tail  ' }, evidence: [] },
    { key: 'adaptable_presentation', decision: 'edited', value: { wardrobe: true }, evidence: [] },
  ] };
  const profile: any = { id: '00000000-0000-4000-8000-000000000079', artistId: '00000000-0000-4000-8000-00000000007a', profileVersion: 2, reviewRevision: 3, status: 'approved',
    sourceFingerprint: 'd'.repeat(64), approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint('d'.repeat(64), normalizeCreatorGenerationProfile('artist', settings)) };
  const participant: any = { id: '00000000-0000-4000-8000-00000000007b', progressId: '00000000-0000-4000-8000-000000000069', userId: '00000000-0000-4000-8000-000000000064', workId: '00000000-0000-4000-8000-000000000065', artistId: '00000000-0000-4000-8000-00000000007a',
    artist: { id: '00000000-0000-4000-8000-00000000007a', slug: 'participant-artist', displayName: 'Participant Artist' },
    identityProfileId: '00000000-0000-4000-8000-000000000079', identityProfileVersion: 2, identityReviewRevision: 3,
    identitySourceFingerprint: profile.sourceFingerprint, identityApprovedFingerprint: profile.approvedFingerprint,
    referenceAssetIds: ['00000000-0000-4000-8000-00000000007c'], referenceChecksums: ['e'.repeat(64)], participantFingerprint: '' };
  const rehash = () => { participant.participantFingerprint = createHash('sha256').update(stableJson({
    artistId: participant.artistId, slug: participant.artist.slug, displayName: participant.artist.displayName,
    identity: participant.identityProfileId ? { id: participant.identityProfileId, profileVersion: participant.identityProfileVersion,
      reviewRevision: participant.identityReviewRevision, sourceFingerprint: participant.identitySourceFingerprint,
      approvedFingerprint: participant.identityApprovedFingerprint } : null,
    referenceAssetIds: participant.referenceAssetIds, referenceChecksums: participant.referenceChecksums,
  })).digest('hex'); };
  rehash();
  const assets: any[] = [{ assetId: '00000000-0000-4000-8000-00000000007c', asset: { checksum: 'e'.repeat(64), metadata: { lifecycle: { status: 'active' } } } }];
  f.db.storyProgressArtistParticipant.findUnique.mockImplementation(async () => participant);
  f.db.artistStoryIdentityProfile.findFirst.mockImplementation(async ({ where }) =>
    Object.keys(where).every((key) => profile[key] === where[key]) ? profile : null);
  f.db.artistAsset.findMany.mockImplementation(async () => assets);
  return { participant, profile, assets, rehash };
}

describe('read-only continuation diagnostic context', () => {
  it.each(['sceneId', 'sourceSceneId', 'sourceGeneratedSceneId', 'choiceId', 'customChoiceId',
    'nextSceneId', 'generatedSceneId'])('rejects malformed stored %s before any UUID query', async key => {
    const f = fixture();
    f.input.progress.pathSummary[0][key] = 'not-a-uuid';
    await expect(read(f)).rejects.toBeInstanceOf(StoryContinuationDiagnosticContextUnavailable);
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
    expect(f.db.storyChoice.findMany).not.toHaveBeenCalled();
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it.each([7, true, {}, ['not-a-uuid']])('rejects stored non-string reference %s before reads', async value => {
    const f = fixture(); f.input.progress.pathSummary[0].choiceId = value;
    await expect(read(f)).rejects.toBeInstanceOf(StoryContinuationDiagnosticContextUnavailable);
    expect(f.db.$queryRaw).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });

  it('rejects malformed route JSON even when the progress reference remains valid', async () => {
    const f = fixture();
    f.routeRows[1].narrative_step = { ...f.routeRows[1].narrative_step, choiceId: 'not-a-uuid' };
    await expect(read(f)).rejects.toBeInstanceOf(StoryContinuationDiagnosticContextUnavailable);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.db.storyChoice.findMany).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });

  it('matches real path/route readers and retains complete source and approved profile/style without rewriting', async () => {
    const f = fixture();
    const before = stableContinuationJson(f.input.generationProfile);
    const context = await read(f);
    expect(context.sourceScene).toEqual({ title: '  Current source title  ', beats: [
      { beatType: 'paragraph', content: '  ABCD  ' }, { beatType: 'dialogue', content: ' EFGHIJ \n' },
    ] });
    expect(context.selectedChoice.label).toBe('  Current explicit choice tail  ');
    expect(context.generationProfile).toBe(f.input.generationProfile);
    expect(stableContinuationJson(context.generationProfile)).toBe(before);
    expect(context.narrativeLength).toMatchObject({ referenceUnits: 10, targetUnits: 10, minUnits: 8, maxUnits: 12 });
    expect(context.path).toEqual(await assembleContinuationSemanticPath(f.tx, {
      pathSummary: f.input.progress.pathSummary, locale: 'ko', userId: '00000000-0000-4000-8000-000000000064', workId: '00000000-0000-4000-8000-000000000065',
      releaseId: '00000000-0000-4000-8000-000000000066', progressId: '00000000-0000-4000-8000-000000000069',
    }));
    expect(context.routeContinuity).toEqual(await assembleContinuationRouteContinuity(f.tx, {
      routeNodeId: '00000000-0000-4000-8000-000000000076', progressId: '00000000-0000-4000-8000-000000000069', workId: '00000000-0000-4000-8000-000000000065', releaseId: '00000000-0000-4000-8000-000000000066',
      userId: '00000000-0000-4000-8000-000000000064', locale: 'ko', pathSummary: f.input.progress.pathSummary,
    }));
    expect(context.routeContinuity?.actions).toEqual([{ step: 1, choiceLabel: 'Prior explicit choice' }]);
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it('uses the established 8-to-3 style sampler, reached ordering and future-plan tags in the exact approval scope', async () => {
    const f = fixture();
    const context = await read(f);
    expect(context.memories.filter((item) => item.memoryType === 'style').map((item) => item.content))
      .toEqual(['  style-0 TAIL  ', '  style-3 TAIL  ', '  style-7 TAIL  ']);
    expect(context.memories.filter((item) => item.memoryType === 'event').map((item) => item.content))
      .toEqual(['established prior event', 'established current event']);
    expect(context.memories).toEqual(expect.arrayContaining([
      { memoryType: 'author_plan_foreshadow', content: 'future hint on a reached part' },
      { memoryType: 'author_plan_event', content: 'future authored event' },
      { memoryType: 'author_plan_branch', content: 'unvisited authored branch' },
      { memoryType: 'author_plan_entity', content: '{"a":"structured first","z":"  structured tail  "}' },
    ]));
    expect(context.memories.some((item) => item.content.includes('OTHER_'))).toBe(false);
    for (const [query] of f.db.storyMemoryRecord.findMany.mock.calls) {
      expect(query.where).toMatchObject({ workId: '00000000-0000-4000-8000-000000000065', manuscriptVersionId: '00000000-0000-4000-8000-000000000067',
        analysisJobId: '00000000-0000-4000-8000-000000000068', status: 'approved' });
    }
    expect(f.db.storyChoiceEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { progressId: '00000000-0000-4000-8000-000000000069', invalidatedAt: null }, take: 1024,
    }));
  });

  it('prioritizes and samples 32 reached rows after the same bounded 128-row read without adding a new text cap', async () => {
    const f = fixture();
    f.memoryRows.splice(0, f.memoryRows.length, ...Array.from({ length: 8 }, (_, i) =>
      f.memory(`style-${i}`, 'style', null, `  style-${i} TAIL  `)),
    ...Array.from({ length: 40 }, (_, i) => f.memory(`event-${String(i).padStart(3, '0')}`, 'event', 's2', `current-${i}`)),
    ...Array.from({ length: 40 }, (_, i) => f.memory(`old-${String(i).padStart(3, '0')}`, 'event', 's1', `prior-${i}`)));
    const context = await read(f);
    expect(context.memories.filter((item) => item.memoryType === 'event').map((item) => item.content))
      .toEqual(Array.from({ length: 32 }, (_, i) => `current-${i}`));
    expect(f.db.storyMemoryRecord.findMany.mock.calls.map(([query]) => query.take)).toEqual([8, 128, 15]);
  });

  it('uses generated read-prefix beats but the complete authored published part for the 80-120% length reference', async () => {
    const f = fixture('generated');
    const context = await read(f);
    expect(context.sourceScene.beats.map((beat) => beat.content)).toEqual(['MNOP', 'QRSTUV']);
    expect(context.narrativeLength).toMatchObject({ referenceUnits: 100, minUnits: 80, targetUnits: 100, maxUnits: 120 });
    expect(f.db.storyAiGeneratedBeat.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sceneId: '00000000-0000-4000-8000-000000000071', position: { lte: 2 } }, take: 41,
    }));
    expect(f.db.storyScene.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { partId: '00000000-0000-4000-8000-00000000006b', status: 'published', fixtureSource: false }, take: 101,
    }));
    expect(f.db.storyBeat.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sceneId: { in: ['00000000-0000-4000-8000-00000000006d', '00000000-0000-4000-8000-00000000006e'] } }, take: 1001,
    }));
    expect(context.path).toHaveLength(2);
    expect(context.routeContinuity?.actions).toHaveLength(2);
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it('includes actual prior generated read evidence, never its unread future beats', async () => {
    const f = fixture('generated');
    const step = { sourceGeneratedSceneId: '00000000-0000-4000-8000-000000000071', choiceId: '00000000-0000-4000-8000-000000000073',
      generatedSceneId: '00000000-0000-4000-8000-000000000072', readBeatPosition: 2 };
    f.input.progress.pathSummary.push(step);
    f.input.progress.routeNodeId = '00000000-0000-4000-8000-000000000078';
    f.input.progress.currentGeneratedSceneId = '00000000-0000-4000-8000-000000000072';
    f.input.scene = { id: '00000000-0000-4000-8000-000000000072', sourcePartId: '00000000-0000-4000-8000-00000000006b', sharedResultId: null, title: { ko: 'Next generated source' } };
    f.input.choice = { id: '00000000-0000-4000-8000-000000000074', sceneId: '00000000-0000-4000-8000-000000000072', routeKind: 'generation_required', label: { ko: 'Next choice' } };
    f.generatedScenes.push(f.input.scene);
    f.generatedChoices.push(f.input.choice);
    f.generatedBeats.push({ sceneId: '00000000-0000-4000-8000-000000000072', position: 1, beatType: 'paragraph', content: { ko: 'ABCD' } },
      { sceneId: '00000000-0000-4000-8000-000000000072', position: 2, beatType: 'paragraph', content: { ko: 'EFGHIJ' } });
    f.routeRows.push({ id: '00000000-0000-4000-8000-000000000078', parent_id: '00000000-0000-4000-8000-000000000077', depth: 3, step_kind: 'private', target_scene_id: null,
      source_shared_result_id: null, route_hash: 'f'.repeat(64), narrative_step: step });
    const context = await read(f);
    expect(context.routeContinuity?.readEvidence).toEqual([{ step: 3, text: 'MNOP / QRSTUV' }]);
    expect(stableContinuationJson(context)).not.toContain('UNREAD_FUTURE');
    expect(f.db.storyAiGeneratedScene.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: '00000000-0000-4000-8000-000000000064', workId: '00000000-0000-4000-8000-000000000065', progressId: '00000000-0000-4000-8000-000000000069',
        releaseId: '00000000-0000-4000-8000-000000000066', status: 'ready' }),
    }));
  });

  it('measures a legitimate current root instead of treating every absent history as unavailable', async () => {
    const f = fixture();
    f.routeRows.splice(1);
    f.routeRows[0].target_scene_id = '00000000-0000-4000-8000-00000000006d';
    f.input.progress.routeNodeId = '00000000-0000-4000-8000-000000000075';
    f.input.progress.pathSummary = [];
    f.events.splice(0);
    const context = await read(f);
    expect(context.path).toEqual([]);
    expect(context.routeContinuity).toMatchObject({ actions: [], readEvidence: [] });
    expect(context.sourceScene.beats).toHaveLength(2);
    expect(context.narrativeLength?.referenceUnits).toBe(10);
    expect(context.generationProfile).toBe(f.input.generationProfile);
  });

  it.each([
    ['missing current route', (f: ReturnType<typeof fixture>) => { f.input.progress.routeNodeId = null; }],
    ['missing route rows', (f: ReturnType<typeof fixture>) => { f.routeRows.splice(0); }],
    ['missing root', (f: ReturnType<typeof fixture>) => { f.routeRows.shift(); }],
    ['missing route hash', (f: ReturnType<typeof fixture>) => { f.routeRows[1].route_hash = null; }],
    ['changed current node', (f: ReturnType<typeof fixture>) => { f.routeRows[1].id = 'other-route'; }],
    ['broken parent chain', (f: ReturnType<typeof fixture>) => { f.routeRows[1].parent_id = 'other-parent'; }],
    ['broken depth', (f: ReturnType<typeof fixture>) => { f.routeRows[1].depth = 9; }],
    ['changed current target', (f: ReturnType<typeof fixture>) => { f.routeRows[1].target_scene_id = 'other-scene'; }],
    ['changed path references', (f: ReturnType<typeof fixture>) => { f.input.progress.pathSummary = [{
      ...f.input.progress.pathSummary[0], choiceId: 'other-choice',
    }]; }],
    ['missing path history', (f: ReturnType<typeof fixture>) => { f.input.progress.pathSummary = []; }],
    ['unrecorded legacy choice', (f: ReturnType<typeof fixture>) => { delete f.routeRows[1].narrative_step.choiceId; }],
    ['unproven shared ancestry', (f: ReturnType<typeof fixture>) => { f.routeRows[1].source_shared_result_id = 'shared'; }],
  ])('rejects %s without repair or locks', async (_label, mutate) => {
    const f = fixture();
    mutate(f);
    await expect(read(f)).rejects.toBeInstanceOf(StoryContinuationDiagnosticContextUnavailable);
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported locale', (f: ReturnType<typeof fixture>) => { f.input.locale = 'fr'; }],
    ['missing source title locale', (f: ReturnType<typeof fixture>) => { f.input.scene.title = { en: 'No locale fallback' }; }],
    ['missing current choice locale', (f: ReturnType<typeof fixture>) => { f.input.choice.label = { en: 'No locale fallback' }; }],
    ['missing source beat locale', (f: ReturnType<typeof fixture>) => { f.canonicalBeats[0].content = { en: 'No locale fallback' }; }],
    ['missing memory locale', (f: ReturnType<typeof fixture>) => { f.memoryRows[0].content = { en: 'No locale fallback' }; }],
    ['missing script-qualified memory locale', (f: ReturnType<typeof fixture>) => { f.memoryRows[0].content = { 'zh-Hans': 'No locale fallback' }; }],
    ['missing semantic title locale', (f: ReturnType<typeof fixture>) => { f.scenes[0].title = { en: 'No locale fallback' }; }],
    ['missing historical choice locale', (f: ReturnType<typeof fixture>) => { f.choices[0].label = { en: 'No locale fallback' }; }],
    ['changed semantic source', (f: ReturnType<typeof fixture>) => { f.choices[0].sceneId = 'other-scene'; }],
    ['source beat gap', (f: ReturnType<typeof fixture>) => { f.canonicalBeats[0].position = 0; }],
    ['missing published source part', (f: ReturnType<typeof fixture>) => { f.parts.splice(1); }],
    ['missing approved profile', (f: ReturnType<typeof fixture>) => { f.input.generationProfile = undefined; }],
  ])('reports only the stable typed error for %s', async (_label, mutate) => {
    const f = fixture();
    mutate(f);
    await expect(read(f)).rejects.toMatchObject({ code: 'diagnostic_context_unavailable', message: 'diagnostic_context_unavailable' });
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it('preserves the participant and exact identity/profile/reference validation without service/config access', async () => {
    const f = fixture();
    const p = addParticipant(f);
    const context = await read(f);
    expect(context.participantArtist).toEqual({ artistId: '00000000-0000-4000-8000-00000000007a', slug: 'participant-artist', displayName: 'Participant Artist',
      visualIdentityReady: true, identityProfile: { schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
        sections: normalizeCreatorGenerationProfile('artist', p.profile.approvedSettings).sections
          .map((section) => ({ key: section.key, value: section.value })) } });
    expect(f.db.artistStoryIdentityProfile.findFirst).toHaveBeenCalledWith({ where: {
      id: '00000000-0000-4000-8000-000000000079', artistId: '00000000-0000-4000-8000-00000000007a', profileVersion: 2, reviewRevision: 3,
      sourceFingerprint: p.profile.sourceFingerprint, approvedFingerprint: p.profile.approvedFingerprint, status: 'approved',
    } });
    expect(f.db.artistAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { artistId: '00000000-0000-4000-8000-00000000007a', assetId: { in: ['00000000-0000-4000-8000-00000000007c'] }, asset: { visibility: 'public' } },
    }));
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it.each(['participant pin', 'artist identity', 'participant owner', 'profile pin', 'profile fingerprint',
    'missing asset', 'asset checksum', 'archived asset', 'invalid normalized profile'])('rejects a changed %s rather than dropping participation', async (change) => {
    const f = fixture();
    const p = addParticipant(f);
    if (change === 'participant pin') p.participant.participantFingerprint = 'f'.repeat(64);
    if (change === 'artist identity') p.participant.artist.id = '00000000-0000-4000-8000-00000000007e';
    if (change === 'participant owner') p.participant.userId = '00000000-0000-4000-8000-00000000007d';
    if (change === 'profile pin') p.profile.reviewRevision++;
    if (change === 'profile fingerprint') p.profile.approvedSettings.sections[0].value.hair = 'changed';
    if (change === 'missing asset') p.assets.splice(0);
    if (change === 'asset checksum') p.assets[0].asset.checksum = 'f'.repeat(64);
    if (change === 'archived asset') p.assets[0].asset.metadata.lifecycle.status = 'archived';
    if (change === 'invalid normalized profile') p.profile.approvedSettings.schemaVersion = 'unknown';
    await expect(read(f)).rejects.toBeInstanceOf(StoryContinuationDiagnosticContextUnavailable);
    expect(f.forbidden).not.toHaveBeenCalled();
  });

  it('retains the existing null-identity participant contract instead of omitting an intact legacy participant', async () => {
    const f = fixture();
    const p = addParticipant(f);
    Object.assign(p.participant, { identityProfileId: null, identityProfileVersion: null, identityReviewRevision: null,
      identitySourceFingerprint: null, identityApprovedFingerprint: null, referenceAssetIds: [], referenceChecksums: [] });
    p.rehash();
    const context = await read(f);
    expect(context.participantArtist).toMatchObject({ artistId: '00000000-0000-4000-8000-00000000007a', visualIdentityReady: false });
    expect(f.db.artistStoryIdentityProfile.findFirst).not.toHaveBeenCalled();
    expect(f.db.artistAsset.findMany).not.toHaveBeenCalled();
  });

  it('executes only scoped read queries on the supplied transaction and never a row lock, repair or write', async () => {
    const f = fixture('generated');
    addParticipant(f);
    const before = stableContinuationJson({ input: f.input, memories: f.memoryRows, route: f.routeRows });
    await read(f);
    expect(f.forbidden).not.toHaveBeenCalled();
    expect(f.rawQueries).toHaveLength(2);
    for (const query of f.rawQueries) {
      expect(query.sql).toContain('WITH RECURSIVE ancestry');
      expect(query.sql).toContain('progress_id=');
      expect(query.sql).toContain('work_id=');
      expect(query.sql).toContain('release_id=');
      expect(query.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|FOR\s+SHARE|FOR\s+UPDATE|LOCK|CREATE|ALTER|SET)\b/i);
      expect(query.values).toEqual(expect.arrayContaining(['00000000-0000-4000-8000-000000000077', '00000000-0000-4000-8000-000000000069', '00000000-0000-4000-8000-000000000065', '00000000-0000-4000-8000-000000000066']));
    }
    expect(stableContinuationJson({ input: f.input, memories: f.memoryRows, route: f.routeRows })).toBe(before);
  });

  it('converts known length policy failures but propagates unknown database/runtime errors for safe parent 503 masking', async () => {
    const f = fixture();
    f.canonicalBeats[0].content = { ko: '\ud800' };
    await expect(read(f)).rejects.toBeInstanceOf(StoryContinuationDiagnosticContextUnavailable);
    const dbFailure = new Error('synthetic_database_outage');
    const g = fixture();
    g.db.storyMemoryRecord.findMany.mockRejectedValue(dbFailure);
    await expect(read(g)).rejects.toBe(dbFailure);
    const runtimeFailure = new TypeError('synthetic_runtime_failure');
    g.db.storyMemoryRecord.findMany.mockRejectedValue(runtimeFailure);
    await expect(read(g)).rejects.toBe(runtimeFailure);
    const unrelatedBadRequest = new BadRequestException({ code: 'UNRELATED_RUNTIME_INPUT' });
    g.db.storyMemoryRecord.findMany.mockRejectedValue(unrelatedBadRequest);
    await expect(read(g)).rejects.toBe(unrelatedBadRequest);
    expect(f.forbidden).not.toHaveBeenCalled();
    expect(g.forbidden).not.toHaveBeenCalled();
  });
});
