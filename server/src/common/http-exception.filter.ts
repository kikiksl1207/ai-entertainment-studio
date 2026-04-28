import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

type ErrorResponseBody = {
  message?: unknown;
  error?: string;
  code?: string;
  details?: unknown;
};

type RequestLike = {
  url?: string;
};

type ResponseLike = {
  status: (statusCode: number) => {
    json: (body: unknown) => void;
  };
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<ResponseLike>();
    const request = context.getRequest<RequestLike>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = this.getBody(exception);
    const message = this.getMessage(body, statusCode);
    const code = this.getCode(body, statusCode);

    response.status(statusCode).json({
      success: false,
      error: {
        code,
        message,
        statusCode,
        details: body.details,
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    });
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
}
