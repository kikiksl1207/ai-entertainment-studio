import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SiteContentService } from './site-content.service';

type EntryStatus = 'draft' | 'published' | 'archived';
type Entry = {
  id: string;
  contentKey: string;
  scope: string;
  pageKey: string | null;
  characterSlug: string | null;
  modelSlug: string | null;
  locale: string;
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  content: Record<string, unknown>;
  status: EntryStatus;
  version: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  publishedByUserId: string | null;
  archivedByUserId: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
type Query = { where: Record<string, unknown>; take?: number };
type Write = Query & { data: Record<string, unknown> };
type AuditData = {
  entryId: string;
  action: string;
  actorUserId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  metadata: Record<string, unknown>;
};
type TransactionRecord = {
  committed: boolean;
  tx: {
    siteContentEntry: {
      update: jest.Mock;
      findUnique: jest.Mock;
    };
    siteContentAuditLog: { create: jest.Mock };
  };
};
type Outcome = { value?: unknown; error?: unknown };

const ENTRY_ID = '00000000-0000-4000-8000-000000000101';
const OTHER_ID = '00000000-0000-4000-8000-000000000102';
const admin = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'cms-admin@example.test',
  adminRole: 'super_admin',
  adminPermissions: ['*'],
};

function entry(overrides: Partial<Entry> = {}): Entry {
  const status = overrides.status ?? 'draft';
  const stamp = new Date('2026-10-10T00:00:00.000Z');
  return {
    id: ENTRY_ID,
    contentKey: 'artists.hero.title',
    scope: 'page',
    pageKey: 'artists',
    characterSlug: null,
    modelSlug: null,
    locale: 'ko-KR',
    title: 'SAFE_ORIGINAL_TITLE',
    body: 'RAW_ORIGINAL_BODY_SENTINEL',
    ctaLabel: null,
    ctaHref: null,
    content: { public_line: 'RAW_ORIGINAL_JSON_SENTINEL' },
    status,
    version: 4,
    createdByUserId: admin.id,
    updatedByUserId: admin.id,
    publishedByUserId: status === 'draft' ? null : admin.id,
    archivedByUserId: status === 'archived' ? admin.id : null,
    publishedAt: status === 'draft' ? null : stamp,
    archivedAt: status === 'archived' ? stamp : null,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function matches(row: Entry, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    if (!(key in row)) throw new Error(`Unsupported fixture predicate: ${key}`);
    return row[key as keyof Entry] === value;
  });
}

