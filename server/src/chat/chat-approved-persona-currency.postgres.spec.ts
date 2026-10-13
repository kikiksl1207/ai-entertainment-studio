import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  APPROVED_ARTIST_CHAT_CRLF_SHA256,
  APPROVED_ARTIST_CHAT_MANIFEST_PATH,
  APPROVED_ARTIST_CHAT_RELEASE,
  APPROVED_ARTIST_CHAT_SOURCE_SHA256,
  isLockedArtistPersona,
  selectArtistPersona,
  type ArtistPersonaSelection,
  type LockedArtistPersonaSelection,
} from './artist-persona-lock';
import { ChatService } from './chat.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const native = url ? describe : describe.skip;
const rows = ['artist', 'public', 'content'] as const;
type Row = typeof rows[number];
type RowClient = Pick<Prisma.TransactionClient, 'artist' | 'artistPublicProfile' | 'artistContentProfile'>;
type FenceProbe = {
  assertArtistPersonaSelectionCurrent(selection: ArtistPersonaSelection, tx: Prisma.TransactionClient): Promise<void>;
};
type Entry = {
  slug: string; displayName: string; tagline: string; summary: string; publicStory: string;
  personalityKeywords: string[]; contentTone: string; profileFacts: Record<string, string>;
};
const sourceSelect = {
  id: true, slug: true, displayName: true, status: true,
  publicProfile: { select: {
    tagline: true, summary: true, publicStory: true, personalityKeywords: true, publicMetadata: true,
  } },
  contentProfile: { select: { contentTone: true } },
} as const;
const fallbackMetadata = {
  artistPersonaLock: { status: 'unverified', reason: 'compatibility_fallback', allArtistsCovered: false },
};
const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000, maxWait: 5_000 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function observe<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(value => ({ status: 'fulfilled' as const, value }),
    reason => ({ status: 'rejected' as const, reason }));
}

