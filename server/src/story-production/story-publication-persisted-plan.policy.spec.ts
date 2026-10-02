import { ConflictException } from '@nestjs/common';
import {
  comparePublicationPlanStorage,
  PublicationPlanStoragePlan,
  PublicationPlanStoredRows,
} from './story-publication-persisted-plan.policy';

function fixture() {
  const plan = {
    parts: Array.from({ length: 3 }, (_, index) => {
      const position = index + 1;
      return {
        partKey: `chapter-${position}`,
        title: `\uc81c${position}\ud654`,
        actNumber: position === 3 ? 2 : 1,
        position,
        beats: [1, 2].map(ordinal => ({
          text: `\ubcf8\ubb38 ${position}-${ordinal}\n\ub300\uc0ac\ub97c \uc77d\ub294\ub2e4.`,
          sourceSceneKey: `chapter-${position}-source-${ordinal}`,
        })),
        choices: [
          { choiceKey: position === 3 ? 'finish' : 'next', label: `Original ${position}`, position: 1,
            routeKind: 'writer_original', targetPartKey: position === 3 ? null : `chapter-${position + 1}`,
            targetEndingKey: position === 3 ? 'author_main' : null },
          { choiceKey: 'branch-b', label: `Investigate ${position}`, position: 2,
            routeKind: 'generation_required', targetPartKey: null, targetEndingKey: null },
          { choiceKey: 'branch-c', label: `Rescue ${position}`, position: 3,
            routeKind: 'generation_required', targetPartKey: null, targetEndingKey: null },
        ],
      };
    }),
  } satisfies PublicationPlanStoragePlan;
  const stored = {
    parts: plan.parts.map(part => ({ id: `db-part-${part.position}`, position: part.position,
      actNumber: part.actNumber, title: { ko: part.title, en: 'Other locale' } })),
    scenes: plan.parts.map(part => ({ id: `db-scene-${part.position}`, partId: `db-part-${part.position}`,
      sceneKey: `${part.partKey}-main`, position: 1 })),
    beats: plan.parts.flatMap(part => part.beats.map((beat, index) => ({
      id: `beat-${part.position}-${index + 1}`, sceneId: `db-scene-${part.position}`, position: index + 1,
      content: { ko: beat.text, en: 'Other locale' }, sourceSceneKey: beat.sourceSceneKey,
    }))),
    choices: plan.parts.flatMap(part => part.choices.map(choice => ({
      id: `choice-${part.position}-${choice.position}`, sceneId: `db-scene-${part.position}`,
      choiceKey: choice.choiceKey, position: choice.position, label: { ko: choice.label, en: 'Other locale' },
      routeKind: choice.routeKind,
      targetSceneId: choice.targetPartKey ? `db-scene-${part.position + 1}` : null,
      targetEndingKey: choice.targetEndingKey, declaredRejoinSceneId: null as string | null,
    }))),
  } satisfies PublicationPlanStoredRows;
  return { plan, stored };
}

function expectMismatch(callback: () => void) {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'STORY_PUBLICATION_STORED_PLAN_MISMATCH',
    });
    return;
  }
  throw new Error('Expected a stored-plan mismatch');
}

