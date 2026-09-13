import { HttpException } from '@nestjs/common';
import { prepareManuscript } from './story-manuscript-file.policy';
import { storeManuscriptVersion } from './story-manuscript-version.store';
import { StoryProductionService } from './story-production.service';

const userId = '00000000-0000-4000-8000-000000000001';
const workId = '00000000-0000-4000-8000-000000000002';
const body = { locale: 'ko', parts: [{ partKey: 'p1', title: 'Synthetic', paragraphs: [{ kind: 'paragraph', text: 'PRIVATE-SYNTHETIC-BODY' }] }] };
const input = (locale = 'ko') => prepareManuscript(Buffer.from(JSON.stringify({ ...body, locale })));

function database() {
  let owner: string | null = userId;
  let revision = 0;
  const rows: any[] = [];
  const query = jest.fn(async (_sql?: unknown) => owner === userId ? [{ id: workId }] : []);
  const ownerRead = jest.fn(async ({ where }: any) => where.id === workId && where.ownerUserId === owner ? { id: workId } : null);
  const prisma = {
    storyWork: { findFirst: ownerRead },
    storyAnalysisJob: { create: jest.fn() },
    storyAnalysisEvidence: { create: jest.fn() },
    $transaction: jest.fn(async (action: any) => {
      const seen = revision;
      const staged = rows.map(row => ({ ...row }));
      const tx = { $queryRaw: query, storyWork: { findFirst: ownerRead }, storyManuscriptVersion: {
        findUnique: jest.fn(async ({ where }: any) => staged.find(r => r.workId === where.workId_contentHash.workId && r.contentHash === where.workId_contentHash.contentHash) ?? null),
        findFirst: jest.fn(async () => [...staged].sort((a, b) => b.version - a.version)[0] ?? null),
        create: jest.fn(async ({ data }: any) => {
          const row = { ...data, id: `version-${staged.length + 1}`, createdAt: new Date('2026-09-14T00:00:00Z') };
          staged.push(row); return row;
        }),
      } };
      const result = await action(tx);
      if (seen !== revision) throw { code: 'P2034' };
      rows.splice(0, rows.length, ...staged); revision++;
      return result;
    }),
  };
  return { prisma, rows, query, ownerRead, transfer: () => { owner = 'other'; revision++; }, missing: () => { owner = null; } };
}

