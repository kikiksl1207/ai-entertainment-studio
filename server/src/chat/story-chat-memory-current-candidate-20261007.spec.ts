import { fixture, ids, generatedText } from '../../test/fixtures/story-chat-memory-current-candidate-20261007.fixture';
import { loadStoryChatMemoryContext } from './story-chat-memory';
import { ChatLlmProviderAdapter } from './llm-provider.adapter';

const empty = { source: 'no_verified_interaction', items: [] };
const load = (f: ReturnType<typeof fixture>) => loadStoryChatMemoryContext(f.prisma as never, f.input);
const adapter = () => new ChatLlmProviderAdapter({ get: jest.fn() } as never);

describe('existing memory and adapter guards integrated into the frozen candidate', () => {
  it('generated current/history cursors and BODY company/readonly metadata never replace event/read proof', async () => {
    for (const condition of ['current-cursor', 'body-company', 'readonly-source', 'history-cursor']) {
      const f = fixture(); f.noProof();
      if (condition === 'body-company') {
        f.generated.latestBodyReview = { decision: 'approve', approvalBasis: 'company_delegation', applicability: 'current' };
        f.reader.bodyReview = f.generated.latestBodyReview;
      }
      if (condition === 'readonly-source') {
        f.reader.sourceInspection = { phase: 'ready', data: { state: 'body_reviewable', releaseVersion: 2,
          progressRevision: 7, bodyReview: { decision: 'approve', approvalBasis: 'company_delegation', applicability: 'current' } } };
        f.generated.memoryPreparation = { readOnly: true, sharedReuseAuthorized: false };
      }
      if (condition === 'history-cursor') {
        f.reader.currentBeatPosition = 0;
        f.reader.pathSummary = [{ generatedSceneId: ids.oldGenerated },
          { generatedSceneId: ids.generated, sourceGeneratedSceneId: ids.oldGenerated, readBeatPosition: 2 }];
        f.generatedScenes.push({ ...f.generated, id: ids.oldGenerated });
        f.generatedBeats.push({ ...f.generatedBeat, sceneId: ids.oldGenerated, position: 2 });
      }
      expect({ condition, context: await load(f) }).toEqual({ condition, context: empty });
    }
  });
  it('legacy or incomplete memory items are withheld by the actual adapter method', () => {
    const render = adapter();
    const item = { workTitle: 'Synthetic Door', sceneTitle: 'Synthetic Private BODY', artistDialogue: generatedText };
    for (const condition of ['legacy-no-evidence', 'canonical-missing-kind', 'wrong-source']) {
      const context = condition === 'canonical-missing-kind'
        ? { source: 'attributed_story_dialogue', items: [{ ...item, evidenceSource: 'canonical_author_approved' }] }
        : condition === 'wrong-source'
          ? { source: 'no_verified_interaction', items: [{ ...item, evidenceSource: 'canonical_author_approved', interactionKind: 'action' }] }
          : { source: 'attributed_story_dialogue', items: [item] };
      expect({ condition, reference: render['buildStoryMemoryReference'](context as never) }).toEqual({ condition, reference: null });
    }
  });
  it('one valid current canonical receipt and approval survives loader and adapter boundaries', async () => {
    const f = fixture(); f.noGenerated();
    const context = await load(f);
    expect(context).toEqual({ source: 'attributed_story_dialogue', items: [f.canonicalItem],
      canonicalProofFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const reference = adapter()['buildStoryMemoryReference'](context);
    expect(reference).not.toBeNull();
    expect(reference).toContain('"artistDid":"Mira opened the door for me."');
    expect(reference).toContain('"evidenceSource":"canonical_author_approved"');
    expect(reference).toContain('"interactionKind":"action"');
    expect(reference).not.toContain(generatedText);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(f.db.$executeRaw.mock.calls.every(([sql]: any[]) => sql.sql === 'SET TRANSACTION READ ONLY')).toBe(true);
  });
});
