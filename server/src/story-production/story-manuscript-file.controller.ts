import {
  CallHandler, CanActivate, Controller, ExecutionContext, HttpException, Injectable,
  Param, Post, Req, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { isUUID } from 'class-validator';
import { Readable } from 'stream';
import { TextDecoder } from 'util';
import { finalize } from 'rxjs';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { StoryUploadFile } from '../story-upload/story-upload.types';
import { invalidManuscript, MANUSCRIPT_FILE_LIMITS, prepareManuscript, preparePastedManuscript } from './story-manuscript-file.policy';
import { requireManuscriptOwner, storeManuscriptVersion } from './story-manuscript-version.store';

type FileRequest = Readable & {
  headers: Record<string, string | string[] | undefined>;
  params: { workId: string };
  user: AuthUser;
  aborted?: boolean;
};

export function manuscriptRequestLength(headers: FileRequest['headers'], paste = false) {
  const type = headers['content-type'];
  if (typeof type !== 'string' || !/^multipart\/form-data\s*;/i.test(type) || type.length > 256 ||
      headers['content-encoding'] !== undefined ||
      (headers['transfer-encoding'] !== undefined && (!paste || headers['transfer-encoding'] !== 'chunked'))) {
    invalidManuscript('MANUSCRIPT_MULTIPART_REQUIRED');
  }
  const raw = headers['content-length'];
  if (paste && raw === undefined && headers['transfer-encoding'] === 'chunked') return null;
  if (headers['transfer-encoding'] !== undefined) invalidManuscript('MANUSCRIPT_CONTENT_LENGTH_REQUIRED');
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,8}$/.test(raw)) invalidManuscript('MANUSCRIPT_CONTENT_LENGTH_REQUIRED');
  const size = Number(raw);
  if (size > (paste ? MANUSCRIPT_FILE_LIMITS.pasteRequestBytes : MANUSCRIPT_FILE_LIMITS.requestBytes)) throw new HttpException({
    code: 'MANUSCRIPT_REQUEST_TOO_LARGE', message: 'Manuscript request exceeds the byte limit',
  }, 413);
  return size;
}

@Injectable()
export class StoryManuscriptOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FileRequest>();
    if (!isUUID(request.params.workId)) invalidManuscript('MANUSCRIPT_INVALID_WORK_ID');
    manuscriptRequestLength(request.headers);
    await requireManuscriptOwner(this.prisma, request.user.id, request.params.workId);
    return true;
  }
}

@Injectable()
export class StoryManuscriptPasteOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FileRequest>();
    if (!isUUID(request.params.workId)) invalidManuscript('MANUSCRIPT_INVALID_WORK_ID');
    manuscriptRequestLength(request.headers, true);
    await requireManuscriptOwner(this.prisma, request.user.id, request.params.workId);
    return true;
  }
}

@Injectable()
export class StoryManuscriptAdmission {
  private active = false;
  private readonly actors = new Map<string, { until: number; count: number }>();

  enter(userId: string, now = Date.now()) {
    for (const [key, bucket] of this.actors) if (bucket.until <= now) this.actors.delete(key);
    const bucket = this.actors.get(userId);
    if (this.active || (bucket?.count ?? 0) >= 3 || (!bucket && this.actors.size >= 1024)) {
      throw new HttpException({ code: 'MANUSCRIPT_INTAKE_BUSY', message: 'Retry manuscript intake later' }, 429);
    }
    this.actors.set(userId, { until: bucket?.until ?? now + 60_000, count: (bucket?.count ?? 0) + 1 });
    this.active = true;
    let released = false;
    return () => { if (!released) { released = true; this.active = false; } };
  }
}

export const MANUSCRIPT_MULTIPART_OPTIONS = {
  // Busboy emits at equality; files/fields still permit exactly one file, no fields.
  limits: { files: 1, fields: 0, parts: 2, fileSize: MANUSCRIPT_FILE_LIMITS.fileBytes + 1,
    fieldNameSize: 64, headerPairs: 32 },
};
const SingleManuscriptInterceptor = FileInterceptor('manuscript', MANUSCRIPT_MULTIPART_OPTIONS);
const PastedManuscriptInterceptor = FileInterceptor('manuscript', {
  limits: { ...MANUSCRIPT_MULTIPART_OPTIONS.limits, fields: 1, parts: 3,
    fieldSize: MANUSCRIPT_FILE_LIMITS.manifestBytes + 1 },
});

@Injectable()
export class StoryManuscriptMultipartInterceptor {
  private readonly parser = new SingleManuscriptInterceptor();
  constructor(private readonly admission: StoryManuscriptAdmission) {}

