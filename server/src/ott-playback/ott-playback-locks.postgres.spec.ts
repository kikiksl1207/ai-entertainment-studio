import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { playbackFixture, playbackPostgresClient } from './ott-playback.postgres-fixture';

const describePostgres = process.env.OTT_PLAYBACK_TEST_DATABASE_URL ? describe : describe.skip;
jest.setTimeout(30_000);
const notReady = { response: expect.objectContaining({ code: 'OTT_NOT_READY' }) };
function signal() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function outcome<T>(promise: Promise<T>) {
  return promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

describePostgres('OTT revocation ordering through real PostgreSQL locks, explicit synthetic media doubles', () => {
  let db: PrismaClient;
  beforeAll(() => { db = playbackPostgresClient(); });
  afterAll(async () => { await db?.$disconnect(); });

  async function blockedSourceLock() {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<Array<{ waiting: bigint }>>`SELECT count(*) AS waiting FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'
          AND query LIKE '%ott_media_uploads%'`;
      if (Number(row.waiting) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('expected a source row-lock waiter in the isolated QA database');
  }

  it.each(['create', 'pin', 'start', 'choice'] as const)('%s that locks first may commit; off-path revoke then blocks later progress', async (kind) => {
    const f = await playbackFixture(db); const m = await f.manifest();
    const preview = await f.service.pinPreview(f.owner, m.manifestId, { locale: 'ko' });
    const p = kind === 'choice' ? await f.service.startProgress(f.owner, preview.previewId, {}) : null;
    const held = signal(); const release = signal();
    const inspect = f.media.inspectPlaybackUpload.bind(f.media);
    const spy = jest.spyOn(f.media, 'inspectPlaybackUpload').mockImplementationOnce(async (upload) => {
      const result = await inspect(upload); held.release(); await release.promise; return result;
    });
    const operation = outcome<unknown>(kind === 'create' ? f.manifest()
      : kind === 'pin' ? f.service.pinPreview(f.owner, m.manifestId, { locale: 'en' })
      : kind === 'start' ? f.service.startProgress(f.owner, preview.previewId, {})
      : f.service.command(f.owner, p!.progressId, 'choice', randomUUID(), {
        manifestId: m.manifestId, expectedRevision: p!.revision, nodeKey: 'intro', choiceKey: 'take-b' }));
    let revoke: ReturnType<typeof outcome> | undefined;
    try {
      await Promise.race([held.promise, operation.then(() => { throw new Error('operation finished before byte-check barrier'); })]);
      revoke = outcome(f.media.revoke(f.owner, f.c.fileId, {}));
      await blockedSourceLock(); release.release();
      expect((await operation).ok).toBe(true); expect((await revoke).ok).toBe(true);
      await expect(f.service.startProgress(f.owner, preview.previewId, {})).rejects.toMatchObject(notReady);
    } finally {
      release.release(); spy.mockRestore(); await operation; if (revoke) await revoke;
    }
  });

  it.each(['create', 'pin', 'start', 'choice', 'position', 'delivery'] as const)('revocation holding the source first prevents later %s authorization/mutation', async (kind) => {
    const f = await playbackFixture(db); const { manifest: m, preview, progress: p } = await f.playable();
    const session = await f.media.browserSession(f.owner, f.intro.fileId, {});
    const grant = f.delivery.readBrowserSession(session.cookie, f.intro.fileId);
    const held = signal(); const release = signal();
    const revoking = outcome(db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ott_media_uploads WHERE id=${f.intro.fileId}::uuid FOR UPDATE`;
      // Same append-only record and SQL lock trigger as the production revoke service.
      await tx.ottMediaRevocation.create({ data: { ownerId: f.owner, fileId: f.intro.fileId } });
      held.release(); await release.promise;
    }, { timeout: 15_000 }));
    let operation: ReturnType<typeof outcome> | undefined;
    try {
      await Promise.race([held.promise, revoking.then(() => { throw new Error('revocation finished before commit barrier'); })]);
      operation = outcome<unknown>(kind === 'create' ? f.manifest()
        : kind === 'pin' ? f.service.pinPreview(f.owner, m.manifestId, { locale: 'en' })
        : kind === 'start' ? f.service.startProgress(f.owner, preview.previewId, {})
        : kind === 'delivery' ? f.media.deliverBrowser(grant)
        : f.service.command(f.owner, p.progressId, kind, randomUUID(), {
          manifestId: m.manifestId, expectedRevision: p.revision, nodeKey: 'intro',
          ...(kind === 'choice' ? { choiceKey: 'take-b' } : { positionMs: 400 }) }));
      await blockedSourceLock(); release.release();
      expect((await revoking).ok).toBe(true);
      expect(await operation).toMatchObject({ ok: false, error: notReady });
      expect((await db.ottPlaybackProgress.findUniqueOrThrow({ where: { id: p.progressId } })).revision).toBe(p.revision);
      expect(await db.ottPlaybackCommand.count({ where: { progressId: p.progressId } })).toBe(0);
    } finally {
      release.release(); await revoking; if (operation) await operation;
    }
  });

  it('allows an already authorized/opened delivery handle to finish, but no new session or range after revoke', async () => {
    const f = await playbackFixture(db);
    const session = await f.media.browserSession(f.owner, f.intro.fileId, {});
    const grant = f.delivery.readBrowserSession(session.cookie, f.intro.fileId);
    const held = signal(); const release = signal(); const open = f.storage.open.bind(f.storage);
    const spy = jest.spyOn(f.storage, 'open').mockImplementationOnce(async (id) => {
      const result = await open(id); held.release(); await release.promise; return result;
    });
    const delivered = outcome(f.media.deliverBrowser(grant));
    let revoke: ReturnType<typeof outcome> | undefined;
    try {
      await Promise.race([held.promise, delivered.then(() => { throw new Error('delivery finished before validation barrier'); })]);
      revoke = outcome(f.media.revoke(f.owner, f.intro.fileId, {}));
      await blockedSourceLock(); release.release();
      const result = await delivered;
      expect(result.ok).toBe(true); expect((await revoke).ok).toBe(true);
      if (!result.ok) throw result.error;
      const chunks: Buffer[] = [];
      for await (const chunk of result.value.stream(0, 7)) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks)).toHaveLength(8);
      await expect(f.media.browserSession(f.owner, f.intro.fileId, {})).rejects.toMatchObject(notReady);
      await expect(f.media.deliverBrowser(grant)).rejects.toMatchObject(notReady);
    } finally {
      release.release(); spy.mockRestore(); const result = await delivered;
      if (result.ok) await result.value.close(); if (revoke) await revoke;
    }
  });
});
