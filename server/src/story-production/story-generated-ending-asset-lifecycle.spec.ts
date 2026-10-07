import { Prisma } from '@prisma/client';
import { fixture } from '../../test/fixtures/story-generated-ending-read.fixture';

const artworkCode = 'STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED';
const falseFlags = ['progressMutated', 'generationStarted', 'imageGenerationStarted',
  'meaningApproved', 'qualityApproved', 'publicationStarted'] as const;
const invalidCases: Array<{ name: string; lifecycle: Prisma.JsonValue }> = [
  { name: 'archived', lifecycle: { status: 'archived' } },
  { name: 'null', lifecycle: null },
  { name: 'string', lifecycle: 'active' },
  { name: 'array', lifecycle: [{ status: 'active' }] },
  { name: 'missing status', lifecycle: {} },
  { name: 'case mismatch', lifecycle: { status: 'Active' } },
];

async function outcome(promise: Promise<unknown>) {
  try {
    await promise;
    return { resolved: true, status: null, code: null };
  } catch (error) {
    const failure = error as { getStatus?: () => number; getResponse?: () => unknown };
    const response = failure.getResponse?.() as { code?: string } | undefined;
    return { resolved: false, status: failure.getStatus?.() ?? null, code: response?.code ?? null };
  }
}

function observe(value: object) {
  console.info(`LIFECYCLE_OBSERVATION ${JSON.stringify(value)}`);
}

function noGenerationOrProgressWrite(f: ReturnType<typeof fixture>) {
  expect(f.tx.storyAiContinuation.create).not.toHaveBeenCalled();
  expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  for (const call of f.stories.currentProgress.mock.calls as unknown[][]) expect(call[3]).toBe(false);
}

function noAudit(f: ReturnType<typeof fixture>) {
  expect(f.rows).toHaveLength(0);
  expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  noGenerationOrProgressWrite(f);
}

function resetAssetCalls(f: ReturnType<typeof fixture>) {
  f.tx.$queryRaw.mockClear();
  f.tx.asset.findFirst.mockClear();
}

// This checks issued SQL and mock call order, not native PostgreSQL lock holding.
function assetLockBeforeRead(f: ReturnType<typeof fixture>) {
  const locks = f.tx.$queryRaw.mock.calls.flatMap(([sql], index) =>
    /SELECT id FROM assets\s+WHERE id = .*::uuid FOR SHARE/.test(sql.sql)
      ? [{ index, sql }] : []);
  expect(locks).toHaveLength(1);
  expect(locks[0].sql.values).toEqual([f.asset.id]);
  expect(f.tx.asset.findFirst).toHaveBeenCalledTimes(1);
  expect(f.tx.$queryRaw.mock.invocationCallOrder[locks[0].index])
    .toBeLessThan(f.tx.asset.findFirst.mock.invocationCallOrder[0]);
}

describe('generated ending asset lifecycle eligibility', () => {
  it.each(['legacy', 'active'])('%s GET/POST preserves explicit receipt and six false flags', async kind => {
    const f = fixture();
    if (kind === 'active') Object.assign(f.asset.metadata, { lifecycle: { status: 'active' } });
    const review = await f.preview();
    expect(review).toMatchObject({ contract: 'story-generated-ending-read-review-v1', confirmation: null });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    const input = await f.input();
    resetAssetCalls(f);
    const receipt = await f.confirm(input);
    assetLockBeforeRead(f);
    const saved = await f.preview();
    const confirmed = receipt as unknown as Record<string, unknown>;
    const retrieved = saved.confirmation as unknown as Record<string, unknown>;
    for (const key of falseFlags) {
      expect(confirmed[key]).toBe(false);
      expect(retrieved?.[key]).toBe(false);
    }
    expect(saved.confirmation?.receiptId).toBe(receipt.receiptId);
    expect(f.rows).toHaveLength(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    noGenerationOrProgressWrite(f);
    observe({ kind, method: 'GET/POST', receiptFlags: Object.fromEntries(falseFlags.map(key => [key, confirmed[key]])), auditRows: f.rows.length });
  });

  it.each(invalidCases)('$name lifecycle GET rejects 409 ARTWORK_CHANGED despite public ready projection', async ({ name, lifecycle }) => {
    const f = fixture();
    Object.assign(f.asset.metadata, { lifecycle });
    expect(f.asset.visibility).toBe('public');
    expect(f.page().scene.deliveryState).toBe('ready');
    const result = await outcome(f.preview());
    noAudit(f);
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    observe({ kind: name, method: 'GET', ...result, auditRows: f.rows.length });
    expect(result).toEqual({ resolved: false, status: 409, code: artworkCode });
  });

  it('all six invalid lifecycles reject prior-valid POST input under asset lock with zero audit', async () => {
    const results: Array<{ kind: string; resolved: boolean; status: number | null; code: string | null }> = [];
    for (const { name, lifecycle } of invalidCases) {
      const f = fixture(), input = await f.input();
      Object.assign(f.asset.metadata, { lifecycle });
      resetAssetCalls(f);
      const result = await outcome(f.confirm(input));
      assetLockBeforeRead(f);
      noAudit(f);
      expect(f.asset.visibility).toBe('public');
      results.push({ kind: name, ...result });
      observe({ kind: name, method: 'prior-valid POST', ...result, auditRows: f.rows.length, assetLockBeforeRead: true });
    }
    expect(results).toEqual(invalidCases.map(({ name }) =>
      ({ kind: name, resolved: false, status: 409, code: artworkCode })));
  });

  it('rejects archive after a synthetically captured ready page and before the receipt transaction', async () => {
    const f = fixture(), input = await f.input();
    const progressBefore = JSON.stringify(f.progress);
    resetAssetCalls(f);
    f.prisma.$transaction.mockClear();
    f.stories.currentProgress.mockImplementationOnce(async (_user, _progress, locale) => {
      const captured = f.page(locale);
      expect(captured.scene.deliveryState).toBe('ready');
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
      Object.assign(f.asset.metadata, { lifecycle: { status: 'archived' } });
      return captured;
    });
    const result = await outcome(f.confirm(input));
    assetLockBeforeRead(f);
    noAudit(f);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.progress)).toBe(progressBefore);
    expect(f.asset.visibility).toBe('public');
    observe({ kind: 'archived after captured page', method: 'prior-valid POST', ...result,
      auditRows: f.rows.length, assetLockBeforeRead: true, syntheticReadyProjection: true });
    expect(result).toEqual({ resolved: false, status: 409, code: artworkCode });
  });
});
