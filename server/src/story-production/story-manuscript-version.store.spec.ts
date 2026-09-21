import { HttpException, ValidationPipe } from '@nestjs/common';
import { createValidationException } from '../common/validation-exception.factory';
import { CreateManuscriptVersionDto } from './dto/story-production.dto';
import { prepareManuscript, preparePastedManuscript } from './story-manuscript-file.policy';
import { manuscriptContentHash } from './story-production.policy';
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

function validatedJson(value: unknown): Promise<CreateManuscriptVersionDto> {
  return new ValidationPipe({
    whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
    transform: true, exceptionFactory: createValidationException,
  }).transform(value, { type: 'body', metatype: CreateManuscriptVersionDto });
}

function jsonDocument(): CreateManuscriptVersionDto {
  return JSON.parse(JSON.stringify(body));
}

type JsonChange = [string, (value: CreateManuscriptVersionDto) => void];
const legacyOnlyCases: JsonChange[] = [
  ['supplementary paragraph regression (5001)', value => { value.parts[0].paragraphs[0].text = '\u{1f642}'.repeat(5001); }],
  ['supplementary paragraph at DTO maximum', value => { value.parts[0].paragraphs[0].text = '\u{1f642}'.repeat(10000); }],
  ['supplementary key at DTO maximum', value => { value.parts[0].partKey = '\u{1f642}'.repeat(80); }],
  ['supplementary title at DTO maximum', value => { value.parts[0].title = '\u{1f642}'.repeat(240); }],
  ['empty key', value => { value.parts[0].partKey = ''; }],
  ['empty title', value => { value.parts[0].title = ''; }],
  ['whitespace key and title', value => { value.parts[0].partKey = ' \t'; value.parts[0].title = '\r\n '; }],
  ['repeated keys', value => { value.parts.push({ ...value.parts[0] }); }],
];

