import 'reflect-metadata';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Readable } from 'stream';
import { lastValueFrom, of, throwError } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  manuscriptRequestLength, StoryManuscriptAdmission, StoryManuscriptFileController,
  StoryManuscriptMultipartInterceptor, StoryManuscriptOwnerGuard,
  StoryManuscriptPasteMultipartInterceptor, StoryManuscriptPasteOwnerGuard,
} from './story-manuscript-file.controller';
import { MANUSCRIPT_FILE_LIMITS, preparePastedManuscript } from './story-manuscript-file.policy';

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'synthetic@example.invalid' };
const workId = '00000000-0000-4000-8000-000000000002';
const json = JSON.stringify({ locale: 'ko', parts: [{ partKey: 'p', title: 'Synthetic', paragraphs: [{ kind: 'paragraph', text: 'private' }] }] });
const boundary = 'synthetic-boundary';
function multipart(content = json, field = 'manuscript', ending = true) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="synthetic.json"\r\nContent-Type: application/json\r\n\r\n${content}\r\n${ending ? `--${boundary}--\r\n` : ''}`);
}
function pasteMultipart(raw: string, manifest: unknown) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n${JSON.stringify(manifest)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="manuscript"; filename="paste.txt"\r\nContent-Type: text/plain\r\n\r\n${raw}\r\n--${boundary}--\r\n`);
}
function context(raw: Buffer, length = raw.length) {
  const request = Object.assign(Readable.from([raw]), { headers: {
    'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(length),
  }, user, params: { workId }, method: 'POST' });
  return { request, context: { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }) } as unknown as ExecutionContext };
}

