import { SemanticAnalysisService } from './story-semantic-analysis.service';
import { SemanticAnalysisProvider } from './story-semantic-analysis.provider';
import { semanticTestConfig } from './story-semantic-analysis.test-fixture';

describe('Semantic writer projections (mocked owner repository, not JWT HTTP)', () => {
  function fixture(pipeline = 'semantic_extraction_v1') {
    const job = { id: 'job', manuscriptVersionId: 'source', analysisVersion: 1, pipeline,
      status: 'completed', phase: 'completed', sourceLocale: 'ko', sourceContentHash: 'a'.repeat(64),
      totalParagraphs: 130, completedParagraphs: 130, plannedParagraphs: 130, plannedChunks: 5, completedChunks: 5,
      configPins: { apiKey: 'private-config-key' },
      result: { evidenceCount: 135, counts: { style: 5, providerPayload: 'private' }, styleCounts: { sentence_rhythm: 5, private: 'never' }, providerPayload: 'raw-envelope' },
    };
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: `e-${i}`, sequence: i, evidenceType: 'style',
      sourcePartKey: 'part-1', sourceParagraphIndex: i, provenance: 'semantic_candidate', payload: {
        title: 'Short sentences', observation: 'Short action clauses suggest a direct rhythm in this cited passage.',
        styleCategory: 'sentence_rhythm', rawSource: 'private-entire-manuscript', providerPayload: 'private-envelope',
        citations: [{ partIndex: 0, partKey: 'part-1', paragraphIndex: i, start: 0, end: 12, quoteHash: 'b'.repeat(64), quote: 'not-for-list' }],
      } }));
    const db = { storyAnalysisEvidence: { findMany: jest.fn().mockResolvedValue(rows), findFirst: jest.fn() } };
    const owned = jest.fn().mockResolvedValue(job);
    const service = new SemanticAnalysisService({ prisma: db, owned } as never, new SemanticAnalysisProvider(semanticTestConfig(), jest.fn()));
    return { job, rows, db, owned, service };
  }
  it('returns only curated interpreted observations, source refs and safe progress', async () => {
    const f = fixture();
    const result = await f.service.get('owner', 'job');
    expect(f.owned).toHaveBeenCalledWith('owner', 'job');
    expect(result).toMatchObject({ hasMore: true, nextCursor: 'e-99', endCursor: 'e-99', review: { fullyReviewed: false },
      job: { semanticCompleted: true, sourceLocale: 'ko', styleCandidates: { sentence_rhythm: 5 }, approval: 'not_approved', memoryApproved: false } });
    expect(result.evidence).toHaveLength(100);
    expect(result.evidence[0]).toMatchObject({ title: 'Short sentences', observation: expect.any(String),
      interpretation: 'model_inference', factualTruthApproved: false, reviewRequired: true });
    expect(JSON.stringify(result)).not.toMatch(/private|raw-envelope|not-for-list|apiKey|providerPayload|rawSource/);
  });
  it('uses monotonically assigned sequence after an owned cursor, not UUID sort order', async () => {
    const f = fixture();
    f.db.storyAnalysisEvidence.findFirst.mockResolvedValue({ id: 'anchor', sequence: 99 });
    f.db.storyAnalysisEvidence.findMany.mockResolvedValue([]);
    expect(await f.service.get('owner', 'job', 'anchor')).toMatchObject({ hasMore: false, nextCursor: null, endCursor: 'anchor' });
    expect(f.db.storyAnalysisEvidence.findFirst).toHaveBeenCalledWith({ where: { id: 'anchor', analysisJobId: 'job' }, select: { id: true, sequence: true } });
    expect(f.db.storyAnalysisEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { analysisJobId: 'job', sequence: { gt: 99 } } }));
    f.db.storyAnalysisEvidence.findFirst.mockResolvedValue(null);
    await expect(f.service.get('owner', 'job', 'foreign')).rejects.toMatchObject({ response: { code: 'ANALYSIS_CURSOR_INVALID' } });
  });
  it('labels old structural completion without claiming semantic completion or approval', async () => {
    const f = fixture('structural_legacy');
    f.rows[0].provenance = 'structural_legacy';
    const result = await f.service.get('owner', 'job');
    expect(result.job).toMatchObject({ kind: 'structural_legacy', semanticCompleted: false, progress: { coverageComplete: false } });
    expect(result.evidence[0]).not.toHaveProperty('observation');
    expect(result.review.fullyReviewed).toBe(false);
  });
});
