import 'reflect-metadata';
import { ArgumentsHost, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'crypto';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { StoryAnalysisDiscoveryQueryDto } from './dto/story-analysis-discovery.dto';
import { SemanticAnalysisRepository } from './story-semantic-analysis.repository';
import { SemanticAnalysisService } from './story-semantic-analysis.service';
import { semanticConfig } from './story-semantic-analysis.config';

const query = (limit = 12, cursor?: string) => Object.assign(new StoryAnalysisDiscoveryQueryDto(), { limit, cursor });

function fixture() {
  const user = randomUUID(), work = randomUUID(), manuscript = randomUUID();
  const tx = {
    storyWork: { findFirst: jest.fn().mockResolvedValue({ id: work }) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue({ workId: work, version: 8 }),
      findMany: jest.fn().mockResolvedValue([]), findUniqueOrThrow: jest.fn() },
    storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null) },
    $executeRaw: jest.fn(), $queryRaw: jest.fn().mockResolvedValue([{ id: work }]),
  };
  const prisma = { $transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
  const repository = new SemanticAnalysisRepository(prisma as never);
  const provider = { readiness: jest.fn(() => { throw new Error('Discovery must not query provider'); }), generate: jest.fn() };
  const service = new SemanticAnalysisService(repository, provider as never, {} as never);
  return { user, work, manuscript, tx, prisma, repository, provider, service };
}

