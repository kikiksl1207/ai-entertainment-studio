import { FanTitle, UserFanTitle } from '@prisma/client';
import { FanEngagementService } from './fan-engagement.service';

const userId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const createdAt = new Date('2026-10-03T01:00:00Z');
type OwnedTitle = UserFanTitle & { title: FanTitle };

function title(index: number, overrides: Partial<OwnedTitle> = {}): OwnedTitle {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const titleId = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  return {
    id, userId, titleId, status: 'active', equipped: false, equippedAt: null,
    createdAt, updatedAt: createdAt,
    title: { id: titleId, code: `title_${index}`, status: 'active', rarity: 'common',
      copy: {}, createdAt, updatedAt: createdAt },
    ...overrides,
  };
}

function copy(row: OwnedTitle): OwnedTitle {
  return { ...row, title: { ...row.title } };
}

type Where = {
  id?: string | { not: string };
  userId?: string;
  status?: string;
  equipped?: boolean;
  title?: { code?: string; status?: string };
};

function matches(row: OwnedTitle, where: Where) {
  return (typeof where.id !== 'string' || row.id === where.id)
    && (typeof where.id !== 'object' || row.id !== where.id.not)
    && (where.userId === undefined || row.userId === where.userId)
    && (where.status === undefined || row.status === where.status)
    && (where.equipped === undefined || row.equipped === where.equipped)
    && (where.title?.code === undefined || row.title.code === where.title.code)
    && (where.title?.status === undefined || row.title.status === where.title.status);
}

function fixture(initial: OwnedTitle[] = [title(1, { equipped: true, equippedAt: createdAt }), title(2)]) {
  const rows = initial.map(copy);
  const locks = new Map<string, Promise<void>>();
  const events: string[] = [];
  const find = ({ where }: { where: Where }) => {
    const row = rows.find(item => matches(item, where));
    return row ? copy(row) : null;
  };
  const raw = jest.fn().mockResolvedValue([
    { completedTodayCount: 0n, currentStreakDays: 0n, totalAcceptedCount: 0n },
  ]);
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: userId }) },
    userFanTitle: { findFirst: jest.fn(find), findMany: jest.fn().mockImplementation(async () => rows.map(copy)) },
    userFanAchievement: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    fanEngagementPointLedger: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]), create: jest.fn() },
    fanTitle: { create: jest.fn() },
    $queryRaw: raw,
    $transaction: jest.fn(),
  };
  const txFind = jest.fn().mockImplementation(async (args: { where: Where }) => {
    events.push('lookup');
    return find(args);
  });
  const clear = jest.fn();
  const write = jest.fn();
  let onTransactionStart = () => {};
  const lockQuery = jest.fn();

  prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    onTransactionStart();
    const releases: Array<() => void> = [];
    const undo = new Map<string, OwnedTitle>();
    const remember = (row: OwnedTitle) => { if (!undo.has(row.id)) undo.set(row.id, copy(row)); };
    const tx = {
      ...prisma,
      userFanTitle: {
        findFirst: txFind,
        findMany: prisma.userFanTitle.findMany,
        updateMany: async (args: { where: Where; data: Partial<OwnedTitle> }) => {
          events.push('clear');
          clear(args);
          const selected = rows.filter(row => matches(row, args.where));
          for (const row of selected) { remember(row); Object.assign(row, args.data); }
          return { count: selected.length };
        },
        update: async (args: { where: Where; data: Partial<OwnedTitle> }) => {
          events.push('write');
          write(args);
          const row = rows.find(item => matches(item, args.where));
          if (!row) throw new Error('conditional write failed');
          remember(row);
          Object.assign(row, args.data);
          return copy(row);
        },
      },
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?').replace(/\s+/g, ' ').trim();
        lockQuery(sql, values);
        if (/FROM public\.users/.test(sql)) {
          const key = String(values[0]);
          const previous = locks.get(key) ?? Promise.resolve();
          let release!: () => void;
          const held = new Promise<void>(resolve => { release = resolve; });
          locks.set(key, previous.then(() => held));
          await previous;
          releases.push(release);
          events.push('owner-lock');
          return [{ id: key }];
        }
        if (/FROM public\.fan_titles/.test(sql)) {
          events.push('title-lock');
          const row = rows.find(row => row.title.code === values[0]);
          return row ? [{ id: row.title.id }] : [];
        }
        if (/FROM public\.user_fan_titles/.test(sql)) {
          events.push('ownership-lock');
          return rows.filter(row => row.userId === values[0] && row.titleId === values[1]).map(row => ({ id: row.id }));
        }
        return raw(strings, ...values);
      },
    };
    try { return await callback(tx); }
    catch (error) {
      // Model rollback of this transaction's writes, not changes committed before it.
      for (const [id, before] of undo) Object.assign(rows.find(row => row.id === id)!, before);
      throw error;
    } finally { for (const release of releases.reverse()) release(); }
  });

  return {
    rows, prisma, events, txFind, clear, write, lockQuery,
    service: new FanEngagementService(prisma as never),
    onTransactionStart: (hook: () => void) => { onTransactionStart = hook; },
  };
}

