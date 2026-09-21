import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { AUTHORED_IMPORT_MULTIPART_OPTIONS, StoryAuthoredImportController } from './story-authored-import.controller';
import { manuscriptRequestLength } from './story-manuscript-file.controller';

describe('authored import bounded private multipart contract', () => {
  const metadata = () => ({ manuscriptVersionId: randomUUID(), releaseId: randomUUID(),
    expectedReleaseChecksum: 'a'.repeat(64), expectedManuscriptHash: 'b'.repeat(64),
    expectedPackageSha256: 'c'.repeat(64), expectedSourceMapSha256: 'd'.repeat(64),
    expectedRevision: 1, endingKey: 'author_main', endingEvidenceSegment: 8 });
  function fixture(body = metadata()) {
    const service = { execute: jest.fn().mockResolvedValue({ mode: 'dry_run' }) };
    const controller = new StoryAuthoredImportController(service as never);
    const buffer = Buffer.from('{}');
    const file = { fieldname: 'sourceMap', originalname: 'source-map.json', mimetype: 'application/json', encoding: '7bit',
      size: buffer.length, buffer };
    return { service, controller, file, request: { body: { metadata: JSON.stringify(body) } } };
  }

  it('passes authenticated actor and explicit bindings, without defaulting apply to true', async () => {
    const f = fixture();
    const ownerId = randomUUID();
    const workId = randomUUID();
    await f.controller.execute({ id: ownerId } as never, workId, f.file, f.request as never, undefined);
    expect(f.service.execute).toHaveBeenCalledWith(ownerId, workId,
      expect.objectContaining({ expectedRevision: 1, endingKey: 'author_main' }), f.file.buffer, undefined);
    expect(f.service.execute.mock.calls[0][2].apply).toBeUndefined();
  });

  it('keeps the 16 MiB file separate from bounded metadata and request overhead', () => {
    expect(AUTHORED_IMPORT_MULTIPART_OPTIONS.limits.fileSize).toBe(16 * 1024 * 1024 + 1);
    expect(AUTHORED_IMPORT_MULTIPART_OPTIONS.limits.fieldSize).toBe(8193);
    const headers = { 'content-type': 'multipart/form-data; boundary=synthetic',
      'content-length': String(16 * 1024 * 1024 + 16 * 1024) };
    expect(manuscriptRequestLength(headers)).toBe(16 * 1024 * 1024 + 16 * 1024);
    expect(() => manuscriptRequestLength({ ...headers, 'content-length': String(Number(headers['content-length']) + 1) })).toThrow();
    expect(() => manuscriptRequestLength({ ...headers, 'content-encoding': 'gzip' })).toThrow();
  });

  it.each(['ready', 'ownerUserId', 'priceLumina', 'targetSceneId'])('rejects authority/target injection through %s', field => {
    const f = fixture({ ...metadata(), [field]: 'PRIVATE_INJECTION' } as never);
    expect(() => f.controller.execute({ id: randomUUID() } as never, randomUUID(), f.file, f.request as never)).toThrow();
    expect(f.service.execute).not.toHaveBeenCalled();
  });

  it('rejects duplicate metadata keys, wrong file fields and extra fields', () => {
    const f = fixture();
    expect(() => f.controller.execute({ id: randomUUID() } as never, randomUUID(), f.file,
      { body: { metadata: '{"apply":false,"apply":true}' } } as never)).toThrow();
    expect(() => f.controller.execute({ id: randomUUID() } as never, randomUUID(), { ...f.file, fieldname: 'other' }, f.request as never)).toThrow();
    expect(() => f.controller.execute({ id: randomUUID() } as never, randomUUID(), f.file,
      { body: { ...f.request.body, extra: 'PRIVATE_EXTRA' } } as never)).toThrow();
    expect(f.service.execute).not.toHaveBeenCalled();
  });
});
