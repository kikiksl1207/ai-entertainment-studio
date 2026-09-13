import { ArgumentsHost, ExecutionContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HealthController } from '../health.controller';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { UserAssetsService } from '../assets/user-assets.service';
import { OttMediaBrowserGuard } from './ott-media-browser.guard';
import { OttMediaController, OttMediaBrowserController } from './ott-media.controller';
import { fail, Upload } from './ott-media.contract';
import { OttMediaDelivery } from './ott-media.delivery';
import { OttMediaModule } from './ott-media.module';
import { OttMediaService } from './ott-media.service';
import { EXPECTED } from './ott-media.test-doubles';

const owner = randomUUID();
const file = randomUUID();
const upload: Upload = { id: file, ownerId: owner, workId: randomUUID(), versionId: randomUUID(), intentKey: 'test-key-1',
  expected: EXPECTED, status: 'confirmed', expiresAt: new Date(), verified: { ...EXPECTED, durationMs: 1000 },
  subtitles: [], confirmationHash: 'test-confirmation' };
const config = new ConfigService({ OTT_MEDIA_DELIVERY_SECRET: 'test-only-never-production'.repeat(2),
  OTT_MEDIA_BROWSER_ORIGINS: '["https://lumina-stage.com"]' });

describe('OTT browser capabilities', () => {
  const delivery = new OttMediaDelivery(config);
  it('issues file-scoped short HttpOnly cookie, not a URL credential', () => {
    const session = delivery.issueBrowserSession(upload);
    expect(session.path).not.toMatch(/\?|signature|storage/);
    expect(session.cookie).toContain(`Path=${session.path}; Max-Age=60; HttpOnly; Secure; SameSite=Strict`);
    expect(session.cookie).not.toContain(owner);
    expect(delivery.readBrowserSession(session.cookie.split(';')[0], file)).toMatchObject({ ownerId: owner, fileId: file, versionId: upload.versionId });
  });
  it('rejects absent/tampered/duplicate/cross-file cookies', () => {
    const session = delivery.issueBrowserSession(upload);
    const cookie = session.cookie.split(';')[0];
    for (const value of [undefined, '', cookie + 'a', `${cookie};${cookie}`]) expect(() => delivery.readBrowserSession(value, file)).toThrow();
    expect(() => delivery.readBrowserSession(cookie, randomUUID())).toThrow();
  });
  it('expires after 60s and a fresh authenticated session restores later Range authorization', () => {
    const now = Date.now();
    const time = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const old = delivery.issueBrowserSession(upload);
      time.mockReturnValue(now + 61_000);
      expect(() => delivery.readBrowserSession(old.cookie.split(';')[0], file)).toThrow();
      const fresh = delivery.issueBrowserSession(upload);
      expect(() => delivery.readBrowserSession(fresh.cookie.split(';')[0], file)).not.toThrow();
    } finally { time.mockRestore(); }
  });
  it('rejects untrusted/null/cross-site origins; native no-Origin GET is allowed only with a valid cookie', () => {
    expect(() => delivery.assertBrowserOrigin('https://lumina-stage.com', true, 'same-site')).not.toThrow();
    for (const origin of ['https://evil.example', 'null', undefined]) expect(() => delivery.assertBrowserOrigin(origin, true)).toThrow();
    expect(() => delivery.assertBrowserOrigin(undefined, false, 'cross-site')).toThrow();
    expect(() => delivery.assertBrowserOrigin(undefined, false, 'same-site')).not.toThrow();
  });
  it('checks active account on every native Range request', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: owner });
    const guard = new OttMediaBrowserGuard(delivery, { user: { findFirst } } as unknown as PrismaService);
    const req = { params: { fileId: file }, headers: { cookie: delivery.issueBrowserSession(upload).cookie.split(';')[0] } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: owner, status: 'active', deletedAt: null }, select: { id: true } });
    findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ response: { code: 'OTT_TOKEN_INVALID' } });
  });
});

describe('module startup isolation and generic-asset boundaries', () => {
  it('initializes the real OTT module and existing health controller with no OTT config; no DB connection', async () => {
    const prisma = { user: { findFirst: jest.fn() } };
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true, skipProcessEnv: true }), OttMediaModule],
      controllers: [HealthController],
    }).overrideProvider(PrismaService).useValue(prisma)
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => false })
      .overrideProvider(ConfigService).useValue(new ConfigService({})).compile();
    await module.init();
    try {
      expect(module.get(HealthController).check().status).toBe('ok');
      expect(module.get(OttMediaController)).toBeDefined();
      expect(module.get(OttMediaBrowserController)).toBeDefined();
      await expect(module.get(OttMediaService).createIntent(owner, randomUUID(), 'test-key-1', EXPECTED)).rejects.toMatchObject({ response: { code: 'OTT_STORAGE_UNAVAILABLE' } });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });
  it('requires separate authorization guards on both delivery surfaces', () => {
    expect(Reflect.getMetadata('__guards__', OttMediaController)).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata('__guards__', OttMediaBrowserController)).toContain(OttMediaBrowserGuard);
  });
  it('existing user/public asset reads cannot resolve an OTT-only id (explicit DB double)', async () => {
    const asset = { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) };
    const generic = new UserAssetsService({ asset } as unknown as PrismaService, new ConfigService({}));
    await expect(generic.getAsset(owner, file)).rejects.toMatchObject({ status: 404 });
    await expect(generic.getPublicAssetDeliveryUrl(file)).rejects.toMatchObject({ status: 404 });
    expect(asset.findFirst).toHaveBeenCalled();
  });
  it('preserves five-locale errors through the existing common HTTP filter', () => {
    const json = jest.fn();
    const host = { switchToHttp: () => ({ getRequest: () => ({ url: '/api/v1/me/ott-media/files/test', headers: {} }),
      getResponse: () => ({ status: () => ({ json }) }) }) } as unknown as ArgumentsHost;
    try { fail('NOT_READY'); } catch (error) { new HttpExceptionFilter().catch(error, host); }
    expect(json.mock.calls[0][0].error.details.messages).toHaveProperty('zh-Hant');
    expect(json.mock.calls[0][0].error.code).toBe('OTT_NOT_READY');
  });
});
