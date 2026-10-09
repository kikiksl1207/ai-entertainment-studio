import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { SiteContentEntry, User } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { SiteContentService } from './site-content.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
type Outcome = { value: unknown; error: unknown };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function observe(pending: Promise<unknown>): Promise<Outcome> {
  return pending.then(value => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }));
}

// Structural audit oracle for these null-CTA synthetic fixtures, not raw content.
function auditView(row: SiteContentEntry) {
  expect(row.ctaHref).toBeNull();
  return {
    contentKey: row.contentKey, scope: row.scope, pageKey: row.pageKey,
    characterSlug: row.characterSlug, modelSlug: row.modelSlug, locale: row.locale,
    status: row.status, version: row.version, titleLength: row.title?.length ?? 0,
    bodyLength: row.body?.length ?? 0, ctaLabelLength: row.ctaLabel?.length ?? 0,
    ctaHrefKind: 'none', contentKeys: Object.keys(row.content as object).sort(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

postgres('CMS lifecycle CAS on owned PostgreSQL (synthetic service-level context)', () => {
  let db: PrismaClient;
  let service: SiteContentService;
  let admin: AuthUser;
  let fixtureUser: User;
  let editId: string;
  let publishId: string;
  let original: Awaited<ReturnType<typeof snapshot>> | undefined;
  let network: jest.SpyInstance;

  async function snapshot() {
    const [users, entries, audits] = await Promise.all([
      db.user.findMany({ orderBy: { id: 'asc' } }),
      db.siteContentEntry.findMany({ orderBy: { id: 'asc' } }),
      db.siteContentAuditLog.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return { users, entries, audits };
  }

  function row(state: Awaited<ReturnType<typeof snapshot>>, id: string) {
    const found = state.entries.find(entry => entry.id === id);
    if (!found) throw new Error('Owned synthetic CMS entry missing');
    return found;
  }

  function assertOriginal(state: Awaited<ReturnType<typeof snapshot>>) {
    expect(state.users.filter(user => user.id !== fixtureUser.id)).toEqual(original!.users);
    expect(state.users.find(user => user.id === fixtureUser.id)).toEqual(fixtureUser);
    expect(state.entries.filter(entry => entry.id !== editId && entry.id !== publishId))
      .toEqual(original!.entries);
    expect(state.entries).toHaveLength(original!.entries.length + 2);
    expect(state.audits.filter(log => log.entryId !== editId && log.entryId !== publishId))
      .toEqual(original!.audits);
  }

  function assertSingleCommit(before: Awaited<ReturnType<typeof snapshot>>,
    after: Awaited<ReturnType<typeof snapshot>>, id: string, action: string) {
    expect(after.users).toEqual(before.users);
    expect(after.entries.filter(entry => entry.id !== id))
      .toEqual(before.entries.filter(entry => entry.id !== id));
    const oldIds = new Set(before.audits.map(log => log.id));
    expect(after.audits.filter(log => oldIds.has(log.id))).toEqual(before.audits);
    const added = after.audits.filter(log => !oldIds.has(log.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ entryId: id, actorUserId: admin.id, action });
    expect(added[0].before).toEqual(auditView(row(before, id)));
    expect(added[0].after).toEqual(auditView(row(after, id)));
    expect(row(after, id).version).toBe(row(before, id).version + 1);
  }

  function holdTransaction() {
    const entered = deferred(), release = deferred();
    let attempts = 0, opened = 0;
    const adapter = {
      siteContentEntry: db.siteContentEntry,
      $transaction: async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
        attempts += 1;
        entered.resolve();
        // Actual outer read and validation finished; no SQL transaction is open yet.
        await release.promise;
        opened += 1;
        return db.$transaction(callback);
      },
    };
    return {
      service: new SiteContentService(adapter as unknown as PrismaService),
      release: release.resolve,
      attempts: () => attempts,
      wait: async (pending: Promise<Outcome>) => {
        await Promise.race([entered.promise, pending.then(() => {
          throw new Error('A must reach its transaction after the actual outer read');
        })]);
        expect(attempts).toBe(1);
        expect(opened).toBe(0);
      },
    };
  }

  function assertConflict(outcome: Outcome) {
    expect(outcome.value).toBeUndefined();
    expect(outcome.error).toBeInstanceOf(ConflictException);
    expect(outcome.error).toMatchObject({ response: { code: 'SITE_CONTENT_REVISION_CONFLICT' } });
    expect((outcome.error as ConflictException).getStatus()).toBe(409);
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' || parsed.password ||
        !/^\/lumina_guidance_qa_20261007_[a-f0-9]{12}$/.test(parsed.pathname) ||
        parsed.search || parsed.hash) {
      throw new Error('Dedicated owned loopback guidance QA database required');
    }
    expect(Prisma.dmmf.datamodel.models).toHaveLength(174);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    original = await snapshot();
    fixtureUser = await db.user.create({ data: {} });
    // No AdminUser/grant row or JWT claim: explicitly synthetic service-level input.
    admin = { id: fixtureUser.id, adminRole: 'super_admin', adminPermissions: ['*'] };
    service = new SiteContentService(db as unknown as PrismaService);
    const nonce = randomUUID();
    const draft = {
      scope: 'page', pageKey: 'artists', locale: 'ko-KR',
      title: 'Synthetic CMS draft', body: 'Synthetic publishable body.',
      content: { note: 'Synthetic publishable note.' },
    };
    editId = (await service.createAdmin(admin, { ...draft, contentKey: `qa.cms-cas.edit.${nonce}` })).item.id;
    publishId = (await service.createAdmin(admin, { ...draft, contentKey: `qa.cms-cas.publish.${nonce}` })).item.id;
    assertOriginal(await snapshot());
  }, 30_000);

  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Native CMS network forbidden'));
  });

  afterEach(async () => {
    try {
      expect(network).not.toHaveBeenCalled();
      if (original && fixtureUser && editId && publishId) assertOriginal(await snapshot());
    } finally { network?.mockRestore(); }
  });

  afterAll(async () => {
    try {
      if (original && fixtureUser && editId && publishId) assertOriginal(await snapshot());
    } finally { await db?.$disconnect(); }
    // Retain all fixtures and original records; only the parent owns cluster cleanup.
  }, 30_000);

  it('CMS lifecycle native rejects a stale draft edit after another publish commits', async () => {
    const before = await snapshot();
    expect(row(before, editId).status).toBe('draft');
    const a = holdTransaction();
    const pending = observe(a.service.updateAdmin(admin, editId, { body: 'Rejected stale synthetic edit.' }));
    try {
      await a.wait(pending);
      expect(await snapshot()).toEqual(before);
      const published = await service.publishAdmin(admin, editId);
      const committed = await snapshot();
      assertSingleCommit(before, committed, editId, 'publish');
      expect(row(committed, editId)).toMatchObject({ status: 'published', body: row(before, editId).body });
      expect(published.item).toMatchObject({ id: editId, status: 'published', version: row(committed, editId).version });
      a.release();
      assertConflict(await pending);
      expect(a.attempts()).toBe(1);
      expect(await snapshot()).toEqual(committed);
    } finally { a.release(); await pending; }
  }, 30_000);

  it('CMS lifecycle native rejects a validated publish after a same-status draft is emptied', async () => {
    const before = await snapshot();
    expect(row(before, publishId).status).toBe('draft');
    const a = holdTransaction();
    const pending = observe(a.service.publishAdmin(admin, publishId));
    try {
      await a.wait(pending);
      expect(await snapshot()).toEqual(before);
      const emptied = await service.updateAdmin(admin, publishId, {
        title: null, body: null, ctaLabel: null, content: {},
      });
      const committed = await snapshot();
      assertSingleCommit(before, committed, publishId, 'update');
      expect(row(committed, publishId)).toMatchObject({ status: 'draft', title: null, body: null, ctaLabel: null, content: {} });
      expect(emptied.item).toMatchObject({ id: publishId, status: 'draft', version: row(committed, publishId).version });
      a.release();
      assertConflict(await pending);
      expect(a.attempts()).toBe(1);
      expect(await snapshot()).toEqual(committed);
    } finally { a.release(); await pending; }
  }, 30_000);

  it('CMS lifecycle native rolls back the actual row when the actual audit insert fails', async () => {
    const before = await snapshot();
    const collision = before.audits.find(log => log.entryId === editId)!;
    expect(collision).toBeDefined();
    expect(row(before, editId).status).not.toBe('archived');
    let auditAttempts = 0;
    let inTransaction: SiteContentEntry | undefined;
    const adapter = {
      siteContentEntry: db.siteContentEntry,
      $transaction: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(tx => callback({
        siteContentEntry: tx.siteContentEntry,
        siteContentAuditLog: {
          create: async (args: Prisma.SiteContentAuditLogCreateArgs) => {
            auditAttempts += 1;
            inTransaction = await tx.siteContentEntry.findUniqueOrThrow({ where: { id: editId } });
            // Real PK violation at the real audit insert, not a mocked rejection.
            return tx.siteContentAuditLog.create({ ...args, data: { ...args.data, id: collision.id } });
          },
        },
      } as unknown as Prisma.TransactionClient)),
    };
    const faulty = new SiteContentService(adapter as unknown as PrismaService);
    const outcome = await observe(faulty.archiveAdmin(admin, editId));
    expect(outcome.value).toBeUndefined();
    expect(outcome.error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(outcome.error).toMatchObject({ code: 'P2002' });
    expect(outcome.error).not.toBeInstanceOf(ConflictException);
    expect(auditAttempts).toBe(1);
    expect(inTransaction).toMatchObject({ id: editId, status: 'archived', version: row(before, editId).version + 1 });
    expect(await snapshot()).toEqual(before);
  }, 30_000);
});