describe('existing JSON DTO compatibility versus strict file validation', () => {
  it.each(legacyOnlyCases)('preserves %s for create, replay and legacy references without relaxing file validation', async (_name, change) => {
    const value = jsonDocument();
    change(value);
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(102400);
    const dto = await validatedJson(value);
    expect(dto).toEqual(value);
    expect(() => prepareManuscript(Buffer.from(JSON.stringify(value)))).toThrow(HttpException);

    const db = database();
    const service = new StoryProductionService(db.prisma as never);
    const first = await service.createManuscriptVersion(userId, workId, dto);
    expect(db.rows[0].structuredBody.parts).toEqual(value.parts);
    expect(db.rows[0].structuredBody.intake.source.rawText).toBe(JSON.stringify(dto));
    expect(first.received.sourceKind).toBe('json_projection');
    const replay = await service.createManuscriptVersion(userId, workId, dto);
    expect(replay.manuscript).toEqual(first.manuscript);
    expect(replay.idempotentReplay).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(JSON.stringify(replay)).not.toMatch(/rawText|structuredBody|ownerUserId|PRIVATE-SYNTHETIC/);
    expect(replay.analysisStarted).toBe(false);

    const old = database();
    const legacyHash = manuscriptContentHash({ parts: dto.parts });
    old.rows.push({ id: 'legacy-id', workId, ownerUserId: userId, version: 7, locale: dto.locale,
      contentHash: legacyHash, structuredBody: { parts: dto.parts } });
    const release = { manuscriptVersionId: 'legacy-id' };
    const before = JSON.stringify(old.rows);
    const oldService = new StoryProductionService(old.prisma as never);
    const linked = await oldService.createManuscriptVersion(userId, workId, dto);
    expect(linked.manuscript.id).toBe(release.manuscriptVersionId);
    expect(linked.manuscript.contentHash).toBe(legacyHash);
    expect(linked.rawSource).toBe('legacy_projection_only');
    expect(JSON.stringify(old.rows)).toBe(before);
    const otherLocale = await oldService.createManuscriptVersion(userId, workId, await validatedJson({ ...value, locale: 'en' }));
    expect(otherLocale.manuscript.id).not.toBe(linked.manuscript.id);
    expect(otherLocale.manuscript.version).toBe(8);
  });

  it.each<JsonChange>([
    ['key above 80 characters', value => { value.parts[0].partKey = '\u{1f642}'.repeat(81); }],
    ['title above 240 characters', value => { value.parts[0].title = '\u{1f642}'.repeat(241); }],
    ['paragraph above 10000 characters', value => { value.parts[0].paragraphs[0].text = '\u{1f642}'.repeat(10001); }],
  ])('still rejects %s at the existing DTO boundary', async (_name, change) => {
    const value = jsonDocument(); change(value);
    await expect(validatedJson(value)).rejects.toMatchObject({ status: 400 });
  });

  it('keeps existing required/unknown/null field rules, without inventing optional fields or defaults', async () => {
    const plain = jsonDocument();
    expect(await validatedJson(plain)).toEqual(plain);
    for (const level of ['root', 'part', 'paragraph']) {
      const value = jsonDocument();
      const target = (level === 'root' ? value : level === 'part' ? value.parts[0] : value.parts[0].paragraphs[0]) as unknown as Record<string, unknown>;
      const keys = Object.keys(target);
      for (const key of keys) {
        const previous = target[key];
        delete target[key];
        await expect(validatedJson(value)).rejects.toMatchObject({ status: 400 });
        target[key] = null;
        await expect(validatedJson(value)).rejects.toMatchObject({ status: 400 });
        target[key] = previous;
      }
      target['unexpected'] = 'synthetic';
      await expect(validatedJson(value)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('keeps common-contract identity and exact combining Unicode/empty paragraph text without normalization', async () => {
    const value = jsonDocument();
    value.parts[0].title = 'e\u0301'.repeat(120);
    value.parts[0].paragraphs = [{ kind: 'paragraph', text: '' }, { kind: 'dialogue', text: 'e\u0301 \u00e9\r\n' }];
    const dto = await validatedJson(value);
    const db = database();
    const result = await new StoryProductionService(db.prisma as never).createManuscriptVersion(userId, workId, dto);
    expect(result.manuscript.contentHash).toBe(prepareManuscript(Buffer.from(JSON.stringify(value))).contentHash);
    expect(db.rows[0].structuredBody.parts).toEqual(value.parts);
  });
});

describe('atomic complete manuscript version store', () => {
  it('stores confirmed paste once and replays it without exposing or mutating the raw source', async () => {
    const db = database();
    const raw = 'PRIVATE-SYNTHETIC\r\nSecond part\n';
    const end = raw.indexOf('Second');
    const manifest = JSON.stringify({ locale: 'ko', confirmed: true, parts: [
      { partKey: 'a', title: 'First', start: 0, end },
      { partKey: 'b', title: 'Second', start: end, end: raw.length },
    ] });
    const parsed = preparePastedManuscript(Buffer.from(raw), manifest);
    const jsonEquivalent = prepareManuscript(Buffer.from(JSON.stringify({ locale: 'ko', parts: parsed.parts })));
    expect(parsed.contentHash).not.toBe(jsonEquivalent.contentHash);
    await storeManuscriptVersion(db.prisma as never, userId, workId, jsonEquivalent);
    const first = await storeManuscriptVersion(db.prisma as never, userId, workId, parsed);
    const snapshot = JSON.stringify(db.rows[1]);
    const replay = await storeManuscriptVersion(db.prisma as never, userId, workId, parsed);
    expect(db.rows).toHaveLength(2);
    expect(db.rows[1].structuredBody.intake.source.rawText).toBe(raw);
    expect(JSON.stringify(db.rows[1])).toBe(snapshot);
    expect(replay.manuscript.id).toBe(first.manuscript.id);
    expect(replay.idempotentReplay).toBe(true);
    expect(JSON.stringify(replay)).not.toContain('PRIVATE-SYNTHETIC');
    expect(db.prisma.storyAnalysisJob.create).not.toHaveBeenCalled();
  });

  it('keeps v3 source/citations immutable while concurrent v4 uploads allocate and replay one new version', async () => {
    const db = database();
    const raw = 'PRIVATE-SYNTHETIC\r\n\r\nSecond\n';
    const manifest = JSON.stringify({ locale: 'ko', confirmed: true, parts: [
      { partKey: 'a', title: 'A', start: 0, end: raw.length },
    ] });
    const input = preparePastedManuscript(Buffer.from(raw), manifest);
    const oldParts = [{ partKey: 'a', title: 'A', paragraphs: [
      { kind: 'paragraph', text: 'PRIVATE-SYNTHETIC\r\n' },
      { kind: 'paragraph', text: '\r\n' }, { kind: 'paragraph', text: 'Second\n' },
    ] }];
    const oldHash = manuscriptContentHash({ identityVersion: 3, locale: 'ko', parts: oldParts, sourceSha256: input.source.sha256 });
    db.rows.push({ id: 'v3-source', workId, ownerUserId: userId, version: 7, locale: 'ko', contentHash: oldHash,
      structuredBody: { parts: oldParts, intake: { identityVersion: 3, locale: 'ko', source: input.source } } });
    const before = JSON.stringify(db.rows[0]);
    const citation = { manuscriptVersionId: 'v3-source', paragraphIndex: 2, start: 0, end: 6 };
    const [first, concurrent] = await Promise.all([1, 2].map(() => storeManuscriptVersion(db.prisma as never, userId, workId, input)));
    expect(first.manuscript.id).toBe(concurrent.manuscript.id);
    expect(first.manuscript.version).toBe(8);
    expect(first.manuscript.contentHash).not.toBe(oldHash);
    expect(db.rows).toHaveLength(2);
    expect(db.rows[1].structuredBody.intake.identityVersion).toBe(4);
    expect(db.rows[1].structuredBody.parts[0].paragraphs).toHaveLength(2);
    const replay = await storeManuscriptVersion(db.prisma as never, userId, workId, preparePastedManuscript(Buffer.from(raw), manifest));
    expect(replay).toMatchObject({ idempotentReplay: true, manuscript: { id: first.manuscript.id } });
    expect(JSON.stringify(db.rows[0])).toBe(before);
    const preserved = db.rows.find(row => row.id === citation.manuscriptVersionId);
    expect(preserved.structuredBody.parts[0].paragraphs[citation.paragraphIndex].text.slice(citation.start, citation.end)).toBe('Second');
    expect(db.prisma.storyAnalysisJob.create).not.toHaveBeenCalled();
  });

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
