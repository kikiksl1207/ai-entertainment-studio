import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { Readable } from 'stream';
import { configureHttpRouting } from './common/http-routing';
import { parseCorsOrigins } from './main';
import { OttMediaDelivery } from './ott-media/ott-media.delivery';
import { OttPublicController } from './public/ott/ott-public.controller';
import { OttPublicService } from './public/ott/ott-public.service';

jest.mock('./app.module', () => ({ AppModule: class AppModule {} }));

const origin = 'https://lumina-stage.com';
const sessionPath = '/api/v1/ott/example/nodes/intro/playback-session';
const deliveryPath = '/api/v1/ott/example/nodes/intro/delivery';

describe('server CORS origins', () => {
  it('allows only known site origins outside local development and tests when the setting is absent', () => {
    for (const value of [undefined, '', '   ']) {
      expect(parseCorsOrigins(value, 'production')).toEqual([
        'https://lumina-stage.com', 'https://www.lumina-stage.com',
        'https://ai-entertainment-studio.vercel.app',
      ]);
      expect(parseCorsOrigins(value, 'staging')).toEqual(parseCorsOrigins(value, 'production'));
      expect(parseCorsOrigins(value, 'development')).toBe(true);
      expect(parseCorsOrigins(value, 'test')).toBe(true);
      expect(parseCorsOrigins(value)).toEqual(parseCorsOrigins(value, 'production'));
    }
  });

  it('retains configured origins and the existing production-site defaults', () => {
    expect(parseCorsOrigins(' https://preview.example, https://preview.example ', 'production')).toEqual([
      'https://lumina-stage.com',
      'https://www.lumina-stage.com',
      'https://ai-entertainment-studio.vercel.app',
      'https://preview.example',
    ]);
  });

  describe('public OTT browser requests', () => {
    let app: INestApplication;
    let baseUrl: string;

    async function start(corsOrigins: boolean | string[]) {
      const bytes = Buffer.from('example-video-bytes');
      const module = await Test.createTestingModule({
        controllers: [OttPublicController],
        providers: [
          {
            provide: OttPublicService,
            useValue: {
              browserSession: async () => ({ path: deliveryPath, expiresAt: new Date().toISOString(),
                cookie: '__Secure-ott-public=test; Path=/api/v1/ott; HttpOnly; Secure; SameSite=Strict' }),
              deliver: async () => ({
                sizeBytes: bytes.length,
                sha256: '',
                prefix: Buffer.alloc(0),
                stream: (start: number, end: number) => Readable.from([bytes.subarray(start, end + 1)]),
                close: async () => undefined,
              }),
            },
          },
          { provide: ConfigService, useValue: { get: () => JSON.stringify([origin]) } },
          OttMediaDelivery,
        ],
      }).compile();

      app = module.createNestApplication();
      configureHttpRouting(app);
      app.enableCors({ origin: corsOrigins, credentials: true });
      await app.listen(0, '127.0.0.1');
      baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    }

    afterEach(async () => {
      await app?.close();
    });

    it('keeps configured-origin session and byte-range access available to browsers', async () => {
      await start(parseCorsOrigins(origin, 'production'));

      const preflight = await fetch(baseUrl + sessionPath, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
      expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');

      const session = await fetch(baseUrl + sessionPath, { method: 'POST', headers: { Origin: origin } });
      expect(session.status).toBe(201);
      expect(session.headers.get('access-control-allow-origin')).toBe(origin);
      expect(session.headers.get('access-control-allow-credentials')).toBe('true');
      expect(session.headers.get('set-cookie')).toContain('HttpOnly');

      const range = await fetch(baseUrl + deliveryPath, {
        headers: { Origin: origin, Range: 'bytes=0-6', Cookie: '__Secure-ott-public=test' },
      });
      expect(range.status).toBe(206);
      expect(range.headers.get('access-control-allow-origin')).toBe(origin);
      expect(range.headers.get('access-control-allow-credentials')).toBe('true');
      expect(range.headers.get('content-range')).toBe('bytes 0-6/19');
      expect(Buffer.from(await range.arrayBuffer())).toEqual(Buffer.from('example'));

      const denied = await fetch(baseUrl + sessionPath, {
        method: 'OPTIONS',
        headers: { Origin: 'https://not-allowed.example', 'Access-Control-Request-Method': 'POST' },
      });
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();
      expect(denied.headers.get('access-control-allow-credentials')).toBe('true');
    });

    it('keeps known sites working while denying unknown origins when production origins are unset', async () => {
      await start(parseCorsOrigins(undefined, 'production'));

      const preflight = await fetch(baseUrl + sessionPath, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      });
      expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);

      const session = await fetch(baseUrl + sessionPath, { method: 'POST', headers: { Origin: origin } });
      expect(session.status).toBe(201);
      expect(session.headers.get('access-control-allow-origin')).toBe(origin);

      const range = await fetch(baseUrl + deliveryPath, {
        headers: { Origin: origin, Range: 'bytes=0-6', Cookie: '__Secure-ott-public=test' },
      });
      expect(range.status).toBe(206);
      expect(range.headers.get('access-control-allow-origin')).toBe(origin);

      const denied = await fetch(baseUrl + sessionPath, {
        method: 'OPTIONS',
        headers: { Origin: 'https://not-allowed.example', 'Access-Control-Request-Method': 'POST' },
      });
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