describe('owned-work bounded file endpoint', () => {
  it('mounts a new authenticated owned-work file route, separate from receipt-only intake', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StoryManuscriptFileController)).toBe('me/creator-studio/stories/:workId/manuscripts');
    const handler = StoryManuscriptFileController.prototype.create;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('file');
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, StoryManuscriptOwnerGuard]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, handler)).toEqual([StoryManuscriptMultipartInterceptor]);
    const paste = StoryManuscriptFileController.prototype.paste;
    expect(Reflect.getMetadata(PATH_METADATA, paste)).toBe('paste');
    expect(Reflect.getMetadata(GUARDS_METADATA, paste)).toEqual([JwtAuthGuard, StoryManuscriptPasteOwnerGuard]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, paste)).toEqual([StoryManuscriptPasteMultipartInterceptor]);
  });

  it('accepts browser-style FormData and bounded chunked proxy delivery for paste only', async () => {
    const raw = 'first\r\nsecond';
    const data = pasteMultipart(raw, { locale: 'ko', confirmed: true, parts: [
      { partKey: 'p1', title: 'First', start: 0, end: raw.length },
    ] });
    const c = context(data);
    const interceptor = new StoryManuscriptPasteMultipartInterceptor(new StoryManuscriptAdmission());
    expect(await lastValueFrom(await interceptor.intercept(c.context, { handle: () => of('ok') }))).toBe('ok');
    expect((c.request as any).body).toHaveProperty('manifest');
    expect((c.request as any).file.buffer.toString()).toBe(raw);
    const chunked = context(data);
    delete (chunked.request.headers as Record<string, unknown>)['content-length'];
    (chunked.request.headers as Record<string, unknown>)['transfer-encoding'] = 'chunked';
    expect(manuscriptRequestLength(chunked.request.headers, true)).toBeNull();
    expect(await lastValueFrom(await interceptor.intercept(chunked.context, { handle: () => of('ok') }))).toBe('ok');
    expect(() => manuscriptRequestLength(chunked.request.headers)).toThrow(HttpException);
  });

  it('rejects malformed raw UTF-8 in manifest before Multer can replace it', async () => {
    const raw = pasteMultipart('Synthetic text', { locale: 'ko', confirmed: true, parts: [
      { partKey: 'p1', title: 'First', start: 0, end: 14 },
    ] });
    raw[raw.indexOf(Buffer.from('First'))] = 0xff;
    const c = context(raw);
    const next = { handle: jest.fn(() => of('bad')) };
    await expect(new StoryManuscriptPasteMultipartInterceptor(new StoryManuscriptAdmission()).intercept(c.context, next))
      .rejects.toBeInstanceOf(HttpException);
    expect(next.handle).not.toHaveBeenCalled();

    const valid = context(pasteMultipart('Synthetic text', { locale: 'ko', confirmed: true, parts: [
      { partKey: 'p1', title: 'Valid � 🚀', start: 0, end: 14 },
    ] }));
    const interceptor = new StoryManuscriptPasteMultipartInterceptor(new StoryManuscriptAdmission());
    expect(await lastValueFrom(await interceptor.intercept(valid.context, { handle: () => of('ok') }))).toBe('ok');
    const prepared = preparePastedManuscript((valid.request as any).file.buffer, (valid.request as any).body.manifest);
    expect(prepared.parts[0].title).toBe('Valid � 🚀');
  });

  it('accepts a valid manifest code point split across request chunks', async () => {
    const data = pasteMultipart('text', { locale: 'ko', confirmed: true, parts: [
      { partKey: 'p1', title: 'Rocket 🚀', start: 0, end: 4 },
    ] });
    const split = data.indexOf(Buffer.from('🚀')) + 2;
    const request = Object.assign(Readable.from([data.subarray(0, split), data.subarray(split)]), {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(data.length) },
      user, params: { workId }, method: 'POST',
    });
    const ctx = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }) } as unknown as ExecutionContext;
    const interceptor = new StoryManuscriptPasteMultipartInterceptor(new StoryManuscriptAdmission());
    expect(await lastValueFrom(await interceptor.intercept(ctx, { handle: () => of('ok') }))).toBe('ok');
    expect((request as any).body.manifest).toContain('Rocket 🚀');
  });

  it('rejects unbounded paste envelopes and extra fields before storage', async () => {
    expect(() => manuscriptRequestLength({ 'content-type': 'multipart/form-data; boundary=x' }, true)).toThrow(HttpException);
    expect(() => manuscriptRequestLength({ 'content-type': 'multipart/form-data; boundary=x',
      'content-length': String(MANUSCRIPT_FILE_LIMITS.pasteRequestBytes + 1) }, true)).toThrow(HttpException);
    const raw = pasteMultipart('text', { locale: 'ko', confirmed: true, parts: [] });
    const extra = Buffer.from(raw.toString().replace(`--${boundary}--`, `--${boundary}\r\nContent-Disposition: form-data; name="extra"\r\n\r\nvalue\r\n--${boundary}--`));
    const c = context(extra);
    const next = { handle: jest.fn(() => of('bad')) };
    await expect(new StoryManuscriptPasteMultipartInterceptor(new StoryManuscriptAdmission()).intercept(c.context, next)).rejects.toBeInstanceOf(HttpException);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it.each([
    {}, { 'content-type': 'application/json', 'content-length': '10' },
    { 'content-type': `multipart/form-data; boundary=x`, 'content-length': '0' },
    { 'content-type': `multipart/form-data; boundary=x`, 'content-length': '10', 'transfer-encoding': 'chunked' },
    { 'content-type': `multipart/form-data; boundary=x`, 'content-length': '10', 'content-encoding': 'gzip' },
    { 'content-type': `multipart/form-data; boundary=x`, 'content-length': String(MANUSCRIPT_FILE_LIMITS.requestBytes + 1) },
  ])('rejects unbounded/encoded/oversized envelopes before buffering %#', headers => {
    expect(() => manuscriptRequestLength(headers)).toThrow(HttpException);
  });

  it('admits only one in-flight process request and three per actor per minute with bounded bookkeeping', () => {
    const limiter = new StoryManuscriptAdmission();
    const first = limiter.enter('a', 0);
    expect(() => limiter.enter('b', 0)).toThrow(HttpException);
    first(); first();
    limiter.enter('a', 0)(); limiter.enter('a', 0)();
    expect(() => limiter.enter('a', 0)).toThrow(HttpException);
    limiter.enter('a', 60001)();
  });

  it('checks ownership before multipart processing, including invalid work and changed ownership', async () => {
    const prisma = { storyWork: { findFirst: jest.fn().mockResolvedValue(null) } };
    const guard = new StoryManuscriptOwnerGuard(prisma as never);
    const c = context(multipart());
    await expect(guard.canActivate(c.context)).rejects.toMatchObject({ status: 404 });
    expect(prisma.storyWork.findFirst).toHaveBeenCalledWith({ where: { id: workId, ownerUserId: user.id }, select: { id: true } });
    c.request.params.workId = 'invalid';
    await expect(guard.canActivate(c.context)).rejects.toMatchObject({ status: 400 });
  });

  it('runs the actual Multer/Nest parser with an in-memory stream, no HTTP/network', async () => {
    const c = context(multipart());
    const interceptor = new StoryManuscriptMultipartInterceptor(new StoryManuscriptAdmission());
    const next = { handle: jest.fn(() => of('receipt')) };
    const result = await interceptor.intercept(c.context, next);
    expect(await lastValueFrom(result)).toBe('receipt');
    expect((c.request as any).file.buffer.toString()).toBe(json);
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it.each(['unknown-field', 'truncated', 'short-length', 'long-length', 'extra-file', 'text-field'])('fails closed for %s without calling storage', async variant => {
    let raw = multipart(json, variant === 'unknown-field' ? 'other' : 'manuscript', variant !== 'truncated');
    if (variant === 'extra-file') raw = Buffer.from(raw.toString().replace(`--${boundary}--`, `--${boundary}\r\nContent-Disposition: form-data; name="manuscript"; filename="second.json"\r\n\r\n{}\r\n--${boundary}--`));
    if (variant === 'text-field') raw = Buffer.from(raw.toString().replace('; filename="synthetic.json"', ''));
    const c = context(raw, raw.length + (variant === 'short-length' ? -1 : variant === 'long-length' ? 1 : 0));
    const next = { handle: jest.fn(() => of('bad')) };
    const interceptor = new StoryManuscriptMultipartInterceptor(new StoryManuscriptAdmission());
    await expect(interceptor.intercept(c.context, next)).rejects.toBeInstanceOf(HttpException);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('releases admission on aborted requests and downstream errors', async () => {
    const admission = new StoryManuscriptAdmission();
    const interceptor = new StoryManuscriptMultipartInterceptor(admission);
    const request = Object.assign(new Readable({ read() {} }), { user, params: { workId },
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': '100' } });
    const ctx = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }) } as unknown as ExecutionContext;
    const promise = interceptor.intercept(ctx, { handle: () => of('bad') });
    request.emit('aborted');
    await expect(promise).rejects.toBeInstanceOf(HttpException);
    request.destroy();
    admission.enter('b')();
    const c = context(multipart());
    const result = await interceptor.intercept(c.context, { handle: () => throwError(() => new Error('synthetic failure')) });
    await expect(lastValueFrom(result)).rejects.toThrow('synthetic failure');
    admission.enter('b')();
  });

  it.each(['missing-boundary', 'unexpected-field'])('closes unfinished %s input before releasing admission, including Multer drain', async variant => {
    let sent = false;
    const request = Object.assign(new Readable({ read() {
      if (!sent && variant === 'unexpected-field') {
        sent = true;
        this.push(multipart(json, 'other', false));
      }
    } }), { user, params: { workId }, headers: {
      'content-type': variant === 'missing-boundary' ? 'multipart/form-data; missing-boundary=x' : `multipart/form-data; boundary=${boundary}`,
      'content-length': '1024',
    } });
    const ctx = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }) } as unknown as ExecutionContext;
    const admission = new StoryManuscriptAdmission();
    const enter = admission.enter.bind(admission);
    const closedAtRelease: boolean[] = [];
    jest.spyOn(admission, 'enter').mockImplementationOnce(actor => {
      const release = enter(actor);
      return () => { closedAtRelease.push(request.destroyed); release(); };
    });
    const next = { handle: jest.fn(() => of('bad')) };
    try {
      await expect(new StoryManuscriptMultipartInterceptor(admission).intercept(ctx, next)).rejects.toMatchObject({ status: 400 });
      expect(closedAtRelease).toEqual([true]);
      expect(request.destroyed).toBe(true);
      expect(request.listenerCount('data')).toBe(0);
      expect(next.handle).not.toHaveBeenCalled();
      admission.enter('other')();
    } finally { request.destroy(); }
  });

  it('enforces the exact multipart file byte boundary and the upload deadline', async () => {
    const interceptor = new StoryManuscriptMultipartInterceptor(new StoryManuscriptAdmission());
    const exact = context(multipart(' '.repeat(MANUSCRIPT_FILE_LIMITS.fileBytes - Buffer.byteLength(json)) + json));
    expect(await lastValueFrom(await interceptor.intercept(exact.context, { handle: () => of('ok') }))).toBe('ok');
    const over = context(multipart(' '.repeat(MANUSCRIPT_FILE_LIMITS.fileBytes + 1)));
    await expect(interceptor.intercept(over.context, { handle: () => of('bad') })).rejects.toMatchObject({ status: 413 });
    jest.useFakeTimers();
    try {
      const request = Object.assign(new Readable({ read() {} }), { user, params: { workId },
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': '100' } });
      const ctx = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }) } as unknown as ExecutionContext;
      const rejected = expect(interceptor.intercept(ctx, { handle: () => of('bad') })).rejects.toBeInstanceOf(HttpException);
      jest.advanceTimersByTime(MANUSCRIPT_FILE_LIMITS.uploadMilliseconds);
      await rejected;
      expect(request.destroyed).toBe(true);
    } finally { jest.useRealTimers(); }
  });

  it('does not accept missing/wrong-type/damaged files in direct calls', async () => {
    const prisma = { storyWork: { findFirst: jest.fn().mockResolvedValue({ id: workId }) }, $transaction: jest.fn() };
    const controller = new StoryManuscriptFileController(prisma as never);
    await expect(controller.create(user, workId, undefined)).rejects.toBeInstanceOf(HttpException);
    const file = { fieldname: 'manuscript', originalname: 'private.zip', mimetype: 'application/json', buffer: Buffer.from(json), size: Buffer.byteLength(json) };
    await expect(controller.create(user, workId, file as never)).rejects.toBeInstanceOf(HttpException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
