import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, type StoryStyleProfileConsent } from '@prisma/client';
import type { UpsertStoryStyleConsentDto } from './dto/story-economics.dto';
import { STORY_AI_PUBLIC_CLAIM } from './story-economics.policy';
import { StoryEconomicsService } from './story-economics.service';

const OWNER = 'owner-id';
const WORK = 'work-id';
const MANUSCRIPT = 'manuscript-id';
const AT = new Date('2026-09-01T00:00:00.000Z');
type Consent = StoryStyleProfileConsent;
type ConsentGuard = Pick<Consent, 'id' | 'workId' | 'ownerUserId' | 'revision' | 'status'>;
type ConsentData = Partial<Omit<Consent, 'revision'>> & { revision?: { increment: number } };
type ConsentUpdate = { where: ConsentGuard; data: ConsentData };
type Memory = { workId: string; memoryType: string; status: string };
type AuditData = { actorUserId: string; actorType: string; action: string;
  targetType: string; targetId: string; metadata: { workId: string; beforeStatus: string; afterStatus: string } };
type State = { consent: Consent | null; memories: Memory[]; audits: AuditData[] };

function consentRow(overrides: Partial<Consent> = {}): Consent {
  return {
    id: 'consent-id', workId: WORK, ownerUserId: OWNER, manuscriptVersionId: MANUSCRIPT,
    status: 'active', rightsConfirmed: true, aiBranchAllowed: true,
    translationAllowed: false, imageTransformationAllowed: false,
    allowedLocales: ['ko'], allowedRegions: ['KR'], startsAt: AT, expiresAt: null,
    publicClaim: STORY_AI_PUBLIC_CLAIM, revision: 7, withdrawnAt: null,
    deletionRequestedAt: null, deletedAt: null, createdAt: AT, updatedAt: AT,
    ...overrides,
  };
}

function saveBody(overrides: Partial<UpsertStoryStyleConsentDto> = {}): UpsertStoryStyleConsentDto {
  return {
    manuscriptVersionId: MANUSCRIPT, rightsConfirmed: true, aiBranchAllowed: true,
    translationAllowed: false, imageTransformationAllowed: false,
    allowedLocales: ['ko'], allowedRegions: ['KR'], startsAt: AT.toISOString(),
    expectedRevision: 7, ...overrides,
  };
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('synthetic database failure', {
    code, clientVersion: '6',
  });
}

function pause() {
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { reached, release, wait: async () => { entered(); await released; } };
}

function fixture(initial: Consent | null = consentRow()) {
  const f = {
    state: { consent: initial, memories: [
      { workId: WORK, memoryType: 'style', status: 'approved' },
      { workId: WORK, memoryType: 'entity', status: 'approved' },
      { workId: 'other-work', memoryType: 'style', status: 'approved' },
    ], audits: [] } as State,
    beforeSaveWrite: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    beforeTransaction: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    errors: {} as { audit?: Error; memory?: Error; update?: Error },
  };

  function update(state: State, { where, data }: ConsentUpdate): Consent {
    const current = state.consent;
    if (!current || Object.entries(where).some(([key, value]) => current[key as keyof Consent] !== value)) {
      throw prismaError('P2025');
    }
    const { revision, ...fields } = data;
    state.consent = { ...current, ...fields, revision: current.revision + (revision?.increment ?? 0) };
    return structuredClone(state.consent);
  }

  function transactionClient(staged: State) {
    return {
      storyStyleProfileConsent: { update: jest.fn(async (args: ConsentUpdate) => {
        if (f.errors.update) throw f.errors.update;
        return update(staged, args);
      }) },
      storyMemoryRecord: { updateMany: jest.fn(async ({ where, data }: {
        where: { workId: string; memoryType: string }; data: { status: string };
      }) => {
        if (f.errors.memory) throw f.errors.memory;
        let count = 0;
        for (const memory of staged.memories) {
          if (memory.workId === where.workId && memory.memoryType === where.memoryType) {
            memory.status = data.status;
            count += 1;
          }
        }
        return { count };
      }) },
      auditEvent: { create: jest.fn(async ({ data }: { data: AuditData }) => {
        if (f.errors.audit) throw f.errors.audit;
        staged.audits.push(structuredClone(data));
        return data;
      }) },
    };
  }
  type Tx = ReturnType<typeof transactionClient>;
  const transactions: Tx[] = [];
  const outsideTransaction = jest.fn(async () => { throw new Error('Effect escaped the transaction'); });
  const prisma = {
    storyWork: { findFirst: jest.fn().mockResolvedValue({ id: WORK }) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue({ id: MANUSCRIPT }) },
    storyStyleProfileConsent: {
      findUnique: jest.fn(async () => structuredClone(f.state.consent)),
      update: jest.fn(async (args: ConsentUpdate) => {
        await f.beforeSaveWrite();
        return update(f.state, args);
      }),
      create: jest.fn(async ({ data }: { data: Partial<Consent> }) => {
        await f.beforeSaveWrite();
        if (f.state.consent) throw prismaError('P2002');
        f.state.consent = consentRow({ revision: 1, ...data });
        return structuredClone(f.state.consent);
      }),
    },
    storyMemoryRecord: { updateMany: outsideTransaction },
    auditEvent: { create: outsideTransaction },
    // Staged state models the transaction contract, not PostgreSQL rollback or lock behavior.
    $transaction: jest.fn(async (body: (tx: Tx) => Promise<Consent>) => {
      await f.beforeTransaction();
      const staged = structuredClone(f.state);
      const tx = transactionClient(staged);
      transactions.push(tx);
      const result = await body(tx);
      f.state = staged;
      return result;
    }),
  };
  return Object.assign(f, { prisma, transactions, outsideTransaction,
    service: new StoryEconomicsService(prisma as never) });
}

