import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { StoryContinuationWorker } from './story-continuation.worker';
import { PrismaService } from '../prisma/prisma.service';

describe('Nest application close with worker destroy before database application shutdown', () => {
  it.each(['database-first', 'worker-first', 'same-module'])('drains and persists before disconnect independent of provider/module order: %s', async (order) => {
    const events: string[] = [];
    let disconnected = false;
    const disconnect = jest.fn(async () => { disconnected = true; events.push('disconnect'); });
    // Exercise the real service hooks without constructing PrismaClient or connecting to a database.
    const database = Object.assign(Object.create(PrismaService.prototype) as PrismaService, {
      $connect: jest.fn(async () => undefined), $disconnect: disconnect,
    });
    let started!: () => void;
    const active = new Promise<void>((resolve) => { started = resolve; });
    const executor = { executeOne: jest.fn((_id: string, signal: AbortSignal) => new Promise<{ status: string }>((resolve) => {
      events.push('dispatch'); started();
      signal.addEventListener('abort', () => {
        events.push('abort');
        setTimeout(() => {
          expect(disconnected).toBe(false);
          events.push('persist-outcome-unknown');
          resolve({ status: 'failed' });
        }, 5);
      }, { once: true });
    })) };
    const workerProvider = {
      provide: StoryContinuationWorker, inject: ['FakePrisma'],
      useFactory: (_db: typeof database) => {
        const worker = new StoryContinuationWorker(executor, { readiness: async () => ({ enabled: true }) },
          { enabled: true, pollMs: 100, maxBackoffMs: 1_000, drainMs: 500 });
        return worker;
      },
    };
    @Global()
    @Module({ providers: [{ provide: 'FakePrisma', useValue: database }], exports: ['FakePrisma'] })
    class FakePrismaModule {}
    @Module({ providers: [workerProvider] })
    class FakeWorkerModule {}
    const module = order === 'same-module'
      ? await Test.createTestingModule({ providers: [{ provide: 'FakePrisma', useValue: database }, workerProvider] }).compile()
      : await Test.createTestingModule({ imports: order === 'database-first'
        ? [FakePrismaModule, FakeWorkerModule] : [FakeWorkerModule, FakePrismaModule] }).compile();
    const app = module.createNestApplication({ logger: false });
    await app.init(); await active;
    await app.close();
    expect(events).toEqual(['dispatch', 'abort', 'persist-outcome-unknown', 'disconnect']);
    expect(executor.executeOne).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(app.get(StoryContinuationWorker).readiness().reason).toBe('worker_stopped');
  });
});