describe('Owned analysis discovery (no provider, bounded metadata)', () => {
  it('uses one repeatable-read snapshot and selects no manuscript body', async () => {
    const f = fixture();
    const rows = [3, 2, 1].map(version => ({ id: randomUUID(), workId: f.work, version,
      locale: 'ko', contentHash: String(version).repeat(64), createdAt: new Date() }));
    f.tx.storyManuscriptVersion.findMany.mockResolvedValue(rows);
    const page = await f.service.manuscripts(f.user, f.work, query(2));
    expect(page).toEqual({ workId: f.work, items: rows.slice(0, 2), hasMore: true, nextCursor: rows[1].id });
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function),
      { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 5000 });
    expect(f.tx.storyManuscriptVersion.findMany).toHaveBeenCalledWith({
      where: { workId: f.work, ownerUserId: f.user }, orderBy: { version: 'desc' }, take: 3,
      select: { id: true, workId: true, version: true, locale: true, contentHash: true, createdAt: true },
    });
    expect(f.provider.readiness).not.toHaveBeenCalled();
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('uses an owned cursor version as an immutable keyset, not a mutable date or offset', async () => {
    const f = fixture(), cursor = randomUUID();
    await f.repository.manuscripts(f.user, f.work, query(30, cursor));
    expect(f.tx.storyManuscriptVersion.findFirst).toHaveBeenCalledWith({
      where: { id: cursor, workId: f.work, ownerUserId: f.user }, select: { version: true },
    });
    expect(f.tx.storyManuscriptVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workId: f.work, ownerUserId: f.user, version: { lt: 8 } }, take: 31,
    }));
  });

  it('returns an explicit empty page with no cursor', async () => {
    const f = fixture();
    expect(await f.service.manuscripts(f.user, f.work, query())).toEqual({
      workId: f.work, items: [], hasMore: false, nextCursor: null,
    });
  });

  it('denies foreign works before inspecting a cursor', async () => {
    const f = fixture(); f.tx.storyWork.findFirst.mockResolvedValue(null);
    await expect(f.repository.manuscripts(f.user, f.work, query(12, randomUUID()))).rejects.toMatchObject({ status: 404 });
    expect(f.tx.storyManuscriptVersion.findFirst).not.toHaveBeenCalled();
    expect(f.tx.storyManuscriptVersion.findMany).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent/other-work manuscript cursor without a page read', async () => {
    const f = fixture(); f.tx.storyManuscriptVersion.findFirst.mockResolvedValue(null);
    await expect(f.repository.manuscripts(f.user, f.work, query(12, randomUUID())))
      .rejects.toMatchObject({ response: { code: 'ANALYSIS_DISCOVERY_CURSOR_INVALID' } });
    expect(f.tx.storyManuscriptVersion.findMany).not.toHaveBeenCalled();
  });

  it.each(['manuscript', 'work'])('requires both current %s and manuscript ownership for jobs', async missing => {
    const f = fixture();
    if (missing === 'manuscript') f.tx.storyManuscriptVersion.findFirst.mockResolvedValue(null);
    else f.tx.storyWork.findFirst.mockResolvedValue(null);
    await expect(f.repository.analyses(f.user, f.manuscript, query())).rejects.toMatchObject({ status: 404 });
    expect(f.tx.storyAnalysisJob.findMany).not.toHaveBeenCalled();
  });

  it('restricts job actor scope, allowing null only for structural legacy; selects scalar metadata only', async () => {
    const f = fixture(), cursor = randomUUID();
    f.tx.storyAnalysisJob.findFirst.mockResolvedValue({ analysisVersion: 14 });
    await f.repository.analyses(f.user, f.manuscript, query(12, cursor));
    const scope = { workId: f.work, manuscriptVersionId: f.manuscript,
      OR: [{ actorUserId: f.user }, { actorUserId: null, pipeline: 'structural_legacy' }] };
    expect(f.tx.storyAnalysisJob.findFirst).toHaveBeenCalledWith({ where: { ...scope, id: cursor }, select: { analysisVersion: true } });
    const request = f.tx.storyAnalysisJob.findMany.mock.calls[0][0];
    expect(request).toMatchObject({ where: { ...scope, analysisVersion: { lt: 14 } }, take: 13, orderBy: { analysisVersion: 'desc' } });
    expect(Object.keys(request.select).sort()).toEqual(['id', 'manuscriptVersionId', 'analysisVersion', 'status', 'pipeline',
      'phase', 'sourceLocale', 'sourceContentHash', 'totalParagraphs', 'plannedParagraphs', 'completedParagraphs',
      'plannedChunks', 'completedChunks', 'errorCode', 'createdAt', 'startedAt', 'completedAt'].sort());
  });

  it('rejects a job cursor outside the scoped manuscript/actor', async () => {
    const f = fixture();
    await expect(f.repository.analyses(f.user, f.manuscript, query(12, randomUUID())))
      .rejects.toMatchObject({ response: { code: 'ANALYSIS_DISCOVERY_CURSOR_INVALID' } });
    expect(f.tx.storyAnalysisJob.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['structural_legacy', 'completed', false], ['semantic_extraction_v1', 'completed', true],
    ['semantic_extraction_v1', 'queued', false], ['semantic_extraction_v1', 'running', false],
    ['semantic_extraction_v1', 'failed', false],
  ])('projects %s/%s without interpreting completion as author approval', async (pipeline, status, complete) => {
    const f = fixture();
    f.tx.storyAnalysisJob.findMany.mockResolvedValue([{ id: randomUUID(), manuscriptVersionId: f.manuscript,
      analysisVersion: 1, pipeline, status, phase: 'legacy', sourceLocale: null, sourceContentHash: null,
      totalParagraphs: 3, plannedParagraphs: 3, completedParagraphs: 3, plannedChunks: 1, completedChunks: 1,
      errorCode: null, createdAt: new Date(), startedAt: null, completedAt: null,
      result: { private: 'must not be projected' }, configPins: { apiKey: 'must not be projected' } }]);
    const page = await f.service.analyses(f.user, f.manuscript, query());
    expect(page.items[0]).toMatchObject({ kind: pipeline, status, semanticCompleted: complete,
      approval: 'not_approved', memoryApproved: false, sourceLocale: null, progress: { coverageComplete: complete } });
    expect(page.items[0]).not.toHaveProperty('result'); expect(page.items[0]).not.toHaveProperty('configPins');
    expect(f.provider.readiness).not.toHaveBeenCalled(); expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it.each([0, 31, 1.5, NaN])('rejects invalid internal limit %s before database access', async limit => {
    const f = fixture();
    await expect(f.repository.manuscripts(f.user, f.work, query(limit))).rejects.toMatchObject({ status: 400 });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sanitizes database failures without forwarding their payload', async () => {
    const f = fixture(); f.tx.storyWork.findFirst.mockRejectedValue(new Error('private database payload'));
    await expect(f.repository.manuscripts(f.user, f.work, query()))
      .rejects.toMatchObject({ response: { code: 'ANALYSIS_DISCOVERY_UNAVAILABLE' } });
  });

  it('preserves the owned reserved id through the real HTTP filter without changing the global filter', async () => {
    const f = fixture(), id = randomUUID();
    f.tx.storyManuscriptVersion.findFirst.mockResolvedValue({ id: f.manuscript, workId: f.work, ownerUserId: f.user,
      contentHash: 'a'.repeat(64), locale: 'ko' });
    f.tx.storyManuscriptVersion.findUniqueOrThrow.mockResolvedValue({ workId: f.work, ownerUserId: f.user,
      contentHash: 'a'.repeat(64), locale: 'ko' });
    f.tx.storyAnalysisJob.findFirst.mockResolvedValue({ id, workId: f.work, actorUserId: f.user });
    let caught: unknown;
    try { await f.repository.enqueue(f.user, f.manuscript, randomUUID(), semanticConfig({}), 'analysis_disabled'); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toMatchObject({ analysisJobId: id, details: { analysisJobId: id } });
    const json = jest.fn(), status = jest.fn().mockReturnValue({ json });
    new HttpExceptionFilter().catch(caught, { switchToHttp: () => ({ getRequest: () => ({ url: '/test' }),
      getResponse: () => ({ status }) }) } as ArgumentsHost);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({
      code: 'ANALYSIS_VERSION_ALREADY_RESERVED', details: { analysisJobId: id },
    }) }));
  });

  it('does not disclose a reserved job with a mismatched actor', async () => {
    const f = fixture();
    const source = { id: f.manuscript, workId: f.work, ownerUserId: f.user, contentHash: 'a'.repeat(64), locale: 'ko' };
    f.tx.storyManuscriptVersion.findFirst.mockResolvedValue(source);
    f.tx.storyManuscriptVersion.findUniqueOrThrow.mockResolvedValue(source);
    f.tx.storyAnalysisJob.findFirst.mockResolvedValue({ id: randomUUID(), workId: f.work, actorUserId: randomUUID() });
    await expect(f.repository.enqueue(f.user, f.manuscript, randomUUID(), semanticConfig({})))
      .rejects.toMatchObject({ status: 404 });
  });

  it('query DTO defaults to 12 and transforms bounded integer limits', async () => {
    expect(plainToInstance(StoryAnalysisDiscoveryQueryDto, {}).limit).toBe(12);
    const dto = plainToInstance(StoryAnalysisDiscoveryQueryDto, { limit: '30', cursor: randomUUID() });
    expect(await validate(dto)).toHaveLength(0); expect(dto.limit).toBe(30);
  });

  it.each([{ limit: '0' }, { limit: '31' }, { limit: '1.2' }, { limit: 'NaN' }, { cursor: 'not-uuid' }])(
    'query DTO rejects malformed page arguments %j', async value => {
      expect((await validate(plainToInstance(StoryAnalysisDiscoveryQueryDto, value))).length).toBeGreaterThan(0);
    });
});
