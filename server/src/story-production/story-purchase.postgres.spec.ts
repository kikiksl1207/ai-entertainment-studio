import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StoryProductionService } from './story-production.service';

const databaseUrl = process.env.STORY_PURCHASE_TEST_DATABASE_URL;
const postgres = databaseUrl ? describe : describe.skip;

postgres('Story purchase PostgreSQL correctness (isolated database)', () => {
  let db: PrismaClient;
  let left: PrismaClient;
  let right: PrismaClient;
  let a: StoryProductionService;
  let b: StoryProductionService;
  let f: Awaited<ReturnType<typeof fixture>>;

  async function fixture() {
    const owner = await db.user.create({ data: {} });
    const reader = await db.user.create({ data: {} });
    const stranger = await db.user.create({ data: {} });
    const work = await db.storyWork.create({ data: {
      ownerUserId: owner.id, slug: `purchase-qa-${randomUUID()}`, title: { ko: 'Synthetic story' },
      summary: {}, priceLumina: '120.50',
    } });
    const manuscript = await db.storyManuscriptVersion.create({ data: {
      workId: work.id, ownerUserId: owner.id, version: 1, locale: 'ko',
      contentHash: 'a'.repeat(64), structuredBody: {},
    } });
    const release = await db.storyRelease.create({ data: {
      workId: work.id, version: 1, status: 'active', manuscriptVersionId: manuscript.id,
      checksum: 'b'.repeat(64), branchGraphSnapshot: {}, endingSetSnapshot: {},
      sceneAssetManifest: {}, localizedDisplaySnapshot: {}, createdByUserId: owner.id,
    } });
    await db.storyWork.update({ where: { id: work.id }, data: {
      status: 'published', activeReleaseId: release.id, publishedAt: new Date(0), releaseRevision: 3,
    } });
    const wallet = await db.walletAccount.create({ data: { userId: reader.id, cachedBalance: 1000 } });
    const foreignWallet = await db.walletAccount.create({ data: { userId: stranger.id, cachedBalance: 1000 } });
    return { owner, reader, stranger, work, manuscript, release, wallet, foreignWallet,
      confirmation: { confirmedPriceLumina: '120.50', expectedReleaseId: release.id, expectedReleaseRevision: 3 } };
  }

  beforeAll(async () => {
    const parsed = new URL(databaseUrl!);
    if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
      parsed.pathname !== '/lumina_purchase_qa') throw new Error('Dedicated purchase QA database required');
    const client = () => new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    db = client(); left = client(); right = client();
    a = new StoryProductionService(left as never);
    b = new StoryProductionService(right as never);
    await db.$connect(); await left.$connect(); await right.$connect();
  });

  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => {
    if (!f) return;
    const users = [f.owner.id, f.reader.id, f.stranger.id];
    await db.userEntitlement.deleteMany({ where: { userId: { in: users } } });
    await db.walletLedger.deleteMany({ where: { walletAccountId: { in: [f.wallet.id, f.foreignWallet.id] } } });
    await db.walletAccount.deleteMany({ where: { userId: { in: users } } });
    await db.storyWork.update({ where: { id: f.work.id }, data: { activeReleaseId: null } });
    await db.storyRelease.deleteMany({ where: { workId: f.work.id } });
    await db.storyManuscriptVersion.deleteMany({ where: { workId: f.work.id } });
    await db.storyWork.delete({ where: { id: f.work.id } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  });
  afterAll(async () => { await left?.$disconnect(); await right?.$disconnect(); await db?.$disconnect(); });

  const buy = (key: string = randomUUID(), service = a, body = f.confirmation) =>
    service.purchaseWork(f.reader.id, f.work.id, key, body);
  async function unchanged(balance = '1000') {
    expect((await db.walletAccount.findUniqueOrThrow({ where: { id: f.wallet.id } })).cachedBalance.toString())
      .toBe(balance);
    expect(await db.walletLedger.count({ where: { walletAccountId: f.wallet.id } })).toBe(0);
    expect(await db.userEntitlement.count({ where: { userId: f.reader.id } })).toBe(0);
  }

  // Hold the buyer lock until both independent connections are actually waiting.
  async function simultaneous(firstKey: string, secondKey: string) {
    let locked!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${f.reader.id}::uuid FOR NO KEY UPDATE`;
      locked(); await gate;
    }, { timeout: 15000 });
    await ready;
    const results = Promise.all([buy(firstKey, a), buy(secondKey, b)]);
    // Attach rejection handling immediately, before observing the lock barrier.
    void results.catch(() => undefined);
    try {
      let waiting = 0;
      for (let i = 0; i < 100 && waiting < 2; i++) {
        const rows = await db.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND (query LIKE '%FROM users%' OR query LIKE '%pg_advisory_xact_lock%')
        `;
        waiting = rows[0].count;
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
    } finally {
      release(); await blocker;
    }
    return results;
  }

  it.each(['same', 'different'])('charges once with simultaneous %s keys across connections', async (mode) => {
    const key = randomUUID();
    const results = await simultaneous(key, mode === 'same' ? key : randomUUID());
    expect(results.filter((result) => result.charged)).toHaveLength(1);
    expect(results.every((result) => result.entitled)).toBe(true);
    expect(await db.walletLedger.count({ where: { walletAccountId: f.wallet.id } })).toBe(1);
    expect(await db.userEntitlement.count({ where: { userId: f.reader.id, referenceId: f.work.id } })).toBe(1);
    expect((await db.walletAccount.findUniqueOrThrow({ where: { id: f.wallet.id } })).cachedBalance.toString())
      .toBe('879.5');
  });

  it('requires confirmation for a new paid debit, with no writes', async () => {
    await expect(a.purchaseWork(f.reader.id, f.work.id, randomUUID())).rejects.toMatchObject({
      status: 409, response: { code: 'STORY_PURCHASE_CONFIRMATION_REQUIRED', walletMutation: false },
    });
    await unchanged();
  });

  it('binds a concurrently reused global key to only one wallet owner', async () => {
    const key = randomUUID();
    const results = await Promise.allSettled([
      buy(key), b.purchaseWork(f.stranger.id, f.work.id, key, f.confirmation),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409,
      response: { code: 'WALLET_MUTATION_IDEMPOTENCY_CONFLICT', walletMutation: false } });
    expect(await db.walletLedger.count({ where: { referenceId: f.work.id } })).toBe(1);
    const wallets = await db.walletAccount.findMany({ where: { id: { in: [f.wallet.id, f.foreignWallet.id] } } });
    expect(wallets.map((wallet) => wallet.cachedBalance.toString()).sort()).toEqual(['1000', '879.5']);
  });

  it.each(['suspended', 'deleted', 'missing'])('refuses an %s buyer without mutation', async (kind) => {
    const userId = kind === 'missing' ? randomUUID() : f.reader.id;
    if (kind !== 'missing') await db.user.update({ where: { id: userId }, data:
      kind === 'deleted' ? { deletedAt: new Date() } : { status: 'suspended' },
    });
    await expect(a.purchaseWork(userId, f.work.id, randomUUID(), f.confirmation))
      .rejects.toMatchObject({ status: 400 });
    await unchanged();
  });

  it.each(['price', 'revision', 'release', 'offline', 'retired', 'future', 'fixture'])
  ('rejects a changed %s after access confirmation without writes', async (change) => {
    const access = await a.readerAccess(f.reader.id, f.work.id, { locale: 'ko' });
    expect(access.access.purchaseConfirmation).toEqual({
      priceLumina: '120.5', releaseId: f.release.id, releaseRevision: 3,
    });
    if (change === 'retired') {
      await db.storyRelease.update({ where: { id: f.release.id }, data: { status: 'retired' } });
    } else if (change === 'release') {
      const next = await db.storyRelease.create({ data: {
        workId: f.work.id, version: 2, status: 'active', manuscriptVersionId: f.manuscript.id,
        checksum: 'c'.repeat(64), branchGraphSnapshot: {}, endingSetSnapshot: {},
        sceneAssetManifest: {}, localizedDisplaySnapshot: {}, createdByUserId: f.owner.id,
      } });
      await db.storyWork.update({ where: { id: f.work.id }, data: { activeReleaseId: next.id } });
    } else {
      const data = change === 'price' ? { priceLumina: 200 }
        : change === 'revision' ? { releaseRevision: 4 }
        : change === 'offline' ? { status: 'draft' }
        : change === 'future' ? { publishedAt: new Date(Date.now() + 60000) }
        : { fixtureSource: true };
      await db.storyWork.update({ where: { id: f.work.id }, data });
    }
    await expect(buy()).rejects.toMatchObject({
      status: 409, response: { code: 'STORY_PURCHASE_CONFIRMATION_STALE', walletMutation: false },
    });
    await unchanged();
  });

  it('replays the original price without a body after a price change', async () => {
    const key = randomUUID();
    expect(await buy(key)).toMatchObject({ charged: true, chargedAmountLumina: '120.5' });
    await db.storyWork.update({ where: { id: f.work.id }, data: { priceLumina: 900 } });
    expect(await b.purchaseWork(f.reader.id, f.work.id, key)).toMatchObject({
      entitled: true, charged: false, idempotentReplay: true, chargedAmountLumina: '0',
      originalPurchaseAmountLumina: '120.5', outcome: 'replayed',
    });
    expect(await db.walletLedger.count({ where: { walletAccountId: f.wallet.id } })).toBe(1);
  });

  it('waits for a concurrent price writer and rejects its committed replacement quote', async () => {
    let locked!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writer = db.$transaction(async (tx) => {
      await tx.storyWork.update({ where: { id: f.work.id }, data: { priceLumina: 200 } });
      locked(); await gate;
    }, { timeout: 15000 });
    await ready;
    const purchase = buy();
    const result = expect(purchase).rejects.toMatchObject({ status: 409,
      response: { code: 'STORY_PURCHASE_CONFIRMATION_STALE', walletMutation: false } });
    void result.catch(() => undefined);
    try {
      let waiting = 0;
      for (let i = 0; i < 100 && waiting < 1; i++) {
        const rows = await db.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%FROM story_works%FOR SHARE%'
        `;
        waiting = rows[0].count;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBeGreaterThan(0);
    } finally {
      release(); await writer;
    }
    await result;
    await unchanged();
  });

  it.each(['expired', 'revoked', 'future', 'missing'])('never revives %s entitlement on old-key replay', async (kind) => {
    const key = randomUUID(); await buy(key);
    if (kind === 'missing') await db.userEntitlement.deleteMany({ where: { userId: f.reader.id } });
    else await db.userEntitlement.updateMany({ where: { userId: f.reader.id }, data:
      kind === 'expired' ? { expiresAt: new Date(0) }
        : kind === 'revoked' ? { revokedAt: new Date() } : { startsAt: new Date(Date.now() + 60000) },
    });
    const before = await db.userEntitlement.findMany({ where: { userId: f.reader.id } });
    expect(await b.purchaseWork(f.reader.id, f.work.id, key)).toMatchObject({
      entitled: false, charged: false, outcome: 'entitlement_inactive', idempotentReplay: true,
    });
    expect((await a.readerAccess(f.reader.id, f.work.id, { locale: 'ko' })).access.entitled).toBe(false);
    expect(await db.userEntitlement.findMany({ where: { userId: f.reader.id } })).toEqual(before);
    expect(await db.walletLedger.count({ where: { walletAccountId: f.wallet.id } })).toBe(1);
  });

  it('allows an explicitly confirmed new purchase after an expired grant', async () => {
    await buy();
    await db.userEntitlement.updateMany({ where: { userId: f.reader.id }, data: { expiresAt: new Date(0) } });
    await expect(a.purchaseWork(f.reader.id, f.work.id, randomUUID())).rejects.toMatchObject({ status: 409 });
    expect(await buy()).toMatchObject({ entitled: true, charged: true, outcome: 'purchased' });
    expect(await db.walletLedger.count({ where: { walletAccountId: f.wallet.id } })).toBe(2);
  });

  it.each(['free', 'owned'])('allows %s access without confirmation or additional ledger', async (kind) => {
    if (kind === 'free') await db.storyWork.update({ where: { id: f.work.id }, data: { priceLumina: 0 } });
    else await buy();
    expect(await b.purchaseWork(f.reader.id, f.work.id, randomUUID())).toMatchObject({
      entitled: true, charged: false, chargedAmountLumina: '0',
      outcome: kind === 'free' ? 'free' : 'already_entitled',
    });
    expect(await db.walletLedger.count({ where: { walletAccountId: f.wallet.id } })).toBe(kind === 'free' ? 0 : 1);
  });

  it.each(['owner', 'direction', 'work', 'type', 'referenceType'])
  ('rejects a globally reused key with wrong %s binding', async (kind) => {
    const key = randomUUID();
    await db.walletLedger.create({ data: {
      walletAccountId: kind === 'owner' ? f.foreignWallet.id : f.wallet.id,
      direction: kind === 'direction' ? 'credit' : 'debit', amount: '120.50',
      ledgerType: kind === 'type' ? 'adjustment' : 'story_purchase',
      referenceType: kind === 'referenceType' ? 'other' : 'story_work',
      referenceId: kind === 'work' ? randomUUID() : f.work.id, idempotencyKey: `story-work:${key}`,
    } });
    await expect(buy(key)).rejects.toMatchObject({
      status: 409, response: { code: 'WALLET_MUTATION_IDEMPOTENCY_CONFLICT', walletMutation: false },
    });
    expect((await db.walletAccount.findUniqueOrThrow({ where: { id: f.wallet.id } })).cachedBalance.toString()).toBe('1000');
    expect(await db.userEntitlement.count({ where: { userId: f.reader.id } })).toBe(0);
  });

  it.each(['insufficient', 'inactive', 'missing'])('rejects %s wallet without entitlement or ledger', async (kind) => {
    if (kind === 'missing') await db.walletAccount.delete({ where: { id: f.wallet.id } });
    else await db.walletAccount.update({ where: { id: f.wallet.id }, data:
      kind === 'insufficient' ? { cachedBalance: 1 } : { status: 'frozen' },
    });
    await expect(buy()).rejects.toMatchObject({ status: 400 });
    if (kind !== 'missing') await unchanged(kind === 'insufficient' ? '1' : '1000');
    else {
      expect(await db.walletLedger.count({ where: { walletAccountId: f.wallet.id } })).toBe(0);
      expect(await db.userEntitlement.count({ where: { userId: f.reader.id } })).toBe(0);
    }
  });

  it('rolls back the debit and ledger if entitlement insertion violates a real foreign key', async () => {
    // A test-only trigger corrupts the new user FK. All normal FK/CHECK triggers stay enabled.
    await db.$executeRawUnsafe(`CREATE FUNCTION purchase_qa_bad_fk() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.user_id := '00000000-0000-4000-8000-000000000000'::uuid; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER purchase_qa_bad_fk BEFORE INSERT ON user_entitlements
      FOR EACH ROW EXECUTE FUNCTION purchase_qa_bad_fk()`);
    try {
      await expect(buy()).rejects.toMatchObject({ code: 'P2003' });
      await unchanged();
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER purchase_qa_bad_fk ON user_entitlements');
      await db.$executeRawUnsafe('DROP FUNCTION purchase_qa_bad_fk()');
    }
  });

  it('preserves every legacy CHECK type and rejects unknown types on the migrated database', async () => {
    const ledgerTypes = ['purchase', 'gift_spend', 'boost_spend', 'chat_feature_spend',
      'premium_video_spend', 'refund', 'adjustment', 'event_grant', 'hold_capture', 'hold_release',
      'daily_attendance', 'user_gift_send', 'user_gift_receive', 'fan_letter_spend',
      'settlement_lumina_conversion', 'signup_bonus', 'referral_reward', 'identity_verification_bonus',
      'birthday_bonus', 'achievement_reward', 'quest_reward', 'profile_completion_reward', 'first_charge_bonus',
      'story_purchase'];
    for (const ledgerType of ledgerTypes) await db.walletLedger.create({ data: {
      walletAccountId: f.wallet.id, direction: 'debit', amount: 1, ledgerType,
    } });
    for (const entitlementType of ['premium_video', 'chat_feature', 'boost_reward', 'event_reward', 'membership', 'story_work']) {
      await db.userEntitlement.create({ data: {
        userId: f.reader.id, entitlementType, referenceType: 'qa', referenceId: f.work.id,
      } });
    }
    await expect(db.walletLedger.create({ data: {
      walletAccountId: f.wallet.id, direction: 'debit', amount: 1, ledgerType: 'not_a_type',
    } })).rejects.toThrow();
    await expect(db.userEntitlement.create({ data: {
      userId: f.reader.id, entitlementType: 'not_a_type', referenceType: 'qa', referenceId: f.work.id,
    } })).rejects.toThrow();
  });
});
