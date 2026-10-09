import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UpsertStoryReleaseCapabilityDto } from './dto/story-economics.dto';
import { StoryEconomicsService } from './story-economics.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class { constructor() { throw new Error('Real Prisma client forbidden'); } },
}));

const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-${String(n).padStart(12, '0')}`;
const releaseId = id(1), otherReleaseId = id(2), workId = id(3), rateCardId = id(4);
const adminId = id(5);
const copy = <T>(value: T): T => structuredClone(value);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
function input(expectedRevision?: number, extra: Partial<UpsertStoryReleaseCapabilityDto> = {}) {
  return Object.assign(new UpsertStoryReleaseCapabilityDto(), {
    rateCardId, customChoiceEnabled: false, ...(expectedRevision === undefined ? {} : { expectedRevision }), ...extra,
  });
}

type Row = Record<string, any> & { id: string; releaseId: string; revision: number };
type Options = {
  barrier?: boolean;
  failWrite?: boolean;
  failCommit?: boolean;
  beforeWrite?: (release: string) => void;
  writeError?: Error;
  onSave?: (release: string) => Promise<void>;
};
type Tx = { held: Set<string>; writes: Map<string, Row>; unlock: Array<() => void> };

// Only these in-memory delegates exist. Each parent lock is held through commit/rollback.
function fixture(revision: number | null = 4, options: Options = {}) {
  const rows = new Map<string, Row>();
  if (revision !== null) rows.set(releaseId, {
    ...input(), id: id(6), workId, releaseId, revision, status: 'active', validationErrors: [],
  });
  const releases = new Map([[releaseId, { id: releaseId, workId }], [otherReleaseId, { id: otherReleaseId, workId }]]);
  const work = { id: workId, priceLumina: { isZero: () => true } };
  const rate = { id: rateCardId, status: 'active' };
  const tails = new Map<string, Promise<void>>(), gate = deferred();
  const events: string[] = [], saves: Array<{ releaseId: string; operation: string; payload: any }> = [];
  let arrivals = 0, commits = 0, rollbacks = 0;

  function strict<T extends object>(value: T): T {
    return new Proxy(value, { get(target, key, receiver) {
      if (!(key in target)) throw new Error('Unexpected persistence delegate: ' + String(key));
      return Reflect.get(target, key, receiver);
    } });
  }
  function client(tx?: Tx): any {
    async function stage(release: string, row: Row, operation: string, payload: any) {
      if (!tx?.held.has(release)) throw new Error('Write without parent lock');
      tx.writes.set(release, row);
      saves.push({ releaseId: release, operation, payload: copy(payload) });
      events.push('save:' + release);
      if (options.onSave) await options.onSave(release);
      if (options.failWrite) throw new Error('Synthetic save failure');
    }
    return strict({
      storyRelease: strict({ findUnique: jest.fn(async ({ where }: any) => releases.get(where.id) ?? null) }),
      storyWork: strict({ findUnique: jest.fn(async ({ where }: any) => where.id === work.id ? work : null) }),
      storyAiRateCard: strict({ findUnique: jest.fn(async ({ where }: any) => where.id === rate.id ? rate : null) }),
      storyReleaseCapability: strict({
        findUnique: jest.fn(async ({ where }: any) => {
          const release = where.releaseId ?? [...(tx?.writes.values() ?? []), ...rows.values()]
            .find(row => row.id === where.id)?.releaseId;
          const row = tx?.writes.get(release) ?? rows.get(release);
          const snapshot = row ? copy(row) : null;
          if (options.barrier && !where.id && !tx?.held.has(release)) {
            arrivals++;
            if (arrivals === 2) gate.resolve();
            await gate.promise;
          }
          events.push((where.id ? 'reload:' : tx?.held.has(release) ? 'locked-read:' : 'read:') + release);
          return snapshot;
        }),
        updateMany: jest.fn(async (payload: any) => {
          const { where, data } = payload, release = where.releaseId;
          options.beforeWrite?.(release);
          if (options.writeError) throw options.writeError;
          const previous = tx?.writes.get(release) ?? rows.get(release);
          if (!previous || previous.id !== where.id || previous.releaseId !== where.releaseId ||
              previous.revision !== where.revision) return { count: 0 };
          const row = { ...previous, ...copy(data), revision: previous.revision + data.revision.increment };
          await stage(release, row, 'updateMany', payload);
          return { count: 1 };
        }),
        create: jest.fn(async (payload: any) => {
          const release = payload.data.releaseId;
          options.beforeWrite?.(release);
          if (options.writeError) throw options.writeError;
          if (tx?.writes.has(release) || rows.has(release)) throw new Prisma.PrismaClientKnownRequestError(
            'Synthetic unique conflict', { code: 'P2002', clientVersion: 'synthetic', meta: { target: ['release_id'] } });
          const row = { ...copy(payload.data), id: id(7), releaseId: release, revision: 1 };
          await stage(release, row, 'create', payload);
          return copy(row);
        }),
      }),
      $queryRaw: jest.fn(async (sql: any) => {
        if (!tx) throw new Error('Parent lock outside transaction');
        expect(sql.text.replace(/\s+/g, ' ').trim()).toBe('SELECT id FROM story_releases WHERE id = $1::uuid FOR UPDATE');
        expect(sql.values).toHaveLength(1);
        const release = sql.values[0];
        expect(typeof release).toBe('string');
        const before = tails.get(release) ?? Promise.resolve(), lock = deferred();
        tails.set(release, before.then(() => lock.promise));
        await before;
        tx.held.add(release); tx.unlock.push(lock.resolve);
        events.push('lock:' + release);
        return releases.has(release) ? [{ id: release }] : [];
      }),
    });
  }
  const root = client();
  root.$transaction = jest.fn(async (run: (tx: any) => Promise<any>, settings: any) => {
    expect(settings?.isolationLevel).toBe('ReadCommitted');
    const tx: Tx = { held: new Set(), writes: new Map(), unlock: [] };
    try {
      const result = await run(client(tx));
      if (options.failCommit) throw new Error('Synthetic commit failure');
      for (const [release, row] of tx.writes) rows.set(release, copy(row));
      commits++; return result;
    } catch (error) { rollbacks++; throw error; }
    finally { for (const unlock of tx.unlock) unlock(); }
  });
  const service = new StoryEconomicsService(root as never);
  return { service, root, rows, releases, rate, work, events, saves, options,
    commits: () => commits, rollbacks: () => rollbacks };
}

function expectConflict(result: PromiseSettledResult<unknown>) {
  expect(result.status).toBe('rejected');
  const error = (result as PromiseRejectedResult).reason;
  expect(error).toBeInstanceOf(ConflictException);
  expect(error.getStatus()).toBe(409);
  expect(error.message).toBe('Story release capability changed concurrently');
}

describe('release capability revision: isolated synthetic transaction adapter', () => {
  it('same expected revision permits one concurrent save and one 409 without overwriting the winner', async () => {
    const f = fixture(4, { barrier: true });
    const bodies = [input(4, { aiOutputTokenLimit: 2000 }), input(4, { aiOutputTokenLimit: 2500 })];
    const results = await Promise.allSettled(bodies.map(body => f.service.upsertReleaseCapability(adminId, releaseId, body)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expectConflict(results.find(result => result.status === 'rejected')!);
    const winner = results.findIndex(result => result.status === 'fulfilled');
    expect(f.rows.get(releaseId)?.revision).toBe(5);
    expect(f.rows.get(releaseId)?.aiOutputTokenLimit).toBe(bodies[winner].aiOutputTokenLimit);
    expect(f.saves).toHaveLength(1); expect(f.commits()).toBe(1); expect(f.rollbacks()).toBe(1);
    expect(f.events.filter(event => event === 'locked-read:' + releaseId)).toHaveLength(2);
  });

  it.each([undefined, 1])('simultaneous initial creation at expectedRevision %s yields one create and one 409', async expected => {
    const f = fixture(null, { barrier: true });
    const results = await Promise.allSettled([0, 1].map(() =>
      f.service.upsertReleaseCapability(adminId, releaseId, input(expected))));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expectConflict(results.find(result => result.status === 'rejected')!);
    expect(f.rows.get(releaseId)?.revision).toBe(1);
    expect(f.saves).toHaveLength(1); expect(f.commits()).toBe(1); expect(f.rollbacks()).toBe(1);
  });

  it('an independent release saves while another parent lock remains held', async () => {
    const entered = deferred(), release = deferred();
    const f = fixture(null, { onSave: async target => { if (target === releaseId) { entered.resolve(); await release.promise; } } });
    const first = f.service.upsertReleaseCapability(adminId, releaseId, input());
    await entered.promise;
    try {
      const second = await f.service.upsertReleaseCapability(adminId, otherReleaseId, input());
      expect(second.revision).toBe(1); expect(f.rows.has(releaseId)).toBe(false);
      expect(f.rows.has(otherReleaseId)).toBe(true);
    } finally { release.resolve(); }
    expect((await first).revision).toBe(1);
    expect(f.commits()).toBe(2);
  });

  it.each([undefined, null, 0, 3, 5, '4'])('an existing row rejects missing or incorrect revision %s without any write', async expected => {
    const f = fixture();
    await expect(f.service.upsertReleaseCapability(adminId, releaseId, input(expected as number)))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.rows.get(releaseId)?.revision).toBe(4); expect(f.saves).toHaveLength(0);
  });

  it.each([undefined, 9])('initial creation preserves legacy/default fields and response at revision %s', async expected => {
    const f = fixture(null), body = input(expected);
    const result = await f.service.upsertReleaseCapability(adminId, releaseId, body);
    expect(result).toMatchObject({ revision: 1, configStatus: 'active', source: 'active_release_capability',
      resetPolicy: { fullLimit: 1, actLimit: 3 }, aiBudget: { inputTokenLimit: 12000, outputTokenLimit: 2500 } });
    const row = f.rows.get(releaseId)!;
    for (const field of ['rateCardId', 'fixedChoiceCount', 'customChoiceEnabled', 'customChoiceMaxLength',
      'fullResetLimit', 'actResetLimit', 'includedAiRouteCount', 'aiInputTokenLimit', 'aiOutputTokenLimit',
      'warningBudgetKrw', 'hardBudgetKrw'] as const) expect(row[field]).toBe(body[field]);
    expect(row.workId).toBe(workId); expect(row.updatedByUserId).toBe(adminId);
    expect(row.validationErrors).toEqual([]); expect(f.saves[0].operation).toBe('create');
    expect(f.saves[0].payload.data.revision).toBeUndefined();
    expect(f.root.$transaction).toHaveBeenCalledTimes(1);
  });

  it('a sequential correct revision still saves and keeps policy validation and projection unchanged', async () => {
    const f = fixture(), body = input(4, { customChoiceEnabled: true });
    const result = await f.service.upsertReleaseCapability(adminId, releaseId, body);
    expect(result.revision).toBe(5); expect(result.configStatus).toBe('invalid');
    expect(result.aiGenerationEnabled).toBe(false);
    expect(f.rows.get(releaseId)?.validationErrors).toEqual([
      'first_release_custom_choice_must_be_disabled', 'free_story_custom_choice_must_be_disabled',
    ]);
    expect(f.saves[0].operation).toBe('updateMany');
    expect(f.saves[0].payload.where).toEqual({ id: id(6), releaseId, revision: 4 });
    expect(f.saves[0].payload.data.revision).toEqual({ increment: 1 });
    expect(f.events.filter(event => event === 'reload:' + releaseId)).toHaveLength(1);
  });

  it.each(['write', 'commit', 'projection'])('a failed %s saves nothing and releases the parent lock for retry', async stage => {
    const f = fixture(), before = copy(f.rows.get(releaseId));
    if (stage === 'write') f.options.failWrite = true;
    if (stage === 'commit') f.options.failCommit = true;
    const projection = stage === 'projection'
      ? jest.spyOn(f.service as any, 'capabilityProjection').mockImplementationOnce(() => { throw new Error('Synthetic projection failure'); })
      : null;
    await expect(f.service.upsertReleaseCapability(adminId, releaseId, input(4))).rejects.toThrow('Synthetic');
    expect(f.saves).toHaveLength(1); expect(f.saves[0].operation).toBe('updateMany');
    expect(f.rows.get(releaseId)).toEqual(before); expect(f.commits()).toBe(0); expect(f.rollbacks()).toBe(1);
    f.options.failWrite = false; f.options.failCommit = false; projection?.mockRestore();
    await expect(f.service.upsertReleaseCapability(adminId, releaseId, input(4))).resolves.toMatchObject({ revision: 5 });
    expect(f.commits()).toBe(1);
  });

  it.each(['release', 'work', 'rate-card'])('missing %s still returns 404 without a capability write', async missing => {
    const f = fixture(null);
    if (missing === 'release') f.releases.delete(releaseId);
    if (missing === 'work') f.work.id = 'missing';
    if (missing === 'rate-card') f.rate.id = 'missing';
    await expect(f.service.upsertReleaseCapability(adminId, releaseId, input())).rejects.toBeInstanceOf(NotFoundException);
    expect(f.saves).toHaveLength(0); expect(f.rows.size).toBe(0);
  });

  it('a retired rate card still returns 409 without changing values or revision', async () => {
    const f = fixture(); f.rate.status = 'retired';
    await expect(f.service.upsertReleaseCapability(adminId, releaseId, input(4))).rejects.toBeInstanceOf(ConflictException);
    expect(f.saves).toHaveLength(0); expect(f.rows.get(releaseId)?.revision).toBe(4);
  });

  it.each(['revision', 'identity'])('a direct writer changing %s after the locked read is not overwritten', async change => {
    const f = fixture();
    let external!: Row;
    f.options.beforeWrite = target => {
      external = { ...copy(f.rows.get(target)!), aiOutputTokenLimit: 1800,
        ...(change === 'revision' ? { revision: 5 } : { id: id(8) }) };
      f.rows.set(target, external);
    };
    const result = await Promise.allSettled([f.service.upsertReleaseCapability(adminId, releaseId, input(4))]);
    expectConflict(result[0]);
    expect(f.rows.get(releaseId)).toEqual(external); expect(f.saves).toHaveLength(0);
    expect(f.events).toContain('locked-read:' + releaseId);
    expect(f.events).not.toContain('reload:' + releaseId);
    expect(f.commits()).toBe(0); expect(f.rollbacks()).toBe(1);
  });

  it('a direct writer creating after the locked read gets a unique conflict, not an update', async () => {
    const f = fixture(null);
    const external: Row = { ...input(), id: id(8), workId, releaseId, revision: 1,
      aiOutputTokenLimit: 1800, status: 'active', validationErrors: [] };
    f.options.beforeWrite = target => { f.rows.set(target, copy(external)); };
    const result = await Promise.allSettled([f.service.upsertReleaseCapability(adminId, releaseId, input())]);
    expectConflict(result[0]);
    expect(f.rows.get(releaseId)).toEqual(external); expect(f.saves).toHaveLength(0);
    expect(f.commits()).toBe(0); expect(f.rollbacks()).toBe(1);
  });

  it.each(['P2003', 'generic'])('a non-unique create failure %s is not translated into a revision conflict', async code => {
    const error = code === 'generic' ? new Error('Synthetic create failure') : new Prisma.PrismaClientKnownRequestError(
      'Synthetic foreign key failure', { code, clientVersion: 'synthetic' });
    const f = fixture(null, { writeError: error });
    await expect(f.service.upsertReleaseCapability(adminId, releaseId, input())).rejects.toBe(error);
    expect(f.rows.size).toBe(0); expect(f.saves).toHaveLength(0);
    expect(f.commits()).toBe(0); expect(f.rollbacks()).toBe(1);
  });
});
