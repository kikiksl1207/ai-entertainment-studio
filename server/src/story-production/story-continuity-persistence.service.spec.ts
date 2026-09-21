import 'reflect-metadata';
import { StoryProductionService } from './story-production.service';

describe('StoryProductionService continuity persistence', () => {
  it('queues through the semantic service without synchronous tag-only completion', async () => {
    const semantic = { enqueue: jest.fn().mockResolvedValue({ id: 'analysis-1', status: 'queued' }) };
    const prisma = { $transaction: jest.fn() };
    const service = new StoryProductionService(prisma as never, undefined, undefined, undefined, semantic as never);
    expect(await service.analyzeManuscript('owner-1', 'manuscript-1', 'analysis-key-123')).toMatchObject({ status: 'queued' });
    expect(semantic.enqueue).toHaveBeenCalledWith('owner-1', 'manuscript-1', 'analysis-key-123');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('forwards the owner and evidence cursor and has no synchronous mock fallback', async () => {
    const semantic = { get: jest.fn().mockResolvedValue({ job: { status: 'running' }, evidence: [], hasMore: true }) };
    const service = new StoryProductionService({} as never, undefined, undefined, undefined, semantic as never);
    expect(await service.analysis('owner-1', 'analysis-1', 'cursor-1')).toMatchObject({ hasMore: true });
    expect(semantic.get).toHaveBeenCalledWith('owner-1', 'analysis-1', 'cursor-1');
    await expect(new StoryProductionService({} as never).analyzeManuscript('owner-1', 'manuscript-1', 'analysis-key-123'))
      .rejects.toMatchObject({ status: 503 });
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
    expect(prisma.storyContinuityIssue.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'issue-1', workId: 'work-1', pathScope: 'author_original', pathKey: 'author_original',
      },
    });
    expect(manuscriptUpdate).not.toHaveBeenCalled();
  });

  it('keeps reader-derived critical issues out of the author projection and publish gate', async () => {
    const authorWarning = {
      id: 'author-warning', analysisVersion: 3, pathScope: 'author_original',
      pathKey: 'author_original', issueKey: 'orphan-payoff:watch', severity: 'warning',
      status: 'open', summary: 'Author warning', decisionRevision: 0, createdAt: new Date(0),
    };
    const readerCritical = {
      id: 'reader-critical', analysisVersion: 3, pathScope: 'reader_derived',
      pathKey: 'progress-2', issueKey: 'missing-payoff:watch', severity: 'critical',
      status: 'open', summary: 'Reader-only critical', decisionRevision: 0, createdAt: new Date(0),
    };
    const prisma = {
      storyWork: { findFirst: jest.fn().mockResolvedValue({ id: 'work-1' }) },
      storyManuscriptVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: 'manuscript-3', version: 3 }),
      },
      storyAnalysisJob: {
        findFirst: jest.fn().mockResolvedValue({ id: 'analysis-3', analysisVersion: 3 }),
      },
      storyContinuityEntry: { findMany: jest.fn().mockResolvedValue([]) },
      storyContinuityIssue: {
        // Returning an out-of-scope row proves the projection also fails closed beyond the query predicate.
        findMany: jest.fn().mockResolvedValue([authorWarning, readerCritical]),
      },
      storyAnalysisEvidence: { findMany: jest.fn().mockResolvedValue([]) },
      storyContinuityEntryEvidence: { findMany: jest.fn().mockResolvedValue([]) },
      storyContinuityIssueEvidence: { findMany: jest.fn().mockResolvedValue([]) },
      storyContinuityPathState: {
        findMany: jest.fn().mockResolvedValue([
          { entryId: 'entry-1', pathScope: 'author_original', pathKey: 'author_original', state: 'observed', createdAt: new Date(0) },
          { entryId: 'entry-1', pathScope: 'reader_derived', pathKey: 'progress-2', state: 'resolved', createdAt: new Date(1) },
        ]),
      },
      storyContinuityDecisionAudit: {
        findMany: jest.fn().mockResolvedValue([
          { issueId: 'reader-critical', decisionRevision: 1, fromStatus: 'open', toStatus: 'accepted', decision: 'reader-only', createdAt: new Date(2) },
        ]),
      },
    };
    const result = await new StoryProductionService(prisma as never).continuity('owner-1', 'work-1');

    expect(prisma.storyAnalysisJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { workId: 'work-1', manuscriptVersionId: 'manuscript-3', status: 'completed' },
    }));
    expect(prisma.storyContinuityIssue.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ pathScope: 'author_original', pathKey: 'author_original' }),
    }));
    expect(result.issues).toEqual([expect.objectContaining({ id: 'author-warning' })]);
    expect(result.decisionHistory).toEqual([]);
    expect(result.pathStates).toEqual({
      authorOriginal: [{ entryId: 'entry-1', pathKey: 'author_original', state: 'observed' }],
      readerDerived: [{ entryId: 'entry-1', pathKey: 'progress-2', state: 'resolved' }],
    });
    expect(result.publishGate).toEqual({
      blocked: false, unresolvedCriticalCount: 0, unresolvedWarningCount: 1,
    });
  });
});
