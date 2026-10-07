import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { storyChatHistoryPrivacyMiddleware } from './chat/story-chat-history.privacy';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { createValidationException } from './common/validation-exception.factory';
import { configureHttpRouting } from './common/http-routing';
import { authorBodyReviewPrivacyMiddleware } from './story-production/story-author-body-review.privacy';
import { generatedEndingReadPrivacyMiddleware } from './story-production/story-generated-ending-read.controller';
import { authorBodyTrialReceiptPrivacyMiddleware } from './story-production/story-author-body-trial-receipt.controller';

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  header: (name: string) => string | undefined;
};

type ResponseLike = {
  setHeader: (name: string, value: string) => void;
};

type NextFunction = () => void;

const defaultCorsOrigins = [
  'https://lumina-stage.com',
  'https://www.lumina-stage.com',
  'https://ai-entertainment-studio.vercel.app',
];

export async function createApplication() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();
  const configService = app.get(ConfigService);
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(requestIdMiddleware);
  app.use(storyChatHistoryPrivacyMiddleware);
  app.use(authorBodyReviewPrivacyMiddleware);
  app.use(generatedEndingReadPrivacyMiddleware);
  app.use(authorBodyTrialReceiptPrivacyMiddleware);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  configureHttpRouting(app);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      exceptionFactory: createValidationException,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({
    origin: parseCorsOrigins(
      configService.get<string>('CORS_ORIGINS'),
      configService.get<string>('NODE_ENV'),
    ),
    credentials: true,
  });

  return app;
}

async function bootstrap() {
  const app = await createApplication();
  const configService = app.get(ConfigService);
  const port = Number(configService.get<string>('PORT') ?? 3001);
  await app.listen(port);
}

export function parseCorsOrigins(value?: string, nodeEnv?: string): boolean | string[] {
  if (!value?.trim()) {
    return nodeEnv === 'development' || nodeEnv === 'test' ? true : [...defaultCorsOrigins];
  }

  return [...new Set([
    ...defaultCorsOrigins,
    ...value.split(',').map((origin) => origin.trim()).filter(Boolean),
  ])];
}

if (require.main === module) {
  void bootstrap();
}

function requestIdMiddleware(
  request: RequestLike,
  response: ResponseLike,
  next: NextFunction,
) {
  const incomingRequestId = request.header('x-request-id');
  const requestId = incomingRequestId?.trim() || randomUUID();

  request.headers['x-request-id'] = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}