describe('atomic complete manuscript version store', () => {
  it('stores exactly one complete immutable row, private raw bytes, and only a receipt', async () => {
    const db = database();
    const parsed = input();
    const receipt = await storeManuscriptVersion(db.prisma as never, userId, workId, parsed);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].structuredBody.parts).toEqual(body.parts);
    expect(Buffer.from(db.rows[0].structuredBody.intake.source.rawText)).toEqual(Buffer.from(JSON.stringify(body)));
    expect(JSON.stringify(receipt)).not.toMatch(/PRIVATE-SYNTHETIC|rawText|storageKey|ownerUserId|structuredBody/);
    expect(receipt.analysisStarted).toBe(false);
    expect(db.prisma.storyAnalysisJob.create).not.toHaveBeenCalled();
    expect(db.prisma.storyAnalysisEvidence.create).not.toHaveBeenCalled();
    expect(db.query.mock.calls[0][0]).toBeDefined();
    expect(db.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', maxWait: 2000, timeout: 10000 });
  });

  it('retries a lost response/reordered JSON using the same version without mutating raw source', async () => {
    const db = database();
    const first = await storeManuscriptVersion(db.prisma as never, userId, workId, input());
    const source = JSON.stringify(db.rows[0]);
    const replay = await storeManuscriptVersion(db.prisma as never, userId, workId,
      prepareManuscript(Buffer.from(JSON.stringify({ parts: body.parts, locale: 'ko' }, null, 2))));
    expect(replay.manuscript).toEqual(first.manuscript);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.rawSource).toBe('existing_version_unchanged');
    expect(JSON.stringify(db.rows[0])).toBe(source);
  });

  it('retains same-locale legacy version IDs/hashes/release references and separates locales', async () => {
    const db = database();
    db.rows.push({ id: 'legacy-id', workId, ownerUserId: userId, version: 7, locale: 'ko',
      contentHash: input().legacyHash, structuredBody: { parts: body.parts } });
    const release = { manuscriptVersionId: 'legacy-id' };
    const legacySnapshot = JSON.stringify(db.rows[0]);
    const same = await storeManuscriptVersion(db.prisma as never, userId, workId, input());
    expect(same.manuscript.id).toBe(release.manuscriptVersionId);
    expect(same.rawSource).toBe('legacy_projection_only');
    expect(JSON.stringify(db.rows[0])).toBe(legacySnapshot);
    const en = await storeManuscriptVersion(db.prisma as never, userId, workId, input('en'));
    expect(en.manuscript.version).toBe(8);
    expect(en.manuscript.id).not.toBe('legacy-id');
    const oldRoute = await new StoryProductionService(db.prisma as never).createManuscriptVersion(userId, workId, body as never);
    expect(oldRoute.manuscript.id).toBe('legacy-id');
    expect(JSON.stringify(oldRoute)).not.toContain('PRIVATE-SYNTHETIC');
  });

  it('deduplicates concurrent same-content requests and allocates different versions for different locales', async () => {
    const db = database();
    const same = await Promise.all([1, 2].map(() => storeManuscriptVersion(db.prisma as never, userId, workId, input())));
    expect(same[0].manuscript.id).toBe(same[1].manuscript.id);
    expect(db.rows).toHaveLength(1);
    await Promise.all(['en', 'ja'].map(locale => storeManuscriptVersion(db.prisma as never, userId, workId, input(locale))));
    expect(db.rows.map(row => row.version)).toEqual([1, 2, 3]);
  });

  it('rejects missing/other owners and rechecks ownership within the transaction', async () => {
    for (const other of [false, true]) {
      const db = database();
      if (other) db.transfer(); else db.missing();
      await expect(storeManuscriptVersion(db.prisma as never, userId, workId, input())).rejects.toMatchObject({ status: 404 });
      expect(db.rows).toHaveLength(0);
    }
    const db = database();
    db.query.mockImplementationOnce(async () => { db.transfer(); return [{ id: workId }]; });
    await expect(storeManuscriptVersion(db.prisma as never, userId, workId, input())).rejects.toMatchObject({ status: 404 });
    expect(db.rows).toHaveLength(0);
  });

  it('never reuses another work or old-owner version and never returns its body', async () => {
    const db = database();
    db.rows.push({ id: 'foreign', workId: 'other-work', ownerUserId: 'other', locale: 'ko', version: 1,
      contentHash: input().contentHash, structuredBody: { secret: 'PRIVATE-SYNTHETIC' } });
    const result = await storeManuscriptVersion(db.prisma as never, userId, workId, input());
    expect(result.manuscript.id).not.toBe('foreign');
    db.rows.find(r => r.id === result.manuscript.id).ownerUserId = 'old-owner';
    await expect(storeManuscriptVersion(db.prisma as never, userId, workId, input())).rejects.toMatchObject({ status: 409 });
  });

  it('bounds conflict retry and sanitizes transaction failures without partial commits', async () => {
    const db = database();
    db.prisma.$transaction.mockRejectedValue({ code: 'P2002', message: 'PRIVATE-SYNTHETIC' });
    await expect(storeManuscriptVersion(db.prisma as never, userId, workId, input())).rejects.toMatchObject({ status: 503 });
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(db.rows).toHaveLength(0);
    db.prisma.$transaction.mockRejectedValue(new Error('PRIVATE-SYNTHETIC-BODY'));
    try { await storeManuscriptVersion(db.prisma as never, userId, workId, input()); fail(); }
    catch (error) { expect(JSON.stringify((error as HttpException).getResponse())).not.toContain('PRIVATE-SYNTHETIC'); }
  });
});