describe('style consent compare-and-set (synthetic, no database)', () => {
  it('rejects a save read before a winning withdrawal without restoring permissions', async () => {
    const f = fixture();
    const gate = pause();
    f.beforeSaveWrite.mockImplementationOnce(gate.wait);
    const rejected = expect(f.service.upsertStyleConsent(OWNER, WORK, saveBody()))
      .rejects.toMatchObject({ status: 409, message: 'Style consent changed concurrently' });
    await gate.reached;

    await f.service.transitionStyleConsent(OWNER, WORK, { expectedRevision: 7, toStatus: 'withdrawn' });
    const withdrawn = structuredClone(f.state);
    gate.release();
    await rejected;

    expect(f.state).toEqual(withdrawn);
    expect(f.state.consent).toMatchObject({ status: 'withdrawn', revision: 8, withdrawnAt: expect.any(Date) });
    expect(f.prisma.storyStyleProfileConsent.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'consent-id', workId: WORK, ownerUserId: OWNER, revision: 7, status: 'active' },
    }));
    expect(f.state.audits).toHaveLength(1);
    expect(f.outsideTransaction).not.toHaveBeenCalled();
  });

  it('allows only the winning transition when both requests read the same revision', async () => {
    const f = fixture();
    const gate = pause();
    f.beforeTransaction.mockImplementationOnce(gate.wait);
    const rejected = expect(f.service.transitionStyleConsent(OWNER, WORK,
      { expectedRevision: 7, toStatus: 'suspended' })).rejects.toBeInstanceOf(ConflictException);
    await gate.reached;

    await f.service.transitionStyleConsent(OWNER, WORK, { expectedRevision: 7, toStatus: 'withdrawn' });
    const winner = structuredClone(f.state);
    gate.release();
    await rejected;

    expect(f.state).toEqual(winner);
    expect(f.state.audits).toHaveLength(1);
    expect(f.state.audits[0].action).toBe('story_style_consent.withdrawn');
    const losingTx = f.transactions[1];
    expect(losingTx.storyMemoryRecord.updateMany).not.toHaveBeenCalled();
    expect(losingTx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.outsideTransaction).not.toHaveBeenCalled();
  });

  it('rejects an absent-row create collision instead of overwriting the winning consent', async () => {
    const f = fixture(null);
    const gate = pause();
    f.beforeSaveWrite.mockImplementationOnce(gate.wait);
    const rejected = expect(f.service.upsertStyleConsent(OWNER, WORK,
      saveBody({ expectedRevision: undefined, aiBranchAllowed: false }))).rejects.toMatchObject({ status: 409 });
    await gate.reached;

    await f.service.upsertStyleConsent(OWNER, WORK, saveBody({ expectedRevision: undefined }));
    const winner = structuredClone(f.state);
    gate.release();
    await rejected;

    expect(f.state).toEqual(winner);
    expect(f.state.consent).toMatchObject({ status: 'active', revision: 1, aiBranchAllowed: true });
    expect(f.prisma.storyStyleProfileConsent.create).toHaveBeenCalledTimes(2);
    expect(f.prisma.storyStyleProfileConsent.update).not.toHaveBeenCalled();
  });

  it('preserves current-revision save permissions and the existing projection', async () => {
    const f = fixture(consentRow({ status: 'withdrawn', withdrawnAt: AT }));
    const result = await f.service.upsertStyleConsent(OWNER, WORK, saveBody({
      aiBranchAllowed: false, translationAllowed: true, imageTransformationAllowed: true,
      allowedLocales: ['ko', 'en'], allowedRegions: ['KR', 'US'], expiresAt: '2027-09-01T00:00:00.000Z',
    }));

    expect(result).toEqual({
      status: 'active', rightsConfirmed: true,
      scopes: { aiBranch: false, translation: true, imageTransformation: true },
      allowedLocales: ['ko', 'en'], allowedRegions: ['KR', 'US'], startsAt: AT,
      expiresAt: new Date('2027-09-01T00:00:00.000Z'), publicClaim: STORY_AI_PUBLIC_CLAIM,
      revision: 8, withdrawnAt: null, deletionRequestedAt: null, deletedAt: null,
    });
    expect(f.prisma.storyStyleProfileConsent.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'consent-id', workId: WORK, ownerUserId: OWNER, revision: 7, status: 'withdrawn' },
      data: expect.objectContaining({ revision: { increment: 1 }, updatedAt: expect.any(Date) }),
    }));
    expect(f.prisma.storyStyleProfileConsent.create).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['active', 'suspended'], ['active', 'withdrawn'], ['suspended', 'active'],
    ['suspended', 'withdrawn'], ['withdrawn', 'deletion_pending'], ['deletion_pending', 'deleted'],
  ] as const)('commits the current %s -> %s transition and only its required effects', async (from, toStatus) => {
    const initial = consentRow({ status: from,
      withdrawnAt: ['withdrawn', 'deletion_pending'].includes(from) ? AT : null,
      deletionRequestedAt: from === 'deletion_pending' ? AT : null });
    const f = fixture(initial);
    const result = await f.service.transitionStyleConsent(OWNER, WORK, { expectedRevision: 7, toStatus });
    const tx = f.transactions[0];

    expect(result).toMatchObject({ status: toStatus, revision: 8, rightsConfirmed: true,
      scopes: { aiBranch: true, translation: false, imageTransformation: false } });
    expect(tx.storyStyleProfileConsent.update).toHaveBeenCalledWith({
      where: { id: initial.id, workId: WORK, ownerUserId: OWNER, revision: 7, status: from },
      data: { status: toStatus, revision: { increment: 1 },
        withdrawnAt: toStatus === 'withdrawn' ? expect.any(Date) : initial.withdrawnAt,
        deletionRequestedAt: toStatus === 'deletion_pending' ? expect.any(Date) : initial.deletionRequestedAt,
        deletedAt: toStatus === 'deleted' ? expect.any(Date) : null, updatedAt: expect.any(Date) },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: {
      actorUserId: OWNER, actorType: 'user', action: `story_style_consent.${toStatus}`,
      targetType: 'story_style_profile_consent', targetId: initial.id,
      metadata: { workId: WORK, beforeStatus: from, afterStatus: toStatus },
    } });
    expect(f.state.audits).toHaveLength(1);
    if (toStatus === 'deleted') {
      expect(tx.storyMemoryRecord.updateMany).toHaveBeenCalledWith({
        where: { workId: WORK, memoryType: 'style' }, data: { status: 'deleted' },
      });
      expect(f.state.memories.map(row => row.status)).toEqual(['deleted', 'approved', 'approved']);
    } else {
      expect(tx.storyMemoryRecord.updateMany).not.toHaveBeenCalled();
      expect(f.state.memories.every(row => row.status === 'approved')).toBe(true);
    }
    expect(f.outsideTransaction).not.toHaveBeenCalled();
  });

  const changedGuards: Array<[string, Partial<Consent>]> = [
    ['id', { id: 'replacement-id' }], ['work', { workId: 'other-work' }],
    ['owner', { ownerUserId: 'other-owner' }], ['revision', { revision: 8 }],
    ['status', { status: 'withdrawn' }],
  ];
  it.each(changedGuards)('rejects a save if %s changes after the initial read', async (_label, change) => {
    const f = fixture();
    f.beforeSaveWrite.mockImplementationOnce(async () => { f.state.consent = consentRow(change); });
    await expect(f.service.upsertStyleConsent(OWNER, WORK, saveBody())).rejects.toMatchObject({ status: 409 });
    expect(f.state.consent).toEqual(consentRow(change));
    expect(f.state.audits).toEqual([]);
  });

  it.each(changedGuards)('leaves memory and audit untouched when transition CAS loses on %s', async (_label, change) => {
    const initial = consentRow({ status: 'deletion_pending', withdrawnAt: AT, deletionRequestedAt: AT });
    const f = fixture(initial);
    f.beforeTransaction.mockImplementationOnce(async () => { f.state.consent = { ...initial, ...change }; });
    await expect(f.service.transitionStyleConsent(OWNER, WORK, { expectedRevision: 7, toStatus: 'deleted' }))
      .rejects.toMatchObject({ status: 409 });
    expect(f.state.consent).toEqual({ ...initial, ...change });
    expect(f.state.memories.every(row => row.status === 'approved')).toBe(true);
    expect(f.state.audits).toEqual([]);
    expect(f.transactions[0].storyMemoryRecord.updateMany).not.toHaveBeenCalled();
    expect(f.transactions[0].auditEvent.create).not.toHaveBeenCalled();
    expect(f.outsideTransaction).not.toHaveBeenCalled();
  });

  it.each(['withdrawn', 'deleted'] as const)('stages all %s effects in the transaction and propagates audit failure', async toStatus => {
    const f = fixture(consentRow({ status: toStatus === 'deleted' ? 'deletion_pending' : 'active' }));
    const before = structuredClone(f.state);
    const failure = new Error('synthetic audit failure');
    f.errors.audit = failure;

    await expect(f.service.transitionStyleConsent(OWNER, WORK, { expectedRevision: 7, toStatus })).rejects.toBe(failure);
    expect(f.transactions[0].storyStyleProfileConsent.update).toHaveBeenCalledTimes(1);
    expect(f.transactions[0].auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.transactions[0].storyMemoryRecord.updateMany).toHaveBeenCalledTimes(toStatus === 'deleted' ? 1 : 0);
    expect(f.state).toEqual(before);
    expect(f.outsideTransaction).not.toHaveBeenCalled();
  });

  it('does not commit a deletion or create an audit when style-memory deletion fails', async () => {
    const f = fixture(consentRow({ status: 'deletion_pending' }));
    const before = structuredClone(f.state);
    const failure = new Error('synthetic memory failure');
    f.errors.memory = failure;

    await expect(f.service.transitionStyleConsent(OWNER, WORK, { expectedRevision: 7, toStatus: 'deleted' }))
      .rejects.toBe(failure);
    expect(f.state).toEqual(before);
    expect(f.transactions[0].auditEvent.create).not.toHaveBeenCalled();
    expect(f.outsideTransaction).not.toHaveBeenCalled();
  });

  it.each(['P2025', 'P2002'])('does not translate an audit %s error into a consent conflict', async code => {
    const f = fixture();
    const before = structuredClone(f.state);
    const failure = prismaError(code);
    f.errors.audit = failure;

    await expect(f.service.transitionStyleConsent(OWNER, WORK, { expectedRevision: 7, toStatus: 'withdrawn' }))
      .rejects.toBe(failure);
    expect(f.state).toEqual(before);
  });

  it.each([
    ['update', 'P2002'], ['update', 'P2003'], ['create', 'P2025'], ['create', 'P2003'],
  ] as const)('preserves unrelated %s %s errors', async (operation, code) => {
    const f = fixture(operation === 'create' ? null : consentRow());
    const failure = prismaError(code);
    f.beforeSaveWrite.mockRejectedValueOnce(failure);
    const before = structuredClone(f.state);

    await expect(f.service.upsertStyleConsent(OWNER, WORK, saveBody())).rejects.toBe(failure);
    expect(f.state).toEqual(before);
  });

  it.each(['update', 'create'])('preserves a non-Prisma %s failure', async operation => {
    const f = fixture(operation === 'create' ? null : consentRow());
    const failure = new Error('synthetic consent write failure');
    f.beforeSaveWrite.mockRejectedValueOnce(failure);
    const before = structuredClone(f.state);

    await expect(f.service.upsertStyleConsent(OWNER, WORK, saveBody())).rejects.toBe(failure);
    expect(f.state).toEqual(before);
  });

  it('preserves a nonconflict transition update error without effects', async () => {
    const f = fixture();
    const failure = prismaError('P2003');
    f.errors.update = failure;
    const before = structuredClone(f.state);

    await expect(f.service.transitionStyleConsent(OWNER, WORK, { expectedRevision: 7, toStatus: 'withdrawn' }))
      .rejects.toBe(failure);
    expect(f.state).toEqual(before);
    expect(f.transactions[0].auditEvent.create).not.toHaveBeenCalled();
  });

  it('keeps the initial manuscript, rights, revision, period and transition checks', async () => {
    const missing = fixture(null);
    missing.prisma.storyManuscriptVersion.findFirst.mockResolvedValueOnce(null);
    await expect(missing.service.upsertStyleConsent(OWNER, WORK, saveBody())).rejects.toBeInstanceOf(NotFoundException);

    const f = fixture();
    await expect(f.service.upsertStyleConsent(OWNER, WORK, saveBody({ rightsConfirmed: false })))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.upsertStyleConsent(OWNER, WORK, saveBody({ expectedRevision: 6 })))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.upsertStyleConsent(OWNER, WORK, saveBody({ expiresAt: AT.toISOString() })))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.transitionStyleConsent(OWNER, WORK, { expectedRevision: 6, toStatus: 'withdrawn' }))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.transitionStyleConsent(OWNER, WORK, { expectedRevision: 7, toStatus: 'deleted' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(missing.prisma.storyStyleProfileConsent.create).not.toHaveBeenCalled();
    expect(f.prisma.storyStyleProfileConsent.update).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});
