import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { normalizeStoryAuthorCurrentFitParserException } from '../story-production/story-author-body-review.privacy';

type ErrorResponseBody = {
  message?: unknown;
  error?: string;
  code?: string;
  messageKey?: string;
  details?: unknown;
};

type RequestLike = {
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type ResponseLike = {
  status: (statusCode: number) => {
    json: (body: unknown) => void;
  };
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<ResponseLike>();
    const request = context.getRequest<RequestLike>();
    exception = normalizeStoryAuthorCurrentFitParserException(exception, request);
    exception = this.normalizeParserTooLargeException(exception);
    const requestId = this.getRequestId(request);
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = this.getBody(exception);
    const message = this.getMessage(body, statusCode);
    const code = this.getCode(body, statusCode);

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `Unhandled exception requestId=${requestId ?? 'unknown'} path=${request.url ?? 'unknown'} message=${this.getUnhandledMessage(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(statusCode).json({
      success: false,
      error: {
        code,
        message,
        messageKey: body.messageKey,
        statusCode,
        details: body.details,
        path: request.url,
        requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  private normalizeParserTooLargeException(exception: unknown): unknown {
    if (!(exception instanceof Error) || exception instanceof HttpException) return exception;
    const type = Object.getOwnPropertyDescriptor(exception, 'type');
    if (!type || !('value' in type) || type.value !== 'entity.too.large') return exception;

    // http-errors stores status on the Error prototype; never invoke an accessor.
    let owner: object | null = exception;
    for (let depth = 0; owner && depth < 4; depth += 1) {
      const status = Object.getOwnPropertyDescriptor(owner, 'status');
      if (status) {
        if (!('value' in status) || status.value !== HttpStatus.PAYLOAD_TOO_LARGE) return exception;
        return new HttpException({
          code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large',
        }, HttpStatus.PAYLOAD_TOO_LARGE);
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
    return exception;
  }

  private getBody(exception: unknown): ErrorResponseBody {
    if (!(exception instanceof HttpException)) {
      return {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      };
    }

    const response = exception.getResponse();

    if (typeof response === 'string') {
      return { message: response };
    }

    return response as ErrorResponseBody;
  }

  private getMessage(body: ErrorResponseBody, statusCode: number) {
    if (typeof body.message === 'string') {
      return body.message;
    }

    if (Array.isArray(body.message)) {
      return body.message.join(', ');
    }

    return body.error ?? HttpStatus[statusCode] ?? 'Error';
  }

  private getCode(body: ErrorResponseBody, statusCode: number) {
    if (body.code) {
      return body.code;
    }

    return (
      Object.entries(HttpStatus).find(([, value]) => value === statusCode)?.[0] ??
      'UNKNOWN_ERROR'
    );
  }

  private getRequestId(request: RequestLike) {
    const requestId = request.headers?.['x-request-id'];

    return Array.isArray(requestId) ? requestId[0] : requestId;
  }

  private getUnhandledMessage(exception: unknown) {
    if (exception instanceof Error) {
      return exception.message;
    }

    return String(exception);
  }
}