  protected paste = false;

  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<FileRequest>();
    const expected = manuscriptRequestLength(request.headers, this.paste);
    const release = this.admission.enter(request.user.id);
    let received = 0;
    let invalidRawUtf8 = false;
    const utf8 = this.paste ? new TextDecoder('utf-8', { fatal: true }) : null;
    let fail!: (error: HttpException) => void;
    const stopped = new Promise<never>((_resolve, reject) => { fail = reject; });
    const onStop = () => fail(new HttpException({ code: 'MANUSCRIPT_INCOMPLETE_REQUEST', message: 'Complete manuscript request required' }, 400));
    const onData = (chunk: Buffer) => {
      received += chunk.length;
      if (received > (expected ?? MANUSCRIPT_FILE_LIMITS.pasteRequestBytes)) { onStop(); request.destroy(); }
      if (utf8) {
        try { utf8.decode(chunk, { stream: true }); }
        catch { invalidRawUtf8 = true; onStop(); request.destroy(); }
      }
    };
    const timeout = setTimeout(() => { onStop(); request.destroy(); }, MANUSCRIPT_FILE_LIMITS.uploadMilliseconds);
    timeout.unref();
    request.on('data', onData);
    request.once('aborted', onStop);
    request.once('error', onStop);
    try {
      const parser = this.paste ? new PastedManuscriptInterceptor() : this.parser;
      const result = await Promise.race([parser.intercept(context, { handle: () => {
        if (request.aborted || invalidRawUtf8 || (expected !== null && received !== expected)) invalidManuscript('MANUSCRIPT_INCOMPLETE_REQUEST');
        if (utf8) {
          try { utf8.decode(); } catch { invalidManuscript('MANUSCRIPT_INVALID_UTF8'); }
        }
        return next.handle().pipe(finalize(release));
      } }), stopped]);
      return result;
    } catch (error) {
      // An early parser error can leave unread bytes or a Multer drain behind.
      // Stop that input before releasing admission and removing its byte timer.
      if (!request.readableEnded) {
        request.unpipe();
        request.destroy();
      }
      release();
      const status = error instanceof HttpException && error.getStatus() === 413 ? 413 : 400;
      // Multer/parser errors must not echo submitted filenames, field names or text.
      throw new HttpException({ code: status === 413 ? 'MANUSCRIPT_FILE_TOO_LARGE' : 'MANUSCRIPT_INVALID_MULTIPART',
        message: 'One complete bounded manuscript file is required' }, status);
    } finally {
      clearTimeout(timeout);
      request.off('data', onData);
      request.off('aborted', onStop);
      request.off('error', onStop);
    }
  }
}

@Injectable()
export class StoryManuscriptPasteMultipartInterceptor extends StoryManuscriptMultipartInterceptor {
  constructor(admission: StoryManuscriptAdmission) { super(admission); }
  protected paste = true;
}

@Controller('me/creator-studio/stories/:workId/manuscripts')
export class StoryManuscriptFileController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('file')
  @UseGuards(JwtAuthGuard, StoryManuscriptOwnerGuard)
  @UseInterceptors(StoryManuscriptMultipartInterceptor)
  async create(@CurrentUser() user: AuthUser, @Param('workId') workId: string,
    @UploadedFile() file: StoryUploadFile | undefined) {
    // Recheck in direct service/controller calls too; the transaction checks again.
    await requireManuscriptOwner(this.prisma, user.id, workId);
    if (!file || file.fieldname !== 'manuscript' || !/\.json$/i.test(file.originalname) ||
        !['application/json', 'text/plain', 'application/octet-stream'].includes(file.mimetype) ||
        !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length) invalidManuscript('MANUSCRIPT_INVALID_FILE');
    return storeManuscriptVersion(this.prisma, user.id, workId, prepareManuscript(file.buffer));
  }

  @Post('paste')
  @UseGuards(JwtAuthGuard, StoryManuscriptPasteOwnerGuard)
  @UseInterceptors(StoryManuscriptPasteMultipartInterceptor)
  async paste(@CurrentUser() user: AuthUser, @Param('workId') workId: string,
    @UploadedFile() file: StoryUploadFile | undefined, @Req() request: FileRequest & { body?: Record<string, unknown> }) {
    await requireManuscriptOwner(this.prisma, user.id, workId);
    if (!file || file.fieldname !== 'manuscript' || !['text/plain', 'application/octet-stream'].includes(file.mimetype) ||
        !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length ||
        !request.body || Object.keys(request.body).length !== 1) invalidManuscript('MANUSCRIPT_INVALID_FILE');
    return storeManuscriptVersion(this.prisma, user.id, workId,
      preparePastedManuscript(file.buffer, request.body.manifest));
  }
}
