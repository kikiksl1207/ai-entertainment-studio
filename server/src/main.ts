import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { createValidationException } from './common/validation-exception.factory';

const defaultCorsOrigins = [
  'https://lumina-stage.com',
  'https://www.lumina-stage.com',
  'https://ai-entertainment-studio.vercel.app',
];

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'admin/api/v1/{*path}', method: RequestMethod.ALL },
      { path: 'health', method: RequestMethod.GET },
    ],
  });
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
    origin: parseCorsOrigins(configService.get<string>('CORS_ORIGINS')),
    credentials: true,
  });

  const port = Number(configService.get<string>('PORT') ?? 3001);
  await app.listen(port);
}

function parseCorsOrigins(value?: string) {
  if (!value) {
    return true;
  }

  return [...new Set([
    ...defaultCorsOrigins,
    ...value.split(',').map((origin) => origin.trim()).filter(Boolean),
  ])];
}

void bootstrap();
