import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { StoryLifecycleService } from './story-lifecycle.service';
import { SemanticAnalysisService } from './story-semantic-analysis.service';
import { SemanticAnalysisProvider } from './story-semantic-analysis.provider';
import { SEMANTIC_WORKER, SEMANTIC_WORKER_FACTORY } from './story-semantic-analysis.worker';
import { semanticTestConfig } from './story-semantic-analysis.test-fixture';

describe('Semantic lifecycle boundaries', () => {
  it('does not feed completed candidates into legacy capped auto-approved memory', async () => {
    const prisma = {
      storyWork: { findFirst: jest.fn().mockResolvedValue({ id: 'work' }) },
      storyMemoryRetrievalRun: { findUnique: jest.fn().mockResolvedValue(null) },
      storyAnalysisJob: { findUnique: jest.fn().mockResolvedValue({ id: 'job', manuscriptVersionId: 'source', status: 'completed', pipeline: 'semantic_extraction_v1' }) },
      storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue({ id: 'source' }) },
      storyAnalysisEvidence: { findMany: jest.fn() }, $transaction: jest.fn(),
    };
    await expect(new StoryLifecycleService(prisma as never).buildMemory('owner', 'work', {
      analysisJobId: 'job', currentPartKey: 'part-1', retrievalTypes: ['style'],
    }, 'memory-test-key')).rejects.toMatchObject({ response: { code: 'ANALYSIS_EVIDENCE_APPROVAL_REQUIRED' } });
    expect(prisma.storyAnalysisEvidence.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('requires both explicit flags before a Nest bootstrap starts a worker', async () => {
    for (const flags of [{ enabled: false, workerEnabled: true }, { enabled: true, workerEnabled: false }]) {
      const executeOne = jest.fn();
      @Module({ providers: [
        { provide: SemanticAnalysisService, useValue: { executeOne } },
        { provide: SemanticAnalysisProvider, useValue: new SemanticAnalysisProvider(semanticTestConfig(flags), jest.fn()) },
        SEMANTIC_WORKER_FACTORY,
      ] })
      class App {}
      const app = await NestFactory.createApplicationContext(App, { logger: false });
      expect(app.get(SEMANTIC_WORKER).readiness()).toMatchObject({ enabled: false, reason: 'worker_disabled' });
      expect(executeOne).not.toHaveBeenCalled();
      await app.close();
    }
  });
  it('app.close aborts/drains persistence before the database application shutdown hook', async () => {
    const events: string[] = [];
    let start!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    let active = 0;
    const executeOne = jest.fn(async (_worker: string, signal: AbortSignal) => {
      expect(++active).toBe(1); start();
      await new Promise<void>(resolve => signal.addEventListener('abort', async () => {
        events.push('abort');
        await new Promise(done => setTimeout(done, 5));
        events.push('persist-unknown'); active--; resolve();
      }, { once: true }));
      return { status: 'failed' };
    });
    @Module({ providers: [{ provide: 'database', useValue: {
      onApplicationShutdown: () => { expect(active).toBe(0); events.push('disconnect'); },
    } }], exports: ['database'] })
    class DatabaseModule {}
    @Module({ imports: [DatabaseModule], providers: [
      { provide: SemanticAnalysisService, useValue: { executeOne } },
      { provide: SemanticAnalysisProvider, useValue: new SemanticAnalysisProvider(semanticTestConfig({ workerEnabled: true }), jest.fn()) },
      SEMANTIC_WORKER_FACTORY,
    ] })
    class App {}
    const app = await NestFactory.createApplicationContext(App, { logger: false });
    await started;
    await app.close();
    expect(events).toEqual(['abort', 'persist-unknown', 'disconnect']);
    expect(executeOne).toHaveBeenCalledTimes(1);
  });
});
