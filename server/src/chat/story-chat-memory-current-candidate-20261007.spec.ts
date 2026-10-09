import { fixture, ids, generatedText } from '../../test/fixtures/story-chat-memory-current-candidate-20261007.fixture';
import { loadStoryChatMemoryContext } from './story-chat-memory';
import { ChatLlmProviderAdapter } from './llm-provider.adapter';
import type { Prisma } from '@prisma/client';
import {
  assertCreatorGenerationProfileApprovable, creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile, STORY_PROFILE_SECTION_KEYS,
} from '../generation-profile/creator-generation-profile.policy';
import { storyChatMemoryMarker } from './story-chat-memory-scope';

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
  it.each(['without canonical proof', 'with canonical proof'] as const)(
    'author plans and profile source observations never become shared route interactions (%s)', async (proof) => {
      const f = fixture(); f.noGenerated();
      const hasProof = proof === 'with canonical proof';
      if (!hasProof) f.noProof();
      const baseline = await load(f);
      expect(baseline).toEqual(hasProof
        ? { source: 'attributed_story_dialogue', items: [f.canonicalItem],
          canonicalProofFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }
        : empty);
      const baselineMarker = storyChatMemoryMarker(baseline);
      const approvalsBefore = f.approvals.map(row => ({ ...row }));
      const receiptsBefore = f.receipts.map(row => ({ ...row }));
      const futurePlanSentinel = 'AUTHOR_PLAN_ONLY: Mira will leave at the unreached winter finale.';
      const profileObservationSentinel = 'PROFILE_SOURCE_ONLY: Mira will reveal a future secret, not a read event.';
      const sourceRef = 'synthetic-unreached-future-plan';
      // Synthetic author guidance is not an interaction approval or reader receipt.
      const settings = normalizeCreatorGenerationProfile('story', {
        schemaVersion: 'creator-generation-profile-v1', kind: 'story',
        sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted',
          value: key === 'timeline'
            ? { observations: [{ title: 'Synthetic future source', detail: profileObservationSentinel, sourceRef }] }
            : { description: 'Synthetic author guidance only' },
          evidence: key === 'timeline'
            ? [{ sourceType: 'manuscript', sourceRef, summary: 'Synthetic future-plan evidence, not route history' }]
            : [],
        })),
      });
      assertCreatorGenerationProfileApprovable(settings);
      const sourceFingerprint = 'e'.repeat(64);
      const now = new Date('2026-10-10T00:00:00.000Z');
      const analysisJobId = '00000000-0000-4000-8000-000000000040';
      const sourceRows: Partial<Record<keyof Prisma.TransactionClient, unknown>> = {
        storyWorkGenerationProfile: {
          id: '00000000-0000-4000-8000-000000000041', workId: ids.work, ownerUserId: ids.owner,
          manuscriptVersionId: ids.manuscript, analysisJobId, profileVersion: 1, reviewRevision: 1,
          status: 'approved', sourceFingerprint, draftSettings: settings, approvedSettings: settings,
          approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
          approvedByUserId: ids.owner, approvedAt: now, createdAt: now, updatedAt: now,
        },
        storyMemoryRecord: {
          id: '00000000-0000-4000-8000-000000000042', workId: ids.work, analysisJobId,
          manuscriptVersionId: ids.manuscript, memoryType: 'foreshadow', memoryKey: 'synthetic-future-plan',
          partKey: 'unreached-winter-finale', content: { en: futurePlanSentinel }, evidenceIds: [],
          provenance: 'writer_original', status: 'approved', revision: 1, createdAt: now,
        },
      };
      const sourceReads = [f.prisma, f.db].flatMap(client => Object.entries(sourceRows).flatMap(([model, row]) => {
        const delegate = { findFirst: jest.fn(async () => row), findUnique: jest.fn(async () => row),
          findMany: jest.fn(async () => [row]) };
        // The access spy also catches reads through any other delegate method.
        const access = jest.fn(() => delegate);
        Object.defineProperty(client, model, { configurable: true, get: access });
        return [access, delegate.findFirst, delegate.findUnique, delegate.findMany];
      }));
      const context = await load(f);
      expect(context).toEqual(baseline);
      expect(context.canonicalProofFingerprint).toBe(baseline.canonicalProofFingerprint);
      expect(storyChatMemoryMarker(context)).toEqual(baselineMarker);
      const reference = adapter()['buildStoryMemoryReference'](context);
      if (hasProof) {
        expect(reference).not.toBeNull();
        expect(reference).toContain(JSON.stringify(f.canonicalItem.artistDialogue));
        expect(reference).toContain('"artistDid"');
        expect(reference).not.toContain(futurePlanSentinel);
        expect(reference).not.toContain(profileObservationSentinel);
      } else {
        expect(context).toEqual(empty);
        expect(reference).toBeNull();
      }
      for (const read of sourceReads) expect(read).not.toHaveBeenCalled();
      expect(f.approvals).toEqual(approvalsBefore);
      expect(f.receipts).toEqual(receiptsBefore);
    },
  );
});