function noGrants(f: ReturnType<typeof fixture>) {
  expect(f.prisma.fanTitle.create).not.toHaveBeenCalled();
  expect(f.prisma.userFanAchievement.create).not.toHaveBeenCalled();
  expect(f.prisma.fanEngagementPointLedger.create).not.toHaveBeenCalled();
}

describe('FAN-06 atomic title equip (synthetic transactions, no PostgreSQL)', () => {
  it('replaces the former title without granting rewards or changing ownership', async () => {
    const f = fixture();
    const result = await f.service.equipTitle(userId, { titleCode: ' title_2 ' });
    expect(result.equipped?.code).toBe('title_2');
    expect(f.rows.map(row => [row.status, row.equipped])).toEqual([['active', false], ['active', true]]);
    expect(f.rows[0].equippedAt).toBeNull();
    expect(result.policy).toMatchObject({ cashLike: false, luminaAmount: 0, transferable: false,
      settlementEligible: false, luminaConvertible: false });
    noGrants(f);
  });

  it.each([null, undefined, [], 'title_2', 42])('rejects malformed body %p without a transaction', async body => {
    const f = fixture();
    await expect(f.service.equipTitle(userId, body as never)).rejects.toMatchObject({
      response: { code: 'INVALID_REQUEST', messageKey: 'fanEngagement.validation.invalidRequest' },
    });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.clear).not.toHaveBeenCalled();
    expect(f.rows[0].equipped).toBe(true);
  });

  it.each([undefined, null, '', '  ', 0, false, [], {}])('rejects invalid titleCode %p without clearing the former title', async titleCode => {
    const f = fixture();
    await expect(f.service.equipTitle(userId, { titleCode })).rejects.toMatchObject({
      response: { code: 'REQUIRED_STRING', messageKey: 'fanEngagement.validation.requiredString' },
    });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.rows[0].equipped).toBe(true);
  });

  it.each(['missing', 'foreign', 'revoked', 'inactive'])('preserves the former title when the target is %s', async reason => {
    const f = fixture();
    if (reason === 'missing') f.rows.splice(1, 1);
    if (reason === 'foreign') f.rows[1].userId = otherUserId;
    if (reason === 'revoked') f.rows[1].status = 'revoked';
    if (reason === 'inactive') f.rows[1].title.status = 'inactive';
    await expect(f.service.equipTitle(userId, { titleCode: 'title_2' })).rejects.toMatchObject({
      response: { code: 'FAN_TITLE_NOT_OWNED', messageKey: 'fanTitle.notOwned', details: { titleCode: 'title_2' } },
    });
    expect(f.clear).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.rows[0]).toMatchObject({ equipped: true, equippedAt: createdAt });
    noGrants(f);
  });

  it.each(['revoked', 'inactive', 'foreign', 'deleted'])('rechecks a target becoming %s at transaction admission', async change => {
    const f = fixture();
    f.onTransactionStart(() => {
      if (change === 'revoked') f.rows[1].status = 'revoked';
      if (change === 'inactive') f.rows[1].title.status = 'inactive';
      if (change === 'foreign') f.rows[1].userId = otherUserId;
      if (change === 'deleted') f.rows.splice(1, 1);
    });
    await expect(f.service.equipTitle(userId, { titleCode: 'title_2' })).rejects.toMatchObject({
      response: { code: 'FAN_TITLE_NOT_OWNED' },
    });
    expect(f.clear).not.toHaveBeenCalled();
    expect(f.rows[0]).toMatchObject({ equipped: true, equippedAt: createdAt });
  });

  it('takes database locks before the transaction lookup and qualifies the write with current ownership and status', async () => {
    const f = fixture();
    await f.service.equipTitle(userId, { titleCode: 'title_2' });
    expect(f.prisma.userFanTitle.findFirst).not.toHaveBeenCalled();
    expect(f.events).toEqual(['owner-lock', 'title-lock', 'ownership-lock', 'lookup', 'clear', 'write']);
    expect(f.lockQuery.mock.calls[0]).toEqual([expect.stringMatching(/FROM public\.users .*FOR NO KEY UPDATE$/), [userId]]);
    expect(f.lockQuery.mock.calls[1]).toEqual([expect.stringMatching(/FROM public\.fan_titles .*FOR SHARE$/), ['title_2']]);
    expect(f.lockQuery.mock.calls[2]).toEqual([expect.stringMatching(/FROM public\.user_fan_titles .*FOR UPDATE$/), [userId, f.rows[1].titleId]]);
    expect(f.write).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: f.rows[1].id, userId, status: 'active', title: { code: 'title_2', status: 'active' },
    } }));
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
  });

  it('serializes two first equips of different titles for the same user', async () => {
    const f = fixture([title(1), title(2)]);
    const results = await Promise.all([
      f.service.equipTitle(userId, { titleCode: 'title_1' }),
      f.service.equipTitle(userId, { titleCode: 'title_2' }),
    ]);
    expect(results.map(result => result.equipped?.code)).toEqual(['title_1', 'title_2']);
    expect(f.rows.filter(row => row.equipped).map(row => row.title.code)).toEqual(['title_2']);
    expect(f.events).toEqual([
      'owner-lock', 'title-lock', 'ownership-lock', 'lookup', 'clear', 'write',
      'owner-lock', 'title-lock', 'ownership-lock', 'lookup', 'clear', 'write',
    ]);
    noGrants(f);
  });

  it('serializes concurrent same-title requests without changing the winning timestamp', async () => {
    const f = fixture([title(2)]);
    const results = await Promise.all([
      f.service.equipTitle(userId, { titleCode: 'title_2' }),
      f.service.equipTitle(userId, { titleCode: 'title_2' }),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.rows.filter(row => row.equipped)).toHaveLength(1);
  });

  it('rechecks revocation committed while a second equip waits for the user lock', async () => {
    const f = fixture([title(1), title(2)]);
    let ready!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { ready = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    f.txFind.mockImplementationOnce(async () => {
      const current = copy(f.rows[0]);
      ready();
      await held;
      return current;
    });
    const first = f.service.equipTitle(userId, { titleCode: 'title_1' });
    await entered;
    const second = f.service.equipTitle(userId, { titleCode: 'title_2' });
    const rejected = expect(second).rejects.toMatchObject({ response: { code: 'FAN_TITLE_NOT_OWNED' } });
    f.rows[1].status = 'revoked';
    release();
    await first;
    await rejected;
    expect(f.rows.map(row => row.equipped)).toEqual([true, false]);
    expect(f.write).toHaveBeenCalledTimes(1);
  });

  it('does not serialize different users together', async () => {
    const f = fixture([title(1), title(2, { userId: otherUserId })]);
    let ready!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { ready = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    f.txFind.mockImplementationOnce(async () => {
      const current = copy(f.rows[0]);
      ready();
      await held;
      return current;
    });
    const first = f.service.equipTitle(userId, { titleCode: 'title_1' });
    await entered;
    try {
      const second = await f.service.equipTitle(otherUserId, { titleCode: 'title_2' });
      expect(second.equipped?.code).toBe('title_2');
      expect(f.rows.map(row => row.equipped)).toEqual([false, true]);
    } finally { release(); await first; }
    expect(f.rows.map(row => row.equipped)).toEqual([true, true]);
  });

  it('keeps repeated equip deterministic and clears legacy extra equipped rows', async () => {
    const f = fixture([title(1, { equipped: true, equippedAt: createdAt }),
      title(2, { equipped: true, equippedAt: createdAt })]);
    const first = await f.service.equipTitle(userId, { titleCode: 'title_2' });
    const second = await f.service.equipTitle(userId, { titleCode: 'title_2' });
    expect(first).toEqual(second);
    expect(second.equipped?.equippedAt).toEqual(createdAt);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.rows.map(row => row.equipped)).toEqual([false, true]);
  });

  it('rolls back a failed target write including the former equipped timestamp', async () => {
    const f = fixture();
    const before = f.rows.map(copy);
    f.write.mockImplementation(() => { throw new Error('synthetic write failure'); });
    await expect(f.service.equipTitle(userId, { titleCode: 'title_2' })).rejects.toThrow('synthetic write failure');
    expect(f.clear).toHaveBeenCalledTimes(1);
    expect(f.rows).toEqual(before);
    noGrants(f);
  });

  it('preserves the former title if lock acquisition fails', async () => {
    const f = fixture();
    f.lockQuery.mockImplementation(() => { throw new Error('synthetic lock failure'); });
    await expect(f.service.equipTitle(userId, { titleCode: 'title_2' })).rejects.toThrow('synthetic lock failure');
    expect(f.clear).not.toHaveBeenCalled();
    expect(f.rows[0]).toMatchObject({ equipped: true, equippedAt: createdAt });
  });

  it.each(['catalog', 'ownership'])('rejects a target deleted before its %s lock without using a later row', async deleted => {
    const f = fixture();
    f.lockQuery.mockImplementation((sql: string) => {
      if (deleted === 'catalog' && /FROM public\.fan_titles/.test(sql)) f.rows.splice(1, 1);
      if (deleted === 'ownership' && /FROM public\.user_fan_titles/.test(sql)) f.rows.splice(1, 1);
    });
    await expect(f.service.equipTitle(userId, { titleCode: 'title_2' })).rejects.toMatchObject({
      response: { code: 'FAN_TITLE_NOT_OWNED' },
    });
    expect(f.txFind).not.toHaveBeenCalled();
    expect(f.clear).not.toHaveBeenCalled();
    expect(f.rows[0]).toMatchObject({ equipped: true, equippedAt: createdAt });
  });

  it('rolls back clearing the former title if the qualified target write no longer matches', async () => {
    const f = fixture();
    f.write.mockImplementation(() => { f.rows[1].status = 'revoked'; });
    await expect(f.service.equipTitle(userId, { titleCode: 'title_2' })).rejects.toThrow('conditional write failed');
    expect(f.rows[0]).toMatchObject({ equipped: true, equippedAt: createdAt });
    expect(f.rows[1]).toMatchObject({ equipped: false, status: 'revoked' });
  });
});

