import { CallHandler, Controller, ExecutionContext, Headers, HttpException, Injectable, Param, Post,
  Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { finalize } from 'rxjs';
import { Readable } from 'stream';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryUploadFile } from '../story-upload/story-upload.types';
import { StoryAuthoredImportDto } from './dto/story-authored-import.dto';
import { AUTHORED_INITIAL_IMPORT_LIMITS } from './story-authored-import.contract';
import { StoryAuthoredImportService } from './story-authored-import.service';
import { manuscriptRequestLength, StoryManuscriptAdmission, StoryManuscriptOwnerGuard } from './story-manuscript-file.controller';
import { parseAuthoredImportMetadata } from './story-authored-source-map.policy';

const METADATA_BYTES = 8 * 1024;
export const AUTHORED_IMPORT_MULTIPART_OPTIONS = {
  limits: { files: 1, fields: 1, parts: 3, fileSize: AUTHORED_INITIAL_IMPORT_LIMITS.sourceMapFileBytes + 1,
    fieldSize: METADATA_BYTES + 1, fieldNameSize: 64, headerPairs: 32 },
};
const SourceMapParser = FileInterceptor('sourceMap', AUTHORED_IMPORT_MULTIPART_OPTIONS);
type ImportRequest = Readable & { headers: Record<string, string | string[] | undefined>;
  user: AuthUser; aborted?: boolean; body?: Record<string, unknown> };

function invalid(): never {
  throw new HttpException({ code: 'AUTHORED_IMPORT_MULTIPART_INVALID', message: 'One complete source map and bounded metadata are required' }, 400);
}

@Injectable()
export class StoryAuthoredImportMultipartInterceptor {
  private readonly parser = new SourceMapParser();
  constructor(private readonly admission: StoryManuscriptAdmission) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<ImportRequest>();
    // Reuse the existing 16 MiB + 16 KiB request envelope, not the global parser.
    const expected = manuscriptRequestLength(request.headers)!;
    const release = this.admission.enter(request.user.id);
    let received = 0;
    let fail!: (error: HttpException) => void;
    const stopped = new Promise<never>((_resolve, reject) => { fail = reject; });
    const onStop = () => fail(new HttpException({ code: 'AUTHORED_IMPORT_INCOMPLETE_REQUEST' }, 400));
    const onData = (chunk: Buffer) => {
      received += chunk.length;
      if (received > expected) { onStop(); request.destroy(); }
    };
    const timer = setTimeout(() => { onStop(); request.destroy(); }, 60_000);
    timer.unref();
    request.on('data', onData);
    request.once('aborted', onStop);
    request.once('error', onStop);
    try {
      return await Promise.race([this.parser.intercept(context, { handle: () => {
        if (request.aborted || received !== expected) invalid();
        return next.handle().pipe(finalize(release));
      } }), stopped]);
    } catch (error) {
      if (!request.readableEnded) { request.unpipe(); request.destroy(); }
      release();
      const status = error instanceof HttpException && error.getStatus() === 413 ? 413 : 400;
      throw new HttpException({ code: status === 413 ? 'AUTHORED_IMPORT_FILE_TOO_LARGE' : 'AUTHORED_IMPORT_MULTIPART_INVALID',
        message: 'One complete bounded authored source map is required' }, status);
    } finally {
      clearTimeout(timer);
      request.off('data', onData);
      request.off('aborted', onStop);
      request.off('error', onStop);
    }
  }
}

@Controller('me/creator-studio/stories/:workId/authored-imports')
@UseGuards(JwtAuthGuard, StoryManuscriptOwnerGuard)
export class StoryAuthoredImportController {
  constructor(private readonly imports: StoryAuthoredImportService) {}

  @Post()
  @UseInterceptors(StoryAuthoredImportMultipartInterceptor)
  execute(@CurrentUser() user: AuthUser, @Param('workId') workId: string,
    @UploadedFile() file: StoryUploadFile | undefined, @Req() request: ImportRequest,
    @Headers('idempotency-key') idempotencyKey?: string) {
    if (!file || file.fieldname !== 'sourceMap' || !/\.json$/i.test(file.originalname) ||
        !['application/json', 'text/plain', 'application/octet-stream'].includes(file.mimetype) ||
        !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length ||
        !request.body || Object.keys(request.body).length !== 1 ||
        typeof request.body.metadata !== 'string' || Buffer.byteLength(request.body.metadata) > METADATA_BYTES) invalid();
    const metadata = plainToInstance(StoryAuthoredImportDto, parseAuthoredImportMetadata(request.body.metadata));
    if (validateSync(metadata, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }).length) invalid();
    return this.imports.execute(user.id, workId, metadata, file.buffer, idempotencyKey);
  }
}
