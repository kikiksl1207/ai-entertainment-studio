import { PrismaService } from '../prisma/prisma.service';
import { PrismaOttMediaRepository } from './ott-media.repository';
import { EXPECTED } from './ott-media.test-doubles';

describe('Prisma repository contract (no database)', () => {
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const id = '00000000-0000-4000-8000-000000000002';
  const versionId = '00000000-0000-4000-8000-000000000003';
  const workId = '00000000-0000-4000-8000-000000000004';
  function setup() {
    const row = { id, ownerId, versionId, version: { workId }, intentKey: 'test-key', expected: EXPECTED,
      status: 'uploaded', expiresAt: new Date(Date.now() + 100_000), verified: null, subtitles: null, confirmationHash: null };
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]),
      ottMediaRevocation: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      ottMediaVersion: { findFirst: jest.fn().mockResolvedValue({ id: versionId, workId }) },
      ottMediaUpload: { findFirst: jest.fn().mockResolvedValue(row), findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ ...row, status: 'pending_upload' }), update: jest.fn().mockResolvedValue(row) } };
    const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { row, tx, prisma, repo: new PrismaOttMediaRepository(prisma as unknown as PrismaService) };
  }
  it('locks owner before intent replay/create and uses typed Prisma delegate writes', async () => {
    const { repo, tx } = setup();
    await repo.createIntent(ownerId, versionId, 'test-key', EXPECTED);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.ottMediaUpload.create.mock.invocationCallOrder[0]);
    expect(tx.ottMediaVersion.findFirst).toHaveBeenCalledWith({ where: { id: versionId, work: { ownerId } } });
    expect(tx.ottMediaUpload.create.mock.calls[0][0].data).toMatchObject({ ownerId, versionId, expected: EXPECTED });
    expect(tx.$queryRaw.mock.calls[0][0].raw).toBeDefined();
  });
  it('locks the owned file and updates only verification state, not immutable registration', async () => {
    const { repo, tx } = setup();
    await repo.withUpload(ownerId, id, async (u) => { u.status = 'confirmed'; u.verified = { ...EXPECTED, durationMs: 1000 }; u.subtitles = []; u.confirmationHash = 'hash'; });
    expect(tx.ottMediaUpload.findFirst).toHaveBeenCalledWith({ where: { id, ownerId, version: { work: { ownerId } } }, include: { version: true } });
    expect(Object.keys(tx.ottMediaUpload.update.mock.calls[0][0].data).sort()).toEqual(['confirmationHash', 'status', 'subtitles', 'verified']);
  });
  it('does not persist failed verification or unchanged reads', async () => {
    const { repo, tx } = setup();
    await expect(repo.withUpload(ownerId, id, async () => { throw new Error('sensitive details'); })).rejects.toMatchObject({ response: { code: 'OTT_PERSISTENCE_UNAVAILABLE' } });
    await repo.withUpload(ownerId, id, async (u) => u.id);
    expect(tx.ottMediaUpload.update).not.toHaveBeenCalled();
  });
  it('rejects unknown persisted status instead of normalizing it to confirmed', async () => {
    const { repo, row } = setup(); row.status = 'unknown';
    await expect(repo.withUpload(ownerId, id, async (u) => u)).rejects.toMatchObject({ response: { code: 'OTT_NOT_READY' } });
  });
});