describe('FAN-06 title summary status flags', () => {
  it.each<[string, string, boolean, boolean, boolean]>([
    ['active', 'active', true, true, true],
    ['active', 'active', false, false, true],
    ['revoked', 'active', true, false, false],
    ['inactive', 'active', true, false, false],
    ['active', 'inactive', true, false, false],
    ['active', 'inactive', false, false, false],
  ])('presents ownership %s / title %s / stored equipped %s accurately', async (status, titleStatus, storedEquipped, equipped, canEquip) => {
    const row = title(1, { status, equipped: storedEquipped, equippedAt: createdAt });
    row.title.status = titleStatus;
    const f = fixture([row]);
    const result = await f.service.getMySummary(userId, {});
    expect(result.titles.items).toEqual([expect.objectContaining({ code: 'title_1', status, equipped, canEquip })]);
    expect(result.titles.equipped?.code ?? null).toBe(equipped ? 'title_1' : null);
    expect(f.clear).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    noGrants(f);
  });

  it('skips stale revoked or inactive representatives and retains the active equipped row', async () => {
    const revoked = title(1, { status: 'revoked', equipped: true });
    const inactive = title(2, { equipped: true });
    inactive.title.status = 'inactive';
    const f = fixture([revoked, inactive, title(3, { equipped: true, equippedAt: createdAt })]);
    const result = await f.service.getMySummary(userId, {});
    expect(result.titles.equipped?.code).toBe('title_3');
    expect(result.titles.items.map(row => row.equipped)).toEqual([false, false, true]);
  });

  it('presents exactly one matching representative even when legacy active rows both store equipped', async () => {
    const f = fixture([title(1, { equipped: true, equippedAt: createdAt }),
      title(2, { equipped: true, equippedAt: createdAt })]);
    const result = await f.service.getMySummary(userId, {});
    const equipped = result.titles.items.filter(row => row.equipped);
    expect(equipped).toHaveLength(1);
    expect(equipped[0].code).toBe(result.titles.equipped?.code);
    expect(result.titles.items.every(row => row.canEquip)).toBe(true);
    expect(f.clear).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });


});