function completed<T>(result: PromiseSettledResult<T> | undefined): T {
  if (!result) throw new Error('Native actor was not started');
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Native ${label} did not become ready`)), 5_000);
  });
  try { return await Promise.race([promise, expired]); }
  finally { clearTimeout(timer); }
}

// Only a parent-owned, unseeded loopback QA database is admitted. No provider or public API.
// This exercises the real private final fence, not the complete greeting/send entry points.
jest.setTimeout(30_000);
native('approved persona current rows and FOR SHARE (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let writer: PrismaClient;
  let probe: FenceProbe;
  let entry: Entry;
  let artistId: string;
  let sessionId: string;

  const publicFields = () => ({
    tagline: entry.tagline, summary: entry.summary, publicStory: entry.publicStory,
    personalityKeywords: [...entry.personalityKeywords],
    publicMetadata: { approvedRelease: APPROVED_ARTIST_CHAT_RELEASE, profileFacts: { ...entry.profileFacts } },
  });

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) {
      throw new Error('Dedicated parent-owned loopback QA database required');
    }
    const bytes = readFileSync(APPROVED_ARTIST_CHAT_MANIFEST_PATH);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (![APPROVED_ARTIST_CHAT_SOURCE_SHA256, APPROVED_ARTIST_CHAT_CRLF_SHA256].includes(hash)) {
      throw new Error('Exact existing approved public source required');
    }
    const manifest = JSON.parse(bytes.toString('utf8')) as { release: string; artists: Entry[] };
    const found = manifest.artists.find(item => item.slug === 'jang-taegeon');
    if (manifest.release !== APPROVED_ARTIST_CHAT_RELEASE || !found) throw new Error('Known existing entry required');
    entry = found;
    db = new PrismaClient({ datasources: { db: { url } } });
    writer = new PrismaClient({ datasources: { db: { url } } });
    if (Prisma.dmmf.datamodel.models.length !== 174) throw new Error('Existing 174-model QA SDK required');
    await db.$connect();
    await writer.$connect();
    const [migrations] = await db.$queryRaw<Array<{ applied: number }>>`
      SELECT count(*)::int AS applied FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    if (migrations.applied !== 103) throw new Error('Existing 103-migration owned QA baseline required');
    if (await db.artist.count({ where: { slug: entry.slug } })) {
      throw new Error('Unseeded QA database required; existing approved artist must not be overwritten');
    }
    const artist = await db.artist.create({
      data: { slug: entry.slug, displayName: entry.displayName, status: 'active',
        publicProfile: { create: publicFields() }, contentProfile: { create: { contentTone: entry.contentTone } } },
      select: { id: true },
    });
    artistId = artist.id;
    const owner = await db.user.create({ data: {}, select: { id: true } });
    const session = await db.chatSession.create({ data: { userId: owner.id, artistId }, select: { id: true } });
    sessionId = session.id;
    const provider = { generate: () => { throw new Error('Native row fixture must not dispatch a provider'); } };
    probe = new ChatService(db as never, provider as never) as unknown as FenceProbe;
  });

  async function resetCurrentRows() {
    if (!artistId || !sessionId) throw new Error('Owned fixture admission did not complete');
    await db.artist.update({ where: { id: artistId }, data: { status: 'active' }, select: { id: true } });
    await db.artistPublicProfile.update({ where: { artistId }, data: publicFields(), select: { artistId: true } });
    await db.artistContentProfile.update({ where: { artistId }, data: { contentTone: entry.contentTone }, select: { artistId: true } });
  }

  beforeEach(resetCurrentRows);

  afterAll(async () => {
    // Fixtures are retained for the parent's owned-database audit; no deletion or DDL.
    await writer?.$disconnect();
    await db?.$disconnect();
  });

  const current = () => db.artist.findUniqueOrThrow({ where: { id: artistId }, select: sourceSelect });
  const messageCount = () => db.chatMessage.count({ where: { chatSessionId: sessionId } });

  async function selected(): Promise<LockedArtistPersonaSelection> {
    const selection = selectArtistPersona(await current());
    if (!isLockedArtistPersona(selection)) throw new Error('Exact current fixture must issue a selection');
    return selection;
  }

  function sentinel(tx: Prisma.TransactionClient) {
    return tx.chatMessage.create({
      data: { chatSessionId: sessionId, senderType: 'artist', messageType: 'text',
        body: 'Synthetic native persona fence sentinel.', safetyMetadata: fallbackMetadata },
      select: { id: true, safetyMetadata: true },
    });
  }

  function save(selection: LockedArtistPersonaSelection) {
    return db.$transaction(async tx => {
      await probe.assertArtistPersonaSelectionCurrent(selection, tx);
      return sentinel(tx);
    }, transactionOptions);
  }

  async function change(client: RowClient, row: Row) {
    if (row === 'artist') {
      await client.artist.update({ where: { id: artistId }, data: { status: 'archived' }, select: { id: true } });
    } else if (row === 'public') {
      await client.artistPublicProfile.update({ where: { artistId },
        data: { publicMetadata: { approvedRelease: 'synthetic-withdrawn-release' } }, select: { artistId: true } });
    } else {
      await client.artistContentProfile.update({ where: { artistId },
        data: { contentTone: 'Synthetic native changed tone' }, select: { artistId: true } });
    }
  }

  it('matches actual approved rows and saves a sentinel without approving fallback metadata', async () => {
    const selection = await selected(), before = await messageCount();
    expect(selection.artistId).toBe(artistId);
    expect(selection.approvedPublicFields.personalityKeywords).toEqual(entry.personalityKeywords);
    expect(selection.approvedPublicFields.contentTone).toBe(entry.contentTone);
    const message = await save(selection);
    expect(await messageCount()).toBe(before + 1);
    expect(message.safetyMetadata).toEqual(fallbackMetadata);
  });

  it.each(rows)('distinguishes %s eligibility changes from presentation-only drift before save', async row => {
    const selection = await selected(), before = await messageCount();
    await change(db, row);
    const now = selectArtistPersona(await current());
    if (row === 'content') {
      expect(isLockedArtistPersona(now)).toBe(true);
      if (!isLockedArtistPersona(now)) throw new Error('Canonical tone must remain selected');
      expect(now.binding).toBe(selection.binding);
      expect(now.approvedPublicFields.contentTone).toBe(entry.contentTone);
      await save(selection);
      expect(await messageCount()).toBe(before + 1);
    } else {
      expect(now.status).toBe('unverified');
      await expect(save(selection)).rejects.toBeInstanceOf(ConflictException);
      expect(await messageCount()).toBe(before);
    }
    if (row === 'public') {
      await resetCurrentRows();
      const beforeWithdrawal = await selected();
      await db.artistPublicProfile.update({ where: { artistId },
        data: { publicMetadata: { profileFacts: { ...entry.profileFacts } } }, select: { artistId: true } });
      expect(selectArtistPersona(await current())).toEqual({ status: 'unverified', reason: 'approved_release_not_selected' });
      await expect(save(beforeWithdrawal)).rejects.toBeInstanceOf(ConflictException);
      expect(await messageCount()).toBe(before);
    }
  });

  async function checkContendedRow(row: Row) {
    await resetCurrentRows();
    const selection = await selected(), before = await messageCount();
    const ready = deferred<number>(), release = deferred<void>(), writerReady = deferred<number>();
    const holder = observe(db.$transaction(async tx => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await probe.assertArtistPersonaSelectionCurrent(selection, tx);
      ready.resolve(backend.pid);
      await release.promise;
      return sentinel(tx);
    }, transactionOptions));
    let writing: Promise<PromiseSettledResult<void>> | undefined;
    let heldResult: Awaited<typeof holder> | undefined;
    let writtenResult: PromiseSettledResult<void> | undefined;
    try {
      const holderPid = await within(ready.promise, 'fence');
      writing = observe(writer.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        writerReady.resolve(backend.pid);
        await change(tx, row);
      }, transactionOptions));
      const writerPid = await within(writerReady.promise, 'writer');
      expect(writerPid).not.toBe(holderPid);
      let observedBlock = false;
      const deadline = Date.now() + 3_000;
      while (!observedBlock && Date.now() < deadline) {
        const activity = await db.$queryRaw<Array<{ waiting: boolean; blockers: number[] }>>`
          SELECT state = 'active' AND wait_event_type = 'Lock' AS waiting,
            pg_blocking_pids(pid) AS blockers
          FROM pg_stat_activity WHERE pid = ${writerPid} AND datname = current_database()`;
        observedBlock = activity.length === 1 && activity[0].waiting && activity[0].blockers.includes(holderPid);
        if (!observedBlock) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(observedBlock).toBe(true);
      expect(await messageCount()).toBe(before);
    } finally {
      release.resolve(undefined);
      heldResult = await holder;
      if (writing) writtenResult = await writing;
    }
    const message = completed(heldResult);
    completed(writtenResult);
    expect(message.safetyMetadata).toEqual(fallbackMetadata);
    expect(await messageCount()).toBe(before + 1);
    if (row === 'content') {
      const now = selectArtistPersona(await current());
      expect(isLockedArtistPersona(now)).toBe(true);
      if (!isLockedArtistPersona(now)) throw new Error('Presentation-only tone must not replace canon');
      expect(now.binding).toBe(selection.binding);
      expect(now.approvedPublicFields.contentTone).toBe(entry.contentTone);
      await save(selection);
      expect(await messageCount()).toBe(before + 2);
    } else {
      expect(selectArtistPersona(await current()).status).toBe('unverified');
      await expect(save(selection)).rejects.toBeInstanceOf(ConflictException);
      expect(await messageCount()).toBe(before + 1);
    }
  }

  it('holds all three actual rows against named writers until each fenced save commits', async () => {
    for (const row of rows) await checkContendedRow(row);
  });

  it('rolls back a staged native save when the actual private fence rejects current eligibility', async () => {
    const selection = await selected(), before = await messageCount();
    await change(db, 'artist');
    const changedRows = await current();
    expect(selectArtistPersona(changedRows).status).toBe('unverified');
    // A staged sentinel proves TX rollback; it is not the production message-write order.
    await expect(db.$transaction(async tx => {
      await sentinel(tx);
      await probe.assertArtistPersonaSelectionCurrent(selection, tx);
    }, transactionOptions)).rejects.toBeInstanceOf(ConflictException);
    expect(await messageCount()).toBe(before);
    expect(await current()).toEqual(changedRows);
  });

  it('retains the literal canonical binding after real mutable presentation and personality edits', async () => {
    const selection = await selected(), before = await messageCount();
    await db.artistPublicProfile.update({ where: { artistId }, data: {
      tagline: 'Synthetic changed promotion', summary: 'Synthetic changed summary',
      publicStory: 'Synthetic unverified background', personalityKeywords: ['Synthetic changed trait'],
      publicMetadata: { approvedRelease: APPROVED_ARTIST_CHAT_RELEASE, profileFacts: { synthetic: 'unapproved fact' } },
    }, select: { artistId: true } });
    await db.artistContentProfile.update({ where: { artistId }, data: { contentTone: 'Synthetic changed voice' }, select: { artistId: true } });
    const now = selectArtistPersona(await current());
    expect(isLockedArtistPersona(now)).toBe(true);
    if (!isLockedArtistPersona(now)) throw new Error('Selected canonical source must survive ordinary edits');
    expect(now.binding).toBe(selection.binding);
    expect(now.approvedPublicFields).toEqual(selection.approvedPublicFields);
    await save(selection);
    expect(await messageCount()).toBe(before + 1);
  });

  it.each(['public', 'content'] as const)(
    'rejects a transaction-local missing %s lock row before findUnique and restores it on rollback', async row => {
      const selection = await selected(), before = await messageCount();
      const beforeRows = await current();
      let findUniqueCalls = 0;
      const operation = db.$transaction(async tx => {
        if (row === 'public') {
          await tx.artistPublicProfile.delete({ where: { artistId }, select: { artistId: true } });
          expect(await tx.artistPublicProfile.count({ where: { artistId } })).toBe(0);
        } else {
          await tx.artistContentProfile.delete({ where: { artistId }, select: { artistId: true } });
          expect(await tx.artistContentProfile.count({ where: { artistId } })).toBe(0);
        }
        await sentinel(tx);
        // Keep the native lock queries; only detect an unsafe reload after a zero-row lock.
        const guardedTx = new Proxy(tx, {
          get(target, property) {
            if (property === 'artist') {
              return new Proxy(target.artist, {
                get(delegate, method) {
                  if (method === 'findUnique') {
                    return () => {
                      findUniqueCalls += 1;
                      throw new Error('Missing lock row reached findUnique');
                    };
                  }
                  const value = Reflect.get(delegate, method);
                  return typeof value === 'function' ? value.bind(delegate) : value;
                },
              });
            }
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        await probe.assertArtistPersonaSelectionCurrent(selection, guardedTx);
        // Even a broken fence must never commit this staged fixture deletion.
        throw new Error('Missing profile lock was not rejected');
      }, transactionOptions);
      await expect(operation).rejects.toBeInstanceOf(ConflictException);
      await expect(operation).rejects.toMatchObject({ response: { code: 'CHAT_ARTIST_PERSONA_SOURCE_CHANGED' } });
      expect(findUniqueCalls).toBe(0);
      expect(await messageCount()).toBe(before);
      expect(await current()).toEqual(beforeRows);
      expect(await db.artistPublicProfile.count({ where: { artistId } })).toBe(1);
      expect(await db.artistContentProfile.count({ where: { artistId } })).toBe(1);
    },
  );
});
