import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, type Asset } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AdminService } from './admin.service';
import type { AuthUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';

const ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FORGED_ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-10-06T09:00:00.000Z');
const CANARY = 'QA_ALLOCATION_CALLER_JSON_20261006';
const LARGE_SIZE = '9007199254740993';
const EXACT_DURATION = '123456789.123';
const user: AuthUser = { id: ACTOR, email: 'allocation@example.invalid' };
type Payload = Record<string, unknown>;
type Failure = { assetError?: Error; auditError?: Error; transactionError?: Error };

function directInput(): Payload {
  return { assetType: 'video', visibility: 'private', storageProvider: 'local',
    storageKey: 'qa/synthetic-allocation.mp4', mimeType: 'video/mp4',
    fileSizeBytes: LARGE_SIZE, width: 1920, height: 1080,
    durationSeconds: EXACT_DURATION, checksum: 'qa-checksum',
    metadata: { arbitrary: { marker: CANARY }, uploadIntent: { createdByUserId: FORGED_ACTOR } } };
}

function intentInput(): Payload {
  return { fileName: 'QA Allocation.PNG', mimeType: 'image/png', assetType: 'image',
    fileSizeBytes: 12345, width: 640, height: 480, checksum: 'qa-intent-checksum',
    metadata: { slot: 'cover', note: CANARY, arbitrary: { marker: CANARY },
      uploadIntent: { createdByUserId: FORGED_ACTOR } } };
}

function rowFrom(data: Prisma.AssetCreateInput): Asset {
  return { id: ID, assetType: data.assetType, visibility: data.visibility ?? 'public',
    storageProvider: data.storageProvider ?? 'local', storageKey: data.storageKey,
    mimeType: data.mimeType, fileSizeBytes: data.fileSizeBytes == null ? null : BigInt(data.fileSizeBytes),
    width: data.width ?? null, height: data.height ?? null,
    durationSeconds: data.durationSeconds == null ? null : new Decimal(data.durationSeconds.toString()),
    checksum: data.checksum ?? null, metadata: (data.metadata ?? {}) as Prisma.JsonValue,
    createdAt: NOW, updatedAt: NOW };
}

function harness(failure: Failure = {}, configOverrides: Record<string, unknown> = {}) {
  const trace: string[] = [];
  const stagedAssets: Asset[] = [], stagedAudits: Prisma.AuditEventCreateInput[] = [];
  const committedAssets: Asset[] = [], committedAudits: Prisma.AuditEventCreateInput[] = [];
  const tx = {
    asset: { create: jest.fn(async (args: Prisma.AssetCreateArgs) => {
      trace.push('asset.create');
      if (failure.assetError) throw failure.assetError;
      const row = Object.freeze(rowFrom(args.data));
      stagedAssets.push(row);
      return row;
    }) },
    auditEvent: { create: jest.fn(async (args: { data: Prisma.AuditEventCreateInput }) => {
      trace.push('audit.create');
      if (failure.auditError) throw failure.auditError;
      stagedAudits.push(args.data);
      return { id: 'qa-audit' };
    }) },
  };
  const db = {
    asset: { create: jest.fn(() => { throw new Error('GLOBAL_ASSET_ALLOCATION_FORBIDDEN'); }) },
    auditEvent: { create: jest.fn(() => { throw new Error('GLOBAL_ALLOCATION_AUDIT_FORBIDDEN'); }) },
    $transaction: jest.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => {
      trace.push('transaction.begin');
      try {
        if (failure.transactionError) throw failure.transactionError;
        const result = await work(tx);
        committedAssets.push(...stagedAssets);
        committedAudits.push(...stagedAudits);
        trace.push('transaction.commit');
        return result;
      } catch (error) {
        trace.push('transaction.reject');
        throw error;
      }
    }),
  };
  // Only explicit synthetic configuration is read, never process.env or storage.
  const configValues: Record<string, unknown> = {
    OBJECT_STORAGE_PROVIDER: 'local', OBJECT_STORAGE_KEY_PREFIX: 'qa-allocation',
    OBJECT_UPLOAD_INTENT_TTL_SECONDS: 900, MAX_IMAGE_UPLOAD_BYTES: 20971520,
    MAX_VIDEO_UPLOAD_BYTES: 524288000, ASSET_PUBLIC_BASE_URL: 'https://delivery.example.invalid',
    ...configOverrides,
  };
  const config = { get<T>(key: string): T | undefined { return configValues[key] as T | undefined; } };
  const service = new AdminService(db as unknown as PrismaService, config as unknown as ConfigService);
  return { service, db, tx, trace, stagedAssets, committedAssets, committedAudits };
}

type Harness = ReturnType<typeof harness>;