describe('publication persisted plan comparison', () => {
  it('accepts three exact parts, their original destinations, and the authored ending', () => {
    const { plan, stored } = fixture();
    expect(comparePublicationPlanStorage(plan, stored)).toBeUndefined();
  });

  it('compares positions rather than query array order without mutating its inputs', () => {
    const { plan, stored } = fixture();
    stored.parts.reverse();
    stored.scenes.reverse();
    stored.beats.reverse();
    stored.choices.reverse();
    const before = JSON.stringify({ plan, stored });
    comparePublicationPlanStorage(plan, stored);
    expect(JSON.stringify({ plan, stored })).toBe(before);
  });

  it('allows unrelated fields and locales, and does not compare beat or choice IDs', () => {
    const { plan, stored } = fixture();
    const extraRows = {
      ...stored,
      parts: stored.parts.map(part => ({ ...part, status: 'published', title: { ...part.title, ja: 'Extra' } })),
      scenes: stored.scenes.map(scene => ({ ...scene, fixtureSource: false })),
      beats: stored.beats.map(({ id: _id, ...beat }) => ({ ...beat, content: { ...beat.content, fr: 'Extra' } })),
      choices: stored.choices.map(({ id: _id, ...choice }) => ({ ...choice, label: { ...choice.label, ja: 'Extra' } })),
    };
    comparePublicationPlanStorage(plan, extraRows);
  });

  it('leaves alternative route policy to the caller while comparing planned routes exactly', () => {
    const { plan, stored } = fixture();
    plan.parts[0].choices[1].routeKind = 'caller_defined_alternative';
    stored.choices[1].routeKind = 'caller_defined_alternative';
    comparePublicationPlanStorage(plan, stored);
    stored.choices[1].routeKind = 'generation_required';
    expectMismatch(() => comparePublicationPlanStorage(plan, stored));
  });

  const cases: Array<[string, (data: ReturnType<typeof fixture>) => void]> = [
    ['missing part', ({ stored }) => { stored.parts.pop(); }],
    ['extra part', ({ stored }) => { stored.parts.push({ ...stored.parts[0], id: 'foreign-part', position: 4 }); }],
    ['duplicate part ID', ({ stored }) => { stored.parts[1].id = stored.parts[0].id; }],
    ['duplicate part position', ({ stored }) => { stored.parts[1].position = 1; }],
    ['shifted part position', ({ stored }) => { stored.parts[1].position = 4; }],
    ['wrong act', ({ stored }) => { stored.parts[2].actNumber = 1; }],
    ['stale part title', ({ stored }) => { stored.parts[1].title.ko += ' changed'; }],
    ['missing scene', ({ stored }) => { stored.scenes.pop(); }],
    ['extra scene', ({ stored }) => { stored.scenes.push({ ...stored.scenes[0], id: 'extra-scene' }); }],
    ['duplicate scene ID', ({ stored }) => { stored.scenes[1].id = stored.scenes[0].id; }],
    ['two scenes for one part', ({ stored }) => { stored.scenes[1].partId = stored.scenes[0].partId; }],
    ['foreign scene part', ({ stored }) => { stored.scenes[1].partId = 'foreign-part'; }],
    ['shifted scene binding', ({ stored }) => {
      [stored.scenes[0].partId, stored.scenes[1].partId] = [stored.scenes[1].partId, stored.scenes[0].partId];
    }],
    ['wrong scene key', ({ stored }) => { stored.scenes[0].sceneKey = 'chapter-2-main'; }],
    ['wrong scene position', ({ stored }) => { stored.scenes[0].position = 2; }],
    ['missing beat', ({ stored }) => { stored.beats.pop(); }],
    ['extra beat', ({ stored }) => { stored.beats.push({ ...stored.beats[0], position: 3 }); }],
    ['foreign beat scene', ({ stored }) => { stored.beats[0].sceneId = 'foreign-scene'; }],
    ['duplicate beat position', ({ stored }) => { stored.beats[1].position = 1; }],
    ['beat position gap', ({ stored }) => { stored.beats[1].position = 3; }],
    ['zero beat position', ({ stored }) => { stored.beats[0].position = 0; }],
    ['reordered beat positions', ({ stored }) => {
      [stored.beats[0].position, stored.beats[1].position] = [stored.beats[1].position, stored.beats[0].position];
    }],
    ['stale Korean content', ({ stored }) => { stored.beats[0].content.ko += ' changed'; }],
    ['changed text whitespace', ({ stored }) => { stored.beats[0].content.ko += ' '; }],
    ['wrong source scene key', ({ stored }) => { stored.beats[0].sourceSceneKey = 'foreign-source'; }],
    ['missing choice', ({ stored }) => { stored.choices.pop(); }],
    ['extra choice', ({ stored }) => { stored.choices.push({ ...stored.choices[1], choiceKey: 'extra', position: 4 }); }],
    ['foreign choice scene', ({ stored }) => { stored.choices[0].sceneId = 'foreign-scene'; }],
    ['duplicate choice position', ({ stored }) => { stored.choices[2].position = 2; }],
    ['choice position gap', ({ stored }) => { stored.choices[2].position = 4; }],
    ['foreign normal B label', ({ stored }) => { stored.choices[1].label.ko = 'Another valid investigation'; }],
    ['foreign normal C label', ({ stored }) => { stored.choices[2].label.ko = 'Another valid rescue'; }],
    ['wrong choice key', ({ stored }) => { stored.choices[1].choiceKey = 'other-branch'; }],
    ['wrong route kind', ({ stored }) => { stored.choices[1].routeKind = 'branch'; }],
    ['wrong original target', ({ stored }) => { stored.choices[0].targetSceneId = 'db-scene-3'; }],
    ['unbound original target', ({ stored }) => { stored.choices[0].targetSceneId = 'foreign-scene'; }],
    ['wrong ending', ({ stored }) => { stored.choices[6].targetEndingKey = 'author_sub'; }],
    ['original with no destination', ({ stored }) => { stored.choices[0].targetSceneId = null; }],
    ['original with two destinations', ({ stored }) => { stored.choices[0].targetEndingKey = 'author_main'; }],
    ['generated scene target', ({ stored }) => { stored.choices[1].targetSceneId = 'db-scene-2'; }],
    ['generated ending target', ({ stored }) => { stored.choices[1].targetEndingKey = 'author_main'; }],
    ['original rejoin', ({ stored }) => { stored.choices[0].declaredRejoinSceneId = 'db-scene-3'; }],
    ['generated rejoin', ({ stored }) => { stored.choices[1].declaredRejoinSceneId = 'db-scene-3'; }],
    ['planned original with no destination', ({ plan, stored }) => {
      plan.parts[0].choices[0].targetPartKey = null;
      stored.choices[0].targetSceneId = null;
    }],
    ['planned original with two destinations', ({ plan, stored }) => {
      plan.parts[0].choices[0].targetEndingKey = 'author_main';
      stored.choices[0].targetEndingKey = 'author_main';
    }],
    ['unknown planned target part', ({ plan }) => { plan.parts[0].choices[0].targetPartKey = 'unknown-chapter'; }],
    ['duplicate planned part key', ({ plan }) => { plan.parts[1].partKey = plan.parts[0].partKey; }],
    ['reordered planned parts', ({ plan }) => { plan.parts.reverse(); }],
    ['duplicate planned choice key', ({ plan }) => { plan.parts[0].choices[2].choiceKey = 'branch-b'; }],
  ];

  it.each(cases)('rejects %s with the publication mismatch code', (_, mutate) => {
    const data = fixture();
    mutate(data);
    expectMismatch(() => comparePublicationPlanStorage(data.plan, data.stored));
  });

  it('rejects empty storage instead of validating an empty publication', () => {
    expectMismatch(() => comparePublicationPlanStorage({ parts: [] }, { parts: [], scenes: [], beats: [], choices: [] }));
  });

  it('rejects missing Korean values rather than using another locale', () => {
    const { plan, stored } = fixture();
    const rows = { ...stored, beats: stored.beats.map(beat => ({ ...beat, content: { en: beat.content.ko } })) };
    expectMismatch(() => comparePublicationPlanStorage(plan, rows));
  });

  it('uses the whole-work routing map for destinations outside a bounded batch', () => {
    const { plan, stored } = fixture();
    const routing = new Map(plan.parts.map(part => [part.partKey, `db-scene-${part.position}`]));
    const firstBatch = { parts: plan.parts.slice(0, 1) };
    const firstRows = { parts: stored.parts.slice(0, 1), scenes: stored.scenes.slice(0, 1),
      beats: stored.beats.slice(0, 2), choices: stored.choices.slice(0, 3) };
    comparePublicationPlanStorage(firstBatch, firstRows, routing);
    expectMismatch(() => comparePublicationPlanStorage(firstBatch, firstRows));
    const laterBatch = { parts: plan.parts.slice(1) };
    const laterRows = { parts: stored.parts.slice(1), scenes: stored.scenes.slice(1),
      beats: stored.beats.slice(2), choices: stored.choices.slice(3) };
    comparePublicationPlanStorage(laterBatch, laterRows, routing);
  });

  it('rejects an incomplete or conflicting external routing map', () => {
    const { plan, stored } = fixture();
    const batch = { parts: plan.parts.slice(0, 1) };
    const rows = { parts: stored.parts.slice(0, 1), scenes: stored.scenes.slice(0, 1),
      beats: stored.beats.slice(0, 2), choices: stored.choices.slice(0, 3) };
    expectMismatch(() => comparePublicationPlanStorage(batch, rows, new Map([['chapter-1', 'db-scene-1']])));
    expectMismatch(() => comparePublicationPlanStorage(batch, rows, new Map([
      ['chapter-1', 'wrong-local-scene'], ['chapter-2', 'db-scene-2'],
    ])));
    expectMismatch(() => comparePublicationPlanStorage(batch, rows, new Map([
      ['chapter-1', 'db-scene-1'], ['chapter-2', 'wrong-destination'],
    ])));
  });
});
