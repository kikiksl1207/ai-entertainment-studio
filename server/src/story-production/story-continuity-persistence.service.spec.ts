import 'reflect-metadata';
import { StoryProductionService } from './story-production.service';

describe('StoryProductionService continuity persistence', () => {
  it('persists ledger evidence links and author-original path state in the analysis transaction', async () => {
    let evidenceSequence = 0;
    let entrySequence = 0;
    let issueSequence = 0;
    const tx = {
      storyAnalysisJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'analysis-1', analysisVersion: 1 }),
        update: jest.fn().mockResolvedValue({
          id: 'analysis-1', manuscriptVersionId: 'manuscript-1', analysisVersion: 1,
          status: 'completed', result: { criticalIssueCount: 1, providerPayload: 'do-not-return' },
          startedAt: new Date(0), completedAt: new Date(1), idempotencyKey: 'do-not-return',
        }),
      },
      storyAnalysisEvidence: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ ...data, id: `e-${++evidenceSequence}` })),
      },
      storyContinuityEntry: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ ...data, id: `entry-${++entrySequence}` })),
      },
      storyContinuityEntryEvidence: { createMany: jest.fn() },
      storyContinuityPathState: { create: jest.fn() },
      storyContinuityIssue: {
        create: jest.fn().mockImplementation(async ({ data }) => ({ ...data, id: `issue-${++issueSequence}` })),
      },
      storyContinuityIssueEvidence: { createMany: jest.fn() },
    };
    const prisma = {
      storyManuscriptVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'manuscript-1',
          workId: 'work-1',
          ownerUserId: 'owner-1',
          structuredBody: {
            parts: [{
              partKey: 'part-1',
              title: 'Part 1',
              paragraphs: [
                { kind: 'paragraph', text: '[entity:Mina] [event:arrival] [foreshadow:watch]' },
                { kind: 'paragraph', text: '[payoff:unrelated promise]' },
              ],
            }],
          },
        }),
      },
      storyAnalysisJob: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation(async (run) => run(tx)),
    };
    const service = new StoryProductionService(prisma as never);

    const result = await service.analyzeManuscript('owner-1', 'manuscript-1', 'analysis-key-123');

    expect(tx.storyContinuityEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ analysisJobId: 'analysis-1', analysisVersion: 1 }),
    });
    expect(tx.storyContinuityEntryEvidence.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ analysisJobId: 'analysis-1', analysisVersion: 1, evidenceId: expect.any(String) }),
      ]),
    });
    expect(tx.storyContinuityPathState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pathScope: 'author_original', pathKey: 'author_original' }),
    });
    expect(tx.storyContinuityIssue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ severity: 'critical', analysisVersion: 1 }),
    });
    expect(tx.storyContinuityIssue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ severity: 'warning', analysisVersion: 1 }),
    });
    expect(JSON.stringify(result)).not.toMatch(/providerPayload|do-not-return|idempotencyKey/);
  });

  it('projects source locations without raw manuscript or provider payload fields', async () => {
    const prisma = {
      storyAnalysisJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'analysis-1',
          manuscriptVersionId: 'manuscript-1',
          analysisVersion: 2,
          idempotencyKey: 'private-key',
          status: 'completed',
          result: {
            counts: { beat: 1, providerPayload: 'nested-secret' },
            providerPayload: { secret: 'do-not-return' },
          },
          startedAt: new Date(0),
          completedAt: new Date(1),
        }),
      },
      storyManuscriptVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: 'manuscript-1', structuredBody: { raw: 'secret manuscript' } }),
      },
      storyAnalysisEvidence: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'e-1',
          analysisJobId: 'analysis-1',
          evidenceType: 'beat',
          sourcePartKey: 'part-1',
          sourceParagraphIndex: 3,
          payload: { excerpt: 'secret manuscript', providerPayload: 'secret' },
        }]),
      },
    };
    const result = await new StoryProductionService(prisma as never).analysis('owner-1', 'analysis-1');
    const wire = JSON.stringify(result);

    expect(result.evidence).toEqual([{
      id: 'e-1', evidenceType: 'beat', sourcePartKey: 'part-1', sourceParagraphIndex: 3,
    }]);
    expect(wire).not.toMatch(/excerpt|providerPayload|nested-secret|secret manuscript|private-key|structuredBody/);
  });

  it('appends an immutable author decision before updating issue state and never mutates manuscript', async () => {
    const manuscriptUpdate = jest.fn();
    const tx = {
      storyContinuityDecisionAudit: { create: jest.fn() },
      storyContinuityIssue: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'issue-1', status: 'resolved', decisionRevision: 3 }),
      },
      storyManuscriptVersion: { update: manuscriptUpdate },
    };
    const prisma = {
      storyWork: { findFirst: jest.fn().mockResolvedValue({ id: 'work-1' }) },
      storyContinuityIssue: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'issue-1', workId: 'work-1', analysisJobId: 'analysis-2', analysisVersion: 4,
          status: 'open', decisionRevision: 2,
        }),
      },
      $transaction: jest.fn().mockImplementation(async (run) => run(tx)),
    };
    const service = new StoryProductionService(prisma as never);

    await service.decideContinuityIssue('owner-1', 'work-1', 'issue-1', {
      status: 'resolved', decision: 'The revised chapter now contains the payoff.',
    });

    expect(tx.storyContinuityDecisionAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issueId: 'issue-1', analysisJobId: 'analysis-2', analysisVersion: 4,
        decisionRevision: 3, fromStatus: 'open', toStatus: 'resolved', actorUserId: 'owner-1',
      }),
    });
    expect(tx.storyContinuityIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ decisionRevision: 2 }),
    }));
    expect(manuscriptUpdate).not.toHaveBeenCalled();
  });
});