function auditSnapshot(row: Asset) {
  return { id: row.id, assetType: row.assetType, visibility: row.visibility,
    storageProvider: row.storageProvider, storageKey: row.storageKey, mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes?.toString() ?? null, width: row.width, height: row.height,
    durationSeconds: row.durationSeconds?.toString() ?? null, checksum: row.checksum };
}

function expectAudit(h: Harness, action: string) {
  expect(h.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  expect(h.tx.auditEvent.create).toHaveBeenCalledWith({ data: {
    actorUserId: ACTOR, actorType: 'admin', action, targetType: 'asset', targetId: ID,
    beforeData: Prisma.JsonNull, metadata: {}, afterData: auditSnapshot(h.stagedAssets[0]),
  } });
  const data = h.tx.auditEvent.create.mock.calls[0][0].data;
  expect(() => JSON.stringify(data)).not.toThrow();
  expect(JSON.stringify(data)).not.toContain(CANARY);
  expect(JSON.stringify(data)).not.toContain(FORGED_ACTOR);
  expect(Object.keys(data.afterData as Record<string, unknown>).sort()).toEqual([
    'assetType', 'checksum', 'durationSeconds', 'fileSizeBytes', 'height', 'id',
    'mimeType', 'storageKey', 'storageProvider', 'visibility', 'width',
  ]);
}

function expectOnlyTransaction(h: Harness, calls = 1) {
  expect(h.db.$transaction).toHaveBeenCalledTimes(calls);
  expect(h.db.asset.create).not.toHaveBeenCalled();
  expect(h.db.auditEvent.create).not.toHaveBeenCalled();
}

const operations = [
  ['direct', (h: Harness) => h.service.createAsset(user, directInput())],
  ['intent', (h: Harness) => h.service.createAssetUploadIntent(user, intentInput())],
] as const;

describe('AdminService asset allocation transaction subunit', () => {
  let fetchSpy: jest.SpyInstance<ReturnType<typeof fetch>, Parameters<typeof fetch>>;
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('EXTERNAL_FETCH_FORBIDDEN'));
  });
  afterEach(() => {
    try { expect(fetchSpy).not.toHaveBeenCalled(); } finally { fetchSpy.mockRestore(); }
  });

  it('keeps direct allocation response JSON-safe, exact and nonmutating while auditing only row scalars', async () => {
    const h = harness(), input = directInput(), originalInput = JSON.stringify(input);
    const result = await h.service.createAsset(user, input);
    const row = h.stagedAssets[0];
    expect(result).toEqual({ ...row, fileSizeBytes: LARGE_SIZE });
    expect(result).not.toBe(row);
    expect(result.durationSeconds).toBe(row.durationSeconds);
    expect(result.durationSeconds?.toString()).toBe(EXACT_DURATION);
    expect(result.metadata).toEqual(input.metadata);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.parse(JSON.stringify(result)).fileSizeBytes).toBe(LARGE_SIZE);
    expect(row.fileSizeBytes).toBe(BigInt(LARGE_SIZE));
    expect(typeof row.fileSizeBytes).toBe('bigint');
    expect(JSON.stringify(input)).toBe(originalInput);
    expect(h.tx.asset.create).toHaveBeenCalledWith({ data: {
      ...input, fileSizeBytes: BigInt(LARGE_SIZE), durationSeconds: new Decimal(EXACT_DURATION),
    } });
    expectAudit(h, 'asset.create');
    expectOnlyTransaction(h);
    expect(h.committedAssets).toHaveLength(1);
    expect(h.committedAudits).toHaveLength(1);
    expect(h.trace).toEqual(['transaction.begin', 'asset.create', 'audit.create', 'transaction.commit']);
  });

  it('preserves defaults and nullable scalar snapshot fields without inventing purpose or owner fields', async () => {
    const h = harness();
    const result = await h.service.createAsset(user, {
      assetType: 'image', storageKey: 'qa/nullable.png', mimeType: 'image/png',
    });
    expect(result.fileSizeBytes).toBeNull();
    expect(result.durationSeconds).toBeNull();
    expect(result.visibility).toBe('public');
    expect(result.storageProvider).toBe('local');
    expect(() => JSON.stringify(result)).not.toThrow();
    expectAudit(h, 'asset.create');
    expect(h.tx.auditEvent.create.mock.calls[0][0].data.afterData).toEqual({
      id: ID, assetType: 'image', visibility: 'public', storageProvider: 'local',
      storageKey: 'qa/nullable.png', mimeType: 'image/png', fileSizeBytes: null,
      width: null, height: null, durationSeconds: null, checksum: null,
    });
    expectOnlyTransaction(h);
  });

  it('retains local intent PUT response, caller metadata and genuine server upload owner without auditing them', async () => {
    const h = harness(), input = intentInput(), original = JSON.stringify(input);
    const result = await h.service.createAssetUploadIntent(user, input);
    const row = h.stagedAssets[0];
    expect(result.asset).toEqual({ ...row, fileSizeBytes: '12345' });
    expect(result.asset).not.toBe(row);
    expect(row.fileSizeBytes).toBe(BigInt(12345));
    expect(result.asset.metadata).toEqual(expect.objectContaining({
      arbitrary: { marker: CANARY }, note: CANARY,
      uploadIntent: expect.objectContaining({ createdByUserId: ACTOR, status: 'pending_upload',
        fileName: 'qa-allocation.png' }),
    }));
    expect(result.upload).toEqual({
      method: 'PUT', url: '/pending-local-upload/' + row.storageKey,
      publicUrl: 'https://delivery.example.invalid/' + row.storageKey,
      storageProvider: 'local', storageKey: row.storageKey,
      requiredHeaders: { 'content-type': 'image/png' }, expiresInSeconds: 900, mode: 'metadata_only',
    });
    expect(row.storageKey).toMatch(/^qa-allocation\/uploads\/images\//);
    expect(JSON.stringify(input)).toBe(original);
    expect(() => JSON.stringify(result)).not.toThrow();
    expectAudit(h, 'asset.upload_intent.create');
    expectOnlyTransaction(h);
  });

  it('keeps locally signed PUT contract while excluding signed URL and caller JSON from the audit', async () => {
    const h = harness({}, { OBJECT_STORAGE_PROVIDER: 'r2',
      OBJECT_STORAGE_ENDPOINT: 'https://storage.example.invalid', OBJECT_STORAGE_BUCKET: 'qa-bucket',
      OBJECT_STORAGE_REGION: 'auto', OBJECT_STORAGE_ACCESS_KEY_ID: 'QA_SYNTHETIC_ACCESS',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'QA_SYNTHETIC_NOT_AN_OPERATING_SECRET',
      OBJECT_UPLOAD_INTENT_TTL_SECONDS: 321 });
    const result = await h.service.createAssetUploadIntent(user, intentInput());
    const url = new URL(result.upload.url);
    expect(url.origin).toBe('https://storage.example.invalid');
    expect(url.pathname).toBe('/qa-bucket/' + result.upload.storageKey);
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('321');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(result.upload.method).toBe('PUT');
    expect(result.upload.requiredHeaders).toEqual({ 'content-type': 'image/png' });
    expect(result.upload.mode).toBe('direct_upload_ready');
    expect(result.upload.storageProvider).toBe('r2');
    expect(result.asset.fileSizeBytes).toBe('12345');
    expect(() => JSON.stringify(result)).not.toThrow();
    expectAudit(h, 'asset.upload_intent.create');
    const serializedAudit = JSON.stringify(h.tx.auditEvent.create.mock.calls[0][0].data);
    expect(serializedAudit).not.toContain(result.upload.url);
    expect(serializedAudit).not.toContain('X-Amz-');
    expect(serializedAudit).not.toContain('QA_SYNTHETIC_ACCESS');
    expectOnlyTransaction(h);
  });

  it.each(operations)('propagates asset failure without audit, commit, global allocation or retry for %s', async (_name, invoke) => {
    const error = new Error('Synthetic allocation failure'), h = harness({ assetError: error });
    await expect(invoke(h)).rejects.toBe(error);
    expect(h.tx.asset.create).toHaveBeenCalledTimes(1);
    expect(h.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(h.committedAssets).toEqual([]);
    expect(h.committedAudits).toEqual([]);
    expectOnlyTransaction(h);
    expect(h.trace).toEqual(['transaction.begin', 'asset.create', 'transaction.reject']);
  });

  it.each(operations)('propagates audit failure with no mock commit, global audit or automatic retry for %s', async (_name, invoke) => {
    const error = new Error('Synthetic audit failure'), h = harness({ auditError: error });
    await expect(invoke(h)).rejects.toBe(error);
    expect(h.tx.asset.create).toHaveBeenCalledTimes(1);
    expect(h.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(h.stagedAssets).toHaveLength(1);
    expect(h.committedAssets).toEqual([]);
    expect(h.committedAudits).toEqual([]);
    expectOnlyTransaction(h);
    expect(h.trace).toEqual(['transaction.begin', 'asset.create', 'audit.create', 'transaction.reject']);
  });

  it.each(operations)('propagates transaction rejection before allocation without fallback or retry for %s', async (_name, invoke) => {
    const error = new Error('Synthetic transaction rejection'), h = harness({ transactionError: error });
    await expect(invoke(h)).rejects.toBe(error);
    expect(h.tx.asset.create).not.toHaveBeenCalled();
    expect(h.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(h.committedAssets).toEqual([]);
    expectOnlyTransaction(h);
  });

  it.each(operations)('does not return success before a delayed rejecting audit completes for %s', async (_name, invoke) => {
    const h = harness(), error = new Error('Synthetic delayed audit rejection');
    let rejectAudit!: (reason: Error) => void;
    h.tx.auditEvent.create.mockImplementationOnce(() =>
      new Promise<{ id: string }>((_resolve, reject) => { rejectAudit = reject; }));
    let settled = false;
    const result = invoke(h);
    const observed = result.then(() => { settled = true; return null; },
      reason => { settled = true; return reason; });
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    expect(h.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(h.committedAssets).toEqual([]);
    rejectAudit(error);
    expect(await observed).toBe(error);
    expect(h.committedAssets).toEqual([]);
    expectOnlyTransaction(h);
  });

  it('rejects malformed direct input without an allocation, audit or retry', async () => {
    const h = harness();
    await expect(h.service.createAsset(user, { ...directInput(), storageKey: undefined }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(h.tx.asset.create).not.toHaveBeenCalled();
    expect(h.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(h.committedAssets).toEqual([]);
    expectOnlyTransaction(h);
  });

  it('rejects unsupported intent MIME before entering a transaction', async () => {
    const h = harness();
    await expect(h.service.createAssetUploadIntent(user, { ...intentInput(), mimeType: 'application/zip' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(h.tx.asset.create).not.toHaveBeenCalled();
    expect(h.tx.auditEvent.create).not.toHaveBeenCalled();
    expectOnlyTransaction(h, 0);
  });

  it('EXACT.ERROR.01 PrismaKnown P2002 asset-create rejection preserves identity and never retries', async () => {
    const h = harness();
    const error = new Prisma.PrismaClientKnownRequestError('Synthetic storage-pair collision', {
      code: 'P2002', clientVersion: 'qa-generated174',
      meta: { target: ['storage_provider', 'storage_key'] },
    });
    h.tx.asset.create.mockRejectedValueOnce(error);
    await expect(h.service.createAsset(user, directInput())).rejects.toBe(error);
    expect(error.code).toBe('P2002');
    expect(h.tx.asset.create).toHaveBeenCalledTimes(1);
    expect(h.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(h.stagedAssets).toEqual([]);
    expect(h.committedAssets).toEqual([]);
    expect(h.committedAudits).toEqual([]);
    expect(h.trace).toEqual(['transaction.begin', 'transaction.reject']);
    expectOnlyTransaction(h);
  });

  it('EXACT.ERROR.02 PrismaKnown P2002 audit rejection preserves identity and never retries allocation', async () => {
    const h = harness();
    const error = new Prisma.PrismaClientKnownRequestError('Synthetic audit unique collision', {
      code: 'P2002', clientVersion: 'qa-generated174', meta: { target: ['id'] },
    });
    h.tx.auditEvent.create.mockRejectedValueOnce(error);
    await expect(h.service.createAsset(user, directInput())).rejects.toBe(error);
    expect(error.code).toBe('P2002');
    expect(h.tx.asset.create).toHaveBeenCalledTimes(1);
    expect(h.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(h.stagedAssets).toHaveLength(1);
    expect(h.committedAssets).toEqual([]);
    expect(h.committedAudits).toEqual([]);
    expect(h.trace).toEqual(['transaction.begin', 'asset.create', 'transaction.reject']);
    expectOnlyTransaction(h);
  });

  it('EXACT.ERROR.03 PrismaUnknown transaction rejection preserves original identity without fallback', async () => {
    const h = harness();
    const error = new Prisma.PrismaClientUnknownRequestError('Synthetic unknown DB rejection', {
      clientVersion: 'qa-generated174',
    });
    h.db.$transaction.mockRejectedValueOnce(error);
    await expect(h.service.createAssetUploadIntent(user, intentInput())).rejects.toBe(error);
    expect(h.tx.asset.create).not.toHaveBeenCalled();
    expect(h.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(h.stagedAssets).toEqual([]);
    expect(h.committedAssets).toEqual([]);
    expect(h.committedAudits).toEqual([]);
    expectOnlyTransaction(h);
  });

  it('EXACT.ERROR.04 nonError number-zero transaction rejection preserves the original falsy value', async () => {
    const h = harness(), rejection = 0;
    h.db.$transaction.mockRejectedValueOnce(rejection);
    await expect(h.service.createAssetUploadIntent(user, intentInput())).rejects.toBe(rejection);
    expect(h.tx.asset.create).not.toHaveBeenCalled();
    expect(h.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(h.stagedAssets).toEqual([]);
    expect(h.committedAssets).toEqual([]);
    expect(h.committedAudits).toEqual([]);
    expectOnlyTransaction(h);
  });
});