function applyWrite(row: Entry, data: Record<string, unknown>): Entry {
  const { version, ...fields } = structuredClone(data);
  let nextVersion = row.version;
  if (version !== undefined) {
    if (typeof version === 'number') nextVersion = version;
    else if (typeof version === 'object' && version !== null &&
             'increment' in version && typeof version.increment === 'number') {
      nextVersion += version.increment;
    } else throw new Error('Unsupported fixture version operation');
  }
  return {
    ...row,
    ...fields,
    version: nextVersion,
    updatedAt: new Date('2026-10-10T00:00:01.000Z'),
  } as Entry;
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('SYNTHETIC_PRISMA_ERROR_SENTINEL', {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

function harness(initial: Entry[] = [entry()]) {
  const rows = new Map(initial.map((row) => [row.id, structuredClone(row)]));
  const audits: AuditData[] = [];
  const transactions: TransactionRecord[] = [];
  let nextPause: { reached: ReturnType<typeof deferred>; released: ReturnType<typeof deferred> } | undefined;
  let writeFailure: Error | undefined;
  let auditFailure: Error | undefined;
  const read = (source: Map<string, Entry>, args: Query) => {
    const row = [...source.values()].find((item) => matches(item, args.where));
    return row ? structuredClone(row) : null;
  };
  const prisma = {
    siteContentEntry: {
      findUnique: jest.fn(async (args: Query) => read(rows, args)),
      findMany: jest.fn(async (args: Query) => [...rows.values()]
        .filter((row) => matches(row, args.where))
        .slice(0, args.take ?? rows.size).map((row) => structuredClone(row))),
    },
    $transaction: jest.fn(async (callback: (tx: TransactionRecord['tx']) => Promise<unknown>) => {
      const pause = nextPause;
      nextPause = undefined;
      const record = { committed: false } as TransactionRecord;
      transactions.push(record);
      if (pause) {
        pause.reached.resolve();
        await pause.released.promise;
      }
      // Start after the winner commits; keep all writes local until audit succeeds.
      const working = new Map([...rows].map(([id, row]) => [id, structuredClone(row)]));
      const dirty = new Set<string>();
      const pendingAudits: AuditData[] = [];
      record.tx = {
        siteContentEntry: {
          findUnique: jest.fn(async (args: Query) => read(working, args)),
          update: jest.fn(async (args: Write) => {
            if (writeFailure) {
              const failure = writeFailure;
              writeFailure = undefined;
              throw failure;
            }
            const row = read(working, args);
            if (!row) throw prismaError('P2025');
            const updated = applyWrite(row, args.data);
            working.set(row.id, updated);
            dirty.add(row.id);
            return structuredClone(updated);
          }),
        },
        siteContentAuditLog: {
          create: jest.fn(async (args: { data: AuditData }) => {
            if (auditFailure) {
              const failure = auditFailure;
              auditFailure = undefined;
              throw failure;
            }
            pendingAudits.push(structuredClone(args.data));
            return { id: `synthetic-audit-${audits.length + pendingAudits.length}`, ...args.data };
          }),
        },
      };
      const result = await callback(record.tx);
      for (const id of dirty) rows.set(id, structuredClone(working.get(id)!));
      audits.push(...pendingAudits);
      record.committed = true;
      return result;
    }),
  };
  return {
    service: new SiteContentService(prisma as unknown as PrismaService),
    prisma,
    transactions,
    snapshot: () => structuredClone({ rows: [...rows.values()], audits }),
    row: (id = ENTRY_ID) => structuredClone(rows.get(id)!),
    pauseNextTransaction: () => {
      if (nextPause) throw new Error('A transaction pause is already armed');
      const reached = deferred();
      const released = deferred();
      nextPause = { reached, released };
      return { reached: reached.promise, release: released.resolve };
    },
    failNextWrite: (error: Error) => { writeFailure = error; },
    failNextAudit: (error: Error) => { auditFailure = error; },
  };
}

function settled(operation: Promise<unknown>): Promise<Outcome> {
  return operation.then((value) => ({ value }), (error: unknown) => ({ error }));
}

function expectConflict(outcome: Outcome, expected: Entry) {
  expect(outcome.error instanceof HttpException ? outcome.error.getStatus() : undefined).toBe(409);
  expect(outcome.value).toBeUndefined();
  const response = (outcome.error as HttpException).getResponse();
  expect(response).toMatchObject({
    code: 'SITE_CONTENT_REVISION_CONFLICT',
    messageKey: 'siteContent.error.revisionConflict',
    details: {
      id: expected.id,
      expectedVersion: expected.version,
      expectedStatus: expected.status,
      reloadRequired: true,
    },
  });
  expect((response as { details: unknown }).details).toEqual({
    id: expected.id, expectedVersion: expected.version,
    expectedStatus: expected.status, reloadRequired: true,
  });
  expect(JSON.stringify(response)).not.toContain('SYNTHETIC_PRISMA_ERROR_SENTINEL');
}

async function race(
  state: ReturnType<typeof harness>,
  start: () => Promise<unknown>,
  winner: () => Promise<void>,
) {
  const original = state.row();
  const gate = state.pauseNextTransaction();
  const pending = settled(start());
  try {
    await Promise.race([
      gate.reached,
      pending.then(() => { throw new Error('Stale operation settled before the transaction barrier'); }),
    ]);
    await winner();
    const committedWinner = state.snapshot();
    gate.release();
    expectConflict(await pending, original);
    expect(state.snapshot()).toEqual(committedWinner);
    const loser = state.transactions[0];
    expect(loser.committed).toBe(false);
    expect(loser.tx.siteContentEntry.update).toHaveBeenCalledTimes(1);
    expect(loser.tx.siteContentEntry.update).toHaveBeenCalledWith({
      where: { id: original.id, status: original.status, version: original.version },
      data: expect.any(Object),
    });
    await expect(loser.tx.siteContentEntry.update.mock.results[0].value)
      .rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await expect(loser.tx.siteContentEntry.update.mock.results[0].value)
      .rejects.toMatchObject({ code: 'P2025' });
    expect(loser.tx.siteContentEntry.findUnique).not.toHaveBeenCalled();
    expect(loser.tx.siteContentAuditLog.create).not.toHaveBeenCalled();
  } finally {
    gate.release();
    await pending;
  }
}

const operations = ['edit', 'publish', 'archive', 'restore'] as const;
type Operation = typeof operations[number];
function initialFor(operation: Operation) {
  return entry({ status: operation === 'restore' ? 'archived' : 'draft' });
}
function perform(state: ReturnType<typeof harness>, operation: Operation) {
  switch (operation) {
    case 'edit': return state.service.updateAdmin(admin, ENTRY_ID, { body: 'RAW_UPDATED_BODY_SENTINEL' });
    case 'publish': return state.service.publishAdmin(admin, ENTRY_ID);
    case 'archive': return state.service.archiveAdmin(admin, ENTRY_ID);
    case 'restore': return state.service.restoreAdmin(admin, ENTRY_ID, {});
  }
}

describe('SiteContentService lifecycle concurrency', () => {
  it('CMS-CAS-RED: rejects stale draft edit after publish without changing public copy', async () => {
    const state = harness();
    await race(state,
      () => state.service.updateAdmin(admin, ENTRY_ID, { body: 'UNPUBLISHED_NEW_BODY_SENTINEL' }),
      async () => {
        const result = await state.service.publishAdmin(admin, ENTRY_ID);
        expect(result.item).toMatchObject({ status: 'published', version: 5, body: 'RAW_ORIGINAL_BODY_SENTINEL' });
        const publicCopy = await state.service.getBootstrap({ locale: 'ko-KR', pageKey: 'artists' });
        expect(publicCopy.items).toHaveLength(1);
        expect(publicCopy.items[0].body).toBe('RAW_ORIGINAL_BODY_SENTINEL');
      });
  });

  it('CMS-CAS-RED: rejects stale publish after archive without resurrecting content', async () => {
    const state = harness();
    await race(state,
      () => state.service.publishAdmin(admin, ENTRY_ID),
      async () => {
        const result = await state.service.archiveAdmin(admin, ENTRY_ID);
        expect(result.item).toMatchObject({ status: 'archived', version: 5 });
        const archivedAt = state.row().archivedAt;
        expect(Object.prototype.toString.call(archivedAt)).toBe('[object Date]');
        const archivedEpoch = Date.prototype.getTime.call(archivedAt);
        expect(Number.isFinite(archivedEpoch)).toBe(true);
        expect(Date.prototype.toISOString.call(archivedAt)).toBe(result.item.archivedAt);
        expect(Date.parse(result.item.archivedAt!)).toBe(archivedEpoch);
        expect((await state.service.getBootstrap({ locale: 'ko-KR' })).items).toEqual([]);
      });
  });

  it('CMS-CAS-RED: rejects stale publish after an edit empties the draft', async () => {
    const state = harness();
    await race(state,
      () => state.service.publishAdmin(admin, ENTRY_ID),
      async () => {
        const result = await state.service.updateAdmin(admin, ENTRY_ID, {
          title: null, body: null, ctaLabel: null, ctaHref: null, content: {},
        });
        expect(result.item).toMatchObject({ status: 'draft', version: 5, title: null, body: null, content: {} });
        await expect(state.service.publishAdmin(admin, ENTRY_ID)).rejects.toMatchObject({
          response: { code: 'SITE_CONTENT_EMPTY_CONTENT' },
        });
        expect((await state.service.getBootstrap({ locale: 'ko-KR' })).items).toEqual([]);
      });
  });

  it('rejects stale restore after restore/archive returns to the same archived status', async () => {
    const state = harness([entry({ status: 'archived' })]);
    await race(state,
      () => state.service.restoreAdmin(admin, ENTRY_ID, { status: 'published' }),
      async () => {
        expect((await state.service.restoreAdmin(admin, ENTRY_ID, {})).item).toMatchObject({ status: 'draft', version: 5 });
        expect((await state.service.archiveAdmin(admin, ENTRY_ID)).item).toMatchObject({ status: 'archived', version: 6 });
      });
  });

  it('rejects stale archive after archive/default-draft-restore', async () => {
    const state = harness([entry({ status: 'published' })]);
    await race(state,
      () => state.service.archiveAdmin(admin, ENTRY_ID),
      async () => {
        expect((await state.service.archiveAdmin(admin, ENTRY_ID)).item).toMatchObject({ status: 'archived', version: 5 });
        expect((await state.service.restoreAdmin(admin, ENTRY_ID, {})).item).toMatchObject({ status: 'draft', version: 6 });
      });
  });

  it.each(operations)('maps real Prisma P2025 to safe 409 without mutation/audit for %s', async (operation) => {
    const original = initialFor(operation);
    const state = harness([original]);
    const before = state.snapshot();
    const failure = prismaError('P2025');
    state.failNextWrite(failure);
    expectConflict(await settled(perform(state, operation)), original);
    expect(state.snapshot()).toEqual(before);
    const transaction = state.transactions[0];
    expect(transaction.committed).toBe(false);
    expect(transaction.tx.siteContentEntry.update).toHaveBeenCalledWith({
      where: { id: original.id, status: original.status, version: original.version },
      data: expect.any(Object),
    });
    expect(transaction.tx.siteContentEntry.update).toHaveBeenCalledTimes(1);
    expect(transaction.tx.siteContentEntry.findUnique).not.toHaveBeenCalled();
    expect(transaction.tx.siteContentAuditLog.create).not.toHaveBeenCalled();
    expect(state.prisma.siteContentEntry.findUnique).toHaveBeenCalledTimes(1);
    await expect(transaction.tx.siteContentEntry.update.mock.results[0].value).rejects.toBe(failure);
  });

  it.each([
    ['real Prisma P2002', prismaError('P2002')],
    ['ordinary error', new Error('SYNTHETIC_ORDINARY_WRITE_FAILURE')],
    ['P2025 lookalike', Object.assign(new Error('SYNTHETIC_CODE_ONLY_FAILURE'), { code: 'P2025' })],
  ] as const)('preserves %s unchanged instead of translating it to a revision conflict', async (_name, failure) => {
    const state = harness();
    const before = state.snapshot();
    state.failNextWrite(failure);
    const outcome = await settled(perform(state, 'edit'));
    expect(outcome.error).toBe(failure);
    expect(outcome.value).toBeUndefined();
    expect(state.snapshot()).toEqual(before);
    expect(state.transactions[0].committed).toBe(false);
    expect(state.transactions[0].tx.siteContentAuditLog.create).not.toHaveBeenCalled();
  });

  it('preserves normal edit/publish/archive/default-draft-restore and current audit revisions', async () => {
    const state = harness();
    expect((await state.service.getBootstrap({ locale: 'ko-KR' })).items).toEqual([]);
    expect((await state.service.updateAdmin(admin, ENTRY_ID, { body: 'RAW_UPDATED_BODY_SENTINEL' })).item)
      .toMatchObject({ status: 'draft', version: 5, body: 'RAW_UPDATED_BODY_SENTINEL' });
    expect((await state.service.publishAdmin(admin, ENTRY_ID)).item).toMatchObject({ status: 'published', version: 6 });
    expect((await state.service.getBootstrap({ locale: 'ko-KR' })).items).toHaveLength(1);
    expect((await state.service.archiveAdmin(admin, ENTRY_ID)).item).toMatchObject({ status: 'archived', version: 7 });
    expect((await state.service.getBootstrap({ locale: 'ko-KR' })).items).toEqual([]);
    const restored = await state.service.restoreAdmin(admin, ENTRY_ID, {});
    expect(restored).toMatchObject({ restored: true, targetStatus: 'draft', item: { status: 'draft', version: 8 } });
    expect(state.row()).toMatchObject({
      publishedAt: null, publishedByUserId: null, archivedAt: null, archivedByUserId: null,
      createdByUserId: admin.id, updatedByUserId: admin.id,
    });
    expect((await state.service.getBootstrap({ locale: 'ko-KR' })).items).toEqual([]);
    expect(state.snapshot().audits.map((log) => ({
      action: log.action, before: log.before.version, after: log.after.version,
      from: log.before.status, to: log.after.status, actor: log.actorUserId,
    }))).toEqual([
      { action: 'update', before: 4, after: 5, from: 'draft', to: 'draft', actor: admin.id },
      { action: 'publish', before: 5, after: 6, from: 'draft', to: 'published', actor: admin.id },
      { action: 'archive', before: 6, after: 7, from: 'published', to: 'archived', actor: admin.id },
      { action: 'restore', before: 7, after: 8, from: 'archived', to: 'draft', actor: admin.id },
    ]);
    const expectedBefore = [
      { status: 'draft', version: 4 }, { status: 'draft', version: 5 },
      { status: 'published', version: 6 }, { status: 'archived', version: 7 },
    ];
    state.transactions.forEach((transaction, index) => {
      expect(transaction.committed).toBe(true);
      expect(transaction.tx.siteContentEntry.update).toHaveBeenCalledTimes(1);
      expect(transaction.tx.siteContentEntry.update).toHaveBeenCalledWith({
        where: { id: ENTRY_ID, ...expectedBefore[index] }, data: expect.any(Object),
      });
      expect(transaction.tx.siteContentEntry.findUnique).not.toHaveBeenCalled();
    });
  });

  it('preserves non-empty direct published restore with its publication markers', async () => {
    const state = harness([entry({ status: 'archived' })]);
    const result = await state.service.restoreAdmin(admin, ENTRY_ID, { status: 'published' });
    expect(result).toMatchObject({ restored: true, targetStatus: 'published', item: { status: 'published', version: 5 } });
    expect(state.row()).toMatchObject({ archivedAt: null, archivedByUserId: null, publishedByUserId: admin.id });
    const publishedAt = state.row().publishedAt;
    expect(Object.prototype.toString.call(publishedAt)).toBe('[object Date]');
    const publishedEpoch = Date.prototype.getTime.call(publishedAt);
    expect(Number.isFinite(publishedEpoch)).toBe(true);
    expect(Date.prototype.toISOString.call(publishedAt)).toBe(result.item.publishedAt);
    expect(Date.parse(result.item.publishedAt!)).toBe(publishedEpoch);
    expect((await state.service.getBootstrap({ locale: 'ko-KR' })).items).toHaveLength(1);
    expect(state.snapshot().audits).toHaveLength(1);
    expect(state.snapshot().audits[0]).toMatchObject({ action: 'restore', metadata: { targetStatus: 'published' } });
  });

  it.each([
    ['publish', 'published', { alreadyPublished: true }],
    ['archive', 'archived', { alreadyArchived: true }],
    ['restore', 'draft', { alreadyRestored: true, restored: false, targetStatus: 'draft' }],
    ['restore', 'published', { alreadyRestored: true, restored: false, targetStatus: 'published' }],
  ] as const)('keeps %s on %s idempotent without transaction/audit', async (operation, status, expected) => {
    const state = harness([entry({ status })]);
    const before = state.snapshot();
    expect(await perform(state, operation)).toMatchObject(expected);
    expect(state.snapshot()).toEqual(before);
    expect(state.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not reject or overwrite a different entry committed during the barrier', async () => {
    const state = harness([entry(), entry({ id: OTHER_ID, contentKey: 'artists.other.title', locale: 'en-US' })]);
    const gate = state.pauseNextTransaction();
    const pending = settled(state.service.updateAdmin(admin, ENTRY_ID, { body: 'RAW_UPDATED_BODY_SENTINEL' }));
    try {
      await Promise.race([
        gate.reached,
        pending.then(() => { throw new Error('Edit settled before the transaction barrier'); }),
      ]);
      expect((await state.service.publishAdmin(admin, OTHER_ID)).item).toMatchObject({ id: OTHER_ID, version: 5, status: 'published' });
      const otherWinner = state.row(OTHER_ID);
      gate.release();
      const outcome = await pending;
      expect(outcome.error).toBeUndefined();
      expect(outcome.value).toMatchObject({ item: { id: ENTRY_ID, version: 5, status: 'draft', body: 'RAW_UPDATED_BODY_SENTINEL' } });
      expect(state.row(OTHER_ID)).toEqual(otherWinner);
      expect(state.snapshot().audits.map((log) => log.entryId)).toEqual([OTHER_ID, ENTRY_ID]);
      expect((await state.service.getBootstrap({ locale: 'ko-KR' })).items).toEqual([]);
      expect((await state.service.getBootstrap({ locale: 'en-US' })).items.map((item) => item.id)).toEqual([OTHER_ID]);
    } finally {
      gate.release();
      await pending;
    }
  });

  it.each(operations)('rolls back the %s mutation when its audit fails', async (operation) => {
    const state = harness([initialFor(operation)]);
    const before = state.snapshot();
    const failure = new Error('SYNTHETIC_AUDIT_FAILURE');
    state.failNextAudit(failure);
    const outcome = await settled(perform(state, operation));
    expect(outcome.error).toBe(failure);
    expect(outcome.value).toBeUndefined();
    expect(state.snapshot()).toEqual(before);
    expect(state.transactions[0].committed).toBe(false);
    expect(state.transactions[0].tx.siteContentAuditLog.create).toHaveBeenCalledTimes(1);
    expect(state.transactions[0].tx.siteContentEntry.update).toHaveBeenCalledTimes(1);
    await expect(state.transactions[0].tx.siteContentEntry.update.mock.results[0].value)
      .resolves.toMatchObject({ id: ENTRY_ID, version: 5 });
  });

  it('records metadata only across successful lifecycle actions, never raw copy', async () => {
    const state = harness();
    await state.service.updateAdmin(admin, ENTRY_ID, {
      body: 'RAW_UPDATED_BODY_SENTINEL',
      content: { public_line: 'RAW_UPDATED_JSON_SENTINEL', new_key: 'RAW_SECOND_JSON_SENTINEL' },
    });
    await state.service.publishAdmin(admin, ENTRY_ID);
    await state.service.archiveAdmin(admin, ENTRY_ID);
    await state.service.restoreAdmin(admin, ENTRY_ID, {});
    const logs = state.snapshot().audits;
    expect(logs).toHaveLength(4);
    const fields = [
      'contentKey', 'scope', 'pageKey', 'characterSlug', 'modelSlug', 'locale',
      'status', 'version', 'titleLength', 'bodyLength', 'ctaLabelLength',
      'ctaHrefKind', 'contentKeys', 'publishedAt', 'archivedAt',
    ].sort();
    for (const log of logs) {
      expect(Object.keys(log.before).sort()).toEqual(fields);
      expect(Object.keys(log.after).sort()).toEqual(fields);
      expect(log).toMatchObject({ entryId: ENTRY_ID, actorUserId: admin.id });
      expect(log.metadata.changedFields).toEqual(expect.arrayContaining(['version']));
    }
    const serialized = JSON.stringify(logs);
    for (const text of [
      'SAFE_ORIGINAL_TITLE', 'RAW_ORIGINAL_BODY_SENTINEL', 'RAW_ORIGINAL_JSON_SENTINEL',
      'RAW_UPDATED_BODY_SENTINEL', 'RAW_UPDATED_JSON_SENTINEL', 'RAW_SECOND_JSON_SENTINEL', admin.email,
    ]) expect(serialized).not.toContain(text);
  });
});
